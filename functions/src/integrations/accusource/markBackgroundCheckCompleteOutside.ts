/**
 * Callable: `markAccusourceBackgroundCheckCompleteOutside`
 *
 * Creates a `backgroundChecks/{id}` document that represents a screening that
 * was completed OUTSIDE of HRX — typically because the worker was entered in
 * AccuSource directly before we had the API wired up. The doc looks like a
 * fully-completed order so the UI + readiness triggers treat it as done:
 *
 *   - `hrxStatus: 'completed'`
 *   - `finalReportReady: true`, `profileCompleted: true`, `orderCompleted: true`
 *   - `providerServiceOrderStatus.{serviceId}` entry per requested service,
 *     each with `status: 'Completed'` and an adjudication of
 *     `autoVerdict: 'PASSED'`.
 *   - Audit fields: `markedCompleteOutsideHrx: true`, actor uid, optional notes.
 *
 * Does NOT call the AccuSource API — this is a Firestore-only write. The
 * existing `syncAssignmentReadinessV1OnBackgroundCheckWrite` trigger then sees
 * the `hrxStatus: 'completed'` and clears any screening blockers on the
 * worker's assignments.
 *
 * Permission: same as `createAccusourceBackgroundCheck` — `ensureAccusourceAdmin`.
 *
 * @see functions/src/integrations/accusource/createBackgroundCheck.ts (the live-order counterpart).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import type { CreateBackgroundCheckInput } from './mapper';
import { ensureAccusourceAdmin } from './accusourceAdminGate';
import { accusourceLog } from './accusourceLogger';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type MarkCompletePayload = CreateBackgroundCheckInput & {
  /** Optional recruiter-entered note describing what happened (e.g. "Ordered via AccuSource portal 2025-11-03"). */
  notes?: string;
  /** Pre-fill the `markedCompleteOutsideHrxAt` timestamp (ISO-8601) when back-dating. Defaults to now. */
  completedAtIso?: string;
  /**
   * Whether the recruiter is declaring the package PASSED (default) or
   * FAILED outside HRX. FAILED stamps every line FAILED and resolves
   * readiness to `complete_fail` (worker NOT cleared).
   */
  verdict?: 'PASSED' | 'FAILED';
};

