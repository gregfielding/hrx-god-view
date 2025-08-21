import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe firmographics retrieval
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'getFirmographics@v2',
  // Input validation limits
  MAX_DOMAIN_LENGTH: 255,
  MAX_COMPANY_NAME_LENGTH: 500,
  // API limits
  APOLLO_TIMEOUT_MS: 30000,
  MAX_APOLLO_RETRIES: 2,
  // Query limits
  MAX_KEYWORDS: 200,
  MAX_TECH_NAMES: 200,
  MAX_CURRENT_TECH: 200,
  MAX_SUBORGANIZATIONS: 25,
  // Cost limits
  MAX_COST_PER_CALL: 0.15 // $0.15 USD max per call (higher for external API calls)
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Validate input parameters
 */
function validateInput(data: any): {
  tenantId: string;
  companyId: string;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { tenantId, companyId } = data;

  // Required field validation
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
    throw new Error('companyId is required and must be a non-empty string');
  }

  return {
    tenantId: tenantId.trim(),
    companyId: companyId.trim()
  };
}

/**
 * Extract domain from URL safely
 */
function extractDomainFromUrlSafely(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Remove protocol if present
    let domain = url.replace(/^https?:\/\//, '');
    // Remove path and query parameters
    domain = domain.split('/')[0];
    // Remove port if present
    domain = domain.split(':')[0];
    // Validate domain format
    if (domain.length > SAFE_CONFIG.MAX_DOMAIN_LENGTH) {
      return null;
    }
    return domain.toLowerCase();
  } catch (error) {
    console.warn('Failed to extract domain from URL:', url, error);
    return null;
  }
}

/**
 * Get Apollo API key safely
 */
async function getApolloKeySafely(tenantId: string): Promise<string | null> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getApolloKeySafely', 0.001);

  try {
    // For now, we'll implement a simplified version
    // In a real implementation, this would get the API key from tenant settings
    console.log(`Getting Apollo API key for tenant: ${tenantId}`);
    return process.env.APOLLO_API_KEY || null;
  } catch (error) {
    console.warn('Failed to get Apollo API key:', error);
    return null;
  }
}

/**
 * Call Apollo API safely with timeout and retry logic
 */
async function callApolloApiSafely(domain: string, apiKey: string): Promise<any> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('callApolloApiSafely', 0.05);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SAFE_CONFIG.APOLLO_TIMEOUT_MS);

  try {
    const rawUrl = `https://api.apollo.io/api/v1/organizations/enrich?${new URLSearchParams({ domain }).toString()}`;
    const fetchMod = await import('node-fetch');
    const fetchFn: any = (fetchMod as any).default || (fetchMod as any);
    
    const rawResp = await fetchFn(rawUrl, { 
      method: 'GET', 
      headers: { 
        'X-Api-Key': apiKey, 
        'Accept': 'application/json' 
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!rawResp.ok) {
      throw new Error(`Apollo API error: ${rawResp.status} ${rawResp.statusText}`);
    }

    const rawJson = await rawResp.json().catch(() => ({}));
    return rawJson?.organization || rawJson?.company || {};
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Apollo API request timed out');
    }
    throw error;
  }
}

/**
 * Get company data safely
 */
async function getCompanyDataSafely(tenantId: string, companyId: string): Promise<any> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('getCompanyDataSafely', 0.001);

  const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
  const cDoc = await companyRef.get();
  
  if (!cDoc.exists) {
    throw new Error(`Company ${companyId} not found`);
  }

  return cDoc.data() || {};
}

/**
 * Update company data safely with field limits
 */
