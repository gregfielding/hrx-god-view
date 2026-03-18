import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { accusourceClient } from './accusourceClient';
import { getAccusourceConfig } from './config';
import {
  buildPartialProfilePayload,
  parseProviderCreateResponse,
  type CreateBackgroundCheckInput,
} from './mapper';
import type { BackgroundCheckDocument } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function normalizeStatus(status: string | null): 'submitted' | 'awaiting_applicant' {
  const s = String(status || '').toLowerCase();
  if (s.includes('await') || s.includes('applicant') || s.includes('invite') || s.includes('portal')) {
    return 'awaiting_applicant';
  }
  return 'submitted';
}

async function ensureAdminOperator(uid: string): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const data = userSnap.data() || {};
  const role = String((data as Record<string, unknown>).role || '').toLowerCase();
  const securityLevelRaw = (data as Record<string, unknown>).securityLevel;
  const securityLevel = Number.parseInt(String(securityLevelRaw || '0'), 10) || 0;
  const isAdminRole = role === 'admin' || role === 'super_admin' || role === 'manager';
  if (!isAdminRole && securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Admin privileges required.');
  }
}

function buildDraftDocument(
  input: CreateBackgroundCheckInput,
  backgroundCheckId: string,
  uid: string,
  providerEnvironment: 'sandbox' | 'production',
): BackgroundCheckDocument & Record<string, unknown> {
  const clientId = `HRX-BGC-${backgroundCheckId}`;
  return {
    provider: 'accusource',
    providerEnvironment,
    tenantId: input.tenantId || null,
    accountId: input.accountId || null,
    accountName: input.accountName || null,
    candidateId: input.candidateId || null,
    candidateName: input.candidateName || null,
    applicantId: input.applicantId || null,
    jobOrderId: input.jobOrderId || null,
    worksiteId: input.worksiteId || null,
    clientId,
    providerClientId: clientId,
    orderMode: 'partial_profile',
    hrxStatus: 'draft',
    providerStatus: null,
    finalReportReady: false,
    drugReportReady: false,
    profileCompleted: false,
    orderCompleted: false,
    createdBy: uid,
    requestedPackageId: input.requestedPackageId || null,
    requestedPackageName: input.requestedPackageName || null,
    requestedServices: Array.isArray(input.requestedServices) ? input.requestedServices : [],
    syncError: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

type CallablePayload = CreateBackgroundCheckInput & {
  backgroundCheckId?: string;
};

async function createBackgroundCheckInternal(
  input: CallablePayload,
  uid: string,
): Promise<{
  ok: true;
  backgroundCheckId: string;
  clientId: string;
  providerProfileId: string | null;
  providerClientId: string;
  applicantPortalLink: string | null;
  hrxStatus: 'submitted' | 'awaiting_applicant';
}> {
  const config = getAccusourceConfig();
  if (!config.enabled) {
    throw new HttpsError('failed-precondition', 'AccuSource integration is disabled.');
  }

  const docRef = input.backgroundCheckId
    ? db.collection('backgroundChecks').doc(String(input.backgroundCheckId))
    : db.collection('backgroundChecks').doc();
  const backgroundCheckId = docRef.id;
  const clientId = `HRX-BGC-${backgroundCheckId}`;

  const draftDoc = buildDraftDocument(
    input,
    backgroundCheckId,
    uid,
    config.environment,
  );
  await docRef.set(draftDoc, { merge: true });
  await docRef.collection('events').doc(`create_draft_${Date.now()}`).set({
    type: 'CREATE_DRAFT',
    source: 'manual_sync',
    payload: { initiatedBy: uid },
    processingStatus: 'processed',
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const providerPayload = buildPartialProfilePayload(input, clientId, backgroundCheckId);
    const providerResponse = await accusourceClient.createPartialProfile(providerPayload);
    const parsed = parseProviderCreateResponse(providerResponse);
    const nextStatus = normalizeStatus(parsed.providerStatus);

    await docRef.set({
      providerProfileId: parsed.providerProfileId,
      providerClientId: parsed.providerClientId || clientId,
      applicantPortalLink: parsed.applicantPortalLink,
      providerStatus: parsed.providerStatus,
      hrxStatus: nextStatus,
      syncError: null,
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastProviderProfileSnapshot: parsed.raw,
    }, { merge: true });

    await docRef.collection('events').doc(`create_submitted_${Date.now()}`).set({
      type: 'CREATE_SUBMITTED',
      source: 'manual_sync',
      providerProfileId: parsed.providerProfileId,
      providerClientId: parsed.providerClientId || clientId,
      payload: parsed.raw,
      processingStatus: 'processed',
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      backgroundCheckId,
      clientId,
      providerProfileId: parsed.providerProfileId,
      providerClientId: parsed.providerClientId || clientId,
      applicantPortalLink: parsed.applicantPortalLink,
      hrxStatus: nextStatus,
    };
  } catch (error: any) {
    const message = error?.message || 'Failed to create SourceDirect partial profile.';
    logger.error('[accusource:create] failed', { backgroundCheckId, error: message });

    await docRef.set({
      hrxStatus: 'error',
      syncError: message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await docRef.collection('events').doc(`create_error_${Date.now()}`).set({
      type: 'CREATE_ERROR',
      source: 'manual_sync',
      payload: { error: message },
      processingStatus: 'error',
      processingError: message,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new HttpsError('internal', message);
  }
}

export const createAccusourceBackgroundCheck = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  await ensureAdminOperator(request.auth.uid);

  const input = (request.data || {}) as CallablePayload;
  return createBackgroundCheckInternal(input, request.auth.uid);
});

/**
 * Admin-only test path for Phase 2 validation without UI.
 * Creates a mock background check and submits SourceDirect partial profile.
 */
export const testCreateAccusourceBackgroundCheck = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  await ensureAdminOperator(request.auth.uid);

  const now = Date.now();
  const mockPayload: CallablePayload = {
    tenantId: String(request.data?.tenantId || ''),
    accountId: String(request.data?.accountId || 'test-account'),
    accountName: String(request.data?.accountName || 'Test Account'),
    candidateId: String(request.data?.candidateId || `test-candidate-${now}`),
    candidateName: String(request.data?.candidateName || 'Test Candidate'),
    applicantId: String(request.data?.applicantId || `test-applicant-${now}`),
    jobOrderId: String(request.data?.jobOrderId || ''),
    worksiteId: String(request.data?.worksiteId || ''),
    requestedPackageId: String(request.data?.requestedPackageId || ''),
    requestedPackageName: String(request.data?.requestedPackageName || ''),
    requestedServices: Array.isArray(request.data?.requestedServices) ? request.data.requestedServices : [],
    candidate: {
      firstName: String(request.data?.candidate?.firstName || 'Test'),
      lastName: String(request.data?.candidate?.lastName || 'Worker'),
      email: String(request.data?.candidate?.email || `test.worker.${now}@example.com`),
      phone: String(request.data?.candidate?.phone || ''),
      dateOfBirth: String(request.data?.candidate?.dateOfBirth || ''),
    },
  };

  const result = await createBackgroundCheckInternal(mockPayload, request.auth.uid);

  return {
    ok: true,
    mode: 'phase2_test_create',
    result,
  };
});

