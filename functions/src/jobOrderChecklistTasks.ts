import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';
import { logger } from './utils/logger';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type ChecklistItemId =
  | 'worksite'
  | 'dealContact'
  | 'recruiterAssigned'
  | 'jobTitleSelected'
  | 'clientJobDescription'
  | 'jobBoardPost'
  | 'aiJobDescription'
  | 'autoAddUserGroups'
  | 'externalJobBoards'
  | 'shiftCreated';

const CHECKLIST_ITEMS: Array<{ id: ChecklistItemId; label: string }> = [
  { id: 'worksite', label: 'Worksite location is set' },
  { id: 'dealContact', label: 'Primary deal contact added' },
  { id: 'recruiterAssigned', label: 'Recruiter assigned' },
  { id: 'jobTitleSelected', label: 'Job title selected' },
  { id: 'clientJobDescription', label: 'Client job description added' },
  { id: 'jobBoardPost', label: 'Job board posting created' },
  { id: 'aiJobDescription', label: 'AI job description generated' },
  { id: 'autoAddUserGroups', label: 'Auto-add user group selected' },
  { id: 'externalJobBoards', label: 'External job board postings linked' },
  { id: 'shiftCreated', label: 'Shift created' },
];

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isValidUrl(value: any, kind: 'indeed' | 'craigslist'): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (kind === 'indeed') return host.includes('indeed.');
    if (kind === 'craigslist') return host.includes('craigslist.');
    return false;
  } catch {
    return false;
  }
}

function getAssignees(jobOrder: any): string[] {
  const assigned = Array.isArray(jobOrder?.assignedRecruiters)
    ? jobOrder.assignedRecruiters.filter((x: any) => typeof x === 'string' && x.trim())
    : [];
  const legacy = typeof jobOrder?.recruiterId === 'string' && jobOrder.recruiterId.trim() ? [jobOrder.recruiterId] : [];
  return Array.from(new Set([...(assigned.length ? assigned : []), ...(assigned.length ? [] : legacy)]));
}

function taskDocId(jobOrderId: string, itemId: ChecklistItemId, assigneeId: string): string {
  return `jobOrder_${jobOrderId}__setup_${itemId}__assignee_${assigneeId}`;
}

function sanitizeAssigneeId(value: any): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Firestore doc IDs cannot contain forward slashes
  if (trimmed.includes('/')) return null;
  return trimmed;
}

async function loadJobPosts(tenantId: string, jobOrderId: string): Promise<any[]> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('loadJobPosts', 0.001);
  const ref = db.collection('tenants').doc(tenantId).collection('job_postings');
  const snap = await SafeFunctionUtils.safeQuery(ref.where('jobOrderId', '==', jobOrderId), 50);
  return snap.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function hasAnyShift(tenantId: string, jobOrderId: string): Promise<boolean> {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('hasAnyShift', 0.001);
  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('shifts');
  const snap = await ref.limit(1).get();
  return !snap.empty;
}

