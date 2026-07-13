import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { AppError } from './errors';
import { fetchEventWithCache, getGraphQLCacheStats, clearGraphQLCache, transformStages, CachedEvent, LiveScoresResult } from './graphql';
import { Stage } from './types';
import { recordHit, getHotMatches, DEFAULT_LIMIT } from './hotMatches';

// ============================================================================
// Response Cache (short TTL for reducing API load)
// ============================================================================

/**
 * Short-lived burst cache for parsed events. Keyed by event (matchType-matchId),
 * NOT by division: the underlying SSI fetch always returns every division's
 * scorecards, so one entry serves all divisions.
 *
 * Each entry keeps the raw stages plus a per-division memo of the transformed
 * result, so the (non-trivial) division transform runs at most once per division
 * per entry — repeat requests for the same division are served straight from the
 * memo, and a new division is transformed on demand from the same raw stages.
 */
interface ResponseCacheEntry extends CachedEvent {
  timestamp: number;
  /** division code (or 'all') -> transformed stages, populated lazily. */
  transformed: Map<string, Stage[]>;
}

const responseCache: Map<string, ResponseCacheEntry> = new Map();

/**
 * Response cache TTL in milliseconds
 * Default: 30 seconds - short enough for near-live updates, long enough to batch
 * bursts (including across divisions). Configurable via config.responseCacheTtl.
 */
const RESPONSE_CACHE_TTL_MS = config.responseCacheTtl;

/**
 * Return the transformed result for `division` from a fresh cache entry, or null
 * if the entry is missing/expired. Transforms and memoizes on first access for a
 * division so repeat requests skip the work.
 */
function getCachedResponse(key: string, division: string): LiveScoresResult | null {
  const entry = responseCache.get(key);
  if (!entry || Date.now() - entry.timestamp >= RESPONSE_CACHE_TTL_MS) {
    return null;
  }
  let stages = entry.transformed.get(division);
  if (!stages) {
    stages = transformStages(entry.stages, division);
    entry.transformed.set(division, stages);
  }
  return { eventName: entry.eventName, stages };
}

/**
 * Store a freshly fetched raw event and return the transformed result for the
 * requested division (also seeding that division's memo).
 */
function setCachedResponse(key: string, event: CachedEvent, division: string): LiveScoresResult {
  const stages = transformStages(event.stages, division);
  responseCache.set(key, {
    eventName: event.eventName,
    stages: event.stages,
    transformed: new Map([[division, stages]]),
    timestamp: Date.now(),
  });
  return { eventName: event.eventName, stages };
}

/**
 * Get response cache stats
 */
export function getResponseCacheStats(): { size: number; ttlMs: number } {
  // Clean up expired entries
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now - entry.timestamp >= RESPONSE_CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }
  
  return {
    size: responseCache.size,
    ttlMs: RESPONSE_CACHE_TTL_MS
  };
}

/**
 * Express application instance.
 * Exported for testing purposes (e.g., with supertest).
 */
export const app = express();
const port = config.port;

// Trust proxy - required when behind nginx reverse proxy
// This allows Express to correctly identify client IPs from X-Forwarded-For header
// Using 1 to trust only the first proxy (nginx) instead of true which is too permissive
app.set('trust proxy', 1);

// Enable CORS for all routes
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

/**
 * Rate limiting middleware
 * Configurable via RATE_LIMIT_ENABLED, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX env vars
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: {
    error: 'Too many requests from this IP, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to API routes (skip in test environment or when disabled via config)
if (config.rateLimitEnabled && process.env.NODE_ENV !== 'test') {
  app.use('/api/', apiLimiter);
  app.use('/:matchType/:matchId/:division/parse', apiLimiter);
}

/**
 * GET endpoint for fetching live scores from ShootnScoreIt.com via GraphQL API
 * 
 * Fetches data from the SSI GraphQL API and returns structured stage data.
 * 
 * @route GET /:matchType/:matchId/:division/parse
 * @param {string} matchType - Event type ID (e.g., '22')
 * @param {string} matchId - Match ID (e.g., '21833')
 * @param {string} division - Division code (e.g., 'hg18' for Production Optics)
 * @returns {object} JSON object with eventName and stages array
 * @throws {400} If required parameters are missing
 * @throws {500} If fetching fails
 * 
 * @example
 * GET /22/21833/hg18/parse
 */