async function updateCompanyDataSafely(
  tenantId: string, 
  companyId: string, 
  org: any, 
  domain: string
): Promise<{ updatedFields: string[], snapshotId: string }> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('updateCompanyDataSafely', 0.01);

  const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
  const existing = await getCompanyDataSafely(tenantId, companyId);

  // Build field-level update with gating and limits
  const update: any = {};
  
  const setIf = (path: string, value: any) => {
    if (value === undefined) return;
    
    // Apply limits for arrays
    if (Array.isArray(value)) {
      if (path.includes('keywords') && value.length > SAFE_CONFIG.MAX_KEYWORDS) {
        value = value.slice(0, SAFE_CONFIG.MAX_KEYWORDS);
      } else if (path.includes('techStack.names') && value.length > SAFE_CONFIG.MAX_TECH_NAMES) {
        value = value.slice(0, SAFE_CONFIG.MAX_TECH_NAMES);
      } else if (path.includes('techStack.current') && value.length > SAFE_CONFIG.MAX_CURRENT_TECH) {
        value = value.slice(0, SAFE_CONFIG.MAX_CURRENT_TECH);
      } else if (path.includes('suborganizations.top') && value.length > SAFE_CONFIG.MAX_SUBORGANIZATIONS) {
        value = value.slice(0, SAFE_CONFIG.MAX_SUBORGANIZATIONS);
      }
    }

    // Apply length limits for strings
    if (typeof value === 'string') {
      if (path === 'name' && value.length > SAFE_CONFIG.MAX_COMPANY_NAME_LENGTH) {
        value = value.substring(0, SAFE_CONFIG.MAX_COMPANY_NAME_LENGTH);
      }
    }

    // Set value at path (simplified implementation)
    const pathParts = path.split('.');
    let current = update;
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) {
        current[pathParts[i]] = {};
      }
      current = current[pathParts[i]];
    }
    current[pathParts[pathParts.length - 1]] = value;
    
    // Mark source of truth
    const sotPath = `integrations.apollo.sourceOfTruth.${path}`;
    const sotParts = sotPath.split('.');
    let sotCurrent = update;
    for (let i = 0; i < sotParts.length - 1; i++) {
      if (!sotCurrent[sotParts[i]]) {
        sotCurrent[sotParts[i]] = {};
      }
      sotCurrent = sotCurrent[sotParts[i]];
    }
    sotCurrent[sotParts[sotParts.length - 1]] = 'apollo';
  };

  // Basic company info
  setIf('name', org?.name);
  setIf('domain', (org?.primary_domain || domain || '').toLowerCase());
  setIf('websiteUrl', org?.website_url);
  setIf('logoUrl', org?.logo_url);
  setIf('phone', org?.phone);
  setIf('foundedYear', org?.founded_year);
  setIf('public.symbol', org?.publicly_traded_symbol);
  setIf('public.exchange', org?.publicly_traded_exchange);
  setIf('marketCapPrinted', org?.market_cap);
  setIf('employeeCount', org?.estimated_num_employees);
  setIf('revenue.amount', org?.annual_revenue ?? org?.organization_revenue);
  setIf('revenue.printed', org?.annual_revenue_printed ?? org?.organization_revenue_printed);
  setIf('industryLabel', org?.industry);

  // Arrays with caps
  const keywords = Array.isArray(org?.keywords)
    ? Array.from(new Set(org.keywords.map((k: any) => String(k || '').toLowerCase().trim())))
    : undefined;
  setIf('keywords', keywords);

  const techNames = Array.isArray(org?.technology_names) ? org.technology_names : undefined;
  setIf('techStack.names', techNames);
  
  const currentTech = Array.isArray(org?.current_technologies)
    ? org.current_technologies.map((t: any) => ({ uid: t?.uid, name: t?.name, category: t?.category }))
    : undefined;
  setIf('techStack.current', currentTech);

  setIf('industries', Array.isArray(org?.industries) ? org.industries : undefined);
  setIf('secondaryIndustries', Array.isArray(org?.secondary_industries) ? org.secondary_industries : undefined);

  // Address
  setIf('address.street', org?.street_address);
  setIf('address.city', org?.city);
  setIf('address.state', org?.state);
  setIf('address.postalCode', org?.postal_code);
  setIf('address.country', org?.country);
  setIf('address.raw', org?.raw_address);

  // Social
  setIf('social.linkedin', org?.linkedin_url);
  setIf('social.twitter', org?.twitter_url);
  setIf('social.facebook', org?.facebook_url);
  setIf('social.crunchbase', org?.crunchbase_url);

  // Org chart/meta
  setIf('orgChart.sector', org?.org_chart_sector);
  setIf('orgChart.departmentHeadcount', org?.departmental_head_count);
  const hasRoot = Array.isArray(org?.org_chart_root_people_ids) && org.org_chart_root_people_ids.length > 0;
  setIf('orgChart.hasRootPeople', hasRoot);
  setIf('suborganizations.count', org?.num_suborganizations);
  
  const subTop = Array.isArray(org?.suborganizations)
    ? org.suborganizations.map((s: any) => ({ id: s?.id, name: s?.name, websiteUrl: s?.website_url }))
    : undefined;
  setIf('suborganizations.top', subTop);

  // Always update integrations metadata
  update.integrations = update.integrations || {};
  update.integrations.apollo = update.integrations.apollo || {};
  update.integrations.apollo.organizationId = org?.id || null;
  update.integrations.apollo.lastSyncedAt = admin.firestore.Timestamp.now();
  update.integrations.apollo.signalStrength = 'verified';
  update.integrations.apollo.source = 'apollo.organizations/enrich';

  // Final sanitize to remove undefined (simplified implementation)
  const finalUpdate = JSON.parse(JSON.stringify(update));
  await companyRef.set(finalUpdate, { merge: true });

  // Write raw snapshot into subcollection
  const snapId = new Date().toISOString().replace(/[:.]/g, '-');
  const snapRef = companyRef.collection('integrations_apollo_snapshots').doc(snapId);
  await snapRef.set({
    organization: org,
    receivedAt: admin.firestore.Timestamp.now(),
    domain,
  });

  const updatedFields = Object.keys(finalUpdate).filter((k) => k !== 'integrations' && k !== 'firmographics');
  return { updatedFields, snapshotId: snapId };
}

/**
 * Safe version of getFirmographics with hardening playbook compliance
 */
export const getFirmographics = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  },
  async (request) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate input
      const { tenantId, companyId } = validateInput(request.data);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get company data safely
      const existing = await getCompanyDataSafely(tenantId, companyId);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Extract domain from company data
      const domain = extractDomainFromUrlSafely(
        existing.website || existing.companyUrl || existing.url || existing.metadata?.discoveredUrls?.website
      );

      if (!domain) {
        return { ok: false, error: 'Company domain missing' };
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Get Apollo API key safely
      const apiKey = await getApolloKeySafely(tenantId);

      if (!apiKey) {
        return { ok: false, error: 'Apollo not configured' };
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Call Apollo API safely
      const org = await callApolloApiSafely(domain, apiKey);

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      if (!org || Object.keys(org).length === 0) {
        return { ok: false, error: 'No data returned from Apollo' };
      }

      // Update company data safely
      const { updatedFields, snapshotId } = await updateCompanyDataSafely(tenantId, companyId, org, domain);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Firmographics retrieved for ${tenantId}, CompanyId: ${companyId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      return { 
        ok: true, 
        updatedFields, 
        snapshotId,
        _metadata: {
          tenantId,
          companyId,
          domain,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

    } catch (error) {
      console.error('Error in getFirmographics:', error);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        _metadata: {
          processedBy: SAFE_CONFIG.TAG
        }
      };
    }
  }
);
