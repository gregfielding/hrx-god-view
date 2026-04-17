/**
 * Writes `noShowRiskPredictionV1` on assignment docs; invoked from assignment write trigger.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  computeNoShowRiskForAssignment,
  haversineKm,
  type ApplicationNoShowRiskStored,
  type ReadinessSummaryLike,
} from './noShowRiskShared';

function safeNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Worker home coordinates from user doc (multiple legacy shapes). */
export function extractWorkerHomeLatLng(userData: Record<string, unknown>): { lat: number; lng: number } | null {
  const directLat = safeNum(userData.homeLat);
  const directLng = safeNum(userData.homeLng);
  if (directLat != null && directLng != null) return { lat: directLat, lng: directLng };

  const addr = userData.address;
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const a = addr as Record<string, unknown>;
    const al = safeNum(a.homeLat ?? a.latitude);
    const ao = safeNum(a.homeLng ?? a.longitude);
    if (al != null && ao != null) return { lat: al, lng: ao };
  }

  const ai = userData.addressInfo;
  if (ai && typeof ai === 'object' && !Array.isArray(ai)) {
    const x = ai as Record<string, unknown>;
    const xl = safeNum(x.homeLat ?? x.latitude);
    const xo = safeNum(x.homeLng ?? x.longitude);
    if (xl != null && xo != null) return { lat: xl, lng: xo };
  }

  return null;
}

function readinessSummaryFromAssignment(raw: unknown): ReadinessSummaryLike | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const sum = o.summary;
  if (!sum || typeof sum !== 'object') return null;
  return { summary: sum as ReadinessSummaryLike['summary'] };
}

function applicationNoShowFromDoc(appData: Record<string, unknown>): ApplicationNoShowRiskStored | null {
  const ai = appData.aiAutomation;
  if (!ai || typeof ai !== 'object') return null;
  const n = (ai as Record<string, unknown>).noShowRisk;
  if (!n || typeof n !== 'object') return null;
  const o = n as Record<string, unknown>;
  const score = safeNum(o.score);
  if (score == null) return null;
  return {
    engineVersion: typeof o.engineVersion === 'number' ? o.engineVersion : 1,
    score,
    band: (o.band as ApplicationNoShowRiskStored['band']) || 'moderate',
    reasons: Array.isArray(o.reasons) ? (o.reasons as string[]) : [],
    recommendedAction: String(o.recommendedAction || ''),
  };
}

export async function recomputeNoShowRiskPredictionForAssignment(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string,
): Promise<{ skipped: boolean; reason?: string }> {
  const ref = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const snap = await ref.get();
  if (!snap.exists) return { skipped: true, reason: 'missing_assignment' };

  const assignment = snap.data() as Record<string, unknown>;
  const applicationId = String(assignment.applicationId || '').trim();
  const workerId = String(assignment.userId || assignment.candidateId || '').trim();

  let applicationNoShow: ApplicationNoShowRiskStored | null = null;
  if (applicationId) {
    const appSnap = await db.doc(`tenants/${tenantId}/applications/${applicationId}`).get();
    if (appSnap.exists) {
      applicationNoShow = applicationNoShowFromDoc(appSnap.data() as Record<string, unknown>);
    }
  }

  let commuteKm: number | null = null;
  const workLat = safeNum(assignment.latitude);
  const workLng = safeNum(assignment.longitude);
  if (workLat != null && workLng != null && workerId) {
    const uSnap = await db.doc(`users/${workerId}`).get();
    if (uSnap.exists) {
      const home = extractWorkerHomeLatLng(uSnap.data() as Record<string, unknown>);
      if (home) {
        commuteKm = haversineKm(home.lat, home.lng, workLat, workLng);
      }
    }
  }

  const readiness = readinessSummaryFromAssignment(assignment.readinessSnapshotV1);

  const prediction = computeNoShowRiskForAssignment({
    applicationNoShowRisk: applicationNoShow,
    assignment,
    readinessSnapshotV1: readiness,
    commuteKm,
  });

  const nextPayload = {
    engineVersion: prediction.engineVersion,
    score: prediction.score,
    band: prediction.band,
    reasons: prediction.reasons,
    recommendedAction: prediction.recommendedAction,
    adjustments: prediction.adjustments,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const existing = assignment.noShowRiskPredictionV1 as Record<string, unknown> | undefined;
  if (existing && typeof existing === 'object') {
    const same =
      safeNum(existing.score) === prediction.score &&
      String(existing.band) === prediction.band &&
      JSON.stringify(existing.adjustments || {}) === JSON.stringify(prediction.adjustments || {});
    if (same) {
      logger.debug('noShowRiskPredictionV1 unchanged', { tenantId, assignmentId });
      return { skipped: true, reason: 'unchanged' };
    }
  }

  await ref.set({ noShowRiskPredictionV1: nextPayload }, { merge: true });
  logger.info('noShowRiskPredictionV1 written', { tenantId, assignmentId, score: prediction.score, band: prediction.band });
  return { skipped: false };
}
