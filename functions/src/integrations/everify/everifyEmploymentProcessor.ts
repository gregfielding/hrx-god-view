/**
 * Shared logic for creating an E-Verify case from a user_employment (HTTP worker + callables).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { resolveEligibility } from './everifyEligibility';
import { createAndSubmitCase } from './everifyService';
import { EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD } from './everifySecrets';
import { OPEN_EVERIFY_CASE_STATUSES, requestHashCollisionBlocksCreate } from './everifyErrors';

const db = admin.firestore();

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

export type EverifyEmploymentProcessResult =
  | { ok: true; caseId: string; everifyCaseNumber?: string; status?: string }
  | { ok: false; reason: string };

/**
 * Resolve eligibility, dedupe by employment + requestHash, then create/submit case.
 * Same behavior as the Cloud Tasks HTTP worker body.
 */
export async function processEverifyCaseFromEmploymentPayload(input: {
  tenantId: string;
  userEmploymentId: string;
}): Promise<EverifyEmploymentProcessResult> {
  const { tenantId, userEmploymentId } = input;

  const eligibility = await resolveEligibility({
    tenantId,
    userEmploymentId,
  });

  if (!eligibility.eligible) {
    logger.info(`E-Verify not eligible for employment ${userEmploymentId}: ${eligibility.errorMessage}`);
    return { ok: false as const, reason: eligibility.errorMessage || 'Not eligible' };
  }

  const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');

  if (eligibility.userEmploymentId) {
    const openByEmployment = await casesRef
      .where('userEmploymentId', '==', eligibility.userEmploymentId)
      .where('status', 'in', [...OPEN_EVERIFY_CASE_STATUSES])
      .limit(1)
      .get();
    if (!openByEmployment.empty) {
      logger.info(`E-Verify case already exists for employment ${userEmploymentId}`);
      return { ok: false as const, reason: 'Open case already exists' };
    }
  }

  const dupHash = await casesRef.where('requestHash', '==', eligibility.requestHash).limit(1).get();
  if (!dupHash.empty) {
    const st = dupHash.docs[0].data()?.status;
    if (requestHashCollisionBlocksCreate(st)) {
      logger.info(`E-Verify duplicate requestHash for employment ${userEmploymentId}`);
      return { ok: false as const, reason: 'Duplicate case' };
    }
  }

  const result = await createAndSubmitCase({
    tenantId,
    entityId: eligibility.entityId!,
    userId: eligibility.userId!,
    jobOrderId: eligibility.jobOrderId,
    shiftId: eligibility.shiftId,
    assignmentId: eligibility.assignmentId,
    userEmploymentId: eligibility.userEmploymentId,
    startDate: eligibility.startDate,
    everifyCompanyId: eligibility.everifyCompanyId,
    requestHash: eligibility.requestHash,
    icaCredentials: getIcaCredentials(),
    legacyCredentials: null,
  });

  logger.info(`Created E-Verify case ${result.caseId} for employment ${userEmploymentId}`);
  return {
    ok: true as const,
    caseId: result.caseId,
    everifyCaseNumber: result.everifyCaseNumber,
    status: result.status,
  };
}