// Bulk-safe variants: do NOT use SafeFunctionUtils.checkSafetyLimits/safeQuery,
// because its built-in rate limiter will throw inside tight loops and produce 429s.
async function loadJobPostsBulk(tenantId: string, jobOrderId: string): Promise<any[]> {
  CostTracker.trackOperation('loadJobPostsBulk', 0.001);
  const ref = db.collection('tenants').doc(tenantId).collection('job_postings');
  const snap = await ref.where('jobOrderId', '==', jobOrderId).limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function hasAnyShiftBulk(tenantId: string, jobOrderId: string): Promise<boolean> {
  CostTracker.trackOperation('hasAnyShiftBulk', 0.001);
  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('shifts');
  const snap = await ref.limit(1).get();
  return !snap.empty;
}

function computeChecklistStatuses(jobOrder: any, jobPosts: any[], hasShiftCreated: boolean): Record<ChecklistItemId, boolean> {
  const worksiteName = jobOrder?.worksiteName || jobOrder?.deal?.worksiteName;
  const hasLocation =
    !!worksiteName ||
    !!jobOrder?.worksiteId ||
    !!jobOrder?.deal?.locationId ||
    !!jobOrder?.deal?.locationName ||
    (Array.isArray(jobOrder?.deal?.associations?.locations) && jobOrder.deal.associations.locations.length > 0);

  const contacts =
    jobOrder?.deal?.associations?.contacts ||
    jobOrder?.deal?.associations?.contactsIds ||
    jobOrder?.deal?.associations?.contactIds ||
    jobOrder?.deal?.contacts ||
    [];
  const hasDealContact = Array.isArray(contacts) && contacts.length > 0;

  const hasRecruiterAssigned =
    (Array.isArray(jobOrder?.assignedRecruiters) && jobOrder.assignedRecruiters.length > 0) ||
    (typeof jobOrder?.recruiterId === 'string' && jobOrder.recruiterId.trim().length > 0);

  const derivedJobTitle =
    jobOrder?.jobTitle ||
    (Array.isArray(jobOrder?.gigPositions) && jobOrder.gigPositions[0]?.jobTitle) ||
    '';
  const hasJobTitleSelected = typeof derivedJobTitle === 'string' && derivedJobTitle.trim().length > 0;

  const desc = jobOrder?.jobDescriptionFromClient;
  const hasClientDescription = typeof desc === 'string' && desc.trim().length > 0;

  const hasJobBoardPost = Array.isArray(jobPosts) && jobPosts.length > 0;
  const hasAiJobDescription =
    Array.isArray(jobPosts) &&
    jobPosts.some((p) => typeof p?.jobDescription === 'string' ? p.jobDescription.trim().length > 0 : false) ||
    jobPosts.some((p) => typeof p?.description === 'string' ? p.description.trim().length > 0 : false);

  const hasAutoAddUserGroup =
    Array.isArray(jobPosts) &&
    jobPosts.some(
      (p) =>
        (Array.isArray(p?.autoAddToUserGroups) && p.autoAddToUserGroups.length > 0) ||
        (typeof p?.autoAddToUserGroup === 'string' && p.autoAddToUserGroup.trim().length > 0)
    );

  const hasExternalJobPost = isValidUrl(jobOrder?.indeedUrl, 'indeed') || isValidUrl(jobOrder?.craigslistUrl, 'craigslist');

  return {
    worksite: hasLocation,
    dealContact: hasDealContact,
    recruiterAssigned: hasRecruiterAssigned,
    jobTitleSelected: hasJobTitleSelected,
    clientJobDescription: hasClientDescription,
    jobBoardPost: hasJobBoardPost,
    aiJobDescription: !!hasAiJobDescription,
    autoAddUserGroups: hasAutoAddUserGroup,
    externalJobBoards: hasExternalJobPost,
    shiftCreated: hasShiftCreated,
  };
}

async function upsertChecklistTasksForAssignees(opts: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
  assigneeIds: string[];
  cleanupAssigneeIds?: string[];
}): Promise<void> {
  const { tenantId, jobOrderId, jobOrder, assigneeIds, cleanupAssigneeIds = [] } = opts;

  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('syncChecklistTasks', 0.002);

  const now = new Date();
  const scheduledDate = toIsoDate(now);

  const [jobPosts, shiftCreated] = await Promise.all([
    loadJobPosts(tenantId, jobOrderId),
    hasAnyShift(tenantId, jobOrderId),
  ]);

  const statuses = computeChecklistStatuses(jobOrder, jobPosts, shiftCreated);

  const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');
  const batch = db.batch();

  const jobOrderNumber = jobOrder?.jobOrderNumber ? `#${jobOrder.jobOrderNumber}` : '';
  const jobOrderName = jobOrder?.jobOrderName || jobOrder?.title || 'Job Order';
  const taskPrefix = `Order Setup: ${jobOrderName}${jobOrderNumber ? ` (${jobOrderNumber})` : ''}`;

  for (const assigneeId of assigneeIds) {
    const safeAssigneeId = sanitizeAssigneeId(assigneeId);
    if (!safeAssigneeId) continue;
    for (const item of CHECKLIST_ITEMS) {
      const complete = !!statuses[item.id];
      const id = taskDocId(jobOrderId, item.id, safeAssigneeId);
      const ref = tasksRef.doc(id);
      const base = {
        title: `${taskPrefix} — ${item.label}`,
        description: `System-managed checklist task for job order ${jobOrderId}.`,
        type: 'admin',
        priority: 'medium',
        status: complete ? 'completed' : 'upcoming',
        classification: 'todo',
        scheduledDate,
        dueDate: scheduledDate,
        assignedTo: safeAssigneeId,
        createdBy: 'system',
        createdByName: 'System',
        tenantId,
        category: 'admin',
        quotaCategory: 'recruiting',
        tags: ['job_order_setup', jobOrderId, item.id],
        systemManaged: true,
        systemSource: 'job_order_checklist',
        sourceType: 'recruiting',
        sourceId: jobOrderId,
        sourceName: jobOrderName,
        jobOrderId,
        checklistItemId: item.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      } as any;

      if (complete) {
        base.completedAt = admin.firestore.FieldValue.serverTimestamp();
      } else {
        base.completedAt = null;
      }

      // Preserve createdAt on existing docs; set if missing
      batch.set(
        ref,
        {
          ...base,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  // Cleanup tasks for removed assignees (best-effort delete)
  for (const assigneeId of cleanupAssigneeIds) {
    const safeAssigneeId = sanitizeAssigneeId(assigneeId);
    if (!safeAssigneeId) continue;
    for (const item of CHECKLIST_ITEMS) {
      const id = taskDocId(jobOrderId, item.id, safeAssigneeId);
      batch.delete(tasksRef.doc(id));
    }
  }

  await batch.commit();
}

async function upsertChecklistTasksForAssigneesBulk(opts: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
  assigneeIds: string[];
  cleanupAssigneeIds?: string[];
  jobPosts: any[];
  shiftCreated: boolean;
}): Promise<void> {
  const { tenantId, jobOrderId, jobOrder, assigneeIds, cleanupAssigneeIds = [], jobPosts, shiftCreated } = opts;

  CostTracker.trackOperation('syncChecklistTasksBulk', 0.002);

  const now = new Date();
  const scheduledDate = toIsoDate(now);
  const statuses = computeChecklistStatuses(jobOrder, jobPosts, shiftCreated);

  const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');
  const batch = db.batch();

  const jobOrderNumber = jobOrder?.jobOrderNumber ? `#${jobOrder.jobOrderNumber}` : '';
  const jobOrderName = jobOrder?.jobOrderName || jobOrder?.title || 'Job Order';
  const taskPrefix = `Order Setup: ${jobOrderName}${jobOrderNumber ? ` (${jobOrderNumber})` : ''}`;

  for (const assigneeId of assigneeIds) {
    const safeAssigneeId = sanitizeAssigneeId(assigneeId);
    if (!safeAssigneeId) continue;
    for (const item of CHECKLIST_ITEMS) {
      const complete = !!statuses[item.id];
      const id = taskDocId(jobOrderId, item.id, safeAssigneeId);
      const ref = tasksRef.doc(id);
      const base = {
        title: `${taskPrefix} — ${item.label}`,
        description: `System-managed checklist task for job order ${jobOrderId}.`,
        type: 'admin',
        priority: 'medium',
        status: complete ? 'completed' : 'upcoming',
        classification: 'todo',
        scheduledDate,
        dueDate: scheduledDate,
        assignedTo: safeAssigneeId,
        createdBy: 'system',
        createdByName: 'System',
        tenantId,
        category: 'admin',
        quotaCategory: 'recruiting',
        tags: ['job_order_setup', jobOrderId, item.id],
        systemManaged: true,
        systemSource: 'job_order_checklist',
        sourceType: 'recruiting',
        sourceId: jobOrderId,
        sourceName: jobOrderName,
        jobOrderId,
        checklistItemId: item.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      } as any;

      base.completedAt = complete ? admin.firestore.FieldValue.serverTimestamp() : null;

      batch.set(
        ref,
        {
          ...base,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  for (const assigneeId of cleanupAssigneeIds) {
    const safeAssigneeId = sanitizeAssigneeId(assigneeId);
    if (!safeAssigneeId) continue;
    for (const item of CHECKLIST_ITEMS) {
      const id = taskDocId(jobOrderId, item.id, safeAssigneeId);
      batch.delete(tasksRef.doc(id));
    }
  }

  await batch.commit();
}

async function syncForJobOrder(tenantId: string, jobOrderId: string, cleanupRemovedAssignees?: boolean, before?: any, after?: any) {
  const snap = after
    ? { exists: true, data: () => after }
    : await db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId).get();

  if (!snap.exists) return;
  const jobOrder = snap.data() as any;

  const assignees = getAssignees(jobOrder);
  if (assignees.length === 0) return;

  const cleanupAssignees: string[] = [];
  if (cleanupRemovedAssignees && before && after) {
    const beforeAssignees = getAssignees(before);
    const afterAssignees = getAssignees(after);
    beforeAssignees.forEach((a) => {
      if (!afterAssignees.includes(a)) cleanupAssignees.push(a);
    });
  }

  await upsertChecklistTasksForAssignees({
    tenantId,
    jobOrderId,
    jobOrder,
    assigneeIds: assignees,
    cleanupAssigneeIds: cleanupAssignees,
  });
}

async function syncForJobOrderBulk(tenantId: string, jobOrderId: string, cleanupRemovedAssignees?: boolean, before?: any, after?: any) {
  const snap = after
    ? { exists: true, data: () => after }
    : await db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId).get();
  if (!snap.exists) return;

  const jobOrder = snap.data() as any;
  const assignees = getAssignees(jobOrder);
  if (assignees.length === 0) return;

  const cleanupAssignees: string[] = [];
  if (cleanupRemovedAssignees && before && after) {
    const beforeAssignees = getAssignees(before);
    const afterAssignees = getAssignees(after);
    beforeAssignees.forEach((a) => {
      if (!afterAssignees.includes(a)) cleanupAssignees.push(a);
    });
  }

  const [jobPosts, shiftCreated] = await Promise.all([
    loadJobPostsBulk(tenantId, jobOrderId),
    hasAnyShiftBulk(tenantId, jobOrderId),
  ]);

  await upsertChecklistTasksForAssigneesBulk({
    tenantId,
    jobOrderId,
    jobOrder,
    assigneeIds: assignees,
    cleanupAssigneeIds: cleanupAssignees,
    jobPosts,
    shiftCreated,
  });
}

const safeTrigger = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const jobOrderId = event?.params?.jobOrderId as string | undefined;
  if (!tenantId || !jobOrderId) return;

  const before = event?.data?.before?.data?.() || null;
  const after = event?.data?.after?.data?.() || null;
  if (!after) return;

  try {
    await syncForJobOrder(tenantId, jobOrderId, true, before, after);
    await logger.aiEvent({
      eventType: 'jobOrder.checklistTasks.sync',
      targetType: 'jobOrder',
      targetId: jobOrderId,
      reason: 'job_order_updated',
      contextType: 'jobOrderChecklist',
      tenantId,
      userId: 'system',
      aiTags: ['job_order_setup', 'tasks'],
      urgencyScore: 3,
      versionTag: 'jobOrderChecklistTasks@v1',
      metadata: { jobOrderId },
    } as any);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on job order update', {
      context: 'jobOrderChecklistTasks',
      extra: { tenantId, jobOrderId },
      error: err,
    });
  }
});

export const jobOrderChecklistTasksOnJobOrderWrite = safeTrigger.onDocumentUpdated(
  'tenants/{tenantId}/job_orders/{jobOrderId}'
);

export const jobOrderChecklistTasksOnJobOrderCreated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const jobOrderId = event?.params?.jobOrderId as string | undefined;
  if (!tenantId || !jobOrderId) return;
  try {
    await syncForJobOrder(tenantId, jobOrderId, false, null, event?.data?.data?.());
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on job order create', {
      context: 'jobOrderChecklistTasks',
      extra: { tenantId, jobOrderId },
      error: err,
    });
  }
}).onDocumentCreated('tenants/{tenantId}/job_orders/{jobOrderId}');

