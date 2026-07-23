/**
 * Assignment lifecycle API — the server half of the assignment drawer on
 * Who's Working (Greg, 2026-07-20).
 *
 *   endAssignment — "this worker is done here as of <date>". A schedule-level
 *     data-cleanup action, NOT separation: the worker stays hired and in the
 *     pool. Handles both assignment shapes:
 *       • per-day doc families (one doc per worker per day, same shiftId):
 *         docs after the end date are HARD-DELETED (the resolver invariant —
 *         removed workers must never resurface on grids/rosters), docs on or
 *         before it get status 'ended' + an audit stamp.
 *       • open-ended docs (empty endDate + weeklySchedule / open-shift flag):
 *         the end date is stamped on; status flips to 'ended' once the date
 *         has passed (future-dated ends stay live until then — the stale
 *         sweep completes them on schedule now that endDate is set).
 *     No worker notification is sent — this is cleanup for people who already
 *     quit or were replaced; recruiters text separately when needed.
 *
 *   getOngoingAssignments — the Full-Time Workers tab. Ongoing = open-ended:
 *     no endDate plus a standing weekly schedule or open-shift flag. Status is
 *     deliberately NOT trusted here: the stale sweep wrongly auto-ended 9/10
 *     ongoing assignments before the 2026-07-20 guard, so rows whose only
 *     "end" is a sweep status-flip still count as ongoing until a real
 *     endDate is stamped (via endAssignment).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { canManageAssignments } from '../placementsApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REMOVED_RE = /cancel|declined|rejected/;

function todayUtcIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function isOngoingDoc(a: FirebaseFirestore.DocumentData): boolean {
  const noEnd = !(typeof a.endDate === 'string' && a.endDate.trim().length > 0);
  const hasWs = a.weeklySchedule && Object.keys(a.weeklySchedule).length > 0;
  // Career JOs are the canonical "full-time" signal (Greg, 2026-07-20);
  // the schedule/open-shift flags remain as fallback for legacy docs
  // that predate the jobOrderType denorm.
  const isCareer = String(a.jobOrderType ?? '') === 'career';
  return noEnd && (isCareer || a.isOpenShift === true || a.noFixedTimes === true || Boolean(hasWs));
}

async function assertRecruiter(
  request: { auth?: { uid?: string; token?: unknown } },
  tenantId: string,
) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Assignment management access required.');
  }
}

export const endAssignment = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '');
    const assignmentId = String(request.data?.assignmentId ?? '');
    const endDate = String(request.data?.endDate ?? '');
    const reason = String(request.data?.reason ?? '').trim();
    // mode 'delete' = "this never happened": the worker was recorded here
    // but never actually worked (e.g. the real hire went through Indeed
    // Flex and HRX was never corrected). Erases the whole family + its
    // placement markers. Refused when timesheet entries exist — that
    // means they DID work, and 'end' is the correct tool.
    const mode = request.data?.mode === 'delete' ? 'delete' : 'end';
    if (!tenantId || !assignmentId) {
      throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
    }
    if (mode === 'end' && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError('invalid-argument', 'endDate must be YYYY-MM-DD');
    }
    await assertRecruiter(request, tenantId);

    const ref = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Assignment not found');
    const a = snap.data() || {};
    const shiftId = String(a.shiftId ?? '');
    const userId = String(a.userId ?? a.candidateId ?? '');

    // The clicked doc may be one day of a per-day family — end the whole
    // (worker, shift) engagement, not just the one day. Falls back to the
    // single doc when there's no shift/worker key to widen by.
    let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (shiftId && userId) {
      const fam = await db
        .collection(`tenants/${tenantId}/assignments`)
        .where('shiftId', '==', shiftId)
        .get();
      docs = fam.docs.filter((d) => {
        const x = d.data() || {};
        return String(x.userId ?? x.candidateId ?? '') === userId;
      });
    }
    if (docs.length === 0) docs = [snap as FirebaseFirestore.QueryDocumentSnapshot];

    if (mode === 'delete') {
      // Safety rail: hours on the books = they worked = not deletable.
      for (const d of docs) {
        // eslint-disable-next-line no-await-in-loop
        const entries = await db
          .collection(`tenants/${tenantId}/timesheet_entries`)
          .where('assignmentId', '==', d.id)
          .limit(1)
          .get();
        if (!entries.empty) {
          throw new HttpsError(
            'failed-precondition',
            'This worker has timesheet entries on this assignment — they worked here. ' +
              'Use "End assignment" instead of deleting.',
          );
        }
      }
      let deleted = 0;
      for (const d of docs) {
        // eslint-disable-next-line no-await-in-loop
        await d.ref.delete();
        deleted += 1;
      }
      // Erase the pre-offer placement markers too (both id formats share
      // the `${shiftId}__${userId}` prefix).
      let placementsDeleted = 0;
      if (shiftId && userId) {
        const prefix = `${shiftId}__${userId}`;
        const placements = await db
          .collection(`tenants/${tenantId}/placements`)
          .where(admin.firestore.FieldPath.documentId(), '>=', prefix)
          .where(admin.firestore.FieldPath.documentId(), '<', `${prefix}\uf8ff`)
          .get();
        for (const p of placements.docs) {
          // eslint-disable-next-line no-await-in-loop
          await p.ref.delete();
          placementsDeleted += 1;
        }
      }
      logger.info('[endAssignment] deleted (never worked)', {
        tenantId,
        assignmentId,
        familySize: docs.length,
        deleted,
        placementsDeleted,
        reason: reason || null,
        by: request.auth!.uid,
      });
      return { success: true, mode: 'delete', deleted, placementsDeleted };
    }

    const today = todayUtcIso();
    const stamp = {
      endedAsOf: endDate,
      endedReason: reason || 'ended by recruiter',
      endedBy: request.auth!.uid,
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Every assignment notifier honors this flag — ending is silent
      // cleanup, never a worker-facing event (Greg, 2026-07-20).
      notificationsSuppressed: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth!.uid,
    };
    let ended = 0;
    let deleted = 0;
    for (const d of docs) {
      const x = d.data() || {};
      const status = String(x.status ?? '').toLowerCase();
      if (REMOVED_RE.test(status)) continue; // already off the schedule
      const docStart = typeof x.startDate === 'string' ? x.startDate.slice(0, 10) : '';
      if (isOngoingDoc(x)) {
        await d.ref.update({
          ...stamp,
          endDate,
          ...(endDate <= today ? { status: 'ended', previousStatus: x.status ?? '' } : {}),
        });
        ended += 1;
      } else if (docStart && docStart > endDate) {
        // Future day the worker will no longer work — hard-delete so no
        // grid/roster/report can resurface it (the removal invariant).
        await d.ref.delete();
        deleted += 1;
      } else {
        await d.ref.update({
          ...stamp,
          ...(/ended|completed/.test(status)
            ? {}
            : { status: 'ended', previousStatus: x.status ?? '' }),
        });
        ended += 1;
      }
    }

    logger.info('[endAssignment] done', {
      tenantId,
      assignmentId,
      endDate,
      familySize: docs.length,
      ended,
      deleted,
      by: request.auth!.uid,
    });
    return { success: true, ended, deleted };
  },
);

export const getOngoingAssignments = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '');
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    // Optional entity narrowing (Greg, 2026-07-23): the Career
    // Assignments tab is C1 Select only by policy — 1099 events crews
    // on open-ended assignments (Black Caviar, Proof of the Pudding)
    // must not appear there. Policy lives with the caller; this stays
    // a generic filter.
    const entityFilter = String(request.data?.hiringEntityId ?? '').trim();
    await assertRecruiter(request, tenantId);

    const snap = await db.collection(`tenants/${tenantId}/assignments`).get();
    const rows: Array<Record<string, unknown>> = [];
    const joIds = new Set<string>();
    for (const d of snap.docs) {
      const a = d.data() || {};
      const status = String(a.status ?? '').toLowerCase();
      if (REMOVED_RE.test(status)) continue;
      if (!isOngoingDoc(a)) continue;
      if (entityFilter && String(a.hiringEntityId ?? '') !== entityFilter) continue;
      if (a.jobOrderId) joIds.add(String(a.jobOrderId));
      rows.push({
        assignmentId: d.id,
        userId: String(a.userId ?? a.candidateId ?? ''),
        workerName:
          [a.firstName, a.lastName].filter(Boolean).join(' ') ||
          String(a.workerDisplayName ?? 'Worker'),
        phone: String(a.phone ?? ''),
        accountName: String(a.companyName ?? ''),
        jobOrderId: String(a.jobOrderId ?? ''),
        shiftId: String(a.shiftId ?? ''),
        jobTitle: String(a.jobTitle ?? a.shiftTitle ?? ''),
        worksiteName: String(a.worksiteName ?? a.locationNickname ?? ''),
        startDate: typeof a.startDate === 'string' ? a.startDate.slice(0, 10) : null,
        // Keys are DOW indices '0'(Sun)..'6'(Sat); enabled must be exactly
        // true — same contract the grid resolver applies.
        weeklyDays:
          a.weeklySchedule && typeof a.weeklySchedule === 'object'
            ? Object.entries(a.weeklySchedule as Record<string, { enabled?: boolean }>)
                .filter(([, v]) => v && v.enabled === true)
                .map(([k]) => k)
                .sort()
            : [],
        isOpenShift: a.isOpenShift === true || a.noFixedTimes === true,
        payRate: Number(a.payRate) > 0 ? Number(a.payRate) : null,
        billRate: Number(a.billRate) > 0 ? Number(a.billRate) : null,
        status: String(a.status ?? ''),
      });
    }

    // One JO read per unique job order for the child-account label + worksite
    // address (denormalized assignment fields don't carry the address).
    const joInfo = new Map<string, { jobOrderName: string; address: string }>();
    await Promise.all(
      Array.from(joIds).map(async (joId) => {
        try {
          const jo = (await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get()).data() || {};
          const addr = jo.worksiteAddress || {};
          const address = [addr.street, addr.city, addr.state, addr.zip]
            .filter(Boolean)
            .join(', ');
          joInfo.set(joId, {
            jobOrderName: String(jo.jobOrderName ?? jo.jobTitle ?? ''),
            address,
          });
        } catch {
          /* label falls back to assignment denorm */
        }
      }),
    );
    for (const r of rows) {
      const info = joInfo.get(String(r.jobOrderId));
      if (info) {
        r.jobOrderName = info.jobOrderName;
        r.worksiteAddress = info.address;
      }
    }
    rows.sort((x, y) =>
      String(x.accountName).localeCompare(String(y.accountName)) ||
      String(x.workerName).localeCompare(String(y.workerName)),
    );
    return { rows };
  },
);
