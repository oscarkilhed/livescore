import 'dotenv/config';
// Side-effect import: initializes OpenTelemetry before any instrument/logger is
// created. Must stay directly after dotenv/config and before ./metrics, ./logger
// and ./graphql (see telemetry.ts for why ordering matters).
import './telemetry';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { AppError } from './errors';
import { fetchEventWithCache, getGraphQLCacheStats, clearGraphQLCache, transformStages, CachedEvent, LiveScoresResult } from './graphql';
import { Stage } from './types';
import { recordHit, getHotMatches, getActiveMatchCount, DEFAULT_LIMIT } from './hotMatches';
import { recordActiveUser, getActiveUserCounts } from './activeUsers';
import { logger } from './logger';
import {
  recordHttpRequest,
  recordCacheAccess,
  recordClientEvent,
  recordClientEventRejected,
  recordExcludedStageCount,
  recordComparisonSize,
  initMetricGauges,
  ClientEventAttributes,
} from './metrics';

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
 * Valid division codes. Shared by the `/parse` route and the `/events` analytics
 * endpoint so both validate divisions against the same allowlist.
 */
const VALID_DIVISIONS = ['all', 'hg1', 'hg2', 'hg3', 'hg5', 'hg12', 'hg17', 'hg18', 'hg33'];

/** Result views/tabs the client can page between (mirrors client `VIEWS`). */
const VALID_VIEWS = ['standings', 'stages', 'projected'];

/**
 * Known IPSC category codes (plus 'Overall'). Anything else a client sends is
 * bucketed to 'other' so metric label cardinality stays bounded.
 */
const KNOWN_CATEGORIES = ['Overall', 'O', 'L', 'LS', 'SJ', 'J', 'S', 'SS', 'GS'];

/** Client behavior events we accept on `/events`. */
const VALID_CLIENT_EVENTS = [
  'view_changed',
  'division_selected',
  'category_selected',
  'stages_excluded',
  'comparison_changed',
];

/** Upper bound for stage/competitor counts, guarding against absurd payloads. */
const MAX_COUNT = 100;

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

/**
 * Per-process salt so hashed-IP visitor ids can't be reversed or correlated
 * across restarts. Regenerated each boot, consistent with the in-memory store.
 */
const VISITOR_ID_SALT = crypto.randomBytes(16).toString('hex');

/**
 * Best-effort per-browser id for unique-visitor counting on hot matches. Prefers
 * the client's anonymous `x-visitor-id` (validated and length-bounded to cap
 * memory and blunt spoofing); falls back to a salted hash of the client IP so
 * older cached clients that don't send the header never regress to raw request
 * counts. The `c:`/`ip:` prefixes keep the two id spaces from colliding.
 */
function resolveVisitorId(req: express.Request): string {
  const header = req.get('x-visitor-id');
  if (header && /^[A-Za-z0-9_-]{8,64}$/.test(header)) {
    return `c:${header}`;
  }
  const ip = req.ip || 'unknown';
  const hash = crypto.createHash('sha256').update(VISITOR_ID_SALT).update(ip).digest('hex');
  return `ip:${hash.slice(0, 16)}`;
}

// Enable CORS for all routes
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

/**
 * HTTP request metrics. Records latency per request labeled by method, a
 * normalized route pattern, and status code. Using the matched route pattern
 * (e.g. `/:matchType/:matchId/:division/parse`) rather than the raw URL keeps
 * label cardinality bounded; unmatched requests collapse to `unmatched`.
 */
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path
      ? String(req.route.path)
      : (req.baseUrl || 'unmatched');
    recordHttpRequest(req.method, route, res.statusCode, seconds);
  });
  next();
});

