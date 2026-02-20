/**
 * E-Verify eligibility resolver.
 * HRX E-Verify Master Plan §1.3
 * Requires: W-2, user_employments.i9Status === 'completed', assignment status in hired/active/confirmed.
 */

import * as admin from 'firebase-admin';
import { EverifyErrorCode } from './everifyErrors';

const db = admin.firestore();

const ASSIGNMENT_ELIGIBLE_STATUSES = ['active', 'confirmed', 'hired', 'placed'];
function isW2(workerType: string): boolean {
  const normalized = String(workerType || '').replace(/-/g, '').toUpperCase();
  return normalized === 'W2';
}

export interface EligibilityResult {
  eligible: boolean;
  entityId: string | null;
  userId: string | null;
  jobOrderId: string | null;
  shiftId: string | null;
  assignmentId: string | null;
  userEmploymentId: string | null;
  startDate: string;
  everifyCompanyId: string;
  requestHash: string;
  errorCode?: string;
  errorMessage?: string;
  blockingReasons: string[];
}

function addBlocking(
  result: Omit<EligibilityResult, 'blockingReasons'>,
  reasons: string[]
): EligibilityResult {
  return { ...result, blockingReasons: reasons };
}

function toDateOnly(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.split('T')[0];
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return '';
}

function hashInput(parts: string[]): string {
  const str = parts.filter(Boolean).join('|');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return `h${Math.abs(h).toString(36)}`;
}

/**
 * Resolve eligibility from assignmentId or userEmploymentId.
 * Requires: W-2, i9Status === 'completed', assignment status in hired/active/confirmed.
 */
