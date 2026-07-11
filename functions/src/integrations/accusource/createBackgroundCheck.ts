import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { accusourceClient } from './accusourceClient';
import { getAccusourceConfig, isAccusourceProductionValidationHrxOnly } from './config';
import { accusourceLog } from './accusourceLogger';
import {
  buildPartialProfilePayload,
  normalizeRequestedServicesCatalog,
  parseProviderCreateResponse,
  type CreateBackgroundCheckInput,
} from './mapper';
import type { BackgroundCheckDocument } from './types';
import {
  assertAccusourceProductionOrderPolicy,
  ensureAccusourceAdmin,
  type AccusourceOrderInvocation,
} from './accusourceAdminGate';
import {
  evaluateScreeningSatisfiedServer,
  requestedEquivalencyKey,
  type BgLike,
} from '../../compliance/screeningAutomationShared';

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

function buildDraftDocument(
  input: CreateBackgroundCheckInput,
  backgroundCheckId: string,
  uid: string,
  providerEnvironment: 'sandbox' | 'production',
): BackgroundCheckDocument & Record<string, unknown> {
  const clientId = `HRX-BGC-${backgroundCheckId}`;
  const catalog = normalizeRequestedServicesCatalog(input.requestedServicesCatalog);
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
    ...(catalog ? { requestedServicesCatalog: catalog } : {}),
    syncError: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

type CallablePayload = CreateBackgroundCheckInput & {
  backgroundCheckId?: string;
  /** Recruiter explicitly confirmed ordering DESPITE an existing satisfied
   *  equivalent package (duplicate-guard override, e.g. an account demands
   *  a fresh run). */
  allowDuplicateOfSatisfied?: boolean;
};

/**
 * Shared by callable and assignment-confirmed automation.
 * Callers that bypass the admin gate must validate trust (e.g. Firestore triggers only).
 */
export async function createBackgroundCheckInternal(
  input: CallablePayload,
  uid: string,
  invocation: AccusourceOrderInvocation,
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

  const productionValidationHrxOnlyActive =
    config.environment === 'production' && isAccusourceProductionValidationHrxOnly();
  const hrxClaim =
    invocation.type === 'callable' ? invocation.auth.token?.hrx === true : undefined;

  accusourceLog('info', 'create', 'createBackgroundCheckInternal: order attempt (pre-policy)', {
    callerUid: uid,
    invocationType: invocation.type,
    hrxClaim,
    productionValidationHrxOnlyActive,
  });

  await assertAccusourceProductionOrderPolicy(invocation, uid, input.tenantId);

  // Duplicate guard (Greg 2026-07-11): if this worker already has a
  // completed order satisfying the SAME package (equivalency-key match,
  // within the validity window), PAUSE instead of ordering — the same rule
  // the assignment automation applies before it ever calls this function
  // (`skipped_already_satisfied`). Manual/callable orders only: the
  // automation runs its own evaluation with its own audit trail. The client
  // surfaces the structured details and may override with
  // `allowDuplicateOfSatisfied: true`. À-la-carte single-service re-orders
  // carry no package → key 'unknown' → guard doesn't apply.
  const requestedKey = requestedEquivalencyKey(
    String(input.requestedPackageId || ''),
    String(input.requestedPackageName || ''),
  );
  if (
    invocation.type === 'callable' &&
    input.allowDuplicateOfSatisfied !== true &&
    requestedKey !== 'unknown' &&
    input.candidateId
  ) {
    let priorQuery = db
      .collection('backgroundChecks')
      .where('candidateId', '==', String(input.candidateId));
    if (input.tenantId) {
      priorQuery = priorQuery.where('tenantId', '==', String(input.tenantId));
    }
    const priorSnap = await priorQuery.limit(25).get();
    for (const doc of priorSnap.docs) {
      const ev = evaluateScreeningSatisfiedServer(doc.data() as BgLike, {
        requestedEquivalencyKey: requestedKey,
        enforceEquivalency: true,
        enforceValidityWindow: true,
      });
      if (!ev.satisfied) continue;
      const row = doc.data() as Record<string, unknown>;
      const packageLabel =
        [row.requestedPackageName, row.requestedPackageId].filter(Boolean).join(' · ') || null;
      accusourceLog('info', 'create', 'duplicate guard paused order — requirement already satisfied', {
        callerUid: uid,
        candidateId: input.candidateId,
        existingBackgroundCheckId: doc.id,
        requestedKey,
      });
      throw new HttpsError(
        'failed-precondition',
        `This worker already has a completed screening that satisfies ${
          packageLabel || 'this package'
        } (order ${doc.id}, still within its validity window). No new order was placed — use "Order anyway" if a duplicate is really needed.`,
        {
          code: 'screening_already_satisfied',
          backgroundCheckId: doc.id,
          packageLabel,
          decisionDetail: ev.decisionDetail,
        },
      );
    }
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
    let providerPayload;
    try {
      providerPayload = buildPartialProfilePayload(input, clientId, backgroundCheckId);
    } catch (validationError: unknown) {
      const msg =
        validationError instanceof Error ? validationError.message : String(validationError);
      await docRef.set(
        {
          hrxStatus: 'error',
          syncError: msg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      throw new HttpsError('invalid-argument', msg);
    }

    const providerResponse = await accusourceClient.createPartialProfile(providerPayload);
    const parsed = parseProviderCreateResponse(providerResponse);
    const nextStatus = normalizeStatus(parsed.providerStatus);

    await docRef.set({
      providerProfileId: parsed.providerProfileId,
      providerProfileNumber: parsed.providerProfileNumber,
      providerSubjectId: parsed.providerSubjectId,
      providerClientId: parsed.providerClientId || clientId,
      applicantPortalLink: parsed.applicantPortalLink,
      applicantPortalUrl: parsed.applicantPortalLink,
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

    accusourceLog('info', 'create', 'createPartialProfile succeeded', {
      callerUid: uid,
      backgroundCheckId,
      hrxStatus: nextStatus,
      hasPortalLink: Boolean(parsed.applicantPortalLink),
      hrxClaim,
      productionValidationHrxOnlyActive,
      /** Proof fields for sandbox / approval (no PII). */
      requestedPackageId: input.requestedPackageId ?? null,
      v2PackageIdSent: providerPayload.packageId,
      v2AddonServiceIdsSent:
        Array.isArray(providerPayload.orders) && providerPayload.orders.length > 0
          ? providerPayload.orders.map((o) => o.serviceId)
          : null,
      clientIdSent: clientId,
      providerProfileId: parsed.providerProfileId,
      providerProfileNumber: parsed.providerProfileNumber,
      providerSubjectId: parsed.providerSubjectId,
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
  } catch (error: unknown) {
    if (error instanceof HttpsError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : 'Failed to create SourceDirect partial profile.';
    accusourceLog('error', 'create', 'createPartialProfile failed', {
      callerUid: uid,
      backgroundCheckId,
      error: message,
      hrxClaim,
      productionValidationHrxOnlyActive,
    });

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
  const raw = (request.data || {}) as CallablePayload;
  const tenantForGate = String(raw.tenantId || '').trim() || undefined;
  await ensureAccusourceAdmin(request.auth.uid, tenantForGate);

  const input = raw;
  return createBackgroundCheckInternal(input, request.auth.uid, {
    type: 'callable',
    auth: request.auth,
  });
});

/**
 * Admin-only test path for Phase 2 validation without UI.
 * Creates a mock background check and submits SourceDirect partial profile.
 */
export const testCreateAccusourceBackgroundCheck = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const tenantForGate = String((request.data as { tenantId?: string })?.tenantId || '').trim() || undefined;
  await ensureAccusourceAdmin(request.auth.uid, tenantForGate);

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

  const result = await createBackgroundCheckInternal(mockPayload, request.auth.uid, {
    type: 'callable',
    auth: request.auth,
  });

  return {
    ok: true,
    mode: 'phase2_test_create',
    result,
  };
});

