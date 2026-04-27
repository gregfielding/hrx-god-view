/**
 * Local-only screening order when ENABLE_SCREENING_ORDER is false.
 * Writes a backgroundChecks doc shaped like a post-create order (no AccuSource API).
 */
import * as admin from 'firebase-admin';
import type { CreateBackgroundCheckInput } from '../integrations/accusource/mapper';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export async function writeSimulatedAutomationBackgroundCheck(args: {
  orderPayload: CreateBackgroundCheckInput;
  assignmentId: string;
  tenantId: string;
  fingerprint: string;
  actorUid: string;
}): Promise<{ backgroundCheckId: string }> {
  const { orderPayload: inp, assignmentId, tenantId, fingerprint, actorUid } = args;
  const docRef = db.collection('backgroundChecks').doc();
  const backgroundCheckId = docRef.id;
  const clientId = `HRX-BGC-${backgroundCheckId}`;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await docRef.set({
    provider: 'accusource',
    providerEnvironment: 'sandbox',
    tenantId: inp.tenantId || null,
    accountId: inp.accountId ?? null,
    accountName: inp.accountName ?? null,
    candidateId: inp.candidateId ?? null,
    candidateName: inp.candidateName ?? null,
    jobOrderId: inp.jobOrderId ?? null,
    worksiteId: inp.worksiteId ?? null,
    clientId,
    providerClientId: clientId,
    orderMode: 'partial_profile',
    hrxStatus: 'awaiting_applicant',
    providerStatus: 'simulated_automation',
    screeningOrderSimulated: true,
    profileCompleted: false,
    orderCompleted: false,
    finalReportReady: false,
    drugReportReady: false,
    requestedPackageId: inp.requestedPackageId ?? null,
    requestedPackageName: inp.requestedPackageName ?? null,
    requestedServices: Array.isArray(inp.requestedServices) ? inp.requestedServices : [],
    syncError: null,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
    automationSource: 'assignment_confirmed',
    automationAssignmentId: assignmentId,
    automationTenantId: tenantId,
    automationFingerprint: fingerprint,
    automationOrderedAt: now,
  });

  return { backgroundCheckId };
}
