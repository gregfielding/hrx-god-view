/**
 * AI hiring monitor sweep (Greg 2026-09-10, Illinois). Rides
 * scheduledOrchestrator as `ai_hiring_monitor_sweep` — no Cloud Run service of
 * its own.
 *
 * Every hour: alert recruiters to new "Ask a recruiter" requests
 * (tenants/{t}/recruiter_review_requests, written by workers on web and app)
 * through the dashboard feed — the job order's assigned recruiters, else the
 * tenant's admins. Request details can describe a disability, so they are only
 * copied into the feed for the admin fallback (no job order to read them on).
 *
 * Once a day per tenant: recompute
 * tenants/{t}/compliance_reports/ai_hiring_illinois — promotion (Tier 1/2) and
 * hire rates by self-identified race/ethnicity and sex, and by age band, for
 * applicants to Illinois postings. Self-ID answers are read here with the
 * admin SDK; only aggregates are written.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { notifyRecruitersOnWorkerEvent } from '../messaging/notifyRecruitersOnWorkerEvent';
import { resolveGlobalTier } from '../tierAutomation/applicantPromotion';
import {
  DEFAULT_MIN_GROUP_SIZE,
  FOUR_FIFTHS_THRESHOLD,
  ageBandFromDob,
  computeSelectionRates,
  isIllinoisPosting,
} from './aiHiringMonitor';
import type { MonitorApplicant } from './aiHiringMonitor';

export const AI_HIRING_REPORT_DOC_ID = 'ai_hiring_illinois';
const REPORT_INTERVAL_MS = 20 * 60 * 60 * 1000;
const NON_APPLICANT_STATUSES = new Set(['in_progress', 'draft', 'deleted']);
const INACTIVE_EMPLOYMENT_STATUSES = new Set(['terminated', 'inactive']);
const ILLINOIS_STATE_VALUES = ['IL', 'Illinois', 'il', 'ILLINOIS'];
const MAX_REQUESTS_PER_RUN = 100;

export interface AiHiringMonitorTotals {
  tenants: number;
  requestsNotified: number;
  reportsWritten: number;
  errors: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sanitizeDocId = (s: string): string => s.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 180);

async function notifyTenantAdmins(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    requestId: string;
    userId: string;
    kind: string;
    title: string;
    snippet: string;
    route: string;
  },
): Promise<number> {
  const admins = await db
    .collection('users')
    .where(`tenantIds.${args.tenantId}.securityLevel`, '==', '7')
    .limit(10)
    .get();
  const now = admin.firestore.Timestamp.now();
  for (const a of admins.docs) {
    const docId = sanitizeDocId(`review_request__${args.requestId}__${a.id}`);
    // eslint-disable-next-line no-await-in-loop
    await db.collection('dashboardFeed').doc(docId).set(
      {
        id: docId,
        userId: a.id,
        tenantId: args.tenantId,
        sourceType: 'notification',
        sourceId: args.requestId,
        title: args.title,
        snippet: args.snippet,
        fromLabel: 'HRX',
        avatarUrl: null,
        isUnread: true,
        isMuted: false,
        timestamp: now.toMillis(),
        drawerScope: { scopeType: 'notification', route: args.route },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        extra: { kind: args.kind, requestId: args.requestId, userId: args.userId },
      },
      { merge: true },
    );
  }
  return admins.size;
}

async function notifyNewReviewRequests(db: admin.firestore.Firestore, tenantId: string): Promise<number> {
  const snap = await db
    .collection(`tenants/${tenantId}/recruiter_review_requests`)
    .where('notifiedAt', '==', null)
    .limit(MAX_REQUESTS_PER_RUN)
    .get();
  let notified = 0;
  for (const doc of snap.docs) {
    const r = doc.data() as Record<string, unknown>;
    const userId = str(r.userId);
    const jobId = str(r.jobId);
    let jobOrderId = str(r.jobOrderId);
    if (!jobOrderId && jobId) {
      // eslint-disable-next-line no-await-in-loop
      const posting = await db.doc(`tenants/${tenantId}/job_postings/${jobId}`).get();
      jobOrderId = str((posting.data() ?? {}).jobOrderId);
    }
    // eslint-disable-next-line no-await-in-loop
    const user = userId ? ((await db.doc(`users/${userId}`).get()).data() ?? {}) : {};
    const name = `${str(user.firstName)} ${str(user.lastName)}`.trim() || 'A worker';
    const accommodation = r.kind === 'accommodation';
    const kind = accommodation ? 'accommodation_request' : 'recruiter_review_request';
    const title = accommodation
      ? `Accommodation request from ${name}`
      : `${name} asked for a recruiter review`;
    const where = str(r.postingTitle) || 'an Illinois job';

    let recipients = 0;
    if (jobOrderId) {
      // eslint-disable-next-line no-await-in-loop
      const res = await notifyRecruitersOnWorkerEvent({
        tenantId,
        assignmentId: doc.id,
        assignment: { jobOrderId },
        event: {
          kind,
          title,
          snippet: `${where} — read the request on the job order's Applications tab.`,
          dedupeKey: `review_request__${doc.id}`,
          extra: { requestId: doc.id, userId, jobId: jobId || null },
        },
        route: `/jobs/job-orders/${jobOrderId}?tab=applications`,
      });
      recipients = res.notifiedRecruiterIds.length;
    }
    if (recipients === 0) {
      const details = str(r.details);
      // eslint-disable-next-line no-await-in-loop
      recipients = await notifyTenantAdmins(db, {
        tenantId,
        requestId: doc.id,
        userId,
        kind,
        title,
        snippet: `${where}${details ? ` — "${details.slice(0, 280)}"` : ''}`,
        route: `/users/${userId}`,
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await doc.ref.set(
      {
        notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        notifiedRecipients: recipients,
        ...(jobOrderId && !str(r.jobOrderId) ? { jobOrderId } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    notified++;
  }
  return notified;
}

async function writeIllinoisReport(db: admin.firestore.Firestore, tenantId: string): Promise<boolean> {
  const postingsCol = db.collection(`tenants/${tenantId}/job_postings`);
  const [byState, byAddress] = await Promise.all([
    postingsCol.where('state', 'in', ILLINOIS_STATE_VALUES).get(),
    postingsCol.where('worksiteAddress.state', 'in', ILLINOIS_STATE_VALUES).get(),
  ]);
  const postings = new Map<string, Record<string, unknown>>();
  for (const s of [byState, byAddress]) {
    s.forEach((d) => {
      const p = d.data() as Record<string, unknown>;
      if (isIllinoisPosting(p)) postings.set(d.id, p);
    });
  }
  if (postings.size === 0) return false;

  const entityIdsByUser = new Map<string, Set<string>>();
  for (const ids of chunk([...postings.keys()], 30)) {
    // eslint-disable-next-line no-await-in-loop
    const apps = await db.collection(`tenants/${tenantId}/applications`).where('jobId', 'in', ids).get();
    apps.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      if (NON_APPLICANT_STATUSES.has(str(a.status).toLowerCase())) return;
      const uid = str(a.userId);
      if (!uid) return;
      const set = entityIdsByUser.get(uid) ?? new Set<string>();
      const entityId = str(postings.get(str(a.jobId))?.hiringEntityId) || str(a.hiringEntityId);
      if (entityId) set.add(entityId);
      entityIdsByUser.set(uid, set);
    });
  }

  const applicants: MonitorApplicant[] = [];
  let selfIdResponses = 0;
  const now = new Date();
  for (const ids of chunk([...entityIdsByUser.keys()], 30)) {
    // eslint-disable-next-line no-await-in-loop
    const [users, selfIds, employments] = await Promise.all([
      db.getAll(...ids.map((id) => db.doc(`users/${id}`))),
      db.getAll(...ids.map((id) => db.doc(`eeo_self_identifications/${id}`))),
      db.collection(`tenants/${tenantId}/entity_employments`).where('userId', 'in', ids).get(),
    ]);
    const liveEntities = new Map<string, Set<string>>();
    employments.forEach((d) => {
      const r = d.data() as Record<string, unknown>;
      if (INACTIVE_EMPLOYMENT_STATUSES.has(str(r.status).toLowerCase())) return;
      const uid = str(r.userId);
      const set = liveEntities.get(uid) ?? new Set<string>();
      set.add(str(r.entityId) || str(r.hiringEntityId));
      liveEntities.set(uid, set);
    });
    const selfIdByUid = new Map(
      selfIds.filter((s) => s.exists).map((s) => [s.id, (s.data() ?? {}) as Record<string, unknown>]),
    );
    users.forEach((u) => {
      if (!u.exists) return;
      const data = (u.data() ?? {}) as Record<string, unknown>;
      const selfId = selfIdByUid.get(u.id);
      if (selfId) selfIdResponses++;
      const applied = entityIdsByUser.get(u.id) ?? new Set<string>();
      const live = liveEntities.get(u.id) ?? new Set<string>();
      applicants.push({
        raceEthnicity: str(selfId?.raceEthnicity) || null,
        sex: str(selfId?.sex) || null,
        ageBand: ageBandFromDob(data.dateOfBirth ?? data.dob, now),
        promoted: resolveGlobalTier(data) <= 2,
        hired: [...applied].some((e) => live.has(e)),
      });
    });
  }

  const openRequests = await db
    .collection(`tenants/${tenantId}/recruiter_review_requests`)
    .where('status', '==', 'open')
    .count()
    .get();

  await db.doc(`tenants/${tenantId}/compliance_reports/${AI_HIRING_REPORT_DOC_ID}`).set({
    tenantId,
    scope: 'IL',
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    postings: postings.size,
    applicants: applicants.length,
    selfIdResponses,
    minGroupSize: DEFAULT_MIN_GROUP_SIZE,
    fourFifthsThreshold: FOUR_FIFTHS_THRESHOLD,
    raceEthnicity: computeSelectionRates(applicants, (a) => a.raceEthnicity),
    sex: computeSelectionRates(applicants, (a) => a.sex),
    ageBand: computeSelectionRates(applicants, (a) => a.ageBand),
    openReviewRequests: openRequests.data().count,
  });
  return true;
}

export async function runAiHiringMonitorSweep(
  db: admin.firestore.Firestore,
  opts: { forceReport?: boolean } = {},
): Promise<AiHiringMonitorTotals> {
  const totals: AiHiringMonitorTotals = { tenants: 0, requestsNotified: 0, reportsWritten: 0, errors: 0 };
  const tenantsSnap = await db.collection('tenants').limit(100).get();
  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    try {
      // eslint-disable-next-line no-await-in-loop
      totals.requestsNotified += await notifyNewReviewRequests(db, tenantId);
      // eslint-disable-next-line no-await-in-loop
      const existing = await db.doc(`tenants/${tenantId}/compliance_reports/${AI_HIRING_REPORT_DOC_ID}`).get();
      const generatedAt = (existing.data() ?? {}).generatedAt as admin.firestore.Timestamp | undefined;
      const lastMs = typeof generatedAt?.toMillis === 'function' ? generatedAt.toMillis() : 0;
      if (!opts.forceReport && Date.now() - lastMs < REPORT_INTERVAL_MS) continue;
      totals.tenants++;
      // eslint-disable-next-line no-await-in-loop
      if (await writeIllinoisReport(db, tenantId)) totals.reportsWritten++;
    } catch (e: unknown) {
      totals.errors++;
      logger.error('aiHiringMonitorSweep: tenant failed', {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.info('aiHiringMonitorSweep: done', { ...totals });
  return totals;
}
