/**
 * After an `ineligible_nudge` AI prescreen SMS, if the worker improves profile primitives (false→true),
 * queue a single bounded follow-up interview-invite SMS on matching submitted applications.
 *
 * Uses tenant-scoped `tenants/{tenantId}/applications` queries via `user.tenantIds` (map or array).
 * Processor: `processWorkerAiPrescreenReminders` (second-wave branch).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import { hasAiPrescreenEligibilityFalseToTrueTransition } from './evaluateAiPrescreenEligibility';
import { resolveHiringInterviewPolicyForApplication } from './aiHiringPolicyResolution';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const FOLLOW_UP_DELAY_MS = 2 * 60 * 1000;
const QUERY_LIMIT = 25;
const MAX_QUEUE_PER_INVOCATION = 40;

function listTenantIdsFromUserDoc(ud: Record<string, unknown> | null | undefined): string[] {
  if (!ud) return [];
  const t = ud.tenantIds;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    return Object.keys(t as Record<string, unknown>).filter(Boolean);
  }
  if (Array.isArray(t)) {
    return t.map((x) => String(x)).filter(Boolean);
  }
  return [];
}

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.data()?.workerAiPrescreenOutreachEnabled === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

function isCandidateApplication(
  userId: string,
  data: Record<string, unknown>,
  outcome: string | undefined,
): boolean {
  if (outcome !== 'ineligible_nudge') return false;
  if (normalizeApplicationStatus(String(data.status ?? '')) !== 'submitted') return false;
  const uid = String(data.userId || data.candidateId || '').trim();
  if (uid !== userId) return false;
  if (data.workerAiPrescreenFollowUpInviteSentAt) return false;
  if (data.workerAiPrescreenFollowUpPending === true) return false;
  return true;
}

async function fetchEligibleApplicationsForTenant(
  tenantId: string,
  userId: string,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const base = db.collection('tenants').doc(tenantId).collection('applications');
  const [byUser, byCandidate] = await Promise.all([
    base
      .where('userId', '==', userId)
      .where('workerAiPrescreenReminderLastOutcome', '==', 'ineligible_nudge')
      .limit(QUERY_LIMIT)
      .get(),
    base
      .where('candidateId', '==', userId)
      .where('workerAiPrescreenReminderLastOutcome', '==', 'ineligible_nudge')
      .limit(QUERY_LIMIT)
      .get(),
  ]);

  const seen = new Set<string>();
  const out: admin.firestore.QueryDocumentSnapshot[] = [];
  for (const d of [...byUser.docs, ...byCandidate.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const data = d.data() as Record<string, unknown>;
    const outcome = String(data.workerAiPrescreenReminderLastOutcome || '');
    if (isCandidateApplication(userId, data, outcome)) {
      out.push(d);
    }
  }
  return out;
}

export const scheduleWorkerAiPrescreenFollowUpOnUserWrite = onDocumentWritten(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 120,
    /** Same as other Firestore triggers: avoid 256MiB cold-start OOM on large shared bundle. */
    memory: '512MiB',
  },
  async (event) => {
    const userId = event.params.userId as string;
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    if (!afterSnap?.exists) return;
    if (!beforeSnap?.exists) return;

    const beforeData = beforeSnap.data() as Record<string, unknown>;
    const afterData = afterSnap.data() as Record<string, unknown>;

    if (!hasAiPrescreenEligibilityFalseToTrueTransition(beforeData, afterData)) {
      return;
    }

    const tenantIds = listTenantIdsFromUserDoc(afterData);
    if (tenantIds.length === 0) {
      return;
    }

    let queued = 0;
    const due = admin.firestore.Timestamp.fromMillis(Date.now() + FOLLOW_UP_DELAY_MS);

    for (const tenantId of tenantIds) {
      if (queued >= MAX_QUEUE_PER_INVOCATION) break;
      if (!(await tenantOutreachEnabled(tenantId))) continue;

      let snaps: admin.firestore.QueryDocumentSnapshot[];
      try {
        snaps = await fetchEligibleApplicationsForTenant(tenantId, userId);
      } catch (err: unknown) {
        logger.warn('scheduleWorkerAiPrescreenFollowUpOnUserWrite: tenant query failed', {
          tenantId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const docSnap of snaps) {
        if (queued >= MAX_QUEUE_PER_INVOCATION) break;
        try {
          const preData = docSnap.data() as Record<string, unknown>;
          try {
            const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, preData);
            if (!interviewPol.workerAiPrescreenRequired) {
              continue;
            }
          } catch {
            continue;
          }

          const didQueue = await db.runTransaction(async (tx) => {
            const s = await tx.get(docSnap.ref);
            if (!s.exists) return false;
            const d = (s.data() || {}) as Record<string, unknown>;
            if (String(d.workerAiPrescreenReminderLastOutcome || '') !== 'ineligible_nudge') return false;
            if (d.workerAiPrescreenFollowUpInviteSentAt) return false;
            if (d.workerAiPrescreenFollowUpPending === true) return false;
            if (normalizeApplicationStatus(String(d.status ?? '')) !== 'submitted') return false;
            const uid = String(d.userId || d.candidateId || '').trim();
            if (uid !== userId) return false;

            tx.update(docSnap.ref, {
              workerAiPrescreenFollowUpPending: true,
              workerAiPrescreenFollowUpDueAt: due,
              workerAiPrescreenFollowUpScheduledAt: admin.firestore.FieldValue.serverTimestamp(),
              workerAiPrescreenFollowUpLastError: admin.firestore.FieldValue.delete(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return true;
          });
          if (didQueue) {
            queued += 1;
            logger.info('scheduleWorkerAiPrescreenFollowUpOnUserWrite: queued follow-up', {
              tenantId,
              userId,
              applicationId: docSnap.id,
            });
          }
        } catch (err: unknown) {
          logger.error('scheduleWorkerAiPrescreenFollowUpOnUserWrite: transaction failed', {
            tenantId,
            userId,
            applicationId: docSnap.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  },
);
