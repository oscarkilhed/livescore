/**
 * Configuration for the server application
 */

export interface ServerConfig {
  ssiApiBaseUrl: string;
  port: number;
  cacheTtl: number; // Cache TTL in milliseconds
  nodeEnv: string;
  essFeatureEnabled: boolean; // Feature flag for ESS (ECM text parsing) functionality
  fetchTimeout: number; // Timeout for external API requests in milliseconds
}

/**
 * Validates that required environment variables are set and have valid values.
 * Throws an error if validation fails.
 */
function validateConfig(config: ServerConfig): void {
  if (!config.ssiApiBaseUrl || !config.ssiApiBaseUrl.startsWith('http')) {
    throw new Error('SSI_API_BASE_URL must be a valid HTTP/HTTPS URL');
  }
  
  if (config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }
  
  if (config.cacheTtl < 0) {
    throw new Error('CACHE_TTL must be a positive number');
  }
}

const getConfig = (): ServerConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const config: ServerConfig = {
    ssiApiBaseUrl: process.env.SSI_API_BASE_URL || 'https://shootnscoreit.com',
    port: parseInt(process.env.PORT || '3000', 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || '300000', 10), // Default 5 minutes
    nodeEnv,
    essFeatureEnabled: process.env.ESS_FEATURE_ENABLED === 'true' || process.env.ESS_FEATURE_ENABLED === '1',
    fetchTimeout: parseInt(process.env.FETCH_TIMEOUT || '120000', 10), // Default 120 seconds (2 minutes)
  };
  
  // Validate configuration (skip in test environment to allow flexibility)
  if (nodeEnv !== 'test') {
    validateConfig(config);
  }
  
  return config;
};

export const config = getConfig();

/**
 * Builds the SSI API URL for fetching live scores
 * @param eventId - The event ID
 * @param matchId - The match ID
 * @param division - The division code
 * @returns The full URL for fetching live scores
 */
export function buildSsiApiUrl(eventId: string, matchId: string, division: string): string {
  return `${config.ssiApiBaseUrl}/event/${eventId}/${matchId}/live-scores/?divShown=${division}`;
}
