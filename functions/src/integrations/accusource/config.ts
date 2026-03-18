import { AccusourceEnvironment, AccusourceProviderConfig } from './types';

const DEFAULT_SANDBOX_BASE = 'https://api.sourcedirectapi.com/sandbox/v2';
const DEFAULT_PROD_BASE = 'https://api.sourcedirectapi.com/v2';

function normalizeEnvironment(input: unknown): AccusourceEnvironment {
  const value = String(input || '').toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  return 'sandbox';
}

export function getAccusourceConfig(): AccusourceProviderConfig {
  const environment = normalizeEnvironment(process.env.ACCUSOURCE_ENVIRONMENT || process.env.ACCUSOURCE_ENV);
  const baseUrlFromEnv = process.env.ACCUSOURCE_BASE_URL;
  const baseUrl = baseUrlFromEnv && baseUrlFromEnv.trim().length > 0
    ? baseUrlFromEnv.trim()
    : (environment === 'production' ? DEFAULT_PROD_BASE : DEFAULT_SANDBOX_BASE);

  const apiKey = process.env.ACCUSOURCE_API_KEY || process.env.SOURCEDIRECT_API_KEY;
  const webhookSecret = process.env.ACCUSOURCE_WEBHOOK_SECRET || process.env.SOURCEDIRECT_WEBHOOK_SECRET;
  const enabled = (process.env.ACCUSOURCE_ENABLED || 'true').toLowerCase() !== 'false';

  return {
    environment,
    baseUrl,
    apiKey: apiKey || undefined,
    webhookSecret: webhookSecret || undefined,
    enabled,
  };
}