async function syncFromJobPostingEvent(event: any) {
  const tenantId = event?.params?.tenantId as string | undefined;
  if (!tenantId) return;
  const after = event?.data?.after?.data?.() || null;
  const before = event?.data?.before?.data?.() || null;
  const jobOrderId = (after?.jobOrderId || before?.jobOrderId) as any;
  if (!jobOrderId || typeof jobOrderId !== 'string') return;
  await syncForJobOrder(tenantId, jobOrderId, false);
}

async function syncFromShiftEvent(event: any) {
  const tenantId = event?.params?.tenantId as string | undefined;
  const jobOrderId = event?.params?.jobOrderId as string | undefined;
  if (!tenantId || !jobOrderId) return;
  await syncForJobOrder(tenantId, jobOrderId, false);
}

// Keep checklist tasks in sync when job postings change
export const jobOrderChecklistTasksOnJobPostingCreated = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromJobPostingEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on job posting create', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentCreated('tenants/{tenantId}/job_postings/{postId}');

export const jobOrderChecklistTasksOnJobPostingUpdated = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromJobPostingEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on job posting update', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentUpdated('tenants/{tenantId}/job_postings/{postId}');

export const jobOrderChecklistTasksOnJobPostingDeleted = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromJobPostingEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on job posting delete', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentDeleted('tenants/{tenantId}/job_postings/{postId}');

