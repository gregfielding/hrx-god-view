import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger } from './utils/safeFunctionTemplate';
import { logger } from './utils/logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function uniqStrings(values: any[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );
}

function getJobOrderAssignees(jobOrder: any): string[] {
  const assignedRecruiters = uniqStrings(jobOrder?.assignedRecruiters || []);
  const legacyRecruiterId =
    typeof jobOrder?.recruiterId === 'string' && jobOrder.recruiterId.trim()
      ? [jobOrder.recruiterId.trim()]
      : [];

  // Prefer the modern array; fall back to legacy recruiterId.
  return Array.from(new Set([...(assignedRecruiters.length ? assignedRecruiters : []), ...(assignedRecruiters.length ? [] : legacyRecruiterId)]));
}

function getJobOrderTitle(jobOrder: any): string {
  return (
    jobOrder?.title ||
    jobOrder?.jobTitle ||
    jobOrder?.jobTitleName ||
    jobOrder?.deal?.name ||
    jobOrder?.deal?.title ||
    'Job Order'
  );
}

function buildCandidateName(app: any): string {
  const c = app?.candidate || {};
  const first = typeof c.firstName === 'string' ? c.firstName.trim() : '';
  const last = typeof c.lastName === 'string' ? c.lastName.trim() : '';
  const full = `${first} ${last}`.trim();
  return full || (typeof c.email === 'string' ? c.email : 'New applicant');
}

async function writeDashboardNotification(args: {
  id: string;
  userId: string;
  title: string;
  snippet: string;
  route: string;
  sourceId: string;
  tenantId: string;
  extra?: Record<string, any>;
}): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const doc = {
    id: args.id,
    userId: args.userId,
    tenantId: args.tenantId,
    sourceType: 'notification' as const,
    sourceId: args.sourceId,
    title: args.title,
    snippet: args.snippet,
    fromLabel: 'HRX',
    avatarUrl: null,
    isUnread: true,
    isMuted: false,
    timestamp: now.toMillis(),
    drawerScope: {
      scopeType: 'notification' as const,
      route: args.route,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(args.extra ? { extra: args.extra } : {}),
  };

  await db.collection('dashboardFeed').doc(args.id).set(doc, { merge: true });
}

function cleanId(s: string): string {
  return s.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 180);
}

function isTruthyString(v: any): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function shouldNotifyTask(task: any): boolean {
  if (!task) return false;
  if (task.systemManaged === true) return false; // avoid spam for system-generated checklists, etc.
  if (task.createdBy === 'system') return false;
  const status = typeof task.status === 'string' ? task.status : '';
  if (status === 'completed' || status === 'cancelled') return false;
  return true;
}

