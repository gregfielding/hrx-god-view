import fetch from 'node-fetch';
import { logEnrichmentEvent } from './logging';
import crypto from 'crypto';

export interface SerpTextResult {
  text: string;
  hash: string;
  fetchedAt: string;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function htmlToText(html: string): string {
  // Keep headings, paragraphs, list items; drop scripts/styles
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const kept = withoutScripts
    .replace(/<\/(h1|h2|h3|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return kept.replace(/\n{2,}/g, '\n').replace(/\s{2,}/g, ' ').trim();
}

async function fetchSerpRaw(url: string, serpApiKey: string): Promise<string> {
  // SERP API "fetch page" endpoint proxy; if unavailable, fallback to direct fetch
  // Caller must provide a fully qualified URL to fetch
  try {
    if (!serpApiKey) throw new Error('Missing SERPAPI_KEY');
    // Fallback/simple approach: use SERP cached HTML via a generic search; if structure unknown, skip
    const resp = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(url)}&api_key=${serpApiKey}`);
    if (resp.ok) {
      const json: any = await resp.json();
      const first = json && json.organic_results && json.organic_results[0];
      const html = (first && (first.snippet || first.title)) || '';
      if (html) return String(html);
    }
  } catch {}
  // Fallback direct fetch (some sites will block; acceptable for best-effort)
  const direct = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return await direct.text();
}

export async function fetchAndNormalize(url: string, serpApiKey: string, maxChars = 10000, context?: { tenantId?: string; companyId?: string; source?: string }): Promise<SerpTextResult> {
  const html = await fetchSerpRaw(url, serpApiKey);
  const text = htmlToText(html).slice(0, maxChars);
  if (!text) {
    logEnrichmentEvent('sourceText.empty', { url, source: context?.source, tenantId: context?.tenantId, companyId: context?.companyId });
  }
  return { text, hash: sha256(text), fetchedAt: new Date().toISOString() };
}

export async function fetchBestGuessUrls(companyName: string): Promise<{ website?: string; linkedin?: string; indeed?: string }> {
  // Lightweight deterministic guesses; the proper discoverCompanyUrls callable can refine later
  const base = companyName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const slug = base.replace(/\s+/g, '');
  return {
    website: `https://${slug}.com`,
    linkedin: `https://www.linkedin.com/company/${slug}`,
    indeed: `https://www.indeed.com/cmp/${base.replace(/\s+/g, '-')}`,
  };
}


