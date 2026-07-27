/**
 * PI-6 — drain the Indeed Flex / Fieldglass review backlog (2026-07-27).
 *
 * The `needs_review` queue is meant to be a recruiter TO-DO list, but it
 * silently accumulates dead weight: rows whose shift date has passed (can't
 * act on a shift that already happened) and pure noise (Indeed's expired-
 * posting daily digests + stale FYI notices that carry no action). This
 * sweeps that dead weight to `superseded` so the queue shows only rows a
 * recruiter can actually act on.
 *
 * Only three terminal conditions — everything else (current-dated
 * new_request / change_* / cancel_booking / no_show) is left for the human
 * or the nightly auto-apply:
 *   - past_dated        — isPastDated(event) (endDate ?? workDate < today CT)
 *   - digest_noise      — eventType 'daily_digest_expired' (never actionable)
 *   - stale_info_notice — eventType 'info_notice' older than the stale window
 *
 * Idempotent + safe: dateless rows are never touched (isPastDated is false),
 * and only `needs_review` rows are scanned. Runs from schedulingTriageNightly
 * (keeps the queue clean going forward) and a one-time scratch drain.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { isPastDated } from './onIngestEventCreatedParse';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const STALE_INFO_NOTICE_DAYS = 21;

export interface PruneResult {
  scanned: number;
  pastDated: number;
  digestNoise: number;
  staleInfoNotice: number;
  totalPruned: number;
  remaining: number;
}

export async function pruneStaleShiftRequests(
  tenantId: string,
  opts?: { dryRun?: boolean; staleInfoNoticeDays?: number },
): Promise<PruneResult> {
  const dryRun = opts?.dryRun === true;
  const staleMs = (opts?.staleInfoNoticeDays ?? STALE_INFO_NOTICE_DAYS) * 24 * 60 * 60 * 1000;
  const snap = await db
    .collection(`tenants/${tenantId}/external_shift_requests`)
    .where('status', '==', 'needs_review')
    .get();

  const result: PruneResult = {
    scanned: snap.size,
    pastDated: 0,
    digestNoise: 0,
    staleInfoNotice: 0,
    totalPruned: 0,
    remaining: 0,
  };

  const now = Date.now();
  const toPrune: Array<{ ref: FirebaseFirestore.DocumentReference; reason: string }> = [];

  for (const d of snap.docs) {
    const r = d.data();
    const eventType = String(r.eventType ?? '');
    const event = (r.event ?? {}) as { workDate?: string; endDate?: string };
    let reason: string | null = null;

    if (eventType === 'daily_digest_expired') {
      reason = 'digest_noise';
      result.digestNoise += 1;
    } else if (isPastDated(event)) {
      reason = 'past_dated';
      result.pastDated += 1;
    } else if (eventType === 'info_notice') {
      const createdAt = (r.createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
      if (createdAt && now - createdAt > staleMs) {
        reason = 'stale_info_notice';
        result.staleInfoNotice += 1;
      }
    }

    if (reason) toPrune.push({ ref: d.ref, reason });
  }

  result.totalPruned = toPrune.length;
  result.remaining = result.scanned - result.totalPruned;

  if (!dryRun && toPrune.length > 0) {
    for (let i = 0; i < toPrune.length; i += 450) {
      const chunk = toPrune.slice(i, i + 450);
      const batch = db.batch();
      for (const { ref, reason } of chunk) {
        batch.update(ref, {
          status: 'superseded',
          decidedBy: 'pi6_prune',
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
          decisionReason: reason,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    logger.info('[pi6-prune] backlog drained', { tenantId, ...result });
  }

  return result;
}
