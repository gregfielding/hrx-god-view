/**
 * E-Verify service: createCase (legacy), createAndSubmitCase (ICA canonical).
 * HRX E-Verify Master Plan §3.1
 * Phase 3: ICA createDraft + submit is the canonical path.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { createCaseClient } from './everifyRestClient';
import { createDraftCase, submitCase } from './everifyRestClient';
import { buildCreateCaseRequest } from './everifyAdapter';
import { mapProviderStatusToHrx } from './everifyAdapter';
import { whitelistEverifyRaw } from './everifyRedaction';
import { redactSensitiveFields } from './everifyRedaction';
import { resolveI9PayloadForCreateCase } from './everifyI9Provider';
import { getEverifyFakeProvider } from './everifyConfig';
import { getEverifyEnv } from './everifyConfig';
import type { EverifyCase, EverifyCaseEvent, EverifyCaseStatus, I9CaseFlat } from './everifySchemas';
import type { EverifyCredentials } from './everifyAuth';
import type { SubmitCaseResponse } from './everifySchemas';

/** Legacy OAuth credentials (EAAT stub / rollback only) */
export interface EverifyOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

const db = admin.firestore();

function everifyCasesRef(tenantId: string) {
  return db.collection('tenants').doc(tenantId).collection('everify_cases');
}

function everifyCasesPublicRef(tenantId: string) {
  return db.collection('tenants').doc(tenantId).collection('everify_cases_public');
}

/** Worker-safe public mirror: tenantId, userId, caseId, linkage fields, public, updatedAt. */
export interface EverifyCasePublicPayload {
  status?: EverifyCaseStatus | string;
  statusDisplay?: string;
  eligibilityStatement?: string;
  deadlines?: { tncResponseDueAt?: unknown; referralDueAt?: unknown };
}

/** Denormalized from private everify_cases for filtering (Employment V2, worker-safe reads). */
export interface EverifyCasePublicLinkage {
  entityId: string | null;
  assignmentId: string | null;
  userEmploymentId: string | null;
}

export function everifyCasePublicLinkageFromPrivate(
  data: Record<string, unknown> | undefined | null
): EverifyCasePublicLinkage {
  const d = data || {};
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    entityId: s(d.entityId),
    assignmentId: s(d.assignmentId),
    userEmploymentId: s(d.userEmploymentId),
  };
}

/**
 * Upsert the public mirror doc so workers can read case status without access to everify_cases.
 * Call whenever public data changes (create or poller update).
 * Always pass `linkage` from the private case so entity-scoped UIs can filter reliably.
 */
