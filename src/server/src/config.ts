/**
 * Configuration for the server application
 */

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  // GraphQL API configuration
  graphqlApiUrl: string; // GraphQL API endpoint URL
  graphqlApiKey: string; // SSI API key used as x-api-key header
  graphqlAuthToken?: string; // Optional bearer token for authenticated calls
  graphqlSessionCookie?: string; // Optional session cookie for authenticated calls
  graphqlAuthUsername?: string; // Optional SSI username for JWT auth mutation
  graphqlAuthPassword?: string; // Optional SSI password for JWT auth mutation
  graphqlTimeout: number; // Timeout for GraphQL requests in milliseconds
  graphqlCacheMaxAge: number; // Max age for GraphQL cache entries in milliseconds
  graphqlCacheIdleEviction: number; // Time after which inactive cache entries are evicted in milliseconds
  responseCacheTtl: number; // TTL for response cache in milliseconds
  // Rate limiting configuration
  rateLimitEnabled: boolean; // Whether to enable rate limiting
  rateLimitWindowMs: number; // Time window for rate limiting in milliseconds
  rateLimitMax: number; // Maximum requests per window
  // Monitoring (OpenTelemetry -> Grafana Cloud) configuration
  monitoring: MonitoringConfig;
}

/**
 * OpenTelemetry / Grafana Cloud monitoring configuration.
 *
 * When `enabled` is false the telemetry bootstrap is a no-op: the global OTel
 * providers stay no-op, so every `getMeter`/`getLogger` call downstream is free.
 * This keeps local dev and the test suite untouched unless monitoring is opted in.
 */
export interface MonitoringConfig {
  enabled: boolean; // Master switch (also requires an OTLP endpoint and non-test env)
  serviceName: string; // OTel service.name resource attribute
  serviceVersion: string; // OTel service.version resource attribute
  deploymentEnv: string; // OTel deployment.environment.name resource attribute
  otlpEndpoint?: string; // Base OTLP endpoint (signal path appended by exporter)
  metricExportIntervalMs: number; // How often metrics are pushed to the collector
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

  if (!config.graphqlApiKey) {
    throw new Error('GRAPHQL_API_KEY is required (used as x-api-key header)');
  }

  const hasAuthUsername = Boolean(config.graphqlAuthUsername);
  const hasAuthPassword = Boolean(config.graphqlAuthPassword);
  if (hasAuthUsername !== hasAuthPassword) {
    throw new Error('GRAPHQL_AUTH_USERNAME and GRAPHQL_AUTH_PASSWORD must be set together');
  }
}

/**
 * Builds the monitoring config from the environment.
 *
 * Monitoring is only active when explicitly opted in (`MONITORING_ENABLED` not
 * `false`), an OTLP endpoint is configured, and we are not running tests. The
 * endpoint is the standard OTel base URL (e.g. Grafana Cloud's
 * `https://otlp-gateway-<zone>.grafana.net/otlp`); the exporters read it and the
 * `OTEL_EXPORTER_OTLP_HEADERS` auth header directly from the environment.
 */
function getMonitoringConfig(nodeEnv: string): MonitoringConfig {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined;
  const optedIn = process.env.MONITORING_ENABLED !== 'false';
  return {
    enabled: optedIn && Boolean(otlpEndpoint) && nodeEnv !== 'test',
    serviceName: process.env.OTEL_SERVICE_NAME || 'livescore-server',
    serviceVersion: process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || '1.0.0',
    deploymentEnv: process.env.OTEL_DEPLOYMENT_ENVIRONMENT || nodeEnv,
    otlpEndpoint,
    metricExportIntervalMs: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || '60000', 10), // Default 60s
  };
}

const getConfig = (): ServerConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv,
    // GraphQL API configuration
    graphqlApiUrl: process.env.GRAPHQL_API_URL || 'https://shootnscoreit.com/graphql/',
    graphqlApiKey: process.env.GRAPHQL_API_KEY || '',
    graphqlAuthToken: process.env.GRAPHQL_AUTH_TOKEN,
    graphqlSessionCookie: process.env.GRAPHQL_SESSION_COOKIE,
    graphqlAuthUsername: process.env.GRAPHQL_AUTH_USERNAME,
    graphqlAuthPassword: process.env.GRAPHQL_AUTH_PASSWORD,
    graphqlTimeout: parseInt(process.env.GRAPHQL_TIMEOUT || '60000', 10), // Default 60 seconds
    graphqlCacheMaxAge: parseInt(process.env.GRAPHQL_CACHE_MAX_AGE_MS || String(3 * 24 * 60 * 60 * 1000), 10), // Default 3 days
    graphqlCacheIdleEviction: parseInt(process.env.GRAPHQL_CACHE_IDLE_EVICTION_MS || String(6 * 60 * 60 * 1000), 10), // Default 6 hours
    responseCacheTtl: parseInt(process.env.RESPONSE_CACHE_TTL_MS || '30000', 10), // Default 30 seconds
    // Rate limiting configuration (enabled by default, set RATE_LIMIT_ENABLED=false to disable)
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // Default 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // Default 100 requests per window
    monitoring: getMonitoringConfig(nodeEnv),
  };
  
  // Validate configuration (skip in test environment to allow flexibility)
  if (nodeEnv !== 'test') {
    validateConfig(config);
  }
  
  return config;
};

export const config = getConfig();
