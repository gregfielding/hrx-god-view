import * as functions from 'firebase-functions';

/**
 * Configuration Reader Utility
 * 
 * Follows the pattern shown in the image to read configuration values from multiple sources:
 * 1. Direct environment variables (uppercase)
 * 2. Environment variables with featureflags_ prefix (lowercase)
 * 3. Environment variables with FEATUREFLAGS_ prefix (uppercase)
 * 4. Firebase config values
 * 
 * This allows compatibility with both Firebase configs and plain env vars from gcloud.
 */

/**
 * Read a boolean configuration value from multiple sources
 * @param key - The configuration key name (e.g., 'enable_gmail_monitoring')
 * @param defaultValue - Default value if not found in any source
 * @returns The configuration value as a boolean
 */
export function readBooleanConfig(key: string, defaultValue: boolean = false): boolean {
  // 1. Direct environment variable (uppercase)
  const directEnv = process.env[key.toUpperCase()];
  if (directEnv !== undefined) {
    return directEnv.toLowerCase() === 'true';
  }
  
  // 2. Environment variable with featureflags_ prefix (lowercase)
  const featureflagsEnv = process.env[`featureflags_${key}`];
  if (featureflagsEnv !== undefined) {
    return featureflagsEnv.toLowerCase() === 'true';
  }
  
  // 3. Environment variable with FEATUREFLAGS_ prefix (uppercase)
  const FEATUREFLAGS_ENV = process.env[`FEATUREFLAGS_${key.toUpperCase()}`];
  if (FEATUREFLAGS_ENV !== undefined) {
    return FEATUREFLAGS_ENV.toLowerCase() === 'true';
  }
  
  // 4. Firebase config value (deprecated in v2, skip)
  // Note: functions.config() is not available in Firebase Functions v2
  // Use environment variables instead
  
  return defaultValue;
}

/**
 * Read a string configuration value from multiple sources
 * @param key - The configuration key name
 * @param defaultValue - Default value if not found in any source
 * @returns The configuration value as a string
 */
export function readStringConfig(key: string, defaultValue: string = ''): string {
  // 1. Direct environment variable (uppercase)
  const directEnv = process.env[key.toUpperCase()];
  if (directEnv !== undefined) {
    return directEnv;
  }
  
  // 2. Environment variable with featureflags_ prefix (lowercase)
  const featureflagsEnv = process.env[`featureflags_${key}`];
  if (featureflagsEnv !== undefined) {
    return featureflagsEnv;
  }
  
  // 3. Environment variable with FEATUREFLAGS_ prefix (uppercase)
  const FEATUREFLAGS_ENV = process.env[`FEATUREFLAGS_${key.toUpperCase()}`];
  if (FEATUREFLAGS_ENV !== undefined) {
    return FEATUREFLAGS_ENV;
  }
  
  // 4. Firebase config value (deprecated in v2, skip)
  // Note: functions.config() is not available in Firebase Functions v2
  // Use environment variables instead
  
  return defaultValue;
}

/**
 * Read a number configuration value from multiple sources
 * @param key - The configuration key name
 * @param defaultValue - Default value if not found in any source
 * @returns The configuration value as a number
 */
export function readNumberConfig(key: string, defaultValue: number = 0): number {
  // 1. Direct environment variable (uppercase)
  const directEnv = process.env[key.toUpperCase()];
  if (directEnv !== undefined) {
    const parsed = parseInt(directEnv, 10);
    if (!isNaN(parsed)) return parsed;
  }
  
  // 2. Environment variable with featureflags_ prefix (lowercase)
  const featureflagsEnv = process.env[`featureflags_${key}`];
  if (featureflagsEnv !== undefined) {
    const parsed = parseInt(featureflagsEnv, 10);
    if (!isNaN(parsed)) return parsed;
  }
  
  // 3. Environment variable with FEATUREFLAGS_ prefix (uppercase)
  const FEATUREFLAGS_ENV = process.env[`FEATUREFLAGS_${key.toUpperCase()}`];
  if (FEATUREFLAGS_ENV !== undefined) {
    const parsed = parseInt(FEATUREFLAGS_ENV, 10);
    if (!isNaN(parsed)) return parsed;
  }
  
  // 4. Firebase config value (deprecated in v2, skip)
  // Note: functions.config() is not available in Firebase Functions v2
  // Use environment variables instead
  
  return defaultValue;
}