export async function upsertEverifyCasePublicMirror(
  tenantId: string,
  caseId: string,
  userId: string | null,
  publicPayload: EverifyCasePublicPayload,
  linkage: EverifyCasePublicLinkage
): Promise<void> {
  const ref = everifyCasesPublicRef(tenantId).doc(caseId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(
    {
      tenantId,
      userId: userId ?? null,
      caseId,
      entityId: linkage.entityId ?? null,
      assignmentId: linkage.assignmentId ?? null,
      userEmploymentId: linkage.userEmploymentId ?? null,
      public: publicPayload,
      updatedAt: now,
    },
    { merge: true }
  );
}

function everifyCaseEventsRef(tenantId: string, caseId: string) {
  return everifyCasesRef(tenantId).doc(caseId).collection('events');
}

async function appendEvent(
  tenantId: string,
  caseId: string,
  event: Omit<EverifyCaseEvent, 'at'> & { at?: admin.firestore.FieldValue }
): Promise<void> {
  const eventsRef = everifyCaseEventsRef(tenantId, caseId);
  await eventsRef.add({
    ...event,
    at: event.at ?? admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Default case creator for worker/trigger path (no auth context) */
const DEFAULT_CASE_CREATOR = {
  name: 'HRX System',
  email: 'everify@hrx.com',
  phone10: '0000000000',
};

function digitsOnlyPhone(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function isPlaceholderPhone10(d: string): boolean {
  if (d.length !== 10) return true;
  if (/^0{10}$/.test(d)) return true;
  if (/^(\d)\1{9}$/.test(d)) return true;
  return false;
}

/**
 * Prefer auth/user caller phone; then entity `contacts.supportPhone`; then env EVERIFY_CASE_CREATOR_PHONE_FALLBACK.
 * Logs when falling back to placeholder.
 */
async function resolveCaseCreatorForIca(params: {
  tenantId: string;
  entityId: string;
  caseCreator?: { name: string; email: string; phone10: string; phoneExt?: string };
}): Promise<{ name: string; email: string; phone10: string; phoneExt?: string }> {
  const { tenantId, entityId, caseCreator: fromAuth } = params;
  const fallbackEnv = String(process.env.EVERIFY_CASE_CREATOR_PHONE_FALLBACK || '').trim();

  const try10 = (raw: string): string | null => {
    let d = digitsOnlyPhone(raw);
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length === 10 && !isPlaceholderPhone10(d)) return d;
    return null;
  };

  if (fromAuth) {
    const d = try10(fromAuth.phone10 || '');
    if (d) return { ...fromAuth, phone10: d };
  }

  try {
    const entSnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    const e = (entSnap.data() || {}) as Record<string, unknown>;
    const contacts = (e.contacts || {}) as Record<string, unknown>;
    const sp = String(contacts.supportPhone || '').trim();
    const d = try10(sp);
    if (d) {
      return {
        name: String(fromAuth?.name || e.name || DEFAULT_CASE_CREATOR.name),
        email: String(fromAuth?.email || contacts.supportEmail || DEFAULT_CASE_CREATOR.email),
        phone10: d,
        phoneExt: fromAuth?.phoneExt,
      };
    }
  } catch {
    /* ignore */
  }

  const fd = try10(fallbackEnv);
  if (fd) {
    return {
      name: fromAuth?.name || DEFAULT_CASE_CREATOR.name,
      email: fromAuth?.email || DEFAULT_CASE_CREATOR.email,
      phone10: fd,
      phoneExt: fromAuth?.phoneExt,
    };
  }

  logger.warn('everify.case_creator_phone_placeholder', {
    tenantId,
    entityId,
    message:
      'Using placeholder or weak case_creator phone; set entity.contacts.supportPhone or EVERIFY_CASE_CREATOR_PHONE_FALLBACK',
  });
  return (
    fromAuth || {
      name: DEFAULT_CASE_CREATOR.name,
      email: DEFAULT_CASE_CREATOR.email,
      phone10: DEFAULT_CASE_CREATOR.phone10,
    }
  );
}

/**
 * Canonical ICA case creation: create draft → submit → persist.
 * Uses fixture for I-9 payload in Stage; never logs payload.
 */
export async function createAndSubmitCase(params: {
  tenantId: string;
  entityId: string;
  userId: string;
  jobOrderId: string | null;
  shiftId: string | null;
  assignmentId: string | null;
  userEmploymentId: string | null;
  startDate: string;
  everifyCompanyId: string;
  requestHash: string;
  caseCreator?: { name: string; email: string; phone10: string; phoneExt?: string };
  icaCredentials?: EverifyCredentials | null;
  legacyCredentials?: EverifyOAuthCredentials | null;
  /** Admin UI / callable: employee identity for USCIS (overrides env fixture + profile hints). */
  i9Employee?: Partial<I9CaseFlat> | null;
}): Promise<{ caseId: string; everifyCaseNumber?: string; status: EverifyCaseStatus }> {
  const env = getEverifyEnv();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const creator = await resolveCaseCreatorForIca({
    tenantId: params.tenantId,
    entityId: params.entityId,
    caseCreator: params.caseCreator ?? undefined,
  });
  const dateOfHire = params.startDate.split('T')[0] || params.startDate;

  if (getEverifyFakeProvider()) {
    const req = buildCreateCaseRequest({
      tenantId: params.tenantId,
      entityId: params.entityId,
      userId: params.userId,
      everifyCompanyId: params.everifyCompanyId,
      startDate: params.startDate,
      requestHash: params.requestHash,
    });
    const resp = await createCaseClient(req, params.legacyCredentials ?? null);
    const rawRedacted = resp.raw ? redactSensitiveFields(resp.raw) : undefined;
    const caseData: Omit<EverifyCase, 'createdAt' | 'updatedAt'> & {
      createdAt: admin.firestore.FieldValue;
      updatedAt: admin.firestore.FieldValue;
    } = {
      tenantId: params.tenantId,
      entityId: params.entityId,
      userId: params.userId,
      jobOrderId: params.jobOrderId,
      shiftId: params.shiftId,
      assignmentId: params.assignmentId,
      userEmploymentId: params.userEmploymentId,
      onboardingInstanceId: null,
      environment: env,
      everifyCompanyId: params.everifyCompanyId,
      everifyCaseNumber: resp.everifyCaseNumber,
      status: resp.status,
      providerStatus: resp.providerStatus,
      submittedAt: now,
      lastCheckedAt: now,
      requestHash: params.requestHash,
      raw: rawRedacted ?? undefined,
      public: {
        status: resp.status,
        statusDisplay: resp.providerStatus,
      },
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await everifyCasesRef(params.tenantId).add(caseData);
    await upsertEverifyCasePublicMirror(
      params.tenantId,
      docRef.id,
      params.userId,
      {
        status: resp.status,
        statusDisplay: resp.providerStatus,
      },
      {
        entityId: params.entityId,
        assignmentId: params.assignmentId,
        userEmploymentId: params.userEmploymentId,
      }
    );
    await appendEvent(params.tenantId, docRef.id, {
      tenantId: params.tenantId,
      entityId: params.entityId,
      userId: params.userId,
      userEmploymentId: params.userEmploymentId,
      assignmentId: params.assignmentId,
      type: 'CASE_SUBMITTED',
      actor: 'system',
      data: { everifyCaseNumber: resp.everifyCaseNumber, providerStatus: resp.providerStatus },
    });
    return {
      caseId: docRef.id,
      everifyCaseNumber: resp.everifyCaseNumber,
      status: resp.status,
    };
  }

  const creds = params.icaCredentials;
  if (!creds?.username || !creds?.password) {
    throw new Error('ICA credentials required. Set EVERIFY_WS_USERNAME and EVERIFY_WS_PASSWORD.');
  }

  const overrides: Partial<I9CaseFlat> = {
    date_of_hire: dateOfHire,
    case_creator_name: creator.name,
    case_creator_email_address: creator.email,
    case_creator_phone_number: creator.phone10,
  };
  const ext = params.caseCreator?.phoneExt;
  if (ext != null && ext !== '') overrides.case_creator_phone_number_extension = ext;
  const payload = await resolveI9PayloadForCreateCase({
    tenantId: params.tenantId,
    userId: params.userId,
    employeeFromClient: params.i9Employee,
    serviceOverrides: overrides,
  });

  let draftCaseNumber: string;
  let submitted: SubmitCaseResponse;

  try {
    const draft = await createDraftCase(payload, creds);
    draftCaseNumber = draft.case_number;
    submitted = await submitCase(draftCaseNumber, creds);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const docRef = await everifyCasesRef(params.tenantId).add({
      tenantId: params.tenantId,
      entityId: params.entityId,
      userId: params.userId,
      jobOrderId: params.jobOrderId,
      shiftId: params.shiftId,
      assignmentId: params.assignmentId,
      userEmploymentId: params.userEmploymentId,
      onboardingInstanceId: null,
      environment: env,
      everifyCompanyId: params.everifyCompanyId,
      everifyCaseNumber: undefined,
      status: 'error',
      providerStatus: 'create/submit failed',
      requestHash: params.requestHash,
      error: { message: errMsg },
      submittedAt: now,
      lastCheckedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await upsertEverifyCasePublicMirror(
      params.tenantId,
      docRef.id,
      params.userId,
      {
        status: 'error',
        statusDisplay: 'create/submit failed',
      },
      {
        entityId: params.entityId,
        assignmentId: params.assignmentId,
        userEmploymentId: params.userEmploymentId,
      }
    );
    await appendEvent(params.tenantId, docRef.id, {
      tenantId: params.tenantId,
      entityId: params.entityId,
      userId: params.userId,
      userEmploymentId: params.userEmploymentId,
      assignmentId: params.assignmentId,
      type: 'ERROR',
      actor: 'system',
      data: { error: errMsg },
    });
    throw e;
  }

  const providerStatus = submitted.case_status ?? 'UNKNOWN';
  const status = mapProviderStatusToHrx(providerStatus);
  const raw = whitelistEverifyRaw(submitted);

  const caseData: Omit<EverifyCase, 'createdAt' | 'updatedAt'> & {
    createdAt: admin.firestore.FieldValue;
    updatedAt: admin.firestore.FieldValue;
  } = {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    jobOrderId: params.jobOrderId,
    shiftId: params.shiftId,
    assignmentId: params.assignmentId,
    userEmploymentId: params.userEmploymentId,
    onboardingInstanceId: null,
    environment: env,
    everifyCompanyId: params.everifyCompanyId,
    everifyCaseNumber: draftCaseNumber,
    status,
    providerStatus,
    submittedAt: now,
    lastCheckedAt: now,
    requestHash: params.requestHash,
    raw: Object.keys(raw).length > 0 ? raw : undefined,
    public: {
      status,
      statusDisplay: String(providerStatus),
      eligibilityStatement:
        typeof (raw as Record<string, unknown>).case_eligibility_statement === 'string'
          ? (raw as Record<string, unknown>).case_eligibility_statement as string
          : undefined,
    },
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await everifyCasesRef(params.tenantId).add(caseData);

  await upsertEverifyCasePublicMirror(params.tenantId, docRef.id, params.userId, caseData.public, {
    entityId: params.entityId,
    assignmentId: params.assignmentId,
    userEmploymentId: params.userEmploymentId,
  });

  await appendEvent(params.tenantId, docRef.id, {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    userEmploymentId: params.userEmploymentId,
    assignmentId: params.assignmentId,
    type: 'CASE_DRAFT_CREATED',
    actor: 'system',
    data: { case_number: draftCaseNumber },
  });
  await appendEvent(params.tenantId, docRef.id, {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    userEmploymentId: params.userEmploymentId,
    assignmentId: params.assignmentId,
    type: 'CASE_SUBMITTED',
    actor: 'system',
    data: { everifyCaseNumber: draftCaseNumber, providerStatus },
  });

  return {
    caseId: docRef.id,
    everifyCaseNumber: draftCaseNumber,
    status,
  };
}

/**
 * Legacy: create case via OAuth or EAAT stub.
 * @deprecated Use createAndSubmitCase (ICA path) instead.
 */
export async function createCase(params: {
  tenantId: string;
  entityId: string;
  userId: string;
  jobOrderId: string | null;
  shiftId: string | null;
  assignmentId: string | null;
  userEmploymentId: string | null;
  startDate: string;
  everifyCompanyId: string;
  requestHash: string;
  credentials?: EverifyOAuthCredentials | null;
}): Promise<{ caseId: string; everifyCaseNumber?: string; status: EverifyCaseStatus }> {
  const env = getEverifyEnv();
  const req = buildCreateCaseRequest({
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    everifyCompanyId: params.everifyCompanyId,
    startDate: params.startDate,
    requestHash: params.requestHash,
  });

  const resp = await createCaseClient(req, params.credentials ?? null);
  const status = mapProviderStatusToHrx(resp.providerStatus);
  const rawRedacted = resp.raw ? redactSensitiveFields(resp.raw) : undefined;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const caseData: Omit<EverifyCase, 'createdAt' | 'updatedAt'> & {
    createdAt: admin.firestore.FieldValue;
    updatedAt: admin.firestore.FieldValue;
  } = {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    jobOrderId: params.jobOrderId,
    shiftId: params.shiftId,
    assignmentId: params.assignmentId,
    userEmploymentId: params.userEmploymentId,
    onboardingInstanceId: null,
    environment: env,
    everifyCompanyId: params.everifyCompanyId,
    everifyCaseNumber: resp.everifyCaseNumber,
    status,
    providerStatus: resp.providerStatus,
    submittedAt: now,
    lastCheckedAt: now,
    requestHash: params.requestHash,
    raw: rawRedacted ?? undefined,
    public: { status, statusDisplay: resp.providerStatus },
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await everifyCasesRef(params.tenantId).add(caseData);

  await upsertEverifyCasePublicMirror(params.tenantId, docRef.id, params.userId, caseData.public, {
    entityId: params.entityId,
    assignmentId: params.assignmentId,
    userEmploymentId: params.userEmploymentId,
  });

  await appendEvent(params.tenantId, docRef.id, {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    userEmploymentId: params.userEmploymentId,
    assignmentId: params.assignmentId,
    type: 'CASE_SUBMITTED',
    actor: 'system',
    data: { everifyCaseNumber: resp.everifyCaseNumber, providerStatus: resp.providerStatus },
  });

  return {
    caseId: docRef.id,
    everifyCaseNumber: resp.everifyCaseNumber,
    status,
  };
}
