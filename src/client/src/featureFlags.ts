/**
 * Feature Flags Configuration
 * 
 * Feature flags allow enabling/disabling features without code changes.
 * Flags can be controlled via environment variables or runtime configuration.
 * 
 * Usage:
 *   import { isFeatureEnabled } from './featureFlags';
 *   if (isFeatureEnabled('ESS_FEATURE')) { ... }
 */

export type FeatureFlag = 'ESS_FEATURE';

interface FeatureFlagConfig {
  [key: string]: boolean;
}

/**
 * Default feature flag values
 * These can be overridden by environment variables
 */
const defaultFlags: Record<FeatureFlag, boolean> = {
  ESS_FEATURE: false, // ESS feature disabled by default
};

/**
 * Get feature flag value from environment variables
 * Environment variables should be prefixed with REACT_APP_ for Create React App
 * Format: REACT_APP_FEATURE_FLAG_<FLAG_NAME>=true|false
 */
function getFeatureFlagsFromEnv(): Partial<FeatureFlagConfig> {
  const flags: Partial<FeatureFlagConfig> = {};
  
  // Check for ESS_FEATURE flag
  const essFeature = process.env.REACT_APP_FEATURE_FLAG_ESS_FEATURE;
  if (essFeature !== undefined) {
    flags.ESS_FEATURE = essFeature === 'true' || essFeature === '1';
  }
  
  return flags;
}

/**
 * Merged feature flag configuration
 * Environment variables override defaults
 */
const featureFlags: Record<FeatureFlag, boolean> = {
  ...defaultFlags,
  ...getFeatureFlagsFromEnv(),
};

/**
 * Check if a feature flag is enabled
 * 
 * @param flag - The feature flag name to check
 * @returns true if the feature is enabled, false otherwise
 * 
 * @example
 * ```typescript
 * if (isFeatureEnabled('ESS_FEATURE')) {
 *   // Show ESS tab
 * }
 * ```
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag] ?? false;
}

/**
 * Get all feature flags (useful for debugging)
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  return { ...featureFlags };
}

/**
 * Check if feature flags are being loaded from environment
 * Useful for debugging feature flag issues
 */
export function getFeatureFlagSource(): 'default' | 'environment' {
  const envFlags = getFeatureFlagsFromEnv();
  return Object.keys(envFlags).length > 0 ? 'environment' : 'default';
}