async function notifyTaskAssigned(args: {
  tenantId: string;
  taskId: string;
  task: any;
  taskCollection: 'tasks' | 'crm_tasks';
  eventKey: string;
}): Promise<void> {
  const { tenantId, taskId, task, taskCollection, eventKey } = args;
  const assignedTo = isTruthyString(task?.assignedTo) ? task.assignedTo.trim() : null;
  if (!assignedTo) return;
  if (!shouldNotifyTask(task)) return;

  const title = 'New Task Assigned';
  const taskTitle = isTruthyString(task?.title) ? task.title.trim() : 'Task';
  const snippet = `"${taskTitle}" was assigned to you.`;
  const sourceId = `task:${tenantId}:${taskCollection}:${taskId}`;

  const now = admin.firestore.Timestamp.now();
  const id = cleanId(`task:${tenantId}:${taskCollection}:${taskId}:${assignedTo}:${eventKey}`);
  
  const doc = {
    id,
    userId: assignedTo,
    tenantId,
    sourceType: 'task' as const,
    sourceId,
    title,
    snippet,
    fromLabel: 'HRX',
    avatarUrl: null,
    isUnread: true,
    isMuted: false,
    timestamp: now.toMillis(),
    drawerScope: {
      scopeType: 'task' as const,
      route: '/tasks',
      taskId,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    extra: { kind: 'task_assigned', taskId, taskCollection },
  };

  await db.collection('dashboardFeed').doc(id).set(doc, { merge: true });
}

/**
 * Create an interview task for a recruiter when a new application is received.
 */
async function createInterviewTaskForRecruiter(args: {
  tenantId: string;
  recruiterId: string;
  applicationId: string;
  jobOrderId: string;
  candidateName: string;
  jobTitle: string;
}): Promise<string | null> {
  const { tenantId, recruiterId, applicationId, jobOrderId, candidateName, jobTitle } = args;
  
  if (!tenantId || !recruiterId || !applicationId || !jobOrderId) {
    return null;
  }

  try {
    // Get recruiter name for assignedToName
    let recruiterName = 'Unknown User';
    try {
      const recruiterDoc = await db.collection('users').doc(recruiterId).get();
      if (recruiterDoc.exists) {
        const recruiterData = recruiterDoc.data();
        const firstName = recruiterData?.firstName || '';
        const lastName = recruiterData?.lastName || '';
        recruiterName = `${firstName} ${lastName}`.trim() || recruiterName;
      }
    } catch (err) {
      // Best effort - use default name
    }

    // Create deterministic task ID to avoid duplicates
    const taskId = `interview:${tenantId}:${jobOrderId}:${applicationId}:${recruiterId}`;
    const taskRef = db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId);

    // Check if task already exists
    const existingTask = await taskRef.get();
    if (existingTask.exists) {
      // Task already exists, return the existing ID
      return taskId;
    }

    const now = admin.firestore.Timestamp.now();
    const taskData = {
      title: `Complete Interview: ${candidateName} - ${jobTitle}`,
      description: `Schedule and complete interview with ${candidateName} for ${jobTitle}.`,
      type: 'custom',
      priority: 'medium',
      status: 'upcoming',
      classification: 'todo',
      scheduledDate: null,
      dueDate: null,
      assignedTo: recruiterId,
      assignedToName: recruiterName,
      associations: {
        contacts: [],
        deals: [],
        companies: [],
      },
      notes: '',
      category: null,
      quotaCategory: null,
      estimatedDuration: 30,
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
      tags: [],
      relatedToName: '',
      tenantId,
      createdBy: 'system',
      createdByName: 'System',
      sourceType: 'recruiting',
      sourceId: jobOrderId,
      sourceName: jobTitle,
      jobOrderId,
      applicationId,
      systemManaged: false,
      createdAt: now,
      updatedAt: now,
    };

    await taskRef.set(taskData);
    return taskId;
  } catch (error) {
    await logger.error('Failed to create interview task', {
      context: 'createInterviewTaskForRecruiter',
      error: error instanceof Error ? error.message : String(error),
      extra: { tenantId, recruiterId, applicationId, jobOrderId },
    });
    return null;
  }
}

/**
 * Notification: Job order assigned to a recruiter (detects newly added assignees).
 */
export const recruiterNotificationOnJobOrderAssigned = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const jobOrderId = event?.params?.jobOrderId as string | undefined;
  if (!tenantId || !jobOrderId) return;

  const before = event?.data?.before?.data?.() || null;
  const after = event?.data?.after?.data?.() || null;
  if (!after) return;

  const beforeAssignees = new Set(getJobOrderAssignees(before || {}));
  const afterAssignees = new Set(getJobOrderAssignees(after || {}));
  const added = Array.from(afterAssignees).filter((uid) => !beforeAssignees.has(uid));

  if (!added.length) return;

  const title = 'Job Order Assigned';
  const jobTitle = getJobOrderTitle(after);
  const route = `/recruiter/job-orders/${jobOrderId}`;
  const sourceId = `job_order:${tenantId}:${jobOrderId}`;
  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();
  added.forEach((uid) => {
    const id = `notif:jobOrderAssigned:${tenantId}:${jobOrderId}:${uid}:${eventKey}`;
    const ref = db.collection('dashboardFeed').doc(id);
    batch.set(
      ref,
      {
        id,
        userId: uid,
        tenantId,
        sourceType: 'notification',
        sourceId,
        title,
        snippet: `${jobTitle} was assigned to you.`,
        fromLabel: 'Recruiting',
        avatarUrl: null,
        isUnread: true,
        isMuted: false,
        timestamp: now.toMillis(),
        drawerScope: { scopeType: 'notification', route },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        extra: { kind: 'job_order_assigned', jobOrderId },
      },
      { merge: true },
    );
  });

  await batch.commit();
  await logger.info('Created job order assignment notifications', {
    context: 'recruiterNotificationOnJobOrderAssigned',
    extra: { tenantId, jobOrderId, addedCount: added.length },
  });
}).onDocumentUpdated('tenants/{tenantId}/job_orders/{jobOrderId}');

/**
 * Notification: New application created in tenant applications collection (source-of-truth path).
 * Only emits when the application is job-linked (jobOrderId present).
 */