// Keep checklist tasks in sync when shifts change
export const jobOrderChecklistTasksOnShiftCreated = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromShiftEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on shift create', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentCreated('tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}');

export const jobOrderChecklistTasksOnShiftUpdated = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromShiftEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on shift update', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentUpdated('tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}');

export const jobOrderChecklistTasksOnShiftDeleted = createSafeFirestoreTrigger(async (event) => {
  try {
    await syncFromShiftEvent(event);
  } catch (err) {
    logger.warn('Failed to sync checklist tasks on shift delete', {
      context: 'jobOrderChecklistTasks',
      error: err,
    });
  }
}).onDocumentDeleted('tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}');

/**
 * Callable: backfill checklist tasks for "My Job Orders" for the caller.
 * This solves the gap where existing job orders won't trigger until they change.
 */
export const backfillMyJobOrderChecklistTasks = onCall({ cors: true, region: 'us-central1', timeoutSeconds: 240 }, async (request) => {
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  const tenantId = (request.data?.tenantId || '').toString();
  const userId = (request.data?.userId || request.auth?.uid || '').toString();

  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  if (!userId) throw new HttpsError('unauthenticated', 'userId is required');

  // Basic auth check: must be the caller
  if (request.auth?.uid && request.auth.uid !== userId) {
    throw new HttpsError('permission-denied', 'Cannot backfill tasks for another user');
  }

  const jobOrdersRef = db.collection('tenants').doc(tenantId).collection('job_orders');
  const [snapAssigned, snapLegacy] = await Promise.all([
    jobOrdersRef.where('assignedRecruiters', 'array-contains', userId).limit(500).get(),
    jobOrdersRef.where('recruiterId', '==', userId).limit(500).get(),
  ]);
  const ids = Array.from(new Set([...snapAssigned.docs.map((d) => d.id), ...snapLegacy.docs.map((d) => d.id)]));

  let synced = 0;
  for (const jobOrderId of ids) {
    CostTracker.trackOperation('backfillJobOrder', 0.001);
    await syncForJobOrderBulk(tenantId, jobOrderId, false);
    synced++;
  }

  return { success: true, jobOrders: ids.length, synced };
});

