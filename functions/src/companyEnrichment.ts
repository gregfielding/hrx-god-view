import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { fetchAndNormalize, fetchBestGuessUrls } from './utils/serp';
import { logEnrichmentEvent } from './utils/logging';
import { createCompanyAILog } from './utils/aiLogging';
import { CompanyEnrichmentSchema, CompanyEnrichmentVersionMetaSchema, CompanyEnrichment } from './schemas/companyEnrichment';
import OpenAI from 'openai';
import { getOpenAIKey, getClearbitKey, getApolloKey } from './utils/secrets';
import { generateEmbedding } from './utils/embeddings';
import { fetchClearbitCompany, bucketEmployeesToSize } from './utils/clearbit';
import { apolloCompanyByDomain, apolloPeopleSearch } from './utils/apollo';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type Mode = 'full' | 'metadata';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

// Secrets used by enrichment pipeline (Apollo optional augmentation)
const APOLLO_API_KEY = defineSecret('APOLLO_API_KEY');

function computeLeadScore(data: CompanyEnrichment): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  // Hiring velocity signals
  if ((data.hiringTrends || []).length >= 2) { score += 20; signals.push('High hiring velocity'); }
  // Ops footprint
  if (data.inferredOrgStructure?.warehouse) { score += 10; signals.push('Warehouse ops'); }
  if (data.inferredOrgStructure?.ops) { score += 5; signals.push('Operations leadership'); }
  // Urgency via red flags
  if ((data.redFlags || []).length > 0) { score += 15; signals.push('Red flags present'); }
  // Competitors using temp staff (heuristic via tags)
  if ((data.suggestedTags || []).some(t => /temp|staff|agency/i.test(t))) { score += 25; signals.push('Competitors using temp staff'); }
  // Cap and floor
  score = Math.max(0, Math.min(100, score));
  return { score, signals };
}

async function callGptEnrichment(prompt: string): Promise<{ parsed: CompanyEnrichment; model: string; usage?: { prompt?: number; completion?: number; total?: number } }> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const system = [
    'You are a senior B2B sales research analyst.',
    'Return ONLY valid JSON that matches the required schema. No prose, no markdown, no explanations.',
    'Rules:',
    '- businessSummary must be 2-3 complete sentences. No ellipses ("..."), no follower counts, no slogans/taglines.',
    '- Do not fabricate facts. If a field is not supported by the sources, return an empty array/string for that field.',
    '- competitorCompanies should be a list of company names (strings), if reasonably inferable; else empty array.',
    '- generatedScripts must include coldEmail, coldCallOpening, voicemail (short, natural, personalized using evidence).',
  ].join('\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    // Ensure key is loaded at runtime before each call
    if (!(openai as any).apiKey) {
      const key = await getOpenAIKey();
      if (key) (openai as any).apiKey = key;
    }
    const resp = await openai.chat.completions.create({
      model,
      response_format: { type: 'json_object' as const },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1600,
    });
    const text = resp.choices?.[0]?.message?.content || '{}';
    try {
      const json = JSON.parse(text);
      const parsed = CompanyEnrichmentSchema.parse(json);
      const usage = resp.usage ? { prompt: resp.usage.prompt_tokens, completion: resp.usage.completion_tokens, total: resp.usage.total_tokens } : undefined;
      return { parsed, model, usage };
    } catch (err: any) {
      if (attempt === 0) {
        // retry with correction hint
        continue;
      }
      throw err;
    }
  }
  // Should be unreachable
  const parsed = CompanyEnrichmentSchema.parse({ businessSummary: '' });
  return { parsed, model };
}

