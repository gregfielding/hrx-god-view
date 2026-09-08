/**
 * Fill kick-off on accept (Greg 2026-09-08 09:11 MT, "yes make those
 * changes"): accept every Flex request within a minute AND start booking pool
 * workers immediately, because Flex revokes unbooked headcount ~4h after a
 * request is posted (three OnTrac Denver requests expired unseen on 9/7).
 *
 * When a real (non-dry-run) `accept_job_request` portal action succeeds, find
 * the HRX shift Flex created for it (shifts.poNumber == flexJobId), text the
 * shift offer to the best candidates (applicants + 15 mi, cleared, textable,
 * up to 2× the open headcount, max 20) and post the plan in Slack. YES
 * replies place + book in Flex through the usual SMS-watch path.
 *
 * Runs from drainNatalieOutbox every minute. Opt out with
 * `app_config/natalie.fillOnAccept = false`.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';
import { candidatesForJobOrder, offerShiftToWorker } from './natalieFill';

const db = admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const toDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: unknown }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : null);

export async function drainAcceptFills(token: string): Promise<number> {
  const cfg = (await db.doc(`tenants/${TENANT}/app_config/natalie`).get()).data() as Record<string, unknown> | undefined;
  if (cfg?.fillOnAccept === false) return 0;
  const channel = s(cfg?.flexNoticeChannelId) || 'C0BF02MEKUP';
  const snap = await db.collection(`tenants/${TENANT}/portal_actions`).where('action', '==', 'accept_job_request').where('status', '==', 'succeeded').limit(40).get();
  let kicked = 0;
  for (const d of snap.docs) {
    const a = d.data() as Record<string, unknown>;
    const payload = (a.payload ?? {}) as Record<string, unknown>;
    if (payload.dryRun === true || a.natalieFillKickoffAt) continue;
    const finished = toDate(a.finishedAt) ?? toDate(a.updatedAt);
    if (!finished || Date.now() - finished.getTime() > 24 * 3600_000) continue;
    const flexJobId = s(payload.flexJobId);
    if (!flexJobId) continue;
    await d.ref.set({ natalieFillKickoffAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    try {
      const shifts = await db.collectionGroup('shifts').where('poNumber', '==', flexJobId).limit(5).get();
      const shift = shifts.docs.find((x) => x.ref.path.startsWith(`tenants/${TENANT}/job_orders/`));
      if (!shift) {
        // The HRX shift appears when the Flex sync ingests the accepted job; retry next minute (bounded by the 24h window).
        const deferrals = Number(a.natalieFillDeferrals ?? 0) + 1;
        await d.ref.set({ natalieFillKickoffAt: admin.firestore.FieldValue.delete(), natalieFillDeferrals: deferrals }, { merge: true });
        if (deferrals === 5) await postAsNatalie(token, { channel, text: `Accepted Flex request *#${flexJobId}* but there is no HRX shift for it yet — I'll start offering it as soon as the Flex sync brings it in.` });
        continue;
      }
      const jobOrderId = shift.ref.parent.parent?.id ?? '';
      const sh = shift.data() as Record<string, unknown>;
      const needed = Number(sh.headcount ?? sh.workersNeeded ?? sh.needed ?? payload.acceptHeadcount ?? 0) || 0;
      const assigned = Number(sh.assignmentsCount ?? 0) || 0;
      const open = Math.max(0, needed - assigned);
      const cands = await candidatesForJobOrder(TENANT, jobOrderId, { radiusMiles: 15, limit: 40 });
      const seen = new Set<string>();
      const targets = [...cands.applicants, ...cands.nearby]
        .filter((c) => c.phoneOk && !c.alreadyOnOrder && c.background !== 'failed')
        .sort((x, y) => y.score - x.score)
        .filter((c) => (seen.has(c.userId) ? false : (seen.add(c.userId), true)))
        .slice(0, Math.min(20, Math.max(4, (open || needed || 4) * 2)));
      const date = s(sh.date ?? sh.shiftDate);
      const sent: string[] = [];
      const skipped: string[] = [];
      for (const c of targets) {
        const r = await offerShiftToWorker({ tenantId: TENANT, userId: c.userId, jobOrderId, shiftId: shift.id, extra: 'This is an ongoing position, not a one-off', askedByName: 'auto (accepted Flex request)', slack: { channel } });
        (r.sent ? sent : skipped).push(r.sent ? c.name : `${c.name} (${r.error})`);
      }
      const text = `Accepted Flex request *#${flexJobId}* → HRX shift ${date} (${needed || '?'} needed, ${assigned} on it). Offered it by text to ${sent.length}: ${sent.join(', ') || 'nobody textable'}${skipped.length ? `. Skipped: ${skipped.join('; ')}` : ''}. A YES places them and books Flex. Flex revokes unbooked headcount about 4h after the request was posted.`;
      const res = await postAsNatalie(token, { channel, text });
      await d.ref.set({ natalieFill: { shiftId: shift.id, jobOrderId, offered: sent.length, skipped: skipped.length, slackTs: res.ts ?? null } }, { merge: true });
      await recordNatalieAction({ tenantId: TENANT, kind: 'fill_kickoff', summary: `Flex request #${flexJobId} accepted — offered the ${date} shift to ${sent.length} candidates`, jobOrderId, slack: res.ok ? { channel, ts: res.ts } : undefined, result: { offered: sent.length, skipped: skipped.length } });
      kicked += 1;
    } catch (err) {
      logger.warn('[natalie] fill kickoff failed', { flexJobId, err: String(err) });
      await postAsNatalie(token, { channel, text: `Accepted Flex request *#${flexJobId}* but my fill kick-off failed: ${err instanceof Error ? err.message : String(err)}. Please start offers by hand.` });
    }
  }
  return kicked;
}
