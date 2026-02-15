import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type AssignmentDecision = 'accept' | 'decline';

function toDateOnly(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value.split('T')[0];
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return '';
}

function parseMinutes(time?: string): number | null {
  if (!time || typeof time !== 'string' || !time.includes(':')) return null;
  const [h, m] = time.split(':').map((part) => parseInt(part, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function overlapsSameDay(aStart: number | null, aEnd: number | null, bStart: number | null, bEnd: number | null): boolean {
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
  const normalizedAEnd = aEnd < aStart ? aEnd + 24 * 60 : aEnd;
  const normalizedBEnd = bEnd < bStart ? bEnd + 24 * 60 : bEnd;
  return aStart < normalizedBEnd && bStart < normalizedAEnd;
}

function canManageAssignmentsFromClaims(auth: any, tenantId: string): boolean {
  const roles = auth?.token?.roles || {};
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  if (auth?.token?.isHRX === true) return true;
  return false;
}

async function canManageAssignments(auth: any, tenantId: string, uid: string): Promise<boolean> {
  if (canManageAssignmentsFromClaims(auth, tenantId)) return true;

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return false;
  const userData: any = userSnap.data() || {};

  const tenantMeta = userData?.tenantIds?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return true;

  const recruiterEnabled = Boolean(tenantMeta.recruiter ?? userData.recruiter);
  if (recruiterEnabled) return true;

  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return true;

  return false;
}

async function resolveApplicationForAssignment(args: {
  tenantId: string;
  jobOrderId: string;
  shiftId: string;
  userId: string;
  createdBy: string;
  assignmentId: string;
  jobPostId?: string;
}) {
  const { tenantId, jobOrderId, shiftId, userId, createdBy, assignmentId, jobPostId } = args;
  const applicationsRef = db.collection(`tenants/${tenantId}/applications`);

  const [byShiftSnap, byShiftIdsSnap] = await Promise.all([
    applicationsRef
      .where('userId', '==', userId)
      .where('jobOrderId', '==', jobOrderId)
      .where('shiftId', '==', shiftId)
      .limit(1)
      .get(),
    applicationsRef
      .where('userId', '==', userId)
      .where('jobOrderId', '==', jobOrderId)
      .where('shiftIds', 'array-contains', shiftId)
      .limit(1)
      .get(),
  ]);

  const existing = byShiftSnap.docs[0] || byShiftIdsSnap.docs[0];
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (existing) {
    const data = existing.data() || {};
    const nextShiftIds = Array.isArray(data.shiftIds) ? Array.from(new Set([...data.shiftIds, shiftId])) : [shiftId];
    await existing.ref.set(
      {
        status: 'accepted',
        assignmentId,
        shiftId: data.shiftId || shiftId,
        shiftIds: nextShiftIds,
        updatedAt: now,
        updatedBy: createdBy,
      },
      { merge: true },
    );
    return existing.id;
  }

  const created = await applicationsRef.add({
    tenantId,
    jobOrderId,
    userId,
    jobId: jobPostId || null,
    postId: jobPostId || null,
    status: 'accepted',
    shiftId,
    shiftIds: [shiftId],
    source: 'manual',
    assignmentId,
    candidate: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  });

  return created.id;
}

export const placementsCreateAssignments = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const {
    tenantId,
    jobOrderId,
    shiftId,
    userIds,
    sourceType = 'manual',
    sourceId = null,
  } = (request.data || {}) as {
    tenantId?: string;
    jobOrderId?: string;
    shiftId?: string;
    userIds?: string[];
    sourceType?: string;
    sourceId?: string | null;
  };

  if (!tenantId || !jobOrderId || !shiftId || !Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpsError('invalid-argument', 'tenantId, jobOrderId, shiftId, and userIds[] are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to assign workers');
  }

  const createdBy = request.auth.uid;
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

  const [jobOrderSnap, shiftSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get(),
    db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`).get(),
  ]);

  if (!jobOrderSnap.exists) throw new HttpsError('not-found', 'Job order not found');
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found');

  const jobOrder = jobOrderSnap.data() || {};
  const shift = shiftSnap.data() || {};
  const shiftDate = toDateOnly(shift.shiftDate);
  const shiftEndDate = toDateOnly(shift.endDate) || shiftDate;
  const shiftStartMin = parseMinutes(shift.startTime || shift.defaultStartTime);
  const shiftEndMin = parseMinutes(shift.endTime || shift.defaultEndTime);

  const locationId = jobOrder.worksiteId || jobOrder.locationId;
  const locationSnap = locationId
    ? await db.doc(`tenants/${tenantId}/locations/${locationId}`).get()
    : null;
  const locationData = locationSnap?.exists ? locationSnap.data() || {} : {};
  const latitude = locationData.latitude ?? locationData.lat ?? 0;
  const longitude = locationData.longitude ?? locationData.lng ?? 0;
  const locationNickname = locationData.nickname || locationData.title || locationData.name || locationData.locationName || jobOrder.worksiteName || '';

  const postingSnap = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', jobOrderId)
    .limit(1)
    .get();
  const jobPostId = postingSnap.docs[0]?.id;

  const created: Array<{ userId: string; assignmentId: string; warnings: string[] }> = [];
  const skipped: Array<{ userId: string; reason: string }> = [];
  const failed: Array<{ userId: string; error: string }> = [];

  for (const userId of uniqueUserIds) {
    try {
      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) {
        skipped.push({ userId, reason: 'user_not_found' });
        continue;
      }
      const userData = userSnap.data() || {};
      const warnings: string[] = [];

      const existingShiftAssignments = await db
        .collection(`tenants/${tenantId}/assignments`)
        .where('userId', '==', userId)
        .where('shiftId', '==', shiftId)
        .limit(5)
        .get();
      const hasExistingForShift = existingShiftAssignments.docs.some((docSnap) => {
        const s = String((docSnap.data() || {}).status || '').toLowerCase();
        return !['declined', 'canceled', 'cancelled'].includes(s);
      });
      if (hasExistingForShift) {
        skipped.push({ userId, reason: 'already_assigned_to_shift' });
        continue;
      }

      const activeAssignments = await db
        .collection(`tenants/${tenantId}/assignments`)
        .where('userId', '==', userId)
        .where('status', 'in', ['proposed', 'confirmed', 'active'])
        .get();

      let blockedByOverlap = false;
      let sameDayDifferentShift = false;
      activeAssignments.docs.forEach((docSnap) => {
        const assignment = docSnap.data() || {};
        const assignmentShiftId = assignment.shiftId;
        if (assignmentShiftId === shiftId) return;

        const assignmentStartDate = toDateOnly(assignment.startDate);
        if (assignmentStartDate !== shiftDate) return;

        const existingStart = parseMinutes(assignment.startTime);
        const existingEnd = parseMinutes(assignment.endTime);
        if (overlapsSameDay(shiftStartMin, shiftEndMin, existingStart, existingEnd)) {
          blockedByOverlap = true;
          return;
        }
        sameDayDifferentShift = true;
      });

      if (blockedByOverlap) {
        skipped.push({ userId, reason: 'overlapping_assignment' });
        continue;
      }
      if (sameDayDifferentShift) {
        warnings.push('same_day_second_shift_warning');
      }

      const assignmentRef = db.collection(`tenants/${tenantId}/assignments`).doc(`${shiftId}__${userId}`);
      const assignmentDoc = await assignmentRef.get();
      const existingStatus = assignmentDoc.exists ? String((assignmentDoc.data() || {}).status || '').toLowerCase() : '';
      if (assignmentDoc.exists && !['canceled', 'cancelled', 'declined'].includes(existingStatus)) {
        skipped.push({ userId, reason: 'duplicate_assignment_key' });
        continue;
      }

      const firstName = String(userData.firstName || '').trim() || String(userData.displayName || '').split(' ')[0] || '';
      const lastName =
        String(userData.lastName || '').trim() ||
        String(userData.displayName || '')
          .split(' ')
          .slice(1)
          .join(' ')
          .trim() ||
        '';

      const isReactivating = assignmentDoc.exists && ['canceled', 'cancelled', 'declined'].includes(existingStatus);

      if (isReactivating) {
        await assignmentRef.set(
          {
            status: 'proposed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            // Clear cancellation fields
            canceledAt: admin.firestore.FieldValue.delete(),
            cancellationReason: admin.firestore.FieldValue.delete(),
            declinedAt: admin.firestore.FieldValue.delete(),
            declinedBy: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        );
      } else {
        const assignmentData: any = {
          tenantId,
          jobOrderId,
          shiftId,
          candidateId: userId,
          userId,
          status: 'proposed',
          startDate: shiftDate || '',
          endDate: shiftEndDate || shiftDate || '',
          startTime: shift.startTime || shift.defaultStartTime || '',
          endTime: shift.endTime || shift.defaultEndTime || '',
          payRate: Number(shift.payRate ?? jobOrder.payRate ?? 0),
          billRate: Number(shift.billRate ?? jobOrder.billRate ?? 0),
          timesheetMode: jobOrder.timesheetMode || 'mobile',
          firstName,
          lastName,
          email: userData.email || '',
          phone: userData.phone || userData.phoneE164 || '',
          companyId: jobOrder.companyId || '',
          companyName: jobOrder.companyName || '',
          companyTitle: jobOrder.companyName || '',
          locationId: locationId || '',
          locationIds: locationId ? [locationId] : [],
          locationNickname,
          worksiteName: locationNickname,
          latitude,
          longitude,
          jobOrderType: jobOrder.jobType || 'gig',
          jobTitle: shift.defaultJobTitle || jobOrder.jobTitle || '',
          shiftTitle: shift.shiftTitle || '',
          assignmentSource: sourceType,
          sourceGroupId: sourceType === 'group' ? sourceId : null,
          placementMode: 'assign_now',
          jobPostId: jobPostId || null,
          createdBy,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await assignmentRef.set(assignmentData, { merge: false });
        const applicationId = await resolveApplicationForAssignment({
          tenantId,
          jobOrderId,
          shiftId,
          userId,
          createdBy,
          assignmentId: assignmentRef.id,
          jobPostId,
        });

        await assignmentRef.set(
          {
            applicationId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      created.push({ userId, assignmentId: assignmentRef.id, warnings });
    } catch (error: any) {
      failed.push({ userId, error: error?.message || 'unknown_error' });
    }
  }

  return {
    success: failed.length === 0,
    created,
    skipped,
    failed,
  };
});

export const respondToAssignment = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { tenantId, assignmentId, decision } = (request.data || {}) as {
    tenantId?: string;
    assignmentId?: string;
    decision?: AssignmentDecision;
  };

  if (!tenantId || !assignmentId || !decision || !['accept', 'decline'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'tenantId, assignmentId, and decision (accept|decline) are required');
  }

  const uid = request.auth.uid;
  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();

  if (!assignmentSnap.exists) throw new HttpsError('not-found', 'Assignment not found');
  const assignment = assignmentSnap.data() || {};
  if (assignment.userId !== uid && assignment.candidateId !== uid) {
    throw new HttpsError('permission-denied', 'This assignment does not belong to the current user');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const applicationId = assignment.applicationId as string | undefined;
  const applicationRef = applicationId ? db.doc(`tenants/${tenantId}/applications/${applicationId}`) : null;

  if (decision === 'accept') {
    await assignmentRef.set(
      {
        status: 'confirmed',
        confirmedAt: now,
        confirmedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );
    if (applicationRef) {
      await applicationRef.set(
        {
          status: 'confirmed',
          confirmedAt: now,
          confirmedBy: uid,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );
    }
    return { success: true, status: 'confirmed' };
  }

  await assignmentRef.set(
    {
      status: 'declined',
      declinedAt: now,
      declinedBy: uid,
      updatedAt: now,
      updatedBy: uid,
    },
    { merge: true },
  );
  if (applicationRef) {
    await applicationRef.set(
      {
        status: 'withdrawn',
        withdrawnAt: now,
        withdrawnBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );
  }
  return { success: true, status: 'declined' };
});

/**
 * Cancel an assignment and revert to Placed state.
 * Deletes the assignment and creates a placement so the worker shows as "Placed" again.
 * For testing / recruiter use.
 */
export const placementsCancelAssignment = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const {
    tenantId,
    assignmentId,
    shiftId,
    userId,
  } = (request.data || {}) as {
    tenantId?: string;
    assignmentId?: string;
    shiftId?: string;
    userId?: string;
  };

  if (!tenantId || !assignmentId || !shiftId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, assignmentId, shiftId, and userId are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to cancel assignments');
  }

  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    throw new HttpsError('not-found', 'Assignment not found');
  }
  const assignmentData = assignmentSnap.data() || {};
  if (assignmentData.userId !== userId || assignmentData.shiftId !== shiftId) {
    throw new HttpsError('invalid-argument', 'Assignment does not match userId/shiftId');
  }

  const placementId = `${shiftId}__${userId}`;
  const placementRef = db.doc(`tenants/${tenantId}/placements/${placementId}`);

  // Update assignment to cancelled first so Firestore onUpdate trigger sends cancellation message (SMS/email/push)
  await assignmentRef.set(
    {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      canceledBy: request.auth!.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.runTransaction(async (tx) => {
    tx.delete(assignmentRef);
    tx.set(placementRef, {
      tenantId,
      jobOrderId: assignmentData.jobOrderId,
      shiftId,
      userId,
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

/**
 * Resend accept/decline offer (SMS, push, email) for an assignment.
 * Updates lastReminderSentAt on the assignment and sends the same notification as assignment_created.
 */
export const resendAssignmentOffer = onCall(
  {
    cors: [
      'http://localhost:3000',
      'https://hrx1-d3beb.web.app',
      'https://hrx1-d3beb.firebaseapp.com',
      'https://hrxone.com',
      'https://www.hrxone.com',
    ],
  },
  async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { tenantId, assignmentId } = (request.data || {}) as { tenantId?: string; assignmentId?: string };
  if (!tenantId || !assignmentId) {
    throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required');
  }
  if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Insufficient permissions to resend assignment offer');
  }

  const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    throw new HttpsError('not-found', 'Assignment not found');
  }
  const assignment = assignmentSnap.data() || {};
  const userId = assignment.userId || assignment.candidateId;
  if (!userId) {
    throw new HttpsError('invalid-argument', 'Assignment has no userId');
  }

  await assignmentRef.set(
    {
      lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const userDoc = await db.doc(`users/${userId}`).get();
  const userData = userDoc.data() || {};
  const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
  let jobTitle = assignment.jobTitle || 'a position';
  let checkInInstructions = '';

  if (assignment.jobOrderId) {
    try {
      const jobOrderDoc = await db.doc(`tenants/${tenantId}/job_orders/${assignment.jobOrderId}`).get();
      const jobOrderData = jobOrderDoc.data();
      if (jobOrderData?.jobTitle) jobTitle = jobOrderData.jobTitle;
      if (jobOrderData?.checkInInstructions) checkInInstructions = String(jobOrderData.checkInInstructions);
    } catch (_) {
      /* ignore */
    }
  }

  let dateTimeInfo = '';
  if (assignment.startDate) {
    const startDate =
      assignment.startDate?.toDate ? assignment.startDate.toDate() : new Date(assignment.startDate);
    dateTimeInfo = ` on ${startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    if (assignment.startTime && assignment.endTime) {
      dateTimeInfo += ` from ${assignment.startTime} - ${assignment.endTime}`;
    }
  }

  const firstName = assignment.firstName || userData.firstName || 'there';
  const worksiteName = assignment.locationNickname || assignment.worksiteName || '';
  const locationText = worksiteName ? ` at ${worksiteName}` : '';
  const postingPath = assignment.jobPostId
    ? `/c1/jobs-board/${assignment.jobPostId}?assignmentId=${assignmentId}&shiftId=${assignment.shiftId || ''}&intent=assignment_response`
    : '/c1/jobs-board';
  const jobUrl = `https://hrxone.com${postingPath}`;
  const instructionsText = checkInInstructions ? ` Check-in: ${checkInInstructions}` : '';
  const message = `Hi ${firstName}, your application has been accepted for ${jobTitle}${dateTimeInfo}${locationText}. View details and respond: ${jobUrl}.${instructionsText}`;

  let emailSubject: string | undefined;
  let emailBody: string | undefined;
  try {
    const { buildAssignmentDetailsEmail } = await import('./messaging/assignmentDetailsEmail');
    const emailResult = await buildAssignmentDetailsEmail(tenantId, assignmentId);
    if (emailResult) {
      emailSubject = emailResult.subject;
      emailBody = emailResult.html;
    }
  } catch (_) {
    /* continue without email body */
  }

  const { sendLegacyAssignmentMessage } = await import('./messaging/legacyMessageHelpers');
  const result = await sendLegacyAssignmentMessage({
    tenantId,
    userId,
    phoneE164: phoneE164 || '+0000000000',
    message,
    messageTypeId: 'assignment_created',
    source: 'assignment_created',
    sourceId: assignmentId,
    assignmentId,
    emailSubject,
    emailBody,
  });

  return { success: result.success, error: result.error };
});