export async function resolveEligibility(params: {
  tenantId: string;
  entityId?: string;
  userEmploymentId?: string;
  assignmentId?: string;
}): Promise<EligibilityResult> {
  const { tenantId, entityId: inputEntityId, userEmploymentId, assignmentId } = params;
  const blockingReasons: string[] = [];

  if (!tenantId) {
    return addBlocking(
      {
        eligible: false,
        entityId: null,
        userId: null,
        jobOrderId: null,
        shiftId: null,
        assignmentId: null,
        userEmploymentId: null,
        startDate: '',
        everifyCompanyId: '',
        requestHash: '',
        errorCode: EverifyErrorCode.INVALID_INPUT,
        errorMessage: 'tenantId required',
      },
      ['tenantId required']
    );
  }

  let resolvedEntityId: string | null = inputEntityId || null;
  let resolvedUserId: string | null = null;
  let resolvedJobOrderId: string | null = null;
  let resolvedShiftId: string | null = null;
  let resolvedAssignmentId: string | null = assignmentId || null;
  let startDate = '';
  let empData: Record<string, unknown> = {};
  let assignData: Record<string, unknown> = {};
  let resolvedUserEmploymentId: string | null = userEmploymentId || null;

  if (userEmploymentId) {
    const empSnap = await db.doc(`tenants/${tenantId}/user_employments/${userEmploymentId}`).get();
    if (!empSnap.exists) {
      return addBlocking(
        {
          eligible: false,
          entityId: null,
          userId: null,
          jobOrderId: null,
          shiftId: null,
          assignmentId: null,
          userEmploymentId,
          startDate: '',
          everifyCompanyId: '',
          requestHash: '',
          errorCode: EverifyErrorCode.USER_EMPLOYMENT_NOT_FOUND,
          errorMessage: `user_employments/${userEmploymentId} not found`,
        },
        ['User employment not found']
      );
    }
    empData = (empSnap.data() || {}) as Record<string, unknown>;
    resolvedEntityId = (empData.entityId as string) || resolvedEntityId;
    resolvedUserId = (empData.userId as string) || null;
    startDate = toDateOnly(empData.startDate) || '';
    resolvedAssignmentId = (empData.currentAssignmentId as string) || resolvedAssignmentId;
  }

  if (assignmentId || resolvedAssignmentId) {
    const aid = assignmentId || resolvedAssignmentId!;
    const assignSnap = await db.doc(`tenants/${tenantId}/assignments/${aid}`).get();
    if (!assignSnap.exists) {
      return addBlocking(
        {
          eligible: false,
          entityId: resolvedEntityId,
          userId: resolvedUserId,
          jobOrderId: null,
          shiftId: null,
          assignmentId: aid,
          userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
          startDate: '',
          everifyCompanyId: '',
          requestHash: '',
          errorCode: EverifyErrorCode.ASSIGNMENT_NOT_FOUND,
          errorMessage: `assignments/${aid} not found`,
        },
        ['Assignment not found']
      );
    }
    assignData = (assignSnap.data() || {}) as Record<string, unknown>;
    resolvedUserId = (assignData.userId || assignData.candidateId || resolvedUserId) as string;
    resolvedJobOrderId = (assignData.jobOrderId as string) || null;
    resolvedShiftId = (assignData.shiftId as string) || null;
    if (!startDate) startDate = toDateOnly(assignData.startDate) || '';

    const assignStatus = String(assignData.status || '').toLowerCase();
    if (!ASSIGNMENT_ELIGIBLE_STATUSES.includes(assignStatus)) {
      blockingReasons.push(
        `Assignment status must be hired, active, or confirmed (current: ${assignStatus || 'unknown'})`
      );
    }
  }

  if (!resolvedEntityId && resolvedJobOrderId) {
    const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${resolvedJobOrderId}`).get();
    if (joSnap.exists) {
      resolvedEntityId = ((joSnap.data() || {}) as Record<string, string>).entityId || null;
    }
  }

  if (!resolvedEntityId) {
    return addBlocking(
      {
        eligible: false,
        entityId: null,
        userId: resolvedUserId,
        jobOrderId: resolvedJobOrderId,
        shiftId: resolvedShiftId,
        assignmentId: resolvedAssignmentId,
        userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
        startDate,
        everifyCompanyId: '',
        requestHash: '',
        errorCode: EverifyErrorCode.ENTITY_NOT_FOUND,
        errorMessage: 'Could not resolve entityId',
      },
      [...blockingReasons, 'Could not resolve entity']
    );
  }

  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${resolvedEntityId}`).get();
  if (!entitySnap.exists) {
    return addBlocking(
      {
        eligible: false,
        entityId: resolvedEntityId,
        userId: resolvedUserId,
        jobOrderId: resolvedJobOrderId,
        shiftId: resolvedShiftId,
        assignmentId: resolvedAssignmentId,
        userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
        startDate,
        everifyCompanyId: '',
        requestHash: '',
        errorCode: EverifyErrorCode.ENTITY_NOT_FOUND,
        errorMessage: `Entity ${resolvedEntityId} not found`,
      },
      [...blockingReasons, 'Entity not found']
    );
  }

  const entity = (entitySnap.data() || {}) as Record<string, unknown>;
  const everifyRequired = Boolean(entity.everifyRequired);
  if (!everifyRequired) {
    return addBlocking(
      {
        eligible: false,
        entityId: resolvedEntityId,
        userId: resolvedUserId,
        jobOrderId: resolvedJobOrderId,
        shiftId: resolvedShiftId,
        assignmentId: resolvedAssignmentId,
        userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
        startDate,
        everifyCompanyId: '',
        requestHash: '',
        errorCode: EverifyErrorCode.ENTITY_EVERIFY_DISABLED,
        errorMessage: 'Entity does not require E-Verify',
      },
      ['Entity does not require E-Verify']
    );
  }

  if (!resolvedUserEmploymentId && resolvedUserId && resolvedEntityId) {
    const empQ = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('user_employments')
      .where('userId', '==', resolvedUserId)
      .where('entityId', '==', resolvedEntityId)
      .limit(1)
      .get();
    if (!empQ.empty) {
      const empDoc = empQ.docs[0];
      resolvedUserEmploymentId = empDoc.id;
      empData = (empDoc.data() || {}) as Record<string, unknown>;
    }
  }

  const workerType = String(empData.workerType || entity.workerType || '');
  if (!isW2(workerType)) {
    blockingReasons.push('Worker must be W-2 (E-Verify does not apply to 1099)');
  }

  const i9Status = String(empData.i9Status || '').toLowerCase();
  if (i9Status !== 'completed') {
    blockingReasons.push(
      i9Status ? `I-9 must be completed (current: ${i9Status})` : 'I-9 must be completed'
    );
  }

  const everifyCompanyId = String(
    entity.everifyCompanyId || entity.entityCode || resolvedEntityId
  );

  if (!startDate) {
    blockingReasons.push('Start date required');
  }

  if (!resolvedUserId) {
    blockingReasons.push('User ID required');
  }

  if (blockingReasons.length > 0) {
    return addBlocking(
      {
        eligible: false,
        entityId: resolvedEntityId,
        userId: resolvedUserId,
        jobOrderId: resolvedJobOrderId,
        shiftId: resolvedShiftId,
        assignmentId: resolvedAssignmentId,
        userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
        startDate,
        everifyCompanyId,
        requestHash: '',
        errorCode: EverifyErrorCode.NOT_ELIGIBLE,
        errorMessage: blockingReasons.join('; '),
      },
      blockingReasons
    );
  }

  const requestHash = hashInput([
    tenantId,
    resolvedEntityId,
    resolvedUserId,
    resolvedUserEmploymentId || '',
    resolvedAssignmentId || '',
    startDate,
  ]);

  return addBlocking(
    {
      eligible: true,
      entityId: resolvedEntityId,
      userId: resolvedUserId,
      jobOrderId: resolvedJobOrderId,
      shiftId: resolvedShiftId,
      assignmentId: resolvedAssignmentId,
      userEmploymentId: resolvedUserEmploymentId || userEmploymentId || null,
      startDate,
      everifyCompanyId,
      requestHash,
    },
    []
  );
}