/**
 * Callable (admin-only): backfill checklist tasks for all tenant users with securityLevel 5-7.
 * This is intended for one-off catchup after enabling checklist→tasks.
 */
export const backfillChecklistTasksForTenantAdmins = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    const tenantId = (request.data?.tenantId || '').toString();
    const callerId = request.auth?.uid || '';
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    if (!callerId) throw new HttpsError('unauthenticated', 'Authentication required');

    // Must be tenant admin (securityLevel 5-7) in this tenant
    const callerSnap = await db.collection('users').doc(callerId).get();
    const callerData = callerSnap.data() || {};
    const callerTenant = (callerData as any)?.tenantIds?.[tenantId] || {};
    const callerLevel = parseInt(String(callerTenant.securityLevel || (callerData as any).securityLevel || '0'), 10);
    if (!(callerLevel >= 5 && callerLevel <= 7)) {
      throw new HttpsError('permission-denied', 'Admin permissions required');
    }

    const usersRef = db.collection('users');
    const q = usersRef.where(`tenantIds.${tenantId}.securityLevel`, 'in', ['5', '6', '7']).limit(300);
    const userSnaps = await q.get();

    let admins = 0;
    let totalJobOrders = 0;
    let syncedJobOrders = 0;

    for (const userDoc of userSnaps.docs) {
      CostTracker.trackOperation('backfillAdminUser', 0.001);

      const userId = userDoc.id;
      admins++;

      const jobOrdersRef = db.collection('tenants').doc(tenantId).collection('job_orders');
      const [snapAssigned, snapLegacy] = await Promise.all([
        jobOrdersRef.where('assignedRecruiters', 'array-contains', userId).limit(300).get(),
        jobOrdersRef.where('recruiterId', '==', userId).limit(300).get(),
      ]);
      const ids = Array.from(new Set([...snapAssigned.docs.map((d) => d.id), ...snapLegacy.docs.map((d) => d.id)]));
      totalJobOrders += ids.length;

      for (const jobOrderId of ids) {
        CostTracker.trackOperation('backfillAdminJobOrder', 0.001);
        await syncForJobOrderBulk(tenantId, jobOrderId, false);
        syncedJobOrders++;
      }
    }

    return {
      success: true,
      tenantId,
      admins,
      totalJobOrders,
      syncedJobOrders,
      cost: CostTracker.getCostSummary(),
    };
  }
);
