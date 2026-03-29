/**
 * E-Verify HTTP/JSON client: real Stage API + EAAT stub.
 * ICA v31: createDraftCase + submitCase use username/password auth (REST).
 * HRX E-Verify Master Plan §3.1
 */

import { EverifyCaseStatus } from './everifySchemas';
import type { I9CaseFlat, CreateCaseDraftResponse, SubmitCaseResponse, CaseStatusResponse } from './everifySchemas';
import {
  assertEverifyEnvUrlConsistency,
  getEverifyBaseUrl,
  getEverifyAuthUrl,
  getEverifyTimeoutMs,
} from './everifyConfig';
import { getEverifyFakeProvider, getEverifyEaatScenario } from './everifyConfig';
import { logger } from 'firebase-functions/v2';
import { httpJson, summarizeHttpErrorBody } from './everifyHttp';
import { getAccessToken as getIcaAccessToken, type EverifyCredentials } from './everifyAuth';

export interface EverifyCreateCaseRequest {
  tenantId: string;
  entityId: string;
  userId: string;
  everifyCompanyId: string;
  startDate: string;
  requestHash: string;
}

export interface EverifyCreateCaseResponse {
  everifyCaseNumber?: string;
  status: EverifyCaseStatus;
  providerStatus: string;
  raw?: Record<string, unknown>;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Fetch OAuth2 access token using client credentials */
async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const authUrl = getEverifyAuthUrl();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(getEverifyTimeoutMs()),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('E-Verify auth failed', { status: res.status, body: text.substring(0, 200) });
    throw new Error(`E-Verify auth failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = json.access_token;
  if (!token) throw new Error('No access_token in E-Verify auth response');
  const expiresIn = (json.expires_in ?? 1799) * 1000;
  cachedToken = { token, expiresAt: Date.now() + expiresIn };
  return token;
}

/** EAAT stub: simulate scenarios for testing */
function createCaseStubInternal(
  _req: EverifyCreateCaseRequest,
  scenario?: string
): EverifyCreateCaseResponse {
  const s = (scenario || '').toLowerCase();
  if (s === 'employment_authorized')
    return {
      everifyCaseNumber: `EAAT-AUTH-${Date.now()}`,
      status: 'employment_authorized',
      providerStatus: 'employment_authorized (EAAT)',
      raw: { _eaat: true, scenario: 'employment_authorized' },
    };
  if (s === 'tnc')
    return {
      everifyCaseNumber: `EAAT-TNC-${Date.now()}`,
      status: 'tnc',
      providerStatus: 'Tentative Nonconfirmation (EAAT)',
      raw: { _eaat: true, scenario: 'tnc' },
    };
  if (s === 'error')
    return {
      everifyCaseNumber: undefined,
      status: 'error',
      providerStatus: 'error (EAAT simulation)',
      raw: { _eaat: true, scenario: 'error' },
    };
  // default: submitted/pending
  return {
    everifyCaseNumber: `EAAT-${Date.now()}`,
    status: 'submitted',
    providerStatus: 'submitted (EAAT stub)',
    raw: { _eaat: true, scenario: scenario || 'default' },
  };
}

/**
 * Create case via real Stage API or EAAT stub.
 * Writes everifyCaseNumber and normalized status to Firestore via everifyService.
 */
export async function createCaseClient(
  req: EverifyCreateCaseRequest,
  credentials: { clientId: string; clientSecret: string } | null
): Promise<EverifyCreateCaseResponse> {
  if (getEverifyFakeProvider()) {
    const scenario = getEverifyEaatScenario();
    logger.info('E-Verify fake provider (stub)', { scenario });
    return createCaseStubInternal(req, scenario);
  }

  if (!credentials?.clientId || !credentials?.clientSecret) {
    logger.warn('E-Verify OAuth credentials missing, using fake provider');
    return createCaseStubInternal(req);
  }

  const token = await getAccessToken(credentials.clientId, credentials.clientSecret);
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const createUrl = `${baseUrl}/cases`;

  // ICA v31 Create Case payload – adjust fields per official ICA
  const payload = {
    companyId: req.everifyCompanyId,
    startDate: req.startDate,
    requestHash: req.requestHash,
    metadata: {
      tenantId: req.tenantId,
      entityId: req.entityId,
      userId: req.userId,
    },
  };

  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(getEverifyTimeoutMs()),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    logger.error('E-Verify Create Case failed', {
      status: res.status,
      body: text.substring(0, 500),
    });
    throw new Error(
      `E-Verify Create Case failed: ${res.status} ${(json as { message?: string }).message || text.substring(0, 100)}`
    );
  }

  // Map provider response to our schema – adjust per ICA response shape
  const caseNumber = (json.caseNumber ?? json.everifyCaseNumber ?? json.case_id) as string | undefined;
  const providerStatus = (json.status ?? json.providerStatus ?? json.caseStatus ?? 'submitted') as string;
  const raw = json as Record<string, unknown>;

  return {
    everifyCaseNumber: caseNumber,
    status: normalizeProviderStatus(providerStatus),
    providerStatus: String(providerStatus),
    raw,
  };
}

function normalizeProviderStatus(s: string): EverifyCaseStatus {
  const lower = String(s || '').toLowerCase();
  if (lower.includes('authorized') || lower.includes('employment authorized'))
    return 'employment_authorized';
  if (lower.includes('tnc') || lower.includes('tentative nonconfirmation')) return 'tnc';
  if (lower.includes('dhs') && lower.includes('process')) return 'dhs_verification_in_process';
  if (lower.includes('further action')) return 'further_action_required';
  if (lower.includes('final') && lower.includes('nonconfirmation')) return 'final_nonconfirmation';
  if (lower.includes('closed')) return 'closed';
  if (lower.includes('error') || lower.includes('failed')) return 'error';
  if (lower.includes('pending') || lower.includes('submitted')) return 'submitted';
  return 'pending';
}

/** Stub for backward compatibility – use createCaseClient with credentials */
export async function createCaseStub(req: EverifyCreateCaseRequest): Promise<EverifyCreateCaseResponse> {
  return createCaseStubInternal(req);
}

// ─── ICA v31: create draft + submit (no Firestore) ─────────────────────────

/**
 * ICA v31: Create draft case via POST /cases.
 * Uses Bearer token from everifyAuth.getAccessToken(creds).
 */
export async function createDraftCase(
  payload: I9CaseFlat,
  creds: EverifyCredentials
): Promise<CreateCaseDraftResponse> {
  assertEverifyEnvUrlConsistency();
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/cases`;
  const token = await getIcaAccessToken(creds);

  try {
    const resp = await httpJson<CreateCaseDraftResponse & Record<string, unknown>>({
      method: 'POST',
      url,
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
      timeoutMs: 20000,
      retries: 1,
    });

    const caseNumber = resp?.case_number ?? (resp as Record<string, unknown>).case_number;
    if (!caseNumber || typeof caseNumber !== 'string') {
      throw new Error('E-Verify create draft: missing case_number in response');
    }

    return {
      case_number: String(caseNumber),
      case_status: resp?.case_status,
      case_status_display: resp?.case_status_display,
    };
  } catch (e: unknown) {
    const detail = summarizeHttpErrorBody(e);
    logger.warn('E-Verify create draft: USCIS returned error', { detail: detail.slice(0, 800) });
    throw new Error(`E-Verify create draft failed: ${detail}`);
  }
}

/**
 * ICA v31: Submit draft case via POST /cases/{case_number}/submit.
 */
export async function submitCase(
  caseNumber: string,
  creds: EverifyCredentials
): Promise<SubmitCaseResponse> {
  assertEverifyEnvUrlConsistency();
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/cases/${encodeURIComponent(caseNumber)}/submit`;
  const token = await getIcaAccessToken(creds);

  try {
    const resp = await httpJson<SubmitCaseResponse & Record<string, unknown>>({
      method: 'POST',
      url,
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20000,
      retries: 1,
    });

    return {
      case_number: resp?.case_number ?? caseNumber,
      case_status: resp?.case_status,
      case_status_display: resp?.case_status_display,
      case_eligibility_statement: resp?.case_eligibility_statement,
      ssa_referral_status: resp?.ssa_referral_status,
      dhs_referral_status: resp?.dhs_referral_status,
      dhs_referral_due_date: resp?.dhs_referral_due_date,
    };
  } catch (e: unknown) {
    const detail = summarizeHttpErrorBody(e);
    logger.warn('E-Verify submit: USCIS returned error', { detail: detail.slice(0, 800) });
    throw new Error(`E-Verify submit failed: ${detail}`);
  }
}

/**
 * ICA v31: Get case status/details via GET /cases/{case_number}.
 * Returns whitelisted fields only. When fake provider, returns stub status.
 */
export async function getCaseStatus(
  caseNumber: string,
  creds: EverifyCredentials
): Promise<CaseStatusResponse> {
  if (getEverifyFakeProvider()) {
    return {
      case_number: caseNumber,
      case_status: 'SUBMITTED',
      case_status_display: 'Submitted (fake provider)',
      case_eligibility_statement: undefined,
    };
  }

  assertEverifyEnvUrlConsistency();
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/cases/${encodeURIComponent(caseNumber)}`;
  const token = await getIcaAccessToken(creds);

  try {
    const resp = await httpJson<CaseStatusResponse & Record<string, unknown>>({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 15000,
      retries: 1,
    });

    return {
      case_number: resp?.case_number ?? caseNumber,
      case_status: resp?.case_status,
      case_status_display: resp?.case_status_display,
      case_eligibility_statement: resp?.case_eligibility_statement,
      ssa_referral_status: resp?.ssa_referral_status,
      dhs_referral_status: resp?.dhs_referral_status,
      dhs_referral_due_date: resp?.dhs_referral_due_date,
      dhs_referral_created_at: resp?.dhs_referral_created_at,
      dhs_referral_contact_by_date: resp?.dhs_referral_contact_by_date,
      ev_star_referral_due_date: resp?.ev_star_referral_due_date,
      ev_star_referral_created_at: resp?.ev_star_referral_created_at,
      ev_star_referral_contact_by_date: resp?.ev_star_referral_contact_by_date,
    };
  } catch (e: unknown) {
    const err = e as Error & { status?: number; body?: { message?: string } };
    const msg = err.body?.message ?? err.message;
    throw new Error(`E-Verify get case status failed: ${err.status ?? ''} ${msg}`.trim());
  }
}
