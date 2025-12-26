import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { parseECMTxt } from './parser';
import { config } from './config';
import { AppError, ValidationError, FeatureDisabledError } from './errors';
import { fetchLiveScoresWithCache, getGraphQLCacheStats, clearGraphQLCache } from './graphql';
import { Stage } from './types';

// ============================================================================
// Response Cache (short TTL for reducing API load)
// ============================================================================

/**
 * Short-lived cache for parsed stage responses
 * Prevents multiple clients from hitting the API simultaneously
 */
interface ResponseCacheEntry {
  stages: Stage[];
  timestamp: number;
}

const responseCache: Map<string, ResponseCacheEntry> = new Map();

/**
 * Response cache TTL in milliseconds
 * Default: 5 seconds - short enough for live updates, long enough to batch requests
 * Configurable via config.responseCacheTtl
 */
const RESPONSE_CACHE_TTL_MS = config.responseCacheTtl;

/**
 * Get cached response or null if expired/missing
 */
function getCachedResponse(key: string): Stage[] | null {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL_MS) {
    return entry.stages;
  }
  return null;
}

/**
 * Store response in cache
 */
function setCachedResponse(key: string, stages: Stage[]): void {
  responseCache.set(key, {
    stages,
    timestamp: Date.now()
  });
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
app.set('trust proxy', true);

// Enable CORS for all routes
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

/**
 * Rate limiting middleware
 * Limits each IP to 100 requests per 15 minutes
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to API routes (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/', apiLimiter);
  app.use('/:matchType/:matchId/:division/parse', apiLimiter);
  app.use('/ecm/txt/parse', apiLimiter);
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
 * @returns {Array<Stage>} JSON array of stages with competitors and scores
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
    const cacheKey = `${matchType}-${matchId}-${division}`;
    
    // Check response cache first (short TTL)
    const cachedStages = getCachedResponse(cacheKey);
    if (cachedStages) {
      return res.json(cachedStages);
    }
    
    // Fetch from GraphQL API
    const contentType = parseInt(matchType, 10);
    const stages = await fetchLiveScoresWithCache(contentType, matchId, division);
    
    // Cache the response
    setCachedResponse(cacheKey, stages);
    
    res.json(stages);
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
 * POST endpoint for parsing ECM (European Championship Match) text format
 * 
 * Accepts ECM text content in the request body and parses it into structured stage data.
 * This endpoint is behind a feature flag (ESS_FEATURE_ENABLED) and returns 403 if disabled.
 * 
 * @route POST /ecm/txt/parse
 * @param {string} req.body - ECM text content (plain text, up to 20MB)
 * @returns {Array<Stage>} JSON array of stages with competitors and scores
 * @throws {403} If ESS feature is disabled
 * @throws {400} If request body is empty
 * @throws {500} If parsing fails
 * 
 * @example
 * POST /ecm/txt/parse
 * Content-Type: text/plain
 * Body: "Production Optics - Stage 1\nPlace\t#\tShooter\t..."
 */
app.post('/ecm/txt/parse', express.text({ type: '*/*', limit: '20mb' }), async (req, res) => {
  // Check feature flag
  if (!config.essFeatureEnabled) {
    const error = new FeatureDisabledError('ESS');
    return res.status(error.statusCode).json({ 
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    const bodyText = (req.body || '').toString();
    
    // Validate request body is not empty
    if (!bodyText || bodyText.trim().length === 0) {
      const error = new ValidationError('Empty request body');
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      });
    }

    // Validate body size (explicit check)
    const sizeInMB = Buffer.byteLength(bodyText, 'utf8') / (1024 * 1024);
    if (sizeInMB > 20) {
      const error = new ValidationError(`Request body too large: ${sizeInMB.toFixed(2)}MB (max 20MB)`);
      return res.status(413).json({ 
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      });
    }

    const parseStartTime = Date.now();
    const stages = parseECMTxt(bodyText);
    const parseElapsed = Date.now() - parseStartTime;
    console.log(`[Parse] Successfully parsed ECM text in ${parseElapsed}ms (${stages.length} stages, body size: ${sizeInMB.toFixed(2)}MB)`);
    return res.json(stages);
  } catch (error) {
    console.error('Error parsing ECM text payload:', error);
    
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && error.cause ? { details: String(error.cause) } : {})
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to parse ECM text payload',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
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
