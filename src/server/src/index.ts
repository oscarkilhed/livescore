import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { parseECMTxt } from './parser';
import { getCachedStages, __cache } from './cache';
import { config } from './config';
import { AppError, ValidationError, FeatureDisabledError, ParseError } from './errors';
import { initializeMockSsiApi } from './mockSsiApi';

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
 * GET endpoint for parsing live scores from ShootnScoreIt.com
 * 
 * Fetches HTML from the SSI API and parses it into structured stage data.
 * 
 * @route GET /:matchType/:matchId/:division/parse
 * @param {string} matchType - Event type ID (e.g., '22')
 * @param {string} matchId - Match ID (e.g., '21833')
 * @param {string} division - Division code (e.g., 'hg18' for Production Optics)
 * @returns {Array<Stage>} JSON array of stages with competitors and scores
 * @throws {400} If required parameters are missing
 * @throws {500} If parsing or fetching fails
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
  const validDivisions = ['all', 'hg1', 'hg2', 'hg3', 'hg5', 'hg12', 'hg18'];
  if (division !== 'all' && !validDivisions.includes(division)) {
    return res.status(400).json({ 
      error: `Invalid division code. Valid values: ${validDivisions.join(', ')}`,
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const stages = await getCachedStages(matchType.toString(), matchId.toString(), division.toString());
    res.json(stages);
  } catch (error) {
    if (error instanceof AppError) {
      // Log timeout errors with more detail
      if (error.statusCode === 504) {
        console.error(`[SSI API Timeout] Request failed for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error.message}`);
      } else {
        console.error(`[SSI API Error] Request failed for matchType=${matchType}, matchId=${matchId}, division=${division}: ${error.message}`);
      }
      
      // Enhance error response for SSI API timeouts
      const isSsiTimeout = error.statusCode === 504 && error.code === 'FETCH_ERROR';
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString(),
        ...(isSsiTimeout ? { 
          ssiApiTimeout: true,
          message: 'The SSI (ShootnScoreIt) API timed out. This usually means the external service is responding slowly. Please try again in a moment.'
        } : {}),
        ...(process.env.NODE_ENV === 'development' && error.cause ? { details: String(error.cause) } : {})
      });
    } else {
      console.error(`[Error] Unexpected error parsing livescore for matchType=${matchType}, matchId=${matchId}, division=${division}:`, error);
      res.status(500).json({ 
        error: 'Failed to parse livescore',
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
 * Health check endpoint for monitoring and load balancers
 * 
 * @route GET /health
 * @returns {object} Health status object
 */
app.get('/health', (req, res) => {
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
      size: Object.keys(__cache).length,
      healthy: true
    }
  });
});

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  // If mock mode is enabled, wait for initialization before starting server
  const startServer = async () => {
    if (process.env.MOCK_SSI_API === 'true' || process.env.MOCK_SSI_API === '1') {
      try {
        await initializeMockSsiApi();
        console.log('[Server] Mock SSI API initialized');
      } catch (error) {
        console.error('[Server] Failed to initialize mock SSI API:', error);
        process.exit(1);
      }
    }
    
    app.listen(port, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on port ${port}`);
    });
  };
  
  startServer();
} 