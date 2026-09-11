/**
 * Semi-automated Craigslist posting (Greg 2026-09-09): opt-in per job board post.
 * See shared/craigslist.ts for the flow. This file:
 *   - drainCraigslistDrafts: every minute, for job_postings with craigslist.status 'requested',
 *     writes a Craigslist-ready draft (Claude) and posts it in #recruiting; flips 'posted' →
 *     'expired' when expiresAt passes and nudges the thread 2 days before.
 *   - craigslistQueue / craigslistMarkPosted: Natalie tools for Slack.
 * Nothing here talks to craigslist.org — publishing is a human step (or Claude driving the
 * recruiter's own browser); Craigslist's terms forbid automated posting.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';
import { isThinDescription, generateDescriptionForPosting } from '../jobs/jobDescriptionGenerator';
import { craigslistCategoryFor, craigslistExpiryDays, craigslistPostUrl, craigslistSiteFor, type CraigslistDraft, type CraigslistPosting } from '../shared/craigslist';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';

const db = admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const CONTACT_EMAIL = 'n.brooks@c1staffing.com';
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/**
 * Greg 2026-09-09: the Craigslist body IS the job board description (the rich AI text recruiters
 * generate in HRX) — not a re-summary — with "Apply Here: <jobs board link>" appended, the same link
 * the "Copy Jobs Board Link" button on the job order's Jobs Board tab produces. Thin/missing
 * descriptions are generated first with the shared generator so the post improves too.
 */
/**
 * Craigslist titles cap at 70 chars. Post titles often already carry the city ("CORT 201 3rd St,
 * San Francisco - Gig Work"), so only append the location when it isn't there, and drop the pay
 * suffix pieces from the right instead of cutting mid-word (the CORT SF draft came out as
 * "... - San Francisco, CA - $21.50" on 2026-09-09).
 */
export function composeTitle(base: string, city: string, state: string, pay: number): string {
  const loc = [city, state].filter(Boolean).join(', ');
  const hasCity = !!city && base.toLowerCase().includes(city.toLowerCase());
  const head = hasCity || !loc ? base : `${base} - ${loc}`;
  const payFull = Number.isFinite(pay) && pay > 0 ? ` - $${pay.toFixed(2)}/hr, weekly pay` : '';
  const payShort = Number.isFinite(pay) && pay > 0 ? ` - $${pay.toFixed(2)}/hr` : '';
  for (const t of [head + payFull, head + payShort, head]) if (t.length <= 70) return t;
  return head.slice(0, 70).trim();
}

/** Pure: a pasted Craigslist URL (with or without the scheme) as https, or null when it isn't one. */
export function normalizeCraigslistUrl(raw: unknown): string | null {
  const t = s(raw);
  if (!t) return null;
  const url = /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, 'https://') : `https://${t.replace(/^\/+/, '')}`;
  return /^https:\/\/[a-z0-9.-]*craigslist\.org\//i.test(url) ? url : null;
}

async function composeDraft(post: Record<string, unknown>, postId: string): Promise<CraigslistDraft> {
  const city = s(post.city) || s((post.worksiteAddress as Record<string, unknown> | undefined)?.city);
  const state = s(post.state) || s((post.worksiteAddress as Record<string, unknown> | undefined)?.state);
  const site = craigslistSiteFor(city, state);
  const { category, slug } = craigslistCategoryFor(s(post.jobType));
  const pay = Number(post.payRate);
  const compensation = Number.isFinite(pay) && pay > 0 ? `$${pay.toFixed(2)}/hour, paid weekly` : 'Competitive hourly pay, paid weekly';
  const applyUrl = `${PUBLIC_APP_ORIGIN}/c1/jobs-board/${postId}`;
  let description = s(post.jobDescription);
  if (isThinDescription(description)) {
    const generated = await generateDescriptionForPosting(TENANT, postId, { by: 'natalie-craigslist', force: true });
    if (generated) description = generated;
  }
  if (!description) throw new Error('no job description on the post and nothing to generate one from — add a description or client notes');
  const title = composeTitle(s(post.postTitle) || s(post.jobTitle), city, state, pay);
  const body = `${description.trim()}

Apply Here: ${applyUrl}`;
  return {
    site, category, postUrl: craigslistPostUrl(site, slug), title, body,
    specificLocation: [city, state].filter(Boolean).join(', '),
    compensation, contactEmail: CONTACT_EMAIL, generatedAt: new Date().toISOString(), generatedBy: 'natalie',
  };
}