// Feed the observable gauges (cache sizes, active hot matches, process memory).
// No-op when monitoring is disabled since the instruments are no-op.
initMetricGauges({
  responseCacheSize: () => getResponseCacheStats().size,
  graphqlCacheSize: () => getGraphQLCacheStats().size,
  hotMatchesActive: () => getActiveMatchCount(),
  activeUserCounts: () => getActiveUserCounts(),
});

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
  app.use('/events', apiLimiter);
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
  if (division !== 'all' && !VALID_DIVISIONS.includes(division)) {
    return res.status(400).json({ 
      error: `Invalid division code. Valid values: ${VALID_DIVISIONS.join(', ')}`,
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Burst cache is keyed by event, not division — the fetch returns every
    // division's scorecards, and we filter the requested division at serve time.
    const cacheKey = `${matchType}-${matchId}`;
    const contentType = parseInt(matchType, 10);
    // Resolve the viewer once so cache hits and fresh fetches dedup identically.
    const visitorId = resolveVisitorId(req);
    // Count this viewer toward global active-users (union across all matches).
    recordActiveUser(visitorId);

    // Check response cache first (short TTL). A hit returns the memoized
    // transform for this division — no re-transformation.
    const cached = getCachedResponse(cacheKey, division);
    if (cached) {
      recordCacheAccess('response', 'hit');
      // Cache hits are still real views — count them for hot-match tracking.
      recordHit(matchType, matchId, division, cached.eventName, visitorId);
      return res.json(cached);
    }
    recordCacheAccess('response', 'miss');

    // Fetch the full event (all divisions) from the GraphQL API, cache the raw
    // stages, and return the transformed result for the requested division.
    const event = await fetchEventWithCache(contentType, matchId);
    const result = setCachedResponse(cacheKey, event, division);

    recordHit(matchType, matchId, division, result.eventName, visitorId);
    res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      // Log timeout errors with more detail
      const kind = error.statusCode === 504 ? 'GraphQL Timeout' : 'GraphQL Error';
      logger.error(`[${kind}] Request failed for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error.message}`, {
        matchType,
        matchId,
        division,
        statusCode: error.statusCode,
        code: error.code,
      });
      
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
      logger.error(`[Error] Unexpected error fetching livescore for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error instanceof Error ? error.message : String(error)}`, {
        matchType,
        matchId,
        division,
      });
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
 * POST endpoint for anonymous client behavior analytics.
 *
 * The client fires small, fire-and-forget events describing UI interactions that
 * never otherwise reach the server (tab switches, division/category selection,
 * stage exclusion, comparison). We validate them against fixed allowlists — this
 * server-side normalization is what keeps metric label cardinality bounded — and
 * turn each valid event into an OpenTelemetry counter increment.
 *
 * Always responds 204 (even for invalid input) so a misbehaving or outdated
 * client can never be paged by, or learn anything from, the analytics path.
 * Reached via nginx's `/api/*` -> `/*` rewrite (like `/hot-matches`).
 *
 * @route POST /events
 * @body {string} event - One of VALID_CLIENT_EVENTS
 * @body {object} [props] - Optional { view, division, category, count, size }
 */
app.post('/events', (req, res) => {
  const body = (req.body ?? {}) as { event?: unknown; props?: unknown };
  const event = typeof body.event === 'string' ? body.event : '';
  const props = (typeof body.props === 'object' && body.props !== null ? body.props : {}) as Record<string, unknown>;

  if (!VALID_CLIENT_EVENTS.includes(event)) {
    recordClientEventRejected();
    return res.status(204).end();
  }

  // Normalize the optional dimensions against fixed enums; drop anything unknown.
  const attrs: ClientEventAttributes = {};
  if (event === 'view_changed' && typeof props.view === 'string' && VALID_VIEWS.includes(props.view)) {
    attrs.view = props.view;
  }
  if (event === 'division_selected' && typeof props.division === 'string' && VALID_DIVISIONS.includes(props.division)) {
    attrs.division = props.division;
  }
  if (event === 'category_selected' && typeof props.category === 'string') {
    attrs.category = KNOWN_CATEGORIES.includes(props.category) ? props.category : 'other';
  }

  recordClientEvent(event, attrs);
  // A validated behavior event is a live viewer too — count toward active users.
  recordActiveUser(resolveVisitorId(req));

  // Bounded numeric detail for the two events that carry a magnitude.
  const rawCount = Number(props.count ?? props.size);
  if (Number.isFinite(rawCount)) {
    const count = Math.min(MAX_COUNT, Math.max(0, Math.floor(rawCount)));
    if (event === 'stages_excluded' && count > 0) {
      recordExcludedStageCount(count);
    } else if (event === 'comparison_changed' && count >= 2) {
      recordComparisonSize(count);
    }
  }

  return res.status(204).end();
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
    logger.info(`Server running on port ${port}`, {
      port,
      monitoringEnabled: config.monitoring.enabled,
    });
  });
}