export const recruiterNotificationOnTenantApplicationCreated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const applicationId = event?.params?.applicationId as string | undefined;
  if (!tenantId || !applicationId) return;

  const app = event?.data?.data?.() || null;
  const jobOrderId = typeof app?.jobOrderId === 'string' ? app.jobOrderId : null;
  if (!app || !jobOrderId) return;

  const jobOrderSnap = await db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId).get();
  const jobOrder = jobOrderSnap.exists ? jobOrderSnap.data() : null;
  const assignees = getJobOrderAssignees(jobOrder || {});
  if (!assignees.length) return;

  const jobTitle = getJobOrderTitle(jobOrder || {});
  const candidateName = buildCandidateName(app);
  const route = `/recruiter/job-orders/${jobOrderId}`;
  const sourceId = `application:${tenantId}:${jobOrderId}:${applicationId}`;
  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();
  assignees.forEach((uid) => {
    const id = `notif:application:${tenantId}:${jobOrderId}:${applicationId}:${uid}:${eventKey}`;
    const ref = db.collection('dashboardFeed').doc(id);
    batch.set(
      ref,
      {
        id,
        userId: uid,
        tenantId,
        sourceType: 'notification',
        sourceId,
        title: 'New Application',
        snippet: `${candidateName} applied to ${jobTitle}.`,
        fromLabel: 'Recruiting',
        avatarUrl: null,
        isUnread: true,
        isMuted: false,
        timestamp: now.toMillis(),
        drawerScope: { scopeType: 'notification', route },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        extra: { kind: 'application_created', jobOrderId, applicationId },
      },
      { merge: true },
    );
  });

  await batch.commit();

  // Create interview tasks for each assigned recruiter
  const taskPromises = assignees.map((uid) =>
    createInterviewTaskForRecruiter({
      tenantId,
      recruiterId: uid,
      applicationId,
      jobOrderId,
      candidateName,
      jobTitle,
    })
  );
  const taskIds = await Promise.all(taskPromises);
  const createdTaskIds = taskIds.filter((id): id is string => id !== null);

  await logger.info('Created application notifications and interview tasks (tenant applications)', {
    context: 'recruiterNotificationOnTenantApplicationCreated',
    extra: { tenantId, jobOrderId, applicationId, assigneesCount: assignees.length, tasksCreated: createdTaskIds.length },
  });
}).onDocumentCreated('tenants/{tenantId}/applications/{applicationId}');

/**
 * Notification: Task assigned (tenant tasks collection).
 */
export const recruiterNotificationOnTaskCreated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const taskId = event?.params?.taskId as string | undefined;
  if (!tenantId || !taskId) return;
  const task = event?.data?.data?.() || null;
  if (!task) return;
  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;
  await notifyTaskAssigned({ tenantId, taskId, task, taskCollection: 'tasks', eventKey });
}).onDocumentCreated('tenants/{tenantId}/tasks/{taskId}');

export const recruiterNotificationOnTaskUpdated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const taskId = event?.params?.taskId as string | undefined;
  if (!tenantId || !taskId) return;
  const before = event?.data?.before?.data?.() || null;
  const after = event?.data?.after?.data?.() || null;
  if (!after) return;

  const beforeAssigned = isTruthyString(before?.assignedTo) ? before.assignedTo.trim() : '';
  const afterAssigned = isTruthyString(after?.assignedTo) ? after.assignedTo.trim() : '';
  if (!afterAssigned || beforeAssigned === afterAssigned) return;

  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;
  await notifyTaskAssigned({ tenantId, taskId, task: after, taskCollection: 'tasks', eventKey });
}).onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}');

/**
 * Notification: Task assigned (tenant crm_tasks collection).
 */
export const recruiterNotificationOnCrmTaskCreated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const taskId = event?.params?.taskId as string | undefined;
  if (!tenantId || !taskId) return;
  const task = event?.data?.data?.() || null;
  if (!task) return;
  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;
  await notifyTaskAssigned({ tenantId, taskId, task, taskCollection: 'crm_tasks', eventKey });
}).onDocumentCreated('tenants/{tenantId}/crm_tasks/{taskId}');

export const recruiterNotificationOnCrmTaskUpdated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const taskId = event?.params?.taskId as string | undefined;
  if (!tenantId || !taskId) return;
  const before = event?.data?.before?.data?.() || null;
  const after = event?.data?.after?.data?.() || null;
  if (!after) return;

  const beforeAssigned = isTruthyString(before?.assignedTo) ? before.assignedTo.trim() : '';
  const afterAssigned = isTruthyString(after?.assignedTo) ? after.assignedTo.trim() : '';
  if (!afterAssigned || beforeAssigned === afterAssigned) return;

  const eventKey = (event as any)?.id || (event as any)?.eventId || `${Date.now()}`;
  await notifyTaskAssigned({ tenantId, taskId, task: after, taskCollection: 'crm_tasks', eventKey });
}).onDocumentUpdated('tenants/{tenantId}/crm_tasks/{taskId}');