export const markAccusourceBackgroundCheckCompleteOutside = onCall(
  { cors: true, memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const uid = request.auth.uid;
    const data = (request.data || {}) as MarkCompletePayload;

    const tenantId = String(data.tenantId || '').trim();
    const candidateId = String(data.candidateId || '').trim();
    if (!tenantId || !candidateId) {
      throw new HttpsError('invalid-argument', 'tenantId and candidateId are required');
    }
    const requestedPackageId = String(data.requestedPackageId || '').trim();
    if (!requestedPackageId) {
      throw new HttpsError(
        'invalid-argument',
        'requestedPackageId is required — pick a package from the catalog.',
      );
    }

    await ensureAccusourceAdmin(uid, tenantId);

    const completedAt = data.completedAtIso
      ? admin.firestore.Timestamp.fromDate(new Date(data.completedAtIso))
      : admin.firestore.Timestamp.now();

    // PASSED (default) or FAILED — stamps every line + drives the readiness gate.
    const verdict: 'PASSED' | 'FAILED' = data.verdict === 'FAILED' ? 'FAILED' : 'PASSED';

    // Service-line map. One entry per requested service, each pre-completed +
    // adjudicated PASSED. We mirror the shape
    // `accusourceWebhookServiceLine.mergeServiceLinePatch` produces so the
    // client normalizer + adjudication code can read these rows without
    // special-casing.
    const requestedServices = Array.isArray(data.requestedServices)
      ? data.requestedServices.map((s) => String(s)).filter((s) => s.length > 0)
      : [];
    const catalog = Array.isArray(data.requestedServicesCatalog)
      ? data.requestedServicesCatalog
      : [];
    const catalogById = new Map<string, { name: string; type?: string }>();
    for (const c of catalog) {
      if (c && c.id) {
        catalogById.set(String(c.id), { name: String(c.name || c.id), type: c.type });
      }
    }

    const providerServiceOrderStatus: Record<string, Record<string, unknown>> = {};
    const historyEntry = {
      at: completedAt,
      actorUid: uid,
      action: 'marked_complete_outside_hrx' as const,
      autoVerdict: verdict,
      autoVerdictReason: buildAutoVerdictReason(data.notes, uid, verdict),
    };
    for (const serviceId of requestedServices) {
      const meta = catalogById.get(serviceId);
      providerServiceOrderStatus[serviceId] = {
        serviceId,
        serviceName: meta?.name ?? `Service ${serviceId}`,
        status: 'Completed',
        completedAt,
        orderedAt: completedAt,
        updatedAt: completedAt,
        providerReportedAt: completedAt,
        adjudication: {
          autoVerdict: verdict,
          autoVerdictReason: buildAutoVerdictReason(data.notes, uid, verdict),
          autoVerdictAt: completedAt,
          manualVerdict: null,
          manualVerdictAt: null,
          manualActorUid: null,
          overrideReason: null,
          history: [historyEntry],
        },
      };
    }

    // Doc id is auto-generated (parallels the live-order path).
    const ref = db.collection('backgroundChecks').doc();
    const clientId = `HRX-BGC-EXT-${ref.id}`;

    const doc: Record<string, unknown> = {
      provider: 'accusource',
      providerEnvironment: 'external', // explicit — no vendor environment for records created this way
      tenantId,
      accountId: data.accountId || null,
      accountName: data.accountName || null,
      candidateId,
      candidateName: data.candidateName || null,
      applicantId: data.applicantId || null,
      jobOrderId: data.jobOrderId || null,
      worksiteId: data.worksiteId || null,
      clientId,
      providerClientId: clientId,
      orderMode: 'marked_complete_outside_hrx',
      // Readiness triggers read `hrxStatus` specifically — 'completed' clears blockers.
      hrxStatus: 'completed',
      providerStatus: 'Completed',
      finalReportReady: true,
      drugReportReady: true, // safe default — drug rows (if any) also marked complete
      profileCompleted: true,
      orderCompleted: true,
      createdBy: uid,
      requestedPackageId,
      requestedPackageName: data.requestedPackageName || null,
      requestedServices,
      ...(catalog.length > 0
        ? {
            requestedServicesCatalog: catalog.map((s) => ({
              id: String(s.id),
              name: String(s.name || s.id),
              ...(s.type != null ? { type: String(s.type) } : {}),
            })),
          }
        : {}),
      providerServiceOrderStatus,
      syncError: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Audit fields specific to this path.
      markedCompleteOutsideHrx: true,
      markedCompleteOutsideHrxVerdict: verdict,
      markedCompleteOutsideHrxAt: completedAt,
      markedCompleteOutsideHrxBy: uid,
      markedCompleteOutsideHrxNotes:
        typeof data.notes === 'string' && data.notes.trim() !== '' ? data.notes.trim() : null,
    };

    await ref.set(doc);

    accusourceLog('info', 'markCompleteOutside', 'wrote pre-completed backgroundCheck', {
      backgroundCheckId: ref.id,
      tenantId,
      candidateId,
      requestedPackageId,
      servicesCount: requestedServices.length,
    });

    return {
      ok: true as const,
      backgroundCheckId: ref.id,
      clientId,
      hrxStatus: 'completed' as const,
      servicesCount: requestedServices.length,
    };
  },
);

function buildAutoVerdictReason(
  notes: string | undefined,
  actorUid: string,
  verdict: 'PASSED' | 'FAILED' = 'PASSED',
): string {
  const trimmed = typeof notes === 'string' ? notes.trim() : '';
  const base = `Marked complete (${verdict}) outside HRX by ${actorUid}`;
  return trimmed ? `${base} — ${trimmed}` : base;
}
