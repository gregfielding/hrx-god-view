/**
 * Google Jobs / SEO for the public job board (Greg 2026-09-09).
 *
 * hrxone.com is a CRA single-page app: every job page shipped the bare shell
 * (title "C1 Staffing", no description, no structured data) and Google indexed
 * "You need to enable JavaScript to run this app." This function sits behind
 * Firebase Hosting rewrites and, for the public board routes only, serves the
 * SAME app shell with the job's real <title>, meta description, canonical URL,
 * Open Graph tags and a schema.org JobPosting JSON-LD block injected into
 * <head>. The React app boots exactly as before. It also serves /sitemap.xml.
 *
 * Routes (see firebase.json rewrites):
 *   /sitemap.xml                  → all active public postings for every tenant with a slug
 *   /:slug/jobs-board             → board shell with a real title/description
 *   /:slug/jobs-board/:postId     → posting shell + JobPosting JSON-LD (404 + noindex when not public)
 *
 * Sources: tenants/{t}/job_postings (status 'active', visibility 'public') and,
 * for `job-order-<id>` post ids, tenants/{t}/job_orders (jobType 'gig', open).
 * Google requires expired postings to disappear: an inactive posting returns
 * 404 with the shell (humans still see the app's own not-found state).
 */
import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

// Domain-agnostic (Greg 2026-09-09: "future-proof for c1staffing.com / app.c1staffing.com").
// The public origin comes from, in order: platform_config/seo.canonicalOrigin (set this when the
// canonical domain changes or while two domains serve the site), the request's forwarded host,
// then the fallback below. Everything emitted (canonical, og:url, JSON-LD url, sitemap, robots)
// uses that origin, so moving domains needs no code change.
const FALLBACK_ORIGIN = 'https://hrxone.com';
const SHELL_FALLBACK_URL = 'https://hrx1-d3beb.web.app/index.html';
const ORG_NAME = 'C1 Staffing';
const VALID_DAYS = 30;

const db = () => admin.firestore();
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---- caches (per instance) -------------------------------------------------
let shellCache: { html: string; at: number } | null = null;
async function shell(origin: string): Promise<string> {
  if (shellCache && Date.now() - shellCache.at < 5 * 60_000) return shellCache.html;
  for (const url of [`${origin}/index.html`, SHELL_FALLBACK_URL]) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'hrx-jobPostingSeo' } });
      const html = await res.text();
      if (res.ok && html.includes('<div id="root">')) { shellCache = { html, at: Date.now() }; return html; }
    } catch { /* try next */ }
  }
  throw new Error('shell fetch failed');
}

