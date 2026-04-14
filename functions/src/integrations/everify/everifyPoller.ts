/**
 * E-Verify scheduled poller: real status checks, STATUS_CHANGED events, TNC handling.
 * Phase 4B/4C.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { getCaseStatus } from './everifyRestClient';
import { mapProviderStatusToHrx } from './everifyAdapter';
import { whitelistEverifyRaw } from './everifyRedaction';
import { handleTncTransition, resolveTncTaskAndAppendEvent, TNC_RESOLVED_STATUSES } from './everifyTncHandler';
import { everifyCasePublicLinkageFromPrivate, upsertEverifyCasePublicMirror } from './everifyService';
import { EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD } from './everifySecrets';
import type { EverifyCaseStatus } from './everifySchemas';

const db = admin.firestore();

const OPEN_STATUSES: EverifyCaseStatus[] = [
  'submitted',
  'pending',
  'tnc',
  'dhs_verification_in_process',
  'further_action_required',
];

/** Statuses that trigger TNC workflow (deadlines + task) */
const TNC_ACTION_STATUSES: EverifyCaseStatus[] = ['tnc', 'further_action_required'];

/** Stuck threshold: no successful check in 24h */
const STUCK_HOURS = 24;

function toMs(ts: admin.firestore.FieldValue | admin.firestore.Timestamp | unknown): number | null {
  if (!ts) return null;
  if (ts && typeof (ts as { toMillis }).toMillis === 'function')
    return (ts as admin.firestore.Timestamp).toMillis();
  if (typeof ts === 'number') return ts;
  return null;
}

function getIcaCredentials(): { username: string; password: string } | null {
  try {
    const u = EVERIFY_WS_USERNAME.value();
    const p = EVERIFY_WS_PASSWORD.value();
    if (u && p) return { username: u, password: p };
  } catch {
    // secrets not configured
  }
  return null;
}

export const scheduledEverifyPoller = onSchedule(
  {
    // Proven in this repo: scheduledOrchestrator / mobileErrorMonitoring use `every 1 hours` + America/New_York.
    // (Some deploys 400 with `every 30 minutes` or `*/30` + UTC — tune interval after deploy succeeds.)
    schedule: 'every 1 hours',
    timeZone: 'America/New_York',
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
    /** Cold start + tenant/case iteration exceeded default 256 MiB in production. */
    memory: '512MiB',
  },
  async () => {
    const creds = getIcaCredentials();
    const tenantsSnap = await db.collection('tenants').get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowMs = Date.now();
    const stuckThresholdMs = nowMs - STUCK_HOURS * 60 * 60 * 1000;

    let totalUpdated = 0;
    let statusChangedCount = 0;
    let tncHandledCount = 0;
    const stuckCases: { tenantId: string; caseId: string; lastCheckedMs: number | null }[] = [];

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');

      const openSnap = await casesRef
        .where('status', 'in', OPEN_STATUSES)
        .limit(100)
        .get();

      for (const doc of openSnap.docs) {
        const data = doc.data();
        const caseNumber = data.everifyCaseNumber as string | undefined;
        const previousStatus = (data.status as EverifyCaseStatus) ?? 'pending';
        const lastCheckedMs = toMs(data.lastCheckedAt);
        const isStuck = lastCheckedMs == null || lastCheckedMs < stuckThresholdMs;

        if (isStuck && !caseNumber) {
          stuckCases.push({ tenantId, caseId: doc.id, lastCheckedMs: lastCheckedMs ?? null });
        }

        const updatePayload: Record<string, unknown> = {
          lastCheckedAt: now,
          updatedAt: now,
        };

        if (creds && caseNumber) {
          try {
            const statusResp = await getCaseStatus(caseNumber, creds);
            const providerStatus = statusResp.case_status ?? statusResp.case_status_display ?? 'UNKNOWN';
            const newStatus = mapProviderStatusToHrx(providerStatus);
            const raw = whitelistEverifyRaw(statusResp);

            updatePayload.providerStatus = providerStatus;
            updatePayload.status = newStatus;
            if (Object.keys(raw).length > 0) updatePayload.raw = raw;
            const existingDeadlines = (data.deadlines ?? {}) as Record<string, unknown>;
            updatePayload.public = {
              status: newStatus,
              statusDisplay: String(providerStatus),
              eligibilityStatement:
                typeof (raw as Record<string, unknown>).case_eligibility_statement === 'string'
                  ? (raw as Record<string, unknown>).case_eligibility_statement
                  : undefined,
              deadlines: Object.keys(existingDeadlines).length > 0 ? existingDeadlines : undefined,
            };

            if (newStatus !== previousStatus) {
              statusChangedCount++;
              const eventsRef = doc.ref.collection('events');
              await eventsRef.add({
                tenantId,
                entityId: data.entityId ?? null,
                userId: data.userId ?? null,
                userEmploymentId: data.userEmploymentId ?? null,
                assignmentId: data.assignmentId ?? null,
                type: 'STATUS_CHANGED',
                actor: 'system',
                data: {
                  previousStatus,
                  newStatus,
                  providerStatus,
                },
                at: now,
              });
              if (TNC_RESOLVED_STATUSES.includes(newStatus)) {
                await resolveTncTaskAndAppendEvent(tenantId, doc.id, newStatus, {
                  entityId: data.entityId,
                  userId: data.userId,
                  userEmploymentId: data.userEmploymentId,
                  assignmentId: data.assignmentId,
                });
              }
            }

            if (TNC_ACTION_STATUSES.includes(newStatus)) {
              const { taskId } = await handleTncTransition(tenantId, doc.id, {
                tenantId,
                entityId: data.entityId,
                userId: data.userId,
                userEmploymentId: data.userEmploymentId,
                assignmentId: data.assignmentId,
                everifyCaseNumber: caseNumber,
                status: newStatus,
                providerStatus,
                raw: Object.keys(raw).length > 0 ? raw : undefined,
              });
              if (taskId) tncHandledCount++;
            }
          } catch (err) {
            logger.warn('E-Verify poller status fetch failed', {
              tenantId,
              caseId: doc.id,
              caseNumber,
              error: err instanceof Error ? err.message : String(err),
            });
            if (isStuck) {
              stuckCases.push({ tenantId, caseId: doc.id, lastCheckedMs: lastCheckedMs ?? null });
            }
          }
        } else {
          if (isStuck) {
            stuckCases.push({ tenantId, caseId: doc.id, lastCheckedMs: lastCheckedMs ?? null });
          }
        }

        await doc.ref.update(updatePayload);
        if (updatePayload.public) {
          await upsertEverifyCasePublicMirror(
            tenantId,
            doc.id,
            (data.userId as string) ?? null,
            updatePayload.public as import('./everifyService').EverifyCasePublicPayload,
            everifyCasePublicLinkageFromPrivate(data as Record<string, unknown>)
          );
        }
        totalUpdated++;
      }
    }

    logger.info('E-Verify poller run', {
      totalUpdated,
      statusChangedCount,
      tncHandledCount,
      stuckCount: stuckCases.length,
      tenants: tenantsSnap.size,
    });

    if (stuckCases.length > 0) {
      logger.warn('E-Verify stuck cases detected', {
        count: stuckCases.length,
        cases: stuckCases.slice(0, 20).map((c) => `${c.tenantId}/${c.caseId}`),
      });
    }
  }
);
