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
 * Notification: New application created under a job order (Phase 2 path).
 */
export const recruiterNotificationOnJobOrderApplicationCreated = createSafeFirestoreTrigger(async (event) => {
  const tenantId = event?.params?.tenantId as string | undefined;
  const jobOrderId = event?.params?.jobOrderId as string | undefined;
  const applicationId = event?.params?.applicationId as string | undefined;
  if (!tenantId || !jobOrderId || !applicationId) return;

  const app = event?.data?.data?.() || null;
  if (!app) return;

  // Load job order to determine assignees
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
  await logger.info('Created application notifications (job order subcollection)', {
    context: 'recruiterNotificationOnJobOrderApplicationCreated',
    extra: { tenantId, jobOrderId, applicationId, assigneesCount: assignees.length },
  });
}).onDocumentCreated('tenants/{tenantId}/job_orders/{jobOrderId}/applications/{applicationId}');

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
  await logger.info('Created application notifications (tenant applications)', {
    context: 'recruiterNotificationOnTenantApplicationCreated',
    extra: { tenantId, jobOrderId, applicationId, assigneesCount: assignees.length },
  });
}).onDocumentCreated('tenants/{tenantId}/applications/{applicationId}');