let originCache: { at: number; value: string | null } | null = null;
async function configuredOrigin(): Promise<string | null> {
  if (originCache && Date.now() - originCache.at < 10 * 60_000) return originCache.value;
  const v = s((await db().doc('platform_config/seo').get().catch(() => null))?.get('canonicalOrigin')).replace(/\/+$/, '');
  originCache = { at: Date.now(), value: /^https?:\/\//.test(v) ? v : null };
  return originCache.value;
}
async function siteOrigin(req: { headers: Record<string, unknown>; hostname?: string }): Promise<string> {
  const configured = await configuredOrigin();
  if (configured) return configured;
  const fwd = s(req.headers['x-forwarded-host']).split(',')[0].trim();
  const host = fwd || s(req.hostname);
  if (host && !/localhost|cloudfunctions\.net|\.run\.app$/i.test(host)) return `https://${host}`;
  return FALLBACK_ORIGIN;
}

let tenantCache: { at: number; bySlug: Map<string, { id: string; name: string }> } | null = null;
async function tenantsBySlug(): Promise<Map<string, { id: string; name: string }>> {
  if (tenantCache && Date.now() - tenantCache.at < 10 * 60_000) return tenantCache.bySlug;
  const snap = await db().collection('tenants').limit(100).get();
  const bySlug = new Map<string, { id: string; name: string }>();
  for (const d of snap.docs) {
    const slug = s(d.get('slug')).toLowerCase();
    if (slug) bySlug.set(slug, { id: d.id, name: s(d.get('name')) || ORG_NAME });
  }
  tenantCache = { at: Date.now(), bySlug };
  return bySlug;
}

// ---- posting model ---------------------------------------------------------
export interface PublicPosting {
  id: string;
  title: string;
  descriptionText: string;
  company: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  payRate: number | null;
  jobType: string;
  datePosted: Date;
  lastmod: Date;
  identifier: string;
}

function postingFromDoc(id: string, x: Record<string, unknown>): PublicPosting | null {
  const title = s(x.postTitle) || s(x.jobTitle) || s(x.positionJobTitle) || s(x.title);
  if (!title) return null;
  const created = toDate(x.createdAt) ?? new Date();
  const addr = (x.worksiteAddress ?? {}) as Record<string, unknown>;
  const pay = Number(x.payRate ?? (x.gigPositions as Array<{ payRate?: unknown }> | undefined)?.[0]?.payRate);
  return {
    id,
    title,
    descriptionText: s(x.jobDescription) || s(x.description) || s(x.jobDescriptionPrompt) || '',
    company: s(x.companyName) || s(x.accountName) || '',
    street: s(x.street) || s(addr.street) || '',
    city: s(x.city) || s(addr.city) || '',
    state: s(x.state) || s(addr.state) || '',
    zip: s(x.zipCode) || s(addr.zipCode) || '',
    payRate: Number.isFinite(pay) && pay > 0 ? pay : null,
    jobType: s(x.jobType) || 'gig',
    datePosted: created,
    lastmod: toDate(x.updatedAt) ?? created,
    identifier: s(x.jobPostId) || id,
  };
}

async function loadPosting(tenantId: string, postId: string): Promise<PublicPosting | null> {
  if (postId.startsWith('job-order-')) {
    const jo = await db().doc(`tenants/${tenantId}/job_orders/${postId.slice('job-order-'.length)}`).get();
    if (!jo.exists) return null;
    const x = jo.data() as Record<string, unknown>;
    if (s(x.jobType) !== 'gig' || !['open', 'partially_filled', 'active'].includes(s(x.status).toLowerCase())) return null;
    return postingFromDoc(postId, x);
  }
  const p = await db().doc(`tenants/${tenantId}/job_postings/${postId}`).get();
  if (!p.exists) return null;
  const x = p.data() as Record<string, unknown>;
  if (s(x.status) !== 'active' || (s(x.visibility) && s(x.visibility) !== 'public')) return null;
  return postingFromDoc(postId, x);
}

async function listPublicPostings(tenantId: string): Promise<PublicPosting[]> {
  const out: PublicPosting[] = [];
  const snap = await db().collection(`tenants/${tenantId}/job_postings`).where('status', '==', 'active').limit(500).get();
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (s(x.visibility) && s(x.visibility) !== 'public') continue;
    const p = postingFromDoc(d.id, x);
    if (p) out.push(p);
  }
  return out;
}

// ---- rendering -------------------------------------------------------------
function descriptionHtml(text: string): string {
  const paras = text.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

export function jobPostingJsonLd(p: PublicPosting, slug: string, org: { name: string }, origin: string): Record<string, unknown> {
  const url = `${origin}/${slug}/jobs-board/${p.id}`;
  const validThrough = new Date(Date.now() + VALID_DAYS * 86400_000);
  const employmentType = p.jobType === 'gig' ? ['TEMPORARY', 'PART_TIME'] : p.jobType === 'part_time' ? 'PART_TIME' : 'FULL_TIME';
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: p.title,
    description: descriptionHtml(p.descriptionText || `${p.title} in ${p.city}, ${p.state}. Apply with ${org.name}.`),
    identifier: { '@type': 'PropertyValue', name: org.name, value: p.identifier },
    datePosted: p.datePosted.toISOString().slice(0, 10),
    validThrough: validThrough.toISOString(),
    employmentType,
    hiringOrganization: { '@type': 'Organization', name: org.name, sameAs: origin, logo: `${origin}/logo512.png` },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', ...(p.street ? { streetAddress: p.street } : {}), addressLocality: p.city, addressRegion: p.state, postalCode: p.zip, addressCountry: 'US' },
    },
    directApply: true,
    url,
  };
  if (p.payRate) ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', value: p.payRate, unitText: 'HOUR' } };
  return ld;
}

