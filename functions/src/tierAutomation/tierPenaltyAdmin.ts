/**
 * Admin-SDK mirror of the client tier writers in src/utils/workerTier.ts —
 * same write shapes (workerTiers + activityLogs in one batch) so audit
 * entries are indistinguishable in the profile Activity tab.
 *
 * Policy (8/31 agreed spec + Greg 2026-09-04): one penalized no-show drops a
 * tier; 40 clean timesheet hours restore the ORIGINAL tier; the counter
 * resets on each demotion (re-penalizing overwrites demotedAt). Tier 3 has
 * nowhere to drop — audit only. Manual tier changes clear the penalty state
 * (recruiter judgment wins), so the nightly earn-back only ever sees
 * penalties that are still live.
 */
import * as admin from 'firebase-admin';

export interface ApplyNoShowPenaltyAdminOptions {
  userId: string;
  byId: string;
  byName: string;
  assignmentId?: string;
  assignmentLabel?: string;
}

function resolveGlobalTier(data: Record<string, unknown>): number {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  const g = Number(tiers.global);
  return g === 1 || g === 2 ? g : 3;
}

export async function applyNoShowPenaltyAdmin(
  db: admin.firestore.Firestore,
  opts: ApplyNoShowPenaltyAdminOptions,
): Promise<{ demoted: boolean; fromTier: number; toTier: number }> {
  const { userId, byId, byName, assignmentId, assignmentLabel } = opts;
  const userRef = db.doc(`users/${userId}`);
  const snap = await userRef.get();
  const currentTier = resolveGlobalTier((snap.data() ?? {}) as Record<string, unknown>);
  const demoted = currentTier < 3;
  const newTier = demoted ? currentTier + 1 : 3;
  const where = assignmentLabel ? ` (${assignmentLabel})` : '';

  const batch = db.batch();
  if (demoted) {
    batch.update(userRef, {
      'workerTiers.global': newTier,
      'workerTiers.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
      'workerTiers.lastChange': {
        from: currentTier,
        to: newTier,
        at: admin.firestore.Timestamp.now(),
        byId,
        byName,
        source: 'no_show_penalty',
        ...(assignmentId ? { reason: `No-show penalty on assignment ${assignmentId}` } : {}),
      },
      'workerTiers.penalty': {
        demotedAt: admin.firestore.Timestamp.now(),
        restoreTo: currentTier,
        hoursRequired: 40,
        ...(assignmentId ? { assignmentId } : {}),
      },
    });
  }
  batch.set(db.collection(`users/${userId}/activityLogs`).doc(), {
    action: 'Tier Change',
    actionType: 'security_change',
    description: demoted
      ? `Tier changed from Tier ${currentTier} to Tier ${newTier} by ${byName} (no-show penalty)${where} — 40 clean hours restore Tier ${currentTier}`
      : `No-show penalty recorded by ${byName}${where} — already Tier 3, no demotion`,
    severity: 'medium',
    source: 'web',
    metadata: {
      targetType: 'workerTier',
      from: currentTier,
      to: newTier,
      changeSource: 'no_show_penalty',
      changedById: byId,
      changedByName: byName,
      ...(assignmentId ? { assignmentId } : {}),
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { demoted, fromTier: currentTier, toTier: newTier };
}
