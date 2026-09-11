/**
 * Thin-description auto-fill (Greg 2026-09-09). Active, PUBLIC job board posts whose description is
 * under 300 characters (empty, or just the title — 11 of 204 on 9/9) get a rich description from the
 * shared generator, once, and #recruiting is told which posts were filled so a recruiter can review.
 * Posts with no source material (no client notes, no prompt, no company + title) are left alone
 * and flagged once. Runs in the natalieSlackInbox tick; max 3 generations per tick.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';
import { isThinDescription, buildInputFromPosting, generateDescriptionForPosting } from '../jobs/jobDescriptionGenerator';

const db = admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

export async function drainThinJobDescriptions(token: string): Promise<number> {
  const cfg = (await db.doc(`tenants/${TENANT}/app_config/natalie`).get()).data() as Record<string, unknown> | undefined;
  if (cfg?.autoFillDescriptions === false) return 0;
  const channel = s(cfg?.recruitingChannelId) || 'C0BF02MEKUP';
  const snap = await db.collection(`tenants/${TENANT}/job_postings`).where('status', '==', 'active').limit(400).get();
  const filled: string[] = [];
  const skipped: string[] = [];
  let budget = 3;
  for (const d of snap.docs) {
    if (budget === 0) break;
    const post = d.data() as Record<string, unknown>;
    if (s(post.visibility) && s(post.visibility) !== 'public') continue;
    if (!isThinDescription(s(post.jobDescription))) continue;
    if (post.descriptionAutoFillAt || post.descriptionAutoFillSkipped || post.jobDescriptionGeneratedAt) continue;
    const title = s(post.postTitle) || s(post.jobTitle) || d.id;
    try {
      const { hasSource } = await buildInputFromPosting(TENANT, post);
      if (!hasSource) {
        await d.ref.set({ descriptionAutoFillSkipped: 'no_source', descriptionAutoFillAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        skipped.push(title);
        continue;
      }
      budget -= 1;
      const text = await generateDescriptionForPosting(TENANT, d.id, { by: 'natalie-autofill', force: true });
      await d.ref.set({ descriptionAutoFillAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (text) filled.push(`<https://hrxone.com/c1/jobs-board/${d.id}|${title}>`);
    } catch (err) {
      logger.warn('[natalie] description autofill failed', { postId: d.id, err: String(err) });
    }
  }
  if (filled.length || skipped.length) {
    const parts: string[] = [];
    if (filled.length) parts.push(`I wrote full job descriptions for ${filled.length} public post${filled.length === 1 ? '' : 's'} that had none: ${filled.join(', ')}. Please skim them in HRX and regenerate if anything's off.`);
    if (skipped.length) parts.push(`Skipped (no client notes, prompt, or company to write from): ${skipped.join(', ')} — add a prompt or client description and I'll fill them.`);
    const res = await postAsNatalie(token, { channel, text: parts.join('\n') });
    await recordNatalieAction({ tenantId: TENANT, kind: 'description_autofill', summary: `Filled ${filled.length} thin job descriptions, skipped ${skipped.length}`, slack: res.ok ? { channel, ts: res.ts } : undefined, result: { filled: filled.length, skipped: skipped.length } });
  }
  return filled.length;
}
