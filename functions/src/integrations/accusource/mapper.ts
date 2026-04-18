import type { AccusourcePartialProfileResponse, AccusourceV2PartialProfileBody } from './accusourceClient';

type AnyRecord = Record<string, unknown>;

function toStr(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

/** AccuSource V2 expects subject.dob as MM/DD/YYYY (e.g. 12/30/2005). */
function parseYyyyMmDdAsLocalCalendar(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function formatMmDdYyyyFromLocalDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function formatMmDdYyyyFromUtcDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Normalize callable/automation `candidate.dateOfBirth` to AccuSource MM/DD/YYYY.
 * Accepts YYYY-MM-DD, M/D/YYYY, ISO strings, Firestore Timestamp-like objects, epoch seconds.
 */
export function normalizeCandidateDobForAccusource(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const dt = parseYyyyMmDdAsLocalCalendar(t);
      return dt ? formatMmDdYyyyFromLocalDate(dt) : undefined;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      const parts = t.split('/').map((x) => parseInt(x.trim(), 10));
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return undefined;
      const [mm, dd, yyyy] = parts;
      const dt = new Date(yyyy, mm - 1, dd);
      if (dt.getFullYear() === yyyy && dt.getMonth() === mm - 1 && dt.getDate() === dd) {
        return formatMmDdYyyyFromLocalDate(dt);
      }
      return undefined;
    }
    const d = new Date(t);
    return !Number.isNaN(d.getTime()) ? formatMmDdYyyyFromLocalDate(d) : undefined;
  }
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    try {
      const d = (raw as { toDate: () => Date }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return formatMmDdYyyyFromUtcDate(d);
    } catch {
      return undefined;
    }
  }
  const sec =
    typeof raw === 'object' && raw !== null
      ? (raw as { seconds?: number; _seconds?: number }).seconds ??
        (raw as { _seconds?: number })._seconds
      : undefined;
  if (typeof sec === 'number') {
    const d = new Date(sec * 1000);
    if (!Number.isNaN(d.getTime())) return formatMmDdYyyyFromUtcDate(d);
  }
  if (typeof raw === 'number' && raw > 0) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return formatMmDdYyyyFromUtcDate(d);
  }
  return undefined;
}

export function normalizeRequestedServicesCatalog(
  raw: unknown,
): Array<{ id: string; name: string; type?: string }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<{ id: string; name: string; type?: string }> = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? '').trim();
    if (!id) continue;
    const name = String(o.name ?? '').trim() || id;
    const typeRaw = o.type;
    const type = typeRaw != null && String(typeRaw).trim() !== '' ? String(typeRaw).trim() : undefined;
    out.push(type ? { id, name, type } : { id, name });
  }
  return out.length ? out : undefined;
}

export interface CreateBackgroundCheckInput {
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  candidateId?: string;
  candidateName?: string;
  applicantId?: string;
  jobOrderId?: string;
  worksiteId?: string;
  requestedPackageId?: string;
  requestedPackageName?: string;
  requestedServices?: string[];
  /** Optional: catalog rows for each ordered screen (id / name / type) — stored for UI + readiness. */
  requestedServicesCatalog?: Array<{ id: string; name: string; type?: string }>;
  candidate?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    /** YYYY-MM-DD, MM/DD/YYYY, ISO string, or Firestore Timestamp / `{ seconds }` from `users` doc. */
    dateOfBirth?: unknown;
  };
  /** V2 optional: SourceDirect client user email (createdBy). */
  createdBy?: string;
  /** Required by V2 when package includes drug/medical/clinical services. */
  ecocEmail?: string;
  drugScreenReason?: string;
  drugScreenTestingAuthority?: string;
  drugScreenAutomaticScheduling?: boolean;
  drugScreenApplicantScheduling?: boolean;
  accountingCodes?: { primary?: string; secondary?: string; tertiary?: string };
  accountingCode?: string;
  accountingCodeId?: number;
}

function parsePositiveIntPackageId(requestedPackageId: string | undefined): number {
  const s = String(requestedPackageId ?? '').trim();
  if (!/^[1-9]\d*$/.test(s)) {
    throw new Error(
      'requestedPackageId must be a positive integer string from the synced SourceDirect catalog (GET /api/v2/company/details).',
    );
  }
  return Number(s);
}

