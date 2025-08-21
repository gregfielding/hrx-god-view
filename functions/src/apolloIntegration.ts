import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getApolloKey } from './utils/secrets';
import { apolloCompanyByDomain, apolloPeopleSearch } from './utils/apollo';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Secrets (injected as env vars at runtime)
const APOLLO_API_KEY = defineSecret('APOLLO_API_KEY');

// Feature gate primarily by key presence; env flag can force-disable when set to 'false'
function envWantsApollo(): boolean {
  const v = (process.env.ENABLE_APOLLO || 'auto').toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return false;
  return true; // 'auto' or 'true' defaults to enabled if key is available
}

function extractDomainFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.toLowerCase();
    // Strip common subdomains
    return host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

// -------- Helpers for safe updates and field gating --------

function isEmptyValue(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function pruneUndefinedDeep<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return (obj.map((v) => pruneUndefinedDeep(v)).filter((v) => v !== undefined) as unknown) as any;
  }
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v as any);
      if (pv !== undefined) result[k] = pv;
    }
    return result as any as T;
  }
  return obj;
}

function getAtPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function setAtPath(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') curr[p] = {};
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

function canSetField(path: string, existing: any): boolean {
  const existingValue = getAtPath(existing, path);
  const sourceOfTruth = existing?.integrations?.apollo?.sourceOfTruth || {};
  if (sourceOfTruth[path] === 'apollo') return true;
  return isEmptyValue(existingValue);
}

function sanitizeUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.toString();
  } catch {
    return undefined;
  }
}

function pickPhone(org: any): string | undefined {
  return (
    org?.primary_phone?.sanitized_number ||
    org?.sanitized_phone ||
    org?.primary_phone?.number ||
    org?.phone ||
    undefined
  );
}

function fmtSnapshotId(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join('');
}

async function locateCompanyByDomain(tenantId: string, domain: string): Promise<admin.firestore.DocumentReference | null> {
  const companies = db.collection(`tenants/${tenantId}/crm_companies`);
  const domainLc = domain.toLowerCase();
  // 1) Try exact domain field
  const q1 = await companies.where('domain', '==', domainLc).limit(1).get();
  if (!q1.empty) return q1.docs[0].ref;
  // 2) Try websiteUrl equality against common variants
  const variants = [
    `https://${domainLc}`,
    `http://${domainLc}`,
    `https://www.${domainLc}`,
    `http://www.${domainLc}`,
  ];
  // Firestore 'in' allows up to 10 values
  const q2 = await companies.where('websiteUrl', 'in', variants).limit(1).get().catch(() => null);
  if (q2 && !q2.empty) return q2.docs[0].ref;
  return null;
}

