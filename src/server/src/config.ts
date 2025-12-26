/**
 * Configuration for the server application
 */

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  essFeatureEnabled: boolean; // Feature flag for ESS (ECM text parsing) functionality
  // GraphQL API configuration
  graphqlApiUrl: string; // GraphQL API endpoint URL
  graphqlTimeout: number; // Timeout for GraphQL requests in milliseconds
  graphqlCacheMaxAge: number; // Max age for GraphQL cache entries in milliseconds
  graphqlCacheIdleEviction: number; // Time after which inactive cache entries are evicted in milliseconds
  responseCacheTtl: number; // TTL for response cache in milliseconds
  // Rate limiting configuration
  rateLimitEnabled: boolean; // Whether to enable rate limiting
  rateLimitWindowMs: number; // Time window for rate limiting in milliseconds
  rateLimitMax: number; // Maximum requests per window
}

/**
 * Validates that required environment variables are set and have valid values.
 * Throws an error if validation fails.
 */
function validateConfig(config: ServerConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }
  
  if (!config.graphqlApiUrl || !config.graphqlApiUrl.startsWith('http')) {
    throw new Error('GRAPHQL_API_URL must be a valid HTTP/HTTPS URL');
  }
}

const getConfig = (): ServerConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv,
    essFeatureEnabled: process.env.ESS_FEATURE_ENABLED === 'true' || process.env.ESS_FEATURE_ENABLED === '1',
    // GraphQL API configuration
    graphqlApiUrl: process.env.GRAPHQL_API_URL || 'https://shootnscoreit.com/graphql/',
    graphqlTimeout: parseInt(process.env.GRAPHQL_TIMEOUT || '60000', 10), // Default 60 seconds
    graphqlCacheMaxAge: parseInt(process.env.GRAPHQL_CACHE_MAX_AGE_MS || String(3 * 24 * 60 * 60 * 1000), 10), // Default 3 days
    graphqlCacheIdleEviction: parseInt(process.env.GRAPHQL_CACHE_IDLE_EVICTION_MS || String(60 * 60 * 1000), 10), // Default 1 hour
    responseCacheTtl: parseInt(process.env.RESPONSE_CACHE_TTL_MS || '5000', 10), // Default 5 seconds
    // Rate limiting configuration (enabled by default, set RATE_LIMIT_ENABLED=false to disable)
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // Default 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // Default 100 requests per window
  };
  
  // Validate configuration (skip in test environment to allow flexibility)
  if (nodeEnv !== 'test') {
    validateConfig(config);
  }
  
  return config;
};

export const config = getConfig();