function headTags(input: { title: string; description: string; canonical: string; jsonLd?: Record<string, unknown>; noindex?: boolean }): string {
  const t = esc(input.title);
  const d = esc(input.description.replace(/\s+/g, ' ').slice(0, 300));
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${input.canonical}">`,
    input.noindex ? '<meta name="robots" content="noindex">' : '',
    `<meta property="og:type" content="website"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${input.canonical}"><meta property="og:site_name" content="C1 Staffing">`,
    input.jsonLd ? `<script type="application/ld+json">${JSON.stringify(input.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n');
}

function inject(html: string, head: string, noscript?: string): string {
  let out = html.replace(/<title>[^<]*<\/title>/, '').replace(/<meta name="description"[^>]*>/, '');
  out = out.replace('</head>', `${head}\n</head>`);
  if (noscript) out = out.replace('<div id="root">', `<noscript>${noscript}</noscript><div id="root">`);
  return out;
}

function summaryLine(p: PublicPosting): string {
  const bits = [p.company, [p.city, p.state].filter(Boolean).join(', '), p.payRate ? `$${p.payRate.toFixed(2)}/hour` : ''].filter(Boolean);
  return bits.join(' · ');
}

// ---- handler ---------------------------------------------------------------
export const jobPostingSeo = onRequest(
  { invoker: 'public', memory: '512MiB', timeoutSeconds: 30, maxInstances: 10 },
  async (req, res) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    const SITE = await siteOrigin(req as unknown as { headers: Record<string, unknown>; hostname?: string });
    try {
      // NOTE: unreachable in practice — the Cloud Functions runtime 404s /robots.txt and /favicon.ico
      // before user code runs, so hosting serves a static public/robots.txt instead. Kept for a future runtime.
      if (path === '/robots.txt') {
        res.set('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').status(200)
          .send(`User-agent: *\nDisallow:\n\nSitemap: ${SITE}/sitemap.xml\n`);
        return;
      }
      if (path === '/sitemap.xml') {
        const tenants = await tenantsBySlug();
        const urls: string[] = [`${SITE}/`, `${SITE}/privacy`, `${SITE}/terms`, `${SITE}/sms-privacy`, `${SITE}/consent`].map((u) => `<url><loc>${u}</loc></url>`);
        for (const [slug, t] of tenants) {
          urls.push(`<url><loc>${SITE}/${slug}/jobs-board</loc><changefreq>hourly</changefreq></url>`);
          const posts = await listPublicPostings(t.id);
          for (const p of posts) urls.push(`<url><loc>${SITE}/${slug}/jobs-board/${p.id}</loc><lastmod>${p.lastmod.toISOString().slice(0, 10)}</lastmod><changefreq>daily</changefreq></url>`);
        }
        res.set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=600').status(200)
          .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
        return;
      }

      const m = /^\/([a-z0-9-]+)\/jobs-board(?:\/([A-Za-z0-9_-]+))?$/i.exec(path);
      const html = await shell(SITE);
      if (!m) { res.set('Cache-Control', 'public, max-age=300').status(200).send(html); return; }
      const slug = m[1].toLowerCase();
      const postId = m[2];
      const tenant = (await tenantsBySlug()).get(slug);
      if (!tenant) { res.status(404).send(inject(html, headTags({ title: 'C1 Staffing', description: 'Jobs board', canonical: `${SITE}/${slug}/jobs-board`, noindex: true }))); return; }

      if (!postId) {
        const head = headTags({ title: `Open jobs — ${tenant.name}`, description: `Browse open shifts and jobs with ${tenant.name}: warehouse, hospitality, events and more. Apply in minutes and get paid weekly.`, canonical: `${SITE}/${slug}/jobs-board` });
        res.set('Cache-Control', 'public, max-age=300').status(200).send(inject(html, head));
        return;
      }

      const posting = await loadPosting(tenant.id, postId);
      const canonical = `${SITE}/${slug}/jobs-board/${postId}`;
      if (!posting) {
        res.set('Cache-Control', 'no-store').status(404).send(inject(html, headTags({ title: `Job no longer available — ${tenant.name}`, description: 'This job is no longer open. Browse current openings.', canonical, noindex: true })));
        return;
      }
      const ld = jobPostingJsonLd(posting, slug, tenant, SITE);
      const description = `${posting.title} — ${summaryLine(posting)}. ${posting.descriptionText.split('\n').find((l) => l.trim().length > 40) ?? ''}`;
      const head = headTags({ title: `${posting.title} — ${[posting.city, posting.state].filter(Boolean).join(', ')} | ${tenant.name}`, description, canonical, jsonLd: ld });
      const noscript = `<h1>${esc(posting.title)}</h1><p>${esc(summaryLine(posting))}</p>${descriptionHtml(posting.descriptionText)}<p><a href="${canonical}">Apply at ${esc(tenant.name)}</a></p>`;
      res.set('Cache-Control', 'public, max-age=300').status(200).send(inject(html, head, noscript));
    } catch (err) {
      logger.error('[jobPostingSeo] failed; serving plain shell', { path, err: err instanceof Error ? err.message : String(err) });
      try {
        res.set('Cache-Control', 'no-store').status(200).send(await shell(SITE));
      } catch {
        res.redirect(302, `${SITE}/index.html`);
      }
    }
  },
);