/**
 * Common configuration constants using the new pattern
 */
export const CONFIG = {
  // Feature flags
  ENABLE_GMAIL_MONITORING: readBooleanConfig('enable_gmail_monitoring', false),
  ENABLE_EXECUTE_CAMPAIGNS: readBooleanConfig('enable_execute_campaigns', false),
  ENABLE_CONTINUOUS_LEARNING: readBooleanConfig('enable_continuous_learning', false),
  ENABLE_JSI_REPORTS: readBooleanConfig('enable_jsi_reports', false),
  ENABLE_SCHEDULED_CHECKINS: readBooleanConfig('enable_scheduled_checkins', false),
  ENABLE_AUTO_CLOSE_GIG_SHIFTS: readBooleanConfig('enable_auto_close_gig_shifts', true),
  ENABLE_AUTO_CLOSE_COMPLETED_ASSIGNMENTS: readBooleanConfig('enable_auto_close_completed_assignments', true),
  ENABLE_SCHEDULED_TESTS: readBooleanConfig('enable_scheduled_tests', false),
  ENABLE_AI_SCHEDULER: readBooleanConfig('enable_ai_scheduler', false),
  ENABLE_WEEKLY_ENRICHMENT: readBooleanConfig('enable_weekly_enrichment', false),
  ENABLE_ASSOCIATIONS_INTEGRITY: readBooleanConfig('enable_associations_integrity', false),
  ENABLE_APOLLO: readBooleanConfig('enable_apollo', true),
  ENABLE_CLEARBIT_FALLBACK: readBooleanConfig('enable_clearbit_fallback', false),
  ENABLE_ENRICHMENT_QA: readBooleanConfig('enrichment_qa_enabled', true),
  AI_LOGGING_DISABLED: readBooleanConfig('ai_logging_disabled', false),
  
  // API Keys and URLs
  OPENAI_API_KEY: readStringConfig('openai_api_key'),
  OPENAI_MODEL: readStringConfig('openai_model', 'gpt-4o'),
  OPENAI_QA_MODEL: readStringConfig('openai_qa_model', 'gpt-4o-mini'),
  SENDGRID_API_KEY: readStringConfig('sendgrid_api_key'),
  SERP_API_KEY: readStringConfig('serp_api_key'),
  ADMIN_EMAIL: readStringConfig('admin_email', 'admin@hrxone.com'),
  FRONTEND_URL: readStringConfig('frontend_url', 'http://localhost:3000'),
  GOOGLE_CLIENT_ID: readStringConfig('google_client_id'),
  GOOGLE_CLIENT_SECRET: readStringConfig('google_client_secret'),
  GOOGLE_REDIRECT_URI: readStringConfig('google_redirect_uri'),
  
  // Project configuration
  GCLOUD_PROJECT: readStringConfig('gcloud_project'),
  GCP_PROJECT: readStringConfig('gcp_project'),
  FUNCTIONS_REGION: readStringConfig('functions_region', 'us-central1'),
  CLOUD_TASKS_QUEUE: readStringConfig('cloud_tasks_queue', 'default'),
} as const;

/**
 * Helper function to check if a feature is enabled (with logging)
 * @param featureName - Name of the feature for logging
 * @param configValue - The configuration value to check
 * @returns The configuration value
 */
export function isFeatureEnabled(featureName: string, configValue: boolean): boolean {
  console.log(`Feature flag '${featureName}': ${configValue ? 'ENABLED' : 'DISABLED'}`);
  return configValue;
}
