/**
 * E-Verify TNC (Tentative Nonconfirmation) / action-required handler.
 * Sets deadlines on case doc and creates internal HR/recruiter task.
 * Phase 4C.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import type { EverifyCaseStatus } from './everifySchemas';

const db = admin.firestore();

const TNC_TASK_PREFIX = 'everify_tnc:';

/** Task ID for a given case (for deep-link and resolution) */
export function getTncTaskId(tenantId: string, caseId: string): string {
  return `${TNC_TASK_PREFIX}${tenantId}:${caseId}`;
}

export interface TncCaseDoc {
  everifyCaseNumber?: string;
  status: EverifyCaseStatus;
  providerStatus?: string;
  raw?: Record<string, unknown>;
  tenantId: string;
  entityId?: string | null;
  userId?: string | null;
  userEmploymentId?: string | null;
  assignmentId?: string | null;
}

/**
 * Build deadlines from status response (whitelisted raw).
 * Uses dhs_referral_due_date, dhs_referral_contact_by_date, ev_star fields.
 */
function buildDeadlines(raw: Record<string, unknown> | undefined): {
  tncResponseDueAt?: admin.firestore.Timestamp | null;
  referralDueAt?: admin.firestore.Timestamp | null;
} {
  if (!raw) return {};

  const toTimestamp = (v: unknown): admin.firestore.Timestamp | null => {
    if (!v || typeof v !== 'string') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return admin.firestore.Timestamp.fromDate(d);
  };

  const referralDueAt = toTimestamp(raw.dhs_referral_due_date ?? raw.ev_star_referral_due_date);
  const tncResponseDueAt = toTimestamp(
    raw.dhs_referral_contact_by_date ?? raw.ev_star_referral_contact_by_date
  );

  return { tncResponseDueAt: tncResponseDueAt ?? undefined, referralDueAt: referralDueAt ?? undefined };
}

/**
 * Create internal task for E-Verify TNC/action required.
 * Idempotent: uses deterministic task id per case.
 */
async function createTncTask(tenantId: string, caseId: string, caseDoc: TncCaseDoc): Promise<string | null> {
  const taskId = getTncTaskId(tenantId, caseId);
  const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);

  const existing = await taskRef.get();
  if (existing.exists) return taskId;

  const now = admin.firestore.Timestamp.now();
  const taskData = {
    title: 'E-Verify action required: follow up on case',
    description: `E-Verify case requires employer action (TNC or referral). Case ID: ${caseId}. Resolve in E-Verify Admin Ops.`,
    type: 'custom',
    priority: 'high',
    status: 'upcoming',
    classification: 'todo',
    scheduledDate: null,
    dueDate: null,
    assignedTo: null,
    assignedToName: null,
    associations: { contacts: [], deals: [], companies: [] },
    notes: '',
    category: null,
    quotaCategory: null,
    estimatedDuration: 15,
    aiSuggested: false,
    aiPrompt: '',
    aiReason: '',
    aiConfidence: null,
    aiContext: null,
    aiInsights: [],
    googleCalendarEventId: null,
    googleTaskId: null,
    lastGoogleSync: null,
    syncStatus: 'pending',
    tags: ['everify', 'compliance'],
    relatedToName: '',
    tenantId,
    createdBy: 'system',
    createdByName: 'System',
    sourceType: 'everify',
    sourceId: caseId,
    sourceName: 'E-Verify case action required',
    everifyCaseId: caseId,
    systemManaged: true,
    createdAt: now,
    updatedAt: now,
  };

  await taskRef.set(taskData);
  logger.info('E-Verify TNC task created', { tenantId, caseId, taskId });
  return taskId;
}

/**
 * Handle transition to TNC or further_action_required: set deadlines and create task.
 * Idempotent for task creation; deadlines merge with existing.
 */
export async function handleTncTransition(
  tenantId: string,
  caseId: string,
  caseDoc: TncCaseDoc
): Promise<{ deadlinesUpdated: boolean; taskId: string | null }> {
  const newDeadlines = buildDeadlines(caseDoc.raw);
  const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);

  const updates: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (newDeadlines.tncResponseDueAt != null || newDeadlines.referralDueAt != null) {
    const snap = await caseRef.get();
    const existing = (snap.data()?.deadlines ?? {}) as Record<string, unknown>;
    updates.deadlines = {
      ...existing,
      ...(newDeadlines.tncResponseDueAt != null && { tncResponseDueAt: newDeadlines.tncResponseDueAt }),
      ...(newDeadlines.referralDueAt != null && { referralDueAt: newDeadlines.referralDueAt }),
    };
  }

  await caseRef.update(updates);

  const taskId = await createTncTask(tenantId, caseId, caseDoc);
  return {
    deadlinesUpdated: newDeadlines.tncResponseDueAt != null || newDeadlines.referralDueAt != null,
    taskId,
  };
}

/** Resolved statuses: case no longer needs TNC action; mark task complete and append TASK_RESOLVED */
export const TNC_RESOLVED_STATUSES: EverifyCaseStatus[] = [
  'employment_authorized',
  'closed',
  'final_nonconfirmation',
];

/**
 * When case status becomes resolved (authorized/closed/fcnc), mark TNC task completed and append TASK_RESOLVED event.
 */
export async function resolveTncTaskAndAppendEvent(
  tenantId: string,
  caseId: string,
  newStatus: EverifyCaseStatus,
  caseData: { entityId?: string | null; userId?: string | null; userEmploymentId?: string | null; assignmentId?: string | null }
): Promise<{ taskResolved: boolean }> {
  const taskId = getTncTaskId(tenantId, caseId);
  const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);
  const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const taskSnap = await taskRef.get();
  const taskResolved = taskSnap.exists;
  if (taskSnap.exists) {
    await taskRef.update({ status: 'completed', updatedAt: now });
  }

  await caseRef.collection('events').add({
    tenantId,
    entityId: caseData.entityId ?? null,
    userId: caseData.userId ?? null,
    userEmploymentId: caseData.userEmploymentId ?? null,
    assignmentId: caseData.assignmentId ?? null,
    type: 'TASK_RESOLVED',
    actor: 'system',
    at: now,
    data: { newStatus, taskId },
  });

  return { taskResolved };
}