function sanitizeSummary(text: string | undefined): string {
  if (!text) return '';
  let t = String(text);
  // Remove ellipses and follower marketing noise
  t = t.replace(/[.]{3,}/g, ' ');
  t = t.replace(/\|\s*\d+\s*followers.*$/i, '');
  t = t.replace(/\bfollowers on LinkedIn\b.*$/i, '');
  t = t.replace(/Conserving Resources\. Improving Life\.?/gi, ''); // common slogan example
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

async function qaCheckEnrichment(parsed: CompanyEnrichment, sources: { website: string; linkedin: string; jobs: string }): Promise<string | undefined> {
  const enabled = (process.env.ENRICHMENT_QA_ENABLED || 'true') !== 'false';
  if (!enabled) return undefined;
  try {
    const qaModel = process.env.OPENAI_QA_MODEL || 'gpt-4o-mini';
    const qaPrompt = `You are a fast QA validator. Given the JSON below (enrichment) and rough source snippets, do a quick sanity check for contradictions or hallucinations (e.g., wrong industry, irrelevant titles). Return a single short sentence with either 'Looks good.' or a concise warning list.\n\n[ENRICHMENT JSON]\n${JSON.stringify(parsed)}\n\n[SOURCES]\nWebsite: ${sources.website.slice(0, 2000)}\nLinkedIn: ${sources.linkedin.slice(0, 2000)}\nJobs: ${sources.jobs.slice(0, 2000)}`;
    const resp = await openai.chat.completions.create({
      model: qaModel,
      messages: [ { role: 'user', content: qaPrompt } ],
      temperature: 0,
      max_tokens: 200,
    });
    const note = resp.choices?.[0]?.message?.content?.trim();
    return note || undefined;
  } catch (e) {
    console.warn('QA check failed', (e as Error).message);
    return undefined;
  }
}

export async function runCompanyEnrichment(
  tenantId: string,
  companyId: string,
  opts: { mode?: Mode; force?: boolean } = {}
): Promise<void> {
  const mode: Mode = opts.mode || 'full';
  const serpKey = process.env.SERP_API_KEY || process.env.SERPAPI_KEY || '';
  if (!serpKey) {
    logEnrichmentEvent('missing_serp_key', { tenantId, companyId });
  }
  // No logger here; rely on index-level logs/metrics later

  const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
  const snap = await companyRef.get();
  if (!snap.exists) return;
  const company = snap.data() as any;

  const companyName = company.companyName || company.name || '';
  let websiteUrl: string | undefined = company.website || company.companyUrl || company.url;
  let linkedinUrl: string | undefined = company.linkedin;
  let indeedUrl: string | undefined = company.indeed;

  // Fallback: best-guess URLs if missing
  if (!websiteUrl || !linkedinUrl || !indeedUrl) {
    try {
      const guesses = await fetchBestGuessUrls(companyName);
      websiteUrl = websiteUrl || guesses.website;
      linkedinUrl = linkedinUrl || guesses.linkedin;
      indeedUrl = indeedUrl || guesses.indeed;
      if (mode === 'metadata') {
        await companyRef.set(
          { website: websiteUrl, linkedin: linkedinUrl, indeed: indeedUrl },
          { merge: true }
        );
      }
    } catch (e) {
      console.warn('URL discovery failed', { tenantId, companyId, err: (e as Error).message });
    }
  }

  // Fetch sources (best effort)
  const [website, linkedin, jobs] = await Promise.all([
    websiteUrl ? fetchAndNormalize(websiteUrl, serpKey, 10000, { tenantId, companyId, source: 'website' }).catch((e) => { console.warn('SERP website fetch failed', { companyId, websiteUrl, err: (e as Error).message }); return { text: '', hash: '', fetchedAt: new Date().toISOString() }; }) : Promise.resolve({ text: '', hash: '', fetchedAt: new Date().toISOString() }),
    linkedinUrl ? fetchAndNormalize(linkedinUrl, serpKey, 10000, { tenantId, companyId, source: 'linkedin' }).catch((e) => { console.warn('SERP linkedin fetch failed', { companyId, linkedinUrl, err: (e as Error).message }); return { text: '', hash: '', fetchedAt: new Date().toISOString() }; }) : Promise.resolve({ text: '', hash: '', fetchedAt: new Date().toISOString() }),
    indeedUrl ? fetchAndNormalize(indeedUrl, serpKey, 10000, { tenantId, companyId, source: 'jobs' }).catch((e) => { console.warn('SERP jobs fetch failed', { companyId, indeedUrl, err: (e as Error).message }); return { text: '', hash: '', fetchedAt: new Date().toISOString() }; }) : Promise.resolve({ text: '', hash: '', fetchedAt: new Date().toISOString() }),
  ]);

  // Write/refresh cache state
  const cacheRef = companyRef.collection('enrichment_cache').doc('state');
  await cacheRef.set(
    {
      websiteText: website.text,
      linkedinText: linkedin.text,
      jobText: jobs.text,
      websiteHash: website.hash,
      linkedinHash: linkedin.hash,
      jobHash: jobs.hash,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      urls: { website: websiteUrl, linkedin: linkedinUrl, indeed: indeedUrl }
    },
    { merge: true }
  );

  const hasSignal = (website.text || linkedin.text || jobs.text).length > 0;
  if (mode === 'metadata' || !hasSignal) {
    // Persist any discovered URLs in metadata mode or when signal is low
    await companyRef.set({ lastEnrichedAt: admin.firestore.FieldValue.serverTimestamp(), metadata: { discoveredUrls: { website: websiteUrl, linkedin: linkedinUrl, indeed: indeedUrl }, signalStrength: hasSignal ? 'low' : 'none' } }, { merge: true });
    await createCompanyAILog('companyEnrichment.metadata', companyId, 'Metadata refresh', tenantId, 'system', undefined, undefined);
    return;
  }

  // Optional Clearbit fallback if configured and still low-quality signals after SERP
  // If we reached here we have some text; if ENABLE_CLEARBIT_FALLBACK is true and summary fields are thin, we augment
  try {
    const enableClearbit = (process.env.ENABLE_CLEARBIT_FALLBACK || 'false').toLowerCase() === 'true';
    if (enableClearbit && !(website.text.length + linkedin.text.length + jobs.text.length > 400)) {
      const cbKey = await getClearbitKey(tenantId);
      const domain = (websiteUrl || '')
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .toLowerCase();
      if (cbKey && domain) {
        const cb = await fetchClearbitCompany(domain, cbKey);
        if (cb) {
          logEnrichmentEvent('companyEnrichment.started', { tenantId, companyId, clearbit: true });
          // Build a tiny prompt with clearbit data to enrich businessSummary/topJobTitles
          const seedSummary = cb.description || `${cb.name || companyName} in ${cb.category?.industry || ''}`.trim();
          const sizeBucket = bucketEmployeesToSize(cb.metrics?.employees);
          // Minimal augment: prepend summary and hint titles from industry
          if (seedSummary) {
            // We will extend the prompt rather than re-scrape
          }
        }
      }
    }
  } catch (e) {
    console.warn('Clearbit fallback failed', (e as Error).message);
  }

  // Build prompt and call model with JSON schema intent
  const prompt = [
    'You are a strategic sales researcher for a staffing agency.',
    'Given the sources below, produce a JSON object with the following keys exactly:',
    'businessSummary (string), topJobTitles (string[]), hiringTrends (string[]), competitorCompanies (string[]), likelyPainPoints (string[]),',
    'recommendedContacts (Array<{ role: string; titleGuess: string }>), redFlags (string[]), suggestedTags (string[]), suggestedApproach (string),',
    'generatedScripts (Object<{ coldEmail: string; coldCallOpening: string; voicemail: string }> ).',
    '',
    'Requirements:',
    '- businessSummary: 2-3 complete sentences summarizing what the company does and where they operate. No ellipses, no slogans, no follower counts.',
    '- Derive topJobTitles and hiringTrends from the Job Listings text if present; else leave empty arrays.',
    '- competitorCompanies: only include if clearly related; otherwise empty.',
    '- recommendedContacts: roles like HR, Operations, Warehouse, Leadership with a plausible titleGuess (e.g., HR Director).',
    '- generatedScripts: concise, specific, grounded in the businessSummary and hiringTrends.',
    '- If sources are thin, prefer empty fields over hallucination.',
    '',
    '[SOURCES]',
    `Website Text: ${website.text}`,
    `LinkedIn Text: ${linkedin.text}`,
    `Job Listings: ${jobs.text}`,
  ].join('\n');

  const startedAt = Date.now();
  let { parsed, model, usage } = await callGptEnrichment(prompt);
  // Guard against missing summary due to model variance
  if (!parsed.businessSummary || parsed.businessSummary.trim().length === 0) {
    const fallback = [website.text, linkedin.text, jobs.text].filter(Boolean).join(' ').slice(0, 600);
    parsed.businessSummary = fallback || `${companyName} company overview unavailable.`;
  }
  parsed.businessSummary = sanitizeSummary(parsed.businessSummary);
  const qaNotes = await qaCheckEnrichment(parsed, { website: website.text, linkedin: linkedin.text, jobs: jobs.text });

  const versionMeta = CompanyEnrichmentVersionMetaSchema.parse({
    model,
    tokenUsage: usage,
    websiteHash: website.hash,
    linkedinHash: linkedin.hash,
    jobHash: jobs.hash,
  });

  // Apollo augmentation (optional, additive)
  try {
    // Enable by default unless explicitly disabled
    const enableApollo = (process.env.ENABLE_APOLLO || 'true').toLowerCase() !== 'false';
    if (enableApollo) {
      const apolloKey = await getApolloKey(tenantId);
      // Extract domain from websiteUrl
      const domain = (() => {
        try {
          if (!websiteUrl) return undefined;
          const u = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
          return u.hostname.replace(/^www\./, '').toLowerCase();
        } catch { return undefined; }
      })();
      if (apolloKey && domain) {
        const [aCompany, aPeople] = await Promise.all([
          apolloCompanyByDomain(domain, apolloKey),
          apolloPeopleSearch({ domain, departments: ['operations', 'hr', 'warehouse'], seniorities: ['vp','head','director','manager'], limit: 10 }, apolloKey)
        ]);

        // Merge top job titles from Apollo if GPT result is sparse
        if ((!parsed.topJobTitles || parsed.topJobTitles.length === 0) && aPeople && aPeople.length > 0) {
          const titles = Array.from(new Set(aPeople.map(p => (p.title || '').trim()).filter(Boolean))).slice(0, 6);
          if (titles.length) parsed.topJobTitles = titles;
        }

        // Merge recommended contacts from Apollo (role inference)
        if (aPeople && aPeople.length > 0) {
          const roleOf = (title?: string, dept?: string): string => {
            const t = (title || '').toLowerCase();
            const d = (dept || '').toLowerCase();
            if (d.includes('hr') || t.includes('people') || t.includes('human resources')) return 'HR';
            if (d.includes('operations') || t.includes('ops')) return 'Operations';
            if (t.includes('warehouse') || d.includes('warehouse') || d.includes('logistics')) return 'Warehouse';
            return 'Leadership';
          };
          const apolloRecs = aPeople.slice(0, 8).map(p => ({ role: roleOf(p.title, p.department), titleGuess: p.title || 'Executive' }));
          const existing = new Set((parsed.recommendedContacts || []).map(r => `${r.role}|${r.titleGuess}`));
          const merged = [...(parsed.recommendedContacts || [])];
          for (const r of apolloRecs) {
            const key = `${r.role}|${r.titleGuess}`;
            if (!existing.has(key)) merged.push(r);
          }
          parsed.recommendedContacts = merged.slice(0, 12);
        }

        // Persist Apollo firmographics snapshot (non-blocking)
        if (aCompany) {
          await companyRef.set({ firmographics: { apollo: aCompany }, metadata: { apolloFetchedAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
          // Optionally map employee count to size if company.size missing
          if (!company.size && aCompany.employeeCount) {
            const bucket = bucketEmployeesToSize(aCompany.employeeCount);
            if (bucket) await companyRef.set({ size: bucket }, { merge: true });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Apollo augmentation failed', (e as Error).message);
  }

  // Versioned write
  const versionDoc = companyRef.collection('ai_enrichments').doc();
  await versionDoc.set({
    ...parsed,
    ...versionMeta,
    ...(qaNotes ? { qaNotes } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Upsert latest snapshot and bookkeeping
  const lead = computeLeadScore(parsed);
  await companyRef.set(
    {
      aiEnrichment: parsed,
      enrichmentVersion: admin.firestore.FieldValue.increment(1),
      lastEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
      leadScore: lead.score,
      leadSignals: lead.signals,
    },
    { merge: true }
  );

  // Optional semantic embedding for future similarity search
  const embed = await generateEmbedding([
    parsed.businessSummary,
    (parsed.hiringTrends || []).join(', '),
    (parsed.likelyPainPoints || []).join(', '),
  ].join('\n'));
  if (embed) {
    const vecRef = companyRef.collection('vectors').doc('embedding');
    await vecRef.set({
      model: embed.model,
      dims: embed.dims,
      vector: embed.vector,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await createCompanyAILog(
    'companyEnrichment.success',
    companyId,
    'Company enrichment completed',
    tenantId,
    'system',
    { websiteHash: versionMeta.websiteHash, linkedinHash: versionMeta.linkedinHash, jobHash: versionMeta.jobHash },
    undefined
  );
}

export const enrichCompanyOnCreate = onDocumentCreated({ document: 'tenants/{tenantId}/crm_companies/{companyId}', secrets: [APOLLO_API_KEY] }, async (event) => {
  const { tenantId, companyId } = event.params as any;
  try {
    await runCompanyEnrichment(tenantId, companyId, { mode: 'metadata' });
  } catch (e) {
    console.error('enrichCompanyOnCreate failed', { tenantId, companyId, err: (e as Error).message });
  }
});

export const enrichCompanyOnDemand = onCall({ secrets: [APOLLO_API_KEY] }, async (request) => {
  const { tenantId, companyId, mode, force } = (request.data || {}) as { tenantId: string; companyId: string; mode?: Mode; force?: boolean };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId || !companyId) throw new Error('tenantId and companyId required');
  const desiredMode: Mode = (mode as Mode) || 'full';
  try {
    console.log('enrichCompanyOnDemand:start', { tenantId, companyId, mode: desiredMode, force: !!force });
    // Resolve key from env or Firestore
    let apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) apiKey = await getOpenAIKey(tenantId);
    if (apiKey) (openai as any).apiKey = apiKey;
    console.log('enrichCompanyOnDemand:key_present', { present: !!(openai as any).apiKey });
    // Graceful degrade if key still missing for full mode
    if (desiredMode !== 'metadata' && !(openai as any).apiKey) {
      console.warn('enrichCompanyOnDemand:degraded_no_key', { tenantId, companyId });
      await runCompanyEnrichment(tenantId, companyId, { mode: 'metadata', force: !!force });
      return { status: 'degraded', message: 'OPENAI_API_KEY missing; ran metadata-only refresh.' };
    }
    await runCompanyEnrichment(tenantId, companyId, { mode: desiredMode, force: !!force });
    console.log('enrichCompanyOnDemand:success', { tenantId, companyId });
    return { status: 'ok' };
  } catch (e: any) {
    console.error('enrichCompanyOnDemand failed', { tenantId, companyId, error: e?.message });
    return { status: 'error', message: e?.message || 'Internal error' };
  }
});

function getEnvNumber(name: string, def: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}

export const enrichCompanyWeekly = onSchedule({ schedule: '0 2 * * 0', secrets: [APOLLO_API_KEY] }, async () => {
  const stalenessDays = getEnvNumber('ENRICHMENT_DEFAULT_STALENESS_DAYS', 7);
  const weeklyCap = getEnvNumber('ENRICHMENT_WEEKLY_LIMIT', 300);
  const perTenantCap = Math.max(10, Math.min(50, Math.floor(weeklyCap / 4)));
  const olderThan = Date.now() - stalenessDays * 24 * 60 * 60 * 1000;

  let remaining = weeklyCap;
  const tenantsSnap = await db.collection('tenants').limit(50).get();
  for (const tenantDoc of tenantsSnap.docs) {
    if (remaining <= 0) break;
    const tenantId = tenantDoc.id;
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const batch: string[] = [];

    // Stale enrichment first
    const staleSnap = await companiesRef
      .where('lastEnrichedAt', '<', new Date(olderThan))
      .limit(Math.min(perTenantCap, remaining))
      .get()
      .catch(() => ({ empty: true, docs: [] as any[] } as FirebaseFirestore.QuerySnapshot));
    staleSnap.docs.forEach((d) => batch.push(d.id));

    // Missing enrichment
    if (batch.length < perTenantCap && remaining > 0) {
      const missingSnap = await companiesRef
        .where('lastEnrichedAt', '==', null)
        .limit(Math.min(perTenantCap - batch.length, remaining))
        .get()
        .catch(() => ({ empty: true, docs: [] as any[] } as FirebaseFirestore.QuerySnapshot));
      missingSnap.docs.forEach((d) => batch.push(d.id));
    }

    for (const companyId of batch) {
      try {
        await runCompanyEnrichment(tenantId, companyId, { mode: 'full' });
        remaining--;
        if (remaining <= 0) break;
        // small delay to avoid spikes
        await new Promise((r) => setTimeout(r, 250));
      } catch (e) {
        console.error('weekly enrichment failed', { tenantId, companyId, error: (e as Error).message });
      }
    }
  }
});

export const getEnrichmentStats = onCall(async (request) => {
  const { tenantId } = (request.data || {}) as { tenantId: string };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId) throw new Error('tenantId required');
  const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
  const snap = await companiesRef.get();
  let enriched = 0;
  let totalScore = 0;
  let withScore = 0;
  let updated7d = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  snap.forEach((doc) => {
    const d = doc.data() as any;
    if (d?.aiEnrichment) enriched++;
    if (typeof d?.leadScore === 'number') { totalScore += d.leadScore; withScore++; }
    const ts = d?.lastEnrichedAt?.toDate ? d.lastEnrichedAt.toDate().getTime() : (d?.lastEnrichedAt?._seconds ? d.lastEnrichedAt._seconds * 1000 : 0);
    if (ts && ts >= sevenDaysAgo) updated7d++;
  });
  return {
    companies: snap.size,
    enriched,
    updatedLast7Days: updated7d,
    avgLeadScore: withScore ? Math.round((totalScore / withScore) * 10) / 10 : 0,
  };
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export const enrichCompanyBatch = onCall(async (request) => {
  const { tenantId, limit = 50, mode = 'metadata', force = false } = (request.data || {}) as { tenantId: string; limit?: number; mode?: Mode; force?: boolean };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId) throw new Error('tenantId required');
  const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
  let snap = await companiesRef.where('hasActiveDeals', '==', true).limit(limit).get();
  if (snap.empty) snap = await companiesRef.where('hasOpenJobOrders', '==', true).limit(limit).get();
  if (snap.empty) snap = await companiesRef.orderBy('updatedAt', 'desc').limit(limit).get();
  let processed = 0;
  for (const doc of snap.docs) {
    try {
      await runCompanyEnrichment(tenantId, doc.id, { mode: (mode as Mode) || 'metadata', force });
      processed++;
      // simple throttle
      await sleep(500);
    } catch (e) {
      console.error('Batch enrichment failed for', doc.id, e);
    }
  }
  return { queued: processed };
});


