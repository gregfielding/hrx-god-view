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
import { THIN_DESCRIPTION_CHARS, generateDescriptionForPosting } from '../jobs/jobDescriptionGenerator';
import { craigslistCategoryFor, craigslistExpiryDays, craigslistPostUrl, craigslistSiteFor, type CraigslistDraft, type CraigslistPosting } from '../shared/craigslist';

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
async function composeDraft(post: Record<string, unknown>, postId: string): Promise<CraigslistDraft> {
  const city = s(post.city) || s((post.worksiteAddress as Record<string, unknown> | undefined)?.city);
  const state = s(post.state) || s((post.worksiteAddress as Record<string, unknown> | undefined)?.state);
  const site = craigslistSiteFor(city, state);
  const { category, slug } = craigslistCategoryFor(s(post.jobType));
  const pay = Number(post.payRate);
  const compensation = Number.isFinite(pay) && pay > 0 ? `$${pay.toFixed(2)}/hour, paid weekly` : 'Competitive hourly pay, paid weekly';
  const applyUrl = `https://hrxone.com/c1/jobs-board/${postId}`;
  let description = s(post.jobDescription);
  if (description.length < THIN_DESCRIPTION_CHARS) {
    const generated = await generateDescriptionForPosting(TENANT, postId, { by: 'natalie-craigslist', force: true });
    if (generated) description = generated;
  }
  if (!description) throw new Error('no job description on the post and nothing to generate one from — add a description or client notes');
  const titleBase = s(post.postTitle) || s(post.jobTitle);
  const payBit = Number.isFinite(pay) && pay > 0 ? ` - $${pay.toFixed(2)}/hr, weekly pay` : '';
  const title = `${titleBase} - ${[city, state].filter(Boolean).join(', ')}${payBit}`.slice(0, 70);
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
        `Location: ${draft.specificLocation} · Compensation: ${draft.compensation} · Contact email: ${draft.contactEmail}`,
        `Publish it here: ${draft.postUrl} — then paste the live URL into the post's Craigslist URL field (<https://hrxone.com/jobs/job-orders|HRX>). Craigslist charges per job post; gigs may be free. Replies come to my mailbox and I'll triage them.`,
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
    return { postId: d.id, jobPostId: d.get('jobPostId') ?? null, title: s(d.get('postTitle')) || s(d.get('jobTitle')), city: s(d.get('city')), status: cl.status, site: cl.draft?.site ?? null, category: cl.draft?.category ?? null, postUrl: cl.draft?.postUrl ?? null, adTitle: cl.draft?.title ?? null, liveUrl: s(d.get('craigslistUrl')) || null, postedAt: cl.postedAt ?? null, expiresAt: cl.expiresAt ?? null, hrxLink: `https://hrxone.com/c1/jobs-board/${d.id}` };
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
