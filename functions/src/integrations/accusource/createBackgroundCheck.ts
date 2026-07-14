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
  DEFAULT_SCREENING_VALIDITY_DAYS,
  evaluateScreeningSatisfiedServer,
  requestedEquivalencyKey,
  type BgLike,
} from '../../compliance/screeningAutomationShared';
import { writeWorkerActivityLog } from '../../compliance/workerActivityLog';

/** Normalized match key for a screening service — NAME-based, because the
 *  same test (4 Panel Quick Test, Social Security Locator, …) appears in
 *  multiple AccuSource packages and its id can differ per package. */
function serviceNameKey(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function statusLooksCompleteLoose(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s.includes('complete') || s.includes('closed') || s === 'pass' || s.includes('clear');
}

function toMillisLoose(v: unknown): number | null {
  if (v && typeof v === 'object') {
    const t = v as { toMillis?: () => number; _seconds?: number; seconds?: number };
    if (typeof t.toMillis === 'function') {
      try {
        return t.toMillis();
      } catch {
        /* fall through */
      }
    }
    const s = t._seconds ?? t.seconds;
    if (typeof s === 'number') return s * 1000;
  }
  return null;
}

/**
 * PASSED service-line display names on a prior order doc, keyed by
 * `serviceNameKey`. Light server-side mirror of the client adjudication
 * rules (`accusourceScreeningLineItems` + `resolveEffectiveVerdict`):
 *   - adjudication verdict (manual override, else autoVerdict) === PASSED
 *   - no adjudication but the vendor closed the line clean AND it's an
 *     SSN-locator / drug-lab line (the classes the server auto-passes)
 *   - `markedCompleteOutsideHrx` docs: every requested service counts as
 *     passed unless a line explicitly FAILED
 * Generic `order:*` echo rows are ignored.
 */
function passedServiceLineNames(row: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const catalog = Array.isArray(row.requestedServicesCatalog)
    ? (row.requestedServicesCatalog as Array<{ id?: unknown; name?: unknown }>)
    : [];
  const nameById = new Map<string, string>();
  for (const c of catalog) {
    const id = String(c.id ?? '').trim();
    const name = String(c.name ?? '').trim();
    if (id && name) nameById.set(id, name);
  }
  const statusMap = (row.providerServiceOrderStatus ?? {}) as Record<
    string,
    {
      status?: unknown;
      serviceName?: unknown;
      labName?: unknown;
      labCode?: unknown;
      adjudication?: { verdict?: unknown; autoVerdict?: unknown } | null;
    }
  >;

  const push = (name: string) => {
    const key = serviceNameKey(name);
    if (!key || /^order\s+\S+$/i.test(name.trim())) return;
    if (!out.has(key)) out.set(key, name.trim());
  };

  for (const [id, entry] of Object.entries(statusMap)) {
    if (id.startsWith('order:')) continue;
    const name = nameById.get(id) || String(entry?.serviceName ?? '').trim();
    if (!name) continue;
    const adj = entry?.adjudication ?? null;
    const verdict = adj ? String(adj.verdict ?? adj.autoVerdict ?? '') : '';
    const nameLc = name.toLowerCase();
    const autoPassClass =
      nameLc.includes('social security') ||
      nameLc.includes('ssn') ||
      nameLc.includes('drug') ||
      entry?.labName != null ||
      entry?.labCode != null;
    const passed =
      verdict === 'PASSED' || (!adj && statusLooksCompleteLoose(entry?.status) && autoPassClass);
    if (passed) push(name);
  }

  if (row.markedCompleteOutsideHrx === true) {
    for (const c of catalog) {
      const id = String(c.id ?? '').trim();
      const adj = statusMap[id]?.adjudication ?? null;
      const failed = adj != null && String(adj.verdict ?? adj.autoVerdict ?? '') === 'FAILED';
      if (!failed) push(String(c.name ?? ''));
    }
  }
  return out;
}

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
    input.candidateId
  ) {
    let priorQuery = db
      .collection('backgroundChecks')
      .where('candidateId', '==', String(input.candidateId));
    if (input.tenantId) {
      priorQuery = priorQuery.where('tenantId', '==', String(input.tenantId));
    }
    const priorSnap = await priorQuery.limit(25).get();

    // Guard 1 — the WHOLE selected package is already satisfied by a
    // completed prior order (same equivalency key, within validity).
    if (requestedKey !== 'unknown') {
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
        accusourceLog('info', 'create', 'duplicate guard paused order — package already satisfied', {
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

    // Guard 2 — ITEM overlap across packages (Greg 2026-07-11): the same
    // test (4 Panel Quick Test, SSN Locator, …) ships inside multiple
    // packages, so a different package can still duplicate screens the
    // worker already PASSED. Match by normalized service NAME across every
    // still-valid prior order; pause listing what's already covered vs
    // newly needed, so the recruiter can order just the new items
    // à-la-carte (or override with "Order anyway").
    const requestedItems = (
      Array.isArray(input.requestedServicesCatalog) ? input.requestedServicesCatalog : []
    )
      .map((s) => String((s as { name?: unknown }).name ?? '').trim())
      .filter(Boolean);
    if (requestedItems.length > 0) {
      const validityMs = DEFAULT_SCREENING_VALIDITY_DAYS * 86_400_000;
      const passedByKey = new Map<string, { label: string; docId: string }>();
      for (const doc of priorSnap.docs) {
        const row = doc.data() as Record<string, unknown>;
        const completedMs = toMillisLoose(row.updatedAt) ?? toMillisLoose(row.createdAt);
        if (completedMs != null && Date.now() - completedMs > validityMs) continue;
        for (const [key, label] of passedServiceLineNames(row)) {
          if (!passedByKey.has(key)) passedByKey.set(key, { label, docId: doc.id });
        }
      }
      const alreadyPassed: string[] = [];
      const newlyNeeded: string[] = [];
      const matchedDocIds = new Set<string>();
      for (const name of requestedItems) {
        const hit = passedByKey.get(serviceNameKey(name));
        if (hit) {
          alreadyPassed.push(name);
          matchedDocIds.add(hit.docId);
        } else {
          newlyNeeded.push(name);
        }
      }
      if (alreadyPassed.length > 0) {
        accusourceLog('info', 'create', 'duplicate guard paused order — items already passed', {
          callerUid: uid,
          candidateId: input.candidateId,
          alreadyPassedCount: alreadyPassed.length,
          newlyNeededCount: newlyNeeded.length,
          matchedBackgroundCheckIds: Array.from(matchedDocIds),
        });
        throw new HttpsError(
          'failed-precondition',
          `This worker already passed ${alreadyPassed.length} of the selected items within the last ${DEFAULT_SCREENING_VALIDITY_DAYS} days: ${alreadyPassed.join(', ')}.${
            newlyNeeded.length > 0
              ? ` Newly needed: ${newlyNeeded.join(', ')} — consider ordering just those à-la-carte.`
              : ' Every selected item is already covered.'
          } No new order was placed — use "Order anyway" to order the full package with duplicates.`,
          {
            code: 'screening_items_already_passed',
            alreadyPassed,
            newlyNeeded,
            matchedBackgroundCheckIds: Array.from(matchedDocIds),
          },
        );
      }
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

    // Server-side worker activity log (P2, policy §8) — the client-side
    // logCustomActivity call is bypassable; this one is not.
    if (input.candidateId) {
      await writeWorkerActivityLog({
        userId: input.candidateId,
        action: 'screening_order_submitted',
        description: `Background screening ordered (${input.requestedPackageName || input.requestedPackageId || 'package'})`,
        severity: 'medium',
        metadata: {
          backgroundCheckId,
          orderedBy: uid,
          invocationType: invocation.type,
          requestedPackageId: input.requestedPackageId ?? null,
        },
      }).catch(() => undefined);
    }

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