export async function drainCraigslistDrafts(token: string): Promise<number> {
  const cfg = (await db.doc(`tenants/${TENANT}/app_config/natalie`).get()).data() as Record<string, unknown> | undefined;
  const channel = s(cfg?.recruitingChannelId) || 'C0BF02MEKUP';
  let touched = 0;
  const requested = await db.collection(`tenants/${TENANT}/job_postings`).where('craigslist.status', '==', 'requested').limit(10).get();
  for (const d of requested.docs) {
    const post = d.data() as Record<string, unknown>;
    const cl = (post.craigslist ?? {}) as CraigslistPosting;
    try {
      const draft = await composeDraft(post, d.id);
      const text = [
        `Craigslist draft for *${draft.title}* (post ${s(post.jobPostId) || d.id}, ${draft.site} · ${draft.category}):`,
        '```' + draft.body + '```',
        `Location: ${draft.specificLocation} · Compensation: ${draft.compensation}`,
        `Publish it here: ${draft.postUrl} — Craigslist settings (Greg 2026-09-10): job posts are *full-time* and *entry level*; email option *no replies to this email* with *remember contact preferences* ticked, since applicants use the Apply Here link. Then paste the live URL into the post's Craigslist URL field (<${PUBLIC_APP_ORIGIN}/jobs/job-orders|HRX>). Craigslist charges per post (Denver labor gigs $7; Chicago jobs $45 per category).`,
      ].join('\n');
      const res = await postAsNatalie(token, { channel, text });
      const next: CraigslistPosting = { ...cl, enabled: true, status: 'ready', draft, lastError: null, slackTs: res.ts ?? cl.slackTs ?? null };
      await d.ref.set({ craigslist: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await recordNatalieAction({ tenantId: TENANT, kind: 'craigslist_draft', summary: `Drafted a Craigslist ad for ${draft.title} (${draft.site})`, slack: res.ok ? { channel, ts: res.ts } : undefined, result: { postId: d.id, site: draft.site } });
      touched += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[natalie] craigslist draft failed', { postId: d.id, err: msg });
      await d.ref.set({ craigslist: { ...cl, status: 'error', lastError: msg.slice(0, 300) } }, { merge: true });
    }
  }
  // Ready + a live URL pasted into the post form → posted. The form saves craigslistUrl but never
  // flips the status, so these ads had no expiry and no renewal nudge (three OnTrac posts, 2026-09-11).
  const ready = await db.collection(`tenants/${TENANT}/job_postings`).where('craigslist.status', '==', 'ready').limit(50).get();
  for (const d of ready.docs) {
    const liveUrl = normalizeCraigslistUrl(d.get('craigslistUrl'));
    if (!liveUrl) continue;
    const cl = (d.get('craigslist') ?? {}) as CraigslistPosting;
    const marked = (await craigslistMarkPosted(TENANT, d.id, liveUrl)) as { ok?: boolean; expiresAt?: string };
    if (!marked.ok) continue;
    const title = s(d.get('postTitle')) || s(d.get('jobTitle'));
    await postAsNatalie(token, { channel, text: `Marked the Craigslist ad for *${title}* as live (${liveUrl}). It expires ${new Date(marked.expiresAt ?? '').toLocaleDateString('en-US')}; I'll nudge here two days before.`, threadTs: cl.slackTs ?? undefined });
    touched += 1;
  }
  // Posted → expired, with a nudge two days before.
  const posted = await db.collection(`tenants/${TENANT}/job_postings`).where('craigslist.status', '==', 'posted').limit(100).get();
  for (const d of posted.docs) {
    const cl = (d.get('craigslist') ?? {}) as CraigslistPosting & { nudgedAt?: string | null };
    const exp = cl.expiresAt ? Date.parse(cl.expiresAt) : NaN;
    if (!Number.isFinite(exp)) continue;
    const title = s(d.get('postTitle')) || s(d.get('jobTitle'));
    if (exp < Date.now()) {
      await d.ref.set({ craigslist: { ...cl, status: 'expired' } }, { merge: true });
      await postAsNatalie(token, { channel, text: `The Craigslist ad for *${title}* has expired (${s(d.get('craigslistUrl'))}). Repost from the draft in HRX if the order is still open, then paste the new URL.`, threadTs: cl.slackTs ?? undefined });
      touched += 1;
    } else if (exp - Date.now() < 2 * 86400_000 && !cl.nudgedAt) {
      await d.ref.set({ craigslist: { ...cl, nudgedAt: new Date().toISOString() } }, { merge: true });
      await postAsNatalie(token, { channel, text: `Heads up: the Craigslist ad for *${title}* expires ${new Date(exp).toLocaleDateString('en-US')}. Renew it on Craigslist if the order is still open.`, threadTs: cl.slackTs ?? undefined });
      touched += 1;
    }
  }
  return touched;
}

/** Natalie tool: what's queued / live on Craigslist. */
export async function craigslistQueue(tenantId: string): Promise<unknown> {
  const snap = await db.collection(`tenants/${tenantId}/job_postings`).where('craigslist.enabled', '==', true).limit(100).get();
  return snap.docs.map((d) => {
    const cl = (d.get('craigslist') ?? {}) as CraigslistPosting;
    return { postId: d.id, jobPostId: d.get('jobPostId') ?? null, title: s(d.get('postTitle')) || s(d.get('jobTitle')), city: s(d.get('city')), status: cl.status, site: cl.draft?.site ?? null, category: cl.draft?.category ?? null, postUrl: cl.draft?.postUrl ?? null, adTitle: cl.draft?.title ?? null, liveUrl: s(d.get('craigslistUrl')) || null, postedAt: cl.postedAt ?? null, expiresAt: cl.expiresAt ?? null, hrxLink: `${PUBLIC_APP_ORIGIN}/c1/jobs-board/${d.id}` };
  });
}

/** Natalie tool: record the live Craigslist URL after a human publishes. */
export async function craigslistMarkPosted(tenantId: string, postId: string, liveUrl: string): Promise<unknown> {
  const ref = db.doc(`tenants/${tenantId}/job_postings/${postId}`);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'no such job posting' };
  if (!/^https?:\/\/[a-z0-9.-]*craigslist\.org\//i.test(liveUrl)) return { error: 'liveUrl must be a craigslist.org URL' };
  const cl = (snap.get('craigslist') ?? { enabled: true, status: 'ready' }) as CraigslistPosting;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + craigslistExpiryDays(s(snap.get('jobType'))) * 86400_000).toISOString();
  const next: CraigslistPosting = { ...cl, enabled: true, status: 'posted', postedAt: now.toISOString(), expiresAt, lastError: null };
  await ref.set({ craigslistUrl: liveUrl, craigslist: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await recordNatalieAction({ tenantId, kind: 'craigslist_posted', summary: `Recorded the live Craigslist ad for ${s(snap.get('postTitle')) || postId}`, result: { postId, liveUrl, expiresAt } });
  return { ok: true, postId, liveUrl, expiresAt };
}