/** Positive integer service ids from UI / Firestore `requestedServices` (matches catalog `services[].id`). */
export function parseRequestedServiceIds(requested: string[] | undefined): number[] {
  if (!Array.isArray(requested) || requested.length === 0) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of requested) {
    const s = String(raw ?? '').trim();
    if (!/^[1-9]\d*$/.test(s)) {
      throw new Error(
        `requestedServices must be positive integer strings from the synced SourceDirect catalog (invalid entry: "${String(raw)}").`,
      );
    }
    const n = Number(s);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Build POST /api/v2/profile/partial JSON body (SourceDirect API V2).
 * HRX-only context (account/job/services) is not sent on the wire; optional notes reference backgroundCheckId.
 */
export function buildPartialProfilePayload(
  input: CreateBackgroundCheckInput,
  clientId: string,
  backgroundCheckId: string,
): AccusourceV2PartialProfileBody {
  const packageId = parsePositiveIntPackageId(input.requestedPackageId);
  const firstName = toStr(input.candidate?.firstName);
  const lastName = toStr(input.candidate?.lastName);
  const email = toStr(input.candidate?.email);
  const phone = toStr(input.candidate?.phone);
  const dobFormatted = normalizeCandidateDobForAccusource(input.candidate?.dateOfBirth);

  if (!email) {
    throw new Error(
      'candidate.email is required for SourceDirect partial profile (primaryNotificationEmail / portal invitation).',
    );
  }
  if (!dobFormatted) {
    throw new Error(
      'candidate.dateOfBirth is required for SourceDirect (AccuSource expects MM/DD/YYYY). Save a valid date of birth on the worker profile and retry.',
    );
  }

  const subject: Record<string, unknown> = {
    firstName,
    lastName,
    email,
    primaryNotificationMethod: 'email',
    primaryNotificationEmail: email,
    dob: dobFormatted,
  };
  if (phone) {
    subject.primaryNotificationText = phone;
  }

  const body: AccusourceV2PartialProfileBody = {
    packageId,
    clientId,
    subject,
    notes: `HRX backgroundCheckId=${backgroundCheckId}`,
  };

  const createdBy = toStr(input.createdBy);
  if (createdBy) body.createdBy = createdBy;

  /** Drug / clinical packages require eCOC email; default to candidate email when not supplied. */
  const ecoc = toStr(input.ecocEmail) || email;
  body.ecocEmail = ecoc;

  const dsr = toStr(input.drugScreenReason);
  if (dsr) body.drugScreenReason = dsr;

  const dta = toStr(input.drugScreenTestingAuthority);
  if (dta) body.drugScreenTestingAuthority = dta;

  if (typeof input.drugScreenAutomaticScheduling === 'boolean') {
    body.drugScreenAutomaticScheduling = input.drugScreenAutomaticScheduling;
  }
  if (typeof input.drugScreenApplicantScheduling === 'boolean') {
    body.drugScreenApplicantScheduling = input.drugScreenApplicantScheduling;
  }

  if (input.accountingCodes && typeof input.accountingCodes === 'object') {
    const { primary, secondary, tertiary } = input.accountingCodes;
    const codes: { primary?: string; secondary?: string; tertiary?: string } = {};
    if (primary) codes.primary = primary;
    if (secondary) codes.secondary = secondary;
    if (tertiary) codes.tertiary = tertiary;
    if (Object.keys(codes).length > 0) body.accountingCodes = codes;
  }
  const ac = toStr(input.accountingCode);
  if (ac) body.accountingCode = ac;
  if (input.accountingCodeId != null && Number.isFinite(Number(input.accountingCodeId))) {
    body.accountingCodeId = Number(input.accountingCodeId);
  }

  const addonServiceIds = parseRequestedServiceIds(input.requestedServices);
  if (addonServiceIds.length > 0) {
    body.orders = addonServiceIds.map((serviceId) => ({ serviceId }));
    /**
     * Vendor requires a reason when drug (or similar) services are ordered; add-on services often include drug panels.
     * Callers can override via `drugScreenReason` / callable payload.
     */
    if (!toStr(input.drugScreenReason)) {
      body.drugScreenReason = 'PRE';
    }
  }

  return body;
}

export function parseProviderCreateResponse(response: AccusourcePartialProfileResponse): {
  providerProfileId: string | null;
  providerProfileNumber: string | null;
  providerSubjectId: string | null;
  providerClientId: string | null;
  applicantPortalLink: string | null;
  providerStatus: string | null;
  raw: AnyRecord;
} {
  const raw = (response || {}) as AnyRecord;
  const payload =
    raw.payload != null && typeof raw.payload === 'object' ? (raw.payload as AnyRecord) : raw;

  const providerProfileId =
    toStr(
      payload.profile_id ??
        payload.profileId ??
        raw.profile_id ??
        raw.profileId ??
        response.providerProfileId ??
        response.profileId,
    ) || null;

  const providerProfileNumber =
    toStr(payload.profile_number ?? payload.profileNumber ?? raw.profile_number) || null;

  const subjId = payload.subject_id ?? payload.subjectId ?? raw.subject_id;
  const providerSubjectId =
    subjId != null && String(subjId).trim() !== '' ? String(subjId).trim() : null;

  const providerClientId =
    toStr(
      payload.client_id ?? payload.clientId ?? response.clientId ?? raw.client_id ?? raw.referenceId,
    ) || null;

  const applicantPortalLink =
    toStr(
      payload.applicant_portal_url ??
        payload.applicantPortalUrl ??
        raw.applicant_portal_url ??
        raw.applicantPortalUrl ??
        response.applicantPortalUrl ??
        response.portalLink ??
        raw.portal_url ??
        raw.portalLink,
    ) || null;

  const providerStatus =
    toStr(
      payload.status_message ??
        payload.statusMessage ??
        response.status ??
        raw.status ??
        raw.profileStatus ??
        raw.state,
    ) || null;

  return {
    providerProfileId,
    providerProfileNumber,
    providerSubjectId,
    providerClientId,
    applicantPortalLink,
    providerStatus,
    raw,
  };
}
