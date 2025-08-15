export type EnrichmentLogType = 'companyEnrichment.started' | 'companyEnrichment.success' | 'companyEnrichment.failure' | 'sourceText.empty' | 'missing_serp_key';

export function logEnrichmentEvent(type: EnrichmentLogType, payload: Record<string, any>) {
  // For now we use console logs which show in Cloud Logging
  try {
    console.log(`[${type}]`, JSON.stringify(payload));
  } catch {
    console.log(`[${type}]`, payload);
  }
}