// Trigger: when a company is created, attempt Apollo firmographics enrichment
export const onCompanyCreatedApollo = onDocumentCreated({ document: 'tenants/{tenantId}/crm_companies/{companyId}', secrets: [APOLLO_API_KEY] }, async (event) => {
  const tenantId = event.params.tenantId as string;
  const companyId = event.params.companyId as string;
  const data = event.data?.data() as any;
  if (!data) return;

  if (!envWantsApollo()) return;
  const apiKey = await getApolloKey(tenantId);
  if (!apiKey) return;

  // Resolve domain
  const website = data.website || data.companyUrl || data.url || data.metadata?.discoveredUrls?.website;
  const domain = extractDomainFromUrl(website);
  if (!domain) return;

  try {
    const info = await apolloCompanyByDomain(domain, apiKey);
    if (!info) return;
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    await companyRef.set(
      {
        firmographics: { apollo: pruneUndefinedDeep(info) },
        metadata: { apolloFetchedAt: admin.firestore.FieldValue.serverTimestamp() },
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Apollo company enrichment failed', { tenantId, companyId, err: (e as Error).message });
  }
});

// Trigger: when a contact is created, try to find verified email/phone
export const onContactCreatedApollo = onDocumentCreated({ document: 'tenants/{tenantId}/crm_contacts/{contactId}', secrets: [APOLLO_API_KEY] }, async (event) => {
  const tenantId = event.params.tenantId as string;
  const contactId = event.params.contactId as string;
  const contact = event.data?.data() as any;
  if (!contact) return;

  if (!envWantsApollo()) return;
  const apiKey = await getApolloKey(tenantId);
  if (!apiKey) return;

  // Determine company domain from contact/company associations
  let domain: string | undefined;
  try {
    const companyId = contact.companyId || (Array.isArray(contact.associations?.companies) ? (typeof contact.associations.companies[0] === 'string' ? contact.associations.companies[0] : contact.associations.companies[0]?.id) : undefined);
    if (companyId) {
      const cDoc = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
      const c = cDoc.exists ? (cDoc.data() as any) : undefined;
      domain = extractDomainFromUrl(c?.website || c?.companyUrl || c?.url || c?.metadata?.discoveredUrls?.website);
    }
  } catch {}

  if (!domain) return;

  const needsEmail = !contact.email || !contact.verifiedEmail;
  const needsPhone = !contact.phone || !contact.verifiedPhone;
  if (!needsEmail && !needsPhone) return;

  try {
    const titles: string[] = contact.title ? [contact.title] : undefined as any;
    const people = await apolloPeopleSearch({ domain, titles, limit: 5 }, apiKey);
    if (!people.length) return;
    // Naive match: same title or seniority/department heuristic, else first
    const best = people.find(p => p.title && contact.title && p.title.toLowerCase() === contact.title.toLowerCase()) || people[0];
    if (!best) return;
    const update: any = { apolloPersonId: best.id, source: { apollo: true } };
    if (needsEmail && best.email) { update.email = best.email; update.verifiedEmail = !!best.verifiedEmail; }
    if (needsPhone && best.phone) { update.phone = best.phone; update.verifiedPhone = true; }
    await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set(update, { merge: true });
  } catch (e) {
    console.warn('Apollo contact enrichment failed', { tenantId, contactId, err: (e as Error).message });
  }
});

// Callable: get firmographics (stable output)
export const getFirmographics = onCall({ secrets: [APOLLO_API_KEY] }, async (request) => {
  const { tenantId, companyId } = (request.data || {}) as { tenantId: string; companyId: string };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId || !companyId) throw new Error('tenantId and companyId required');
  try {
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const cDoc = await companyRef.get();
    const existing = cDoc.exists ? (cDoc.data() as any) : {};
    const domain = extractDomainFromUrl(
      existing.website || existing.companyUrl || existing.url || existing.metadata?.discoveredUrls?.website
    );
    const apiKey = envWantsApollo() ? await getApolloKey(tenantId) : undefined;

    if (!apiKey || !domain) {
      return { ok: false, error: 'Apollo not configured or company domain missing' };
    }

    // Fetch normalized summary via helper
    const apolloSummary = await apolloCompanyByDomain(domain, apiKey);

    // Separately fetch raw snapshot for archival (avoid shape drift issues)
    const rawUrl = `https://api.apollo.io/api/v1/organizations/enrich?${new URLSearchParams({ domain }).toString()}`;
    const fetchMod = await import('node-fetch');
    const fetchFn: any = (fetchMod as any).default || (fetchMod as any);
    const rawResp = await fetchFn(rawUrl, { method: 'GET', headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } });
    const rawJson: any = rawResp.ok ? await rawResp.json().catch(() => ({})) : {};
    const org = rawJson?.organization || rawJson?.company || {};

    if (!apolloSummary && isEmptyValue(org)) {
      return { ok: false, error: 'No data returned from Apollo' };
    }

    // Build field-level update with gating
    const update: any = {};
    const setIf = (path: string, value: any) => {
      if (value === undefined) return;
      if (canSetField(path, existing)) {
        setAtPath(update, path, value);
        // mark source of truth
        const sotPath = `integrations.apollo.sourceOfTruth.${path}`;
        setAtPath(update, sotPath, 'apollo');
      }
    };

    setIf('name', org?.name);
    setIf('domain', (org?.primary_domain || domain || '').toLowerCase());
    setIf('websiteUrl', sanitizeUrl(org?.website_url));
    setIf('logoUrl', sanitizeUrl(org?.logo_url));
    setIf('phone', pickPhone(org));
    setIf('foundedYear', org?.founded_year);
    setIf('public.symbol', org?.publicly_traded_symbol);
    setIf('public.exchange', org?.publicly_traded_exchange);
    setIf('marketCapPrinted', org?.market_cap);
    setIf('employeeCount', org?.estimated_num_employees);
    setIf('revenue.amount', org?.annual_revenue ?? org?.organization_revenue);
    setIf('revenue.printed', org?.annual_revenue_printed ?? org?.organization_revenue_printed);
    setIf('industryLabel', org?.industry);
    // arrays with caps
    const keywords = Array.isArray(org?.keywords)
      ? Array.from(new Set(org.keywords.map((k: any) => String(k || '').toLowerCase().trim()))).slice(0, 200)
      : undefined;
    setIf('keywords', keywords);

    const techNames = Array.isArray(org?.technology_names) ? org.technology_names.slice(0, 200) : undefined;
    setIf('techStack.names', techNames);
    const currentTech = Array.isArray(org?.current_technologies)
      ? org.current_technologies.slice(0, 200).map((t: any) => ({ uid: t?.uid, name: t?.name, category: t?.category }))
      : undefined;
    setIf('techStack.current', currentTech);

    setIf('industries', Array.isArray(org?.industries) ? org.industries : undefined);
    setIf(
      'secondaryIndustries',
      Array.isArray(org?.secondary_industries) ? org.secondary_industries : undefined
    );

    // address
    setIf('address.street', org?.street_address);
    setIf('address.city', org?.city);
    setIf('address.state', org?.state);
    setIf('address.postalCode', org?.postal_code);
    setIf('address.country', org?.country);
    setIf('address.raw', org?.raw_address);

    // social
    setIf('social.linkedin', sanitizeUrl(org?.linkedin_url));
    setIf('social.twitter', sanitizeUrl(org?.twitter_url));
    setIf('social.facebook', sanitizeUrl(org?.facebook_url));
    setIf('social.crunchbase', sanitizeUrl(org?.crunchbase_url));

    // org chart/meta
    setIf('orgChart.sector', org?.org_chart_sector);
    setIf('orgChart.departmentHeadcount', org?.departmental_head_count);
    const hasRoot = Array.isArray(org?.org_chart_root_people_ids) && org.org_chart_root_people_ids.length > 0;
    setIf('orgChart.hasRootPeople', hasRoot);
    setIf('suborganizations.count', org?.num_suborganizations);
    const subTop = Array.isArray(org?.suborganizations)
      ? org.suborganizations.slice(0, 25).map((s: any) => ({ id: s?.id, name: s?.name, websiteUrl: s?.website_url }))
      : undefined;
    setIf('suborganizations.top', subTop);

    // Always update integrations metadata
    setAtPath(update, 'integrations.apollo.organizationId', org?.id || apolloSummary?.id || null);
    setAtPath(update, 'integrations.apollo.lastSyncedAt', admin.firestore.Timestamp.now());
    setAtPath(update, 'integrations.apollo.signalStrength', 'verified');
    setAtPath(update, 'integrations.apollo.source', 'apollo.organizations/enrich');

    // Optional: keep simplified summary for compatibility
    if (apolloSummary) {
      setAtPath(update, 'firmographics.apollo', pruneUndefinedDeep(apolloSummary));
    }

    // Final sanitize to remove undefined
    const finalUpdate = pruneUndefinedDeep(update);
    await companyRef.set(finalUpdate, { merge: true });

    // Write raw snapshot into subcollection
    const snapId = fmtSnapshotId(new Date());
    const snapRef = companyRef.collection('integrations_apollo_snapshots').doc(snapId);
    await snapRef.set(
      pruneUndefinedDeep({
        organization: org,
        receivedAt: admin.firestore.Timestamp.now(),
        domain,
      })
    );

    const updatedFields = Object.keys(finalUpdate).filter((k) => k !== 'integrations' && k !== 'firmographics');
    return { ok: true, updatedFields, snapshotId: snapId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// Callable: firmographics by tenant + domain (finds company doc automatically)
export const getFirmographicsByDomain = onCall({ secrets: [APOLLO_API_KEY] }, async (request) => {
  const { tenantId, domain } = (request.data || {}) as { tenantId: string; domain: string };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId || !domain) throw new Error('tenantId and domain required');
  try {
    const apiKey = envWantsApollo() ? await getApolloKey(tenantId) : undefined;
    if (!apiKey) return { ok: false, error: 'Apollo not configured' };
    const companyRef = await locateCompanyByDomain(tenantId, domain);
    if (!companyRef) return { ok: false, error: 'Company not found for domain' };
    const cDoc = await companyRef.get();
    const existing = cDoc.exists ? (cDoc.data() as any) : {};

    const apolloSummary = await apolloCompanyByDomain(domain, apiKey);
    const rawUrl = `https://api.apollo.io/api/v1/organizations/enrich?${new URLSearchParams({ domain }).toString()}`;
    const fetchMod = await import('node-fetch');
    const fetchFn: any = (fetchMod as any).default || (fetchMod as any);
    const rawResp = await fetchFn(rawUrl, { method: 'GET', headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } });
    const rawJson: any = rawResp.ok ? await rawResp.json().catch(() => ({})) : {};
    const org = rawJson?.organization || rawJson?.company || {};

    if (!apolloSummary && isEmptyValue(org)) {
      return { ok: false, error: 'No data returned from Apollo' };
    }

    const update: any = {};
    const setIf = (path: string, value: any) => {
      if (value === undefined) return;
      if (canSetField(path, existing)) {
        setAtPath(update, path, value);
        const sotPath = `integrations.apollo.sourceOfTruth.${path}`;
        setAtPath(update, sotPath, 'apollo');
      }
    };

    setIf('name', org?.name);
    setIf('domain', (org?.primary_domain || domain || '').toLowerCase());
    setIf('websiteUrl', sanitizeUrl(org?.website_url));
    setIf('logoUrl', sanitizeUrl(org?.logo_url));
    setIf('phone', pickPhone(org));
    setIf('foundedYear', org?.founded_year);
    setIf('public.symbol', org?.publicly_traded_symbol);
    setIf('public.exchange', org?.publicly_traded_exchange);
    setIf('marketCapPrinted', org?.market_cap);
    setIf('employeeCount', org?.estimated_num_employees);
    setIf('revenue.amount', org?.annual_revenue ?? org?.organization_revenue);
    setIf('revenue.printed', org?.annual_revenue_printed ?? org?.organization_revenue_printed);
    setIf('industryLabel', org?.industry);
    const keywords = Array.isArray(org?.keywords)
      ? Array.from(new Set(org.keywords.map((k: any) => String(k || '').toLowerCase().trim()))).slice(0, 200)
      : undefined;
    setIf('keywords', keywords);
    const techNames = Array.isArray(org?.technology_names) ? org.technology_names.slice(0, 200) : undefined;
    setIf('techStack.names', techNames);
    const currentTech = Array.isArray(org?.current_technologies)
      ? org.current_technologies.slice(0, 200).map((t: any) => ({ uid: t?.uid, name: t?.name, category: t?.category }))
      : undefined;
    setIf('techStack.current', currentTech);
    setIf('industries', Array.isArray(org?.industries) ? org.industries : undefined);
    setIf('secondaryIndustries', Array.isArray(org?.secondary_industries) ? org.secondary_industries : undefined);
    setIf('address.street', org?.street_address);
    setIf('address.city', org?.city);
    setIf('address.state', org?.state);
    setIf('address.postalCode', org?.postal_code);
    setIf('address.country', org?.country);
    setIf('address.raw', org?.raw_address);
    setIf('social.linkedin', sanitizeUrl(org?.linkedin_url));
    setIf('social.twitter', sanitizeUrl(org?.twitter_url));
    setIf('social.facebook', sanitizeUrl(org?.facebook_url));
    setIf('social.crunchbase', sanitizeUrl(org?.crunchbase_url));
    setIf('orgChart.sector', org?.org_chart_sector);
    setIf('orgChart.departmentHeadcount', org?.departmental_head_count);
    const hasRoot = Array.isArray(org?.org_chart_root_people_ids) && org.org_chart_root_people_ids.length > 0;
    setIf('orgChart.hasRootPeople', hasRoot);
    setIf('suborganizations.count', org?.num_suborganizations);
    const subTop = Array.isArray(org?.suborganizations)
      ? org.suborganizations.slice(0, 25).map((s: any) => ({ id: s?.id, name: s?.name, websiteUrl: s?.website_url }))
      : undefined;
    setIf('suborganizations.top', subTop);

    setAtPath(update, 'integrations.apollo.organizationId', org?.id || apolloSummary?.id || null);
    setAtPath(update, 'integrations.apollo.lastSyncedAt', admin.firestore.Timestamp.now());
    setAtPath(update, 'integrations.apollo.signalStrength', 'verified');
    setAtPath(update, 'integrations.apollo.source', 'apollo.organizations/enrich');
    if (apolloSummary) setAtPath(update, 'firmographics.apollo', pruneUndefinedDeep(apolloSummary));

    const finalUpdate = pruneUndefinedDeep(update);
    await companyRef.set(finalUpdate, { merge: true });

    const snapId = fmtSnapshotId(new Date());
    await companyRef.collection('integrations_apollo_snapshots').doc(snapId).set(
      pruneUndefinedDeep({ organization: org, receivedAt: admin.firestore.Timestamp.now(), domain })
    );

    const updatedFields = Object.keys(finalUpdate).filter((k) => k !== 'integrations' && k !== 'firmographics');
    return { ok: true, updatedFields, snapshotId: snapId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// Callable: get recommended contacts (stable output)
export const getRecommendedContacts = onCall({ secrets: [APOLLO_API_KEY] }, async (request) => {
  const { tenantId, companyId, filters } = (request.data || {}) as { tenantId: string; companyId: string; filters?: any };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId || !companyId) throw new Error('tenantId and companyId required');
  try {
    const cDoc = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
    const data = cDoc.exists ? (cDoc.data() as any) : {};
    const domain = extractDomainFromUrl(data.website || data.companyUrl || data.url || data.metadata?.discoveredUrls?.website);
    const apiKey = envWantsApollo() ? await getApolloKey(tenantId) : undefined;
    let people: any[] = [];
    if (apiKey && domain) {
      people = await apolloPeopleSearch({ domain, titles: filters?.titles, departments: filters?.departments, seniorities: filters?.seniorities, limit: 10 }, apiKey);
    }
    return { ok: true, contacts: people };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// Simple ping callable to verify Apollo connectivity with an arbitrary domain
export const apolloPing = onCall({ secrets: [APOLLO_API_KEY] }, async (request) => {
  const { domain, tenantId } = (request.data || {}) as { domain?: string; tenantId?: string };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!domain) throw new Error('domain required');
  try {
    const apiKey = envWantsApollo() ? await getApolloKey(tenantId) : undefined;
    if (!apiKey) return { ok: false, error: 'Apollo key not configured' };
    const info = await apolloCompanyByDomain(domain, apiKey);
    return { ok: !!info, info };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// Public HTTP variant for quick ops testing (no auth). Keep minimal and safe.
export const apolloPingHttp = onRequest({ cors: true, secrets: [APOLLO_API_KEY] }, async (req, res) => {
  try {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const domain = (req.query.domain as string) || (req.body?.domain as string);
    const tenantId = (req.query.tenantId as string) || (req.body?.tenantId as string);
    console.log('apolloPingHttp:start', { domain, tenantId, hasBody: !!req.body, debug: !!req.query.debug });
    if (!domain) {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(400).json({ ok: false, error: 'domain required' });
      return;
    }
    const apiKey = envWantsApollo() ? await getApolloKey(tenantId) : undefined;
    if (!apiKey) {
      console.warn('apolloPingHttp:no_api_key', { tenantId });
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(200).json({ ok: false, error: 'Apollo key not configured' });
      return;
    }
    console.log('apolloPingHttp:api_key_present');
    // Attempt normalized parse
    const info = await apolloCompanyByDomain(domain, apiKey);
    if (info) {
      console.log('apolloPingHttp:normalized_ok', { id: info.id, name: info.name, domain: info.domain });
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(200).json({ ok: true, info });
      return;
    }

    // Fallback: fetch raw and build a minimal info object if possible
    const qs = new URLSearchParams({ domain }).toString();
    const url = `https://api.apollo.io/api/v1/organizations/enrich?${qs}`;
    const headers = {
      'X-Api-Key': apiKey,
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    } as Record<string, string>;
    const fetchMod = await import('node-fetch');
    const fetchFn: any = (fetchMod as any).default || (fetchMod as any);
    const r = await fetchFn(url, { method: 'GET', headers });
    const text = await r.text();
    console.log('apolloPingHttp:fallback_status', { status: r.status, domain });
    console.log('apolloPingHttp:fallback_body_snippet', text ? text.slice(0, 400) : null);

    if (req.query.debug) {
      res.status(200).json({ ok: false, status: r.status, body: text?.slice(0, 800) || null });
      return;
    }

    let minimal: any = null;
    try {
      const json: any = text ? JSON.parse(text) : {};
      const org = json?.organization || json?.company || null;
      if (org) {
        minimal = {
          id: org.id,
          name: org.name,
          domain: org.primary_domain || org.website_url || org.domain,
          industry: org.industry,
          employeeCount: org.estimated_num_employees || org.employee_count || org.employees,
        };
      }
    } catch {}
    console.log('apolloPingHttp:minimal_result', { ok: !!minimal, id: minimal?.id, name: minimal?.name });
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(200).json({ ok: !!minimal, info: minimal });
  } catch (e:any) {
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(500).json({ ok: false, error: e?.message || 'internal' });
  }
});