app.get('/:matchType/:matchId/:division/parse', async (req, res) => {
  const { matchType, matchId, division } = req.params;
  
  // Validate required parameters
  if (!matchType || !matchId || !division) {
    return res.status(400).json({ 
      error: 'Missing required parameters',
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  // Validate parameter formats
  if (!/^\d+$/.test(matchType) || !/^\d+$/.test(matchId)) {
    return res.status(400).json({ 
      error: 'Invalid parameter format: matchType and matchId must be numeric',
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  // Validate division format
  const validDivisions = ['all', 'hg1', 'hg2', 'hg3', 'hg5', 'hg12', 'hg17', 'hg18', 'hg33'];
  if (division !== 'all' && !validDivisions.includes(division)) {
    return res.status(400).json({ 
      error: `Invalid division code. Valid values: ${validDivisions.join(', ')}`,
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Burst cache is keyed by event, not division — the fetch returns every
    // division's scorecards, and we filter the requested division at serve time.
    const cacheKey = `${matchType}-${matchId}`;
    const contentType = parseInt(matchType, 10);

    // Check response cache first (short TTL). A hit returns the memoized
    // transform for this division — no re-transformation.
    const cached = getCachedResponse(cacheKey, division);
    if (cached) {
      // Cache hits are still real views — count them for hot-match tracking.
      recordHit(matchType, matchId, division, cached.eventName);
      return res.json(cached);
    }

    // Fetch the full event (all divisions) from the GraphQL API, cache the raw
    // stages, and return the transformed result for the requested division.
    const event = await fetchEventWithCache(contentType, matchId);
    const result = setCachedResponse(cacheKey, event, division);

    recordHit(matchType, matchId, division, result.eventName);
    res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      // Log timeout errors with more detail
      if (error.statusCode === 504) {
        console.error(`[GraphQL Timeout] Request failed for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error.message}`);
      } else {
        console.error(`[GraphQL Error] Request failed for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error.message}`);
      }
      
      // Enhance error response for API timeouts
      const isTimeout = error.statusCode === 504;
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString(),
        ...(isTimeout ? { 
          apiTimeout: true,
          message: 'The GraphQL API timed out. This usually means the external service is responding slowly. Please try again in a moment.'
        } : {}),
        ...(process.env.NODE_ENV === 'development' && error.cause ? { details: String(error.cause) } : {})
      });
    } else {
      console.error(`[Error] Unexpected error fetching livescore for matchType=${matchType}, matchId=${matchId}, division=${division}:`, error);
      res.status(500).json({ 
        error: 'Failed to fetch livescore',
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
});

/**
 * DELETE endpoint to clear GraphQL cache for a specific competition
 * 
 * Useful when cache data is corrupted or needs to be refreshed manually.
 * 
 * @route DELETE /api/cache/:matchType/:matchId
 * @param {string} matchType - Event type ID (e.g., '22')
 * @param {string} matchId - Match ID (e.g., '21833')
 * @returns {object} Confirmation message
 * 
 * @example
 * DELETE /api/cache/22/21833
 */
app.delete('/api/cache/:matchType/:matchId', (req, res) => {
  const { matchType, matchId } = req.params;
  
  // Validate parameters
  if (!/^\d+$/.test(matchType) || !/^\d+$/.test(matchId)) {
    return res.status(400).json({
      error: 'Invalid parameter format: matchType and matchId must be numeric',
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
  
  const contentType = parseInt(matchType, 10);
  clearGraphQLCache(contentType, matchId);
  
  return res.json({
    message: `Cache cleared for event ${matchType}-${matchId}`,
    timestamp: new Date().toISOString()
  });
});

/**
 * DELETE endpoint to clear all GraphQL cache entries
 * 
 * Clears the entire GraphQL cache. Use with caution.
 * 
 * @route DELETE /api/cache
 * @returns {object} Confirmation message
 */
app.delete('/api/cache', (req, res) => {
  const stats = getGraphQLCacheStats();
  const clearedCount = stats.size;
  
  clearGraphQLCache();
  
  return res.json({
    message: `Cache cleared: ${clearedCount} entries removed`,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET endpoint returning the matches currently being viewed most.
 *
 * Derived from `/parse` traffic tracked in-memory. Used by the client landing
 * page to surface "live now" matches when no match is selected.
 *
 * @route GET /hot-matches
 * @query {number} [limit] - Max matches to return (clamped to 1..50)
 * @returns {object} JSON object with a `matches` array, ranked by recent views
 *
 * Note: in production the client reaches this via `/api/hot-matches`; nginx
 * rewrites `^/api/(.*)` to `/$1` before proxying, mirroring the `/parse` route.
 */
app.get('/hot-matches', (req, res) => {
  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(50, Math.max(1, rawLimit))
    : DEFAULT_LIMIT;

  res.json({ matches: getHotMatches(limit) });
});

/**
 * Health check endpoint for monitoring and load balancers
 *
 * @route GET /health
 * @returns {object} Health status object
 */
app.get('/health', (req, res) => {
  const graphqlCacheStats = getGraphQLCacheStats();
  const responseCacheStats = getResponseCacheStats();
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) // MB
    },
    cache: {
      response: {
        size: responseCacheStats.size,
        ttlMs: responseCacheStats.ttlMs
      },
      graphql: {
        size: graphqlCacheStats.size,
        evictionAfterSeconds: Math.round(graphqlCacheStats.evictionAgeMs / 1000),
        entries: graphqlCacheStats.entries.map(e => ({
          key: e.key,
          ageSeconds: Math.round(e.age / 1000),
          idleSeconds: Math.round(e.idleTime / 1000),
          scorecards: e.scorecardCount
        }))
      }
    }
  });
});

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  app.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on port ${port}`);
  });
}
