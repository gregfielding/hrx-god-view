/**
 * Scheduling Health API — the server half of the recruiter-facing daily
 * checklist (Phase 1c of the scheduling review).
 *
 * Design constraint (Greg, 2026-07-17): recruiters are not tech-savvy.
 * The page speaks plain English and every problem has ONE button. These
 * callables keep all judgment server-side so the client stays dumb:
 *
 *   getScheduleDivergence  — returns the latest divergence snapshot,
 *     computing a fresh one if today's doesn't exist yet (first visit of
 *     the day before the 11:00 UTC cron, or a brand-new tenant).
 *   completeStaleAssignments — the "Mark finished" button. Re-verifies
 *     server-side that each assignment is genuinely stale (live status,
 *     effective end date in the past) before completing it, so a stale
 *     client list can never close out someone who's actually working.
 *
 * Both gated by the canonical recruiter check (canManageAssignments).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { canManageAssignments } from '../placementsApi';
import { computeTenantDivergence } from './scheduleDivergenceSweep';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const LIVE_RE = /^(pending|proposed|confirmed|in_progress|active|none|)$/;
const DEAD_RE = /cancel|declined|completed|ended|rejected/;

function todayUtcIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
function asIso(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  return null;
}

async function assertRecruiter(request: { auth?: { uid?: string; token?: unknown } }, tenantId: string) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Scheduling health requires assignment-management access.');
  }
}

export const getScheduleDivergence = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    await assertRecruiter(request, tenantId);

    const col = db.collection('tenants').doc(tenantId).collection('schedule_divergence');
    const latest = await col.doc('latest').get();
    const runDate = latest.exists ? String(latest.data()?.runDate ?? '') : '';
    if (runDate) {
      const snap = await col.doc(runDate).get();
      if (snap.exists) return { ok: true, fresh: false, snapshot: snap.data() };
    }
    // No snapshot yet (pre-cron first visit / new tenant): compute one now
    // so the page never shows an empty shrug.
    const result = await computeTenantDivergence(tenantId);
    await col.doc(result.runDate).set(result);
    await col.doc('latest').set({
      runDate: result.runDate,
      generatedAt: result.generatedAt,
      counts: result.counts,
      truncated: result.truncated,
    });
    const persisted = await col.doc(result.runDate).get();
    return { ok: true, fresh: true, snapshot: persisted.data() };
  },
);

export const completeStaleAssignments = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '').trim();
    const ids: string[] = Array.isArray(request.data?.assignmentIds)
      ? (request.data.assignmentIds as unknown[]).map((v) => String(v)).filter(Boolean)
      : [];
    if (!tenantId || !ids.length) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentIds are required');
    }
    if (ids.length > 500) {
      throw new HttpsError('invalid-argument', 'At most 500 assignments per call.');
    }
    await assertRecruiter(request, tenantId);

    const today = todayUtcIso();
    let completed = 0;
    const skipped: Array<{ id: string; reason: string }> = [];
    const batch = db.batch();
    for (const id of ids) {
      const ref = db.doc(`tenants/${tenantId}/assignments/${id}`);
      const snap = await ref.get();
      if (!snap.exists) { skipped.push({ id, reason: 'already gone' }); continue; }
      const a = snap.data() || {};
      const status = String(a.status ?? '').toLowerCase();
      if (DEAD_RE.test(status) || !LIVE_RE.test(status)) {
        skipped.push({ id, reason: `already ${status || 'closed'}` });
        continue;
      }
      const start = asIso(a.startDate) ?? asIso(a.start);
      const end = asIso(a.endDate) ?? start;
      const effEnd = end && start && end >= start ? end : start;
      if (!effEnd || effEnd >= today) {
        skipped.push({ id, reason: 'shift has not ended yet' });
        continue;
      }
      batch.update(ref, {
        status: 'completed',
        previousStatus: a.status ?? '',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedReason: 'scheduling-health: shift ended, marked finished',
        notificationsSuppressed: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth!.uid,
      });
      completed += 1;
    }
    if (completed > 0) await batch.commit();
    logger.info('completeStaleAssignments', { tenantId, requested: ids.length, completed, skipped: skipped.length });
    return { ok: true, completed, skipped };
  },
);
