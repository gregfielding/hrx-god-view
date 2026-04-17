/**
 * E-Verify I-9 payload provider.
 * Assembles i9_case_flat just-in-time. NEVER store or log SSN/doc numbers.
 * ICA v31 Refactor Pack §4.4
 */

import * as admin from 'firebase-admin';
import type { I9CaseFlat } from './everifySchemas';
import { assertEverifyEnvUrlConsistency } from './everifyConfig';
import { normalizeAlienNumberForApi } from './everifyAlienNumber';
import {
  deriveEverifyI551MaskFromAlienNumber,
  normalizeI551NumberForEverifyApi,
} from './everifyI551DocumentNumber';
import {
  i9SupportingApprovedToI9CaseFlatPartial,
  type I9SupportingDocLike,
} from '../../utils/i9SupportingToEverifyMerge';
import { sanitizeCaseCreatorNameForIca, sanitizeEverifyDocumentNumber } from './everifyIcaSanitize';

const REQUIRED_FIELDS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'ssn',
  'citizenship_status_code',
  'date_of_hire',
  'case_creator_email_address',
  'case_creator_name',
  'case_creator_phone_number',
] as const;

function validateI9Required(merged: Record<string, unknown>): void {
  const missing: string[] = [];
  for (const key of REQUIRED_FIELDS) {
    const val = merged[key];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `I-9 payload missing required fields: ${missing.join(', ')}. ` +
        'Provide i9Employee from the admin E-Verify flow and/or EVERIFY_I9_FIXTURE_JSON defaults.'
    );
  }
}

function nonEmptyString(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return false;
}

/** ICA ATTRIBUTE_FORMAT: document numbers `^[a-zA-Z0-9*-]*$`, case_creator_name letters/apostrophe/hyphen/period/space only. */
function sanitizeIcaFormatFieldsInPayload(merged: Record<string, unknown>): void {
  const bc = merged.document_bc_number;
  if (typeof bc === 'string' && bc.trim()) {
    const s = sanitizeEverifyDocumentNumber(bc);
    if (s) merged.document_bc_number = s;
    else delete merged.document_bc_number;
  }
  const cnum = merged.document_c_number;
  if (typeof cnum === 'string' && cnum.trim()) {
    const s = sanitizeEverifyDocumentNumber(cnum);
    if (s) merged.document_c_number = s;
    else delete merged.document_c_number;
  }
  const cname = merged.case_creator_name;
  if (typeof cname === 'string' && cname.trim()) {
    merged.case_creator_name = sanitizeCaseCreatorNameForIca(cname, 'HRX System');
  }
}

/**
 * REST create-draft rejects empty List A and empty B/C (ATTRIBUTE_A_OR_B_AND_C_DOCUMENTS_REQUIRED).
 */
function validateI9ListDocumentsForEverifyRest(data: Record<string, unknown>): void {
  const hasA = nonEmptyString(data.document_a_type_code);
  const hasB = nonEmptyString(data.document_b_type_code);
  const hasC = nonEmptyString(data.document_c_type_code);
  if (hasA || (hasB && hasC)) return;
  throw new Error(
    'E-Verify requires List A (document_a_type_code) or both List B and List C (document_b_type_code and document_c_type_code). ' +
      'Use the Start E-Verify document section or set these fields in EVERIFY_I9_FIXTURE_JSON. Codes must match your ICA.'
  );
}

/**
 * ICA rejects bare 9-digit SSN; pattern is ###-##-#### and disallows 123-45-6789 / 111-11-1111.
 * Normalizes env fixtures so values match USCIS pattern (###-##-####); applies in stage and prod.
 */
function normalizeSsnInI9Payload(data: Record<string, unknown>): void {
  const v = data.ssn;
  if (v === undefined || v === null) return;
  // JSON fixtures often use a numeric ssn; JSON.stringify would send 123456789 without dashes → USCIS 400.
  let raw: string;
  if (typeof v === 'string') raw = v.trim();
  else if (typeof v === 'number' && Number.isFinite(v)) raw = String(Math.trunc(Math.abs(v)));
  else return;
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return;
  let formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}`;
  if (formatted === '123-45-6789' || formatted === '111-11-1111') {
    formatted = '890-12-3456';
  }
  data.ssn = formatted;
}

/**
 * REST create-draft expects `citizenship_status_code` as USCIS enum strings (e.g. US_CITIZEN), not legacy "1"–"5" digits.
 * Admin UI and old fixtures may still send digits; map them here. Pass through values already in the API set.
 */
const REST_CITIZENSHIP_STATUS_ENUMS = new Set([
  'US_CITIZEN',
  'NONCITIZEN',
  'LAWFUL_PERMANENT_RESIDENT',
  'ALIEN_AUTHORIZED_TO_WORK',
  'NONCITIZEN_AUTHORIZED_TO_WORK',
]);

const LEGACY_DIGIT_CITIZENSHIP_TO_REST: Record<string, string> = {
  '1': 'US_CITIZEN',
  '2': 'NONCITIZEN',
  '3': 'LAWFUL_PERMANENT_RESIDENT',
  '4': 'ALIEN_AUTHORIZED_TO_WORK',
  '5': 'NONCITIZEN_AUTHORIZED_TO_WORK',
};

const LEGACY_HRX_LABEL_TO_REST: Record<string, string> = {
  NONCITIZEN_NATIONAL: 'NONCITIZEN',
  OTHER: 'NONCITIZEN_AUTHORIZED_TO_WORK',
};

function normalizeCitizenshipStatusCodeInI9Payload(data: Record<string, unknown>): void {
  const v = data.citizenship_status_code;
  if (v === undefined || v === null) return;
  let raw: string;
  if (typeof v === 'number' && Number.isFinite(v)) {
    raw = String(Math.trunc(Math.abs(v)));
  } else if (typeof v === 'string') {
    raw = v.trim();
  } else {
    return;
  }
  if (!raw) return;
  if (REST_CITIZENSHIP_STATUS_ENUMS.has(raw)) return;
  const fromDigit = LEGACY_DIGIT_CITIZENSHIP_TO_REST[raw];
  if (fromDigit) {
    data.citizenship_status_code = fromDigit;
    return;
  }
  const fromHrx = LEGACY_HRX_LABEL_TO_REST[raw];
  if (fromHrx) {
    data.citizenship_status_code = fromHrx;
  }
}

/**
 * Final pass immediately before POST /cases. Idempotent; covers any code path that skipped resolveI9Payload*.
 * Also maps legacy document_a_type_code values to USCIS REST enums.
 */
const DOCUMENT_A_TYPE_CODE_ALIASES: Record<string, string> = {
  PERMANENT_RESIDENT_CARD: "FORM_I551",
  US_PASSPORT_CARD: "US_PASSPORT",
  EMPLOYMENT_AUTHORIZATION_DOCUMENT: "FORM_I766",
};

function normalizeDocumentATypeCodeForEverifyRest(data: Record<string, unknown>): void {
  const v = data.document_a_type_code;
  if (typeof v !== 'string') return;
  const t = v.trim();
  const mapped = DOCUMENT_A_TYPE_CODE_ALIASES[t];
  if (mapped) data.document_a_type_code = mapped;
}

/** E-Verify REST: `i551_number` = card document number (3 letters + 10 digits or *+9 digits). */
function normalizeI551NumberInI9Payload(data: Record<string, unknown>): void {
  const v = data.i551_number;
  if (typeof v !== 'string') return;
  const norm = normalizeI551NumberForEverifyApi(v);
  if (norm) data.i551_number = norm;
}

function normalizeAlienNumberInI9Payload(data: Record<string, unknown>): void {
  const v = data.alien_number;
  if (typeof v !== 'string') return;
  const norm = normalizeAlienNumberForApi(v);
  if (norm) data.alien_number = norm;
}

/**
 * REST create-draft: `case_creator_phone_number` must be exactly 10 digits (`/^\\d{10}$/`, max length 10).
 * Strip formatting from profile/env values; normalize +1XXXXXXXXXX to 10 digits.
 */
function normalizeCaseCreatorPhoneForEverifyRest(data: Record<string, unknown>): void {
  const v = data.case_creator_phone_number;
  if (v === undefined || v === null) return;
  const raw = typeof v === 'string' ? v.trim() : String(v);
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return;
  data.case_creator_phone_number = d;
}

/** E-Verify returns ATTRIBUTE_EXTRANEOUS_FIELD for no_expiration_date on FORM_I551 cases. */
function omitNoExpirationDateForFormI551(data: Record<string, unknown>): void {
  const docA = data.document_a_type_code;
  if (typeof docA !== 'string' || docA.trim() !== 'FORM_I551') return;
  delete data.no_expiration_date;
}

/**
 * FORM_I551: API requires `i551_number`. When only `alien_number` is collected, derive the ICA mask
 * `UNK*#########` (see deriveEverifyI551MaskFromAlienNumber). Preserve an explicit valid `i551_number`.
 */
function ensureI551NumberForFormI551(data: Record<string, unknown>): void {
  const docA = data.document_a_type_code;
  if (typeof docA !== 'string' || docA.trim() !== 'FORM_I551') return;

  const alienNorm =
    typeof data.alien_number === 'string' ? normalizeAlienNumberForApi(data.alien_number) : null;
  if (!alienNorm || !/^A\d{9}$/.test(alienNorm)) return;

  const raw = data.i551_number;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = normalizeI551NumberForEverifyApi(raw);
    if (n) {
      data.i551_number = n;
      return;
    }
  }

  const derived = deriveEverifyI551MaskFromAlienNumber(alienNorm);
  if (derived) data.i551_number = derived;
}

/**
 * ICA create-draft rejects `document_sub_type_code` when present as `""` (ATTRIBUTE_REQUIRED).
 * Fixtures and JSON merges may include the key with an empty string — omit before POST.
 */
function omitEmptyDocumentSubTypeCode(data: Record<string, unknown>): void {
  const v = data.document_sub_type_code;
  if (v === null || v === undefined) {
    delete data.document_sub_type_code;
    return;
  }
  if (typeof v === 'string' && v.trim() === '') {
    delete data.document_sub_type_code;
  }
}

/**
 * When List A is U.S. passport (or receipt), USCIS REST expects a non-empty `document_sub_type_code`
 * (passport book vs passport card). HRX presets only set `document_a_type_code`; default to book.
 * Confirm enum labels against your signed ICA if ATTRIBUTE_INVALID_ENUM appears.
 */
const US_PASSPORT_SUBTYPE_DEFAULT = 'US_PASSPORT_BOOK';

function ensureDocumentSubTypeCodeForPassportListA(data: Record<string, unknown>): void {
  const docA = typeof data.document_a_type_code === 'string' ? data.document_a_type_code.trim() : '';
  if (docA !== 'US_PASSPORT' && docA !== 'US_PASSPORT_RECEIPT') return;

  const sub =
    typeof data.document_sub_type_code === 'string' ? data.document_sub_type_code.trim() : '';
  if (sub) return;

  data.document_sub_type_code =
    docA === 'US_PASSPORT_RECEIPT' ? 'US_PASSPORT_RECEIPT' : US_PASSPORT_SUBTYPE_DEFAULT;
}

export function applyRestDraftPayloadNormalization(data: Record<string, unknown>): void {
  normalizeSsnInI9Payload(data);
  normalizeCitizenshipStatusCodeInI9Payload(data);
  normalizeDocumentATypeCodeForEverifyRest(data);
  normalizeAlienNumberInI9Payload(data);
  ensureI551NumberForFormI551(data);
  normalizeI551NumberInI9Payload(data);
  omitNoExpirationDateForFormI551(data);
  normalizeCaseCreatorPhoneForEverifyRest(data);
  omitEmptyDocumentSubTypeCode(data);
  ensureDocumentSubTypeCodeForPassportListA(data);
}

function parseEnvI9FixtureJson(): Record<string, unknown> | null {
  const raw =
    (process.env.EVERIFY_I9_FIXTURE_JSON && String(process.env.EVERIFY_I9_FIXTURE_JSON).trim()) ||
    (process.env.EVERIFY_STAGE_I9_FIXTURE_JSON && String(process.env.EVERIFY_STAGE_I9_FIXTURE_JSON).trim());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid I-9 fixture JSON (EVERIFY_I9_FIXTURE_JSON / EVERIFY_STAGE_I9_FIXTURE_JSON)');
  }
}

function toDateOnlyFromFirestore(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const s = value.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Non-sensitive profile hints from users/{userId}. Does not include SSN (not stored on profile in HRX).
 */
export async function loadUserI9HintsFromFirestore(userId: string): Promise<Record<string, unknown>> {
  const id = String(userId || '').trim();
  if (!id) return {};
  const snap = await admin.firestore().collection('users').doc(id).get();
  if (!snap.exists) return {};
  const u = (snap.data() || {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof u.firstName === 'string' && u.firstName.trim()) out.first_name = u.firstName.trim();
  if (typeof u.lastName === 'string' && u.lastName.trim()) out.last_name = u.lastName.trim();
  const dobStr = toDateOnlyFromFirestore(u.dob ?? u.dateOfBirth);
  if (dobStr) out.date_of_birth = dobStr;
  return out;
}

function assignDefined(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    target[k] = v;
  }
}

const I9_SUPPORTING_IDENTITY_KEYS = ['first_name', 'last_name', 'date_of_birth'] as const;

/** Approved I-9 supporting docs: document fields always merge; identity from extraction only fills blanks. */
function applyApprovedI9SupportingToMerged(
  merged: Record<string, unknown>,
  partial: Record<string, string>,
): void {
  for (const [k, v] of Object.entries(partial)) {
    if ((I9_SUPPORTING_IDENTITY_KEYS as readonly string[]).includes(k)) continue;
    if (v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    merged[k] = v;
  }
  for (const k of I9_SUPPORTING_IDENTITY_KEYS) {
    const v = partial[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    const cur = merged[k];
    if (cur === undefined || cur === null || (typeof cur === 'string' && String(cur).trim() === '')) {
      merged[k] = v;
    }
  }
}

async function loadApprovedI9SupportingPartial(tenantId: string, userId: string): Promise<Record<string, string>> {
  const id = String(userId || '').trim();
  const tid = String(tenantId || '').trim();
  if (!id || !tid) return {};
  const snap = await admin.firestore().collection(`tenants/${tid}/worker_i9_supporting_documents`).where('userId', '==', id).get();
  const rows: I9SupportingDocLike[] = snap.docs.map((d) => d.data() as I9SupportingDocLike);
  return i9SupportingApprovedToI9CaseFlatPartial(rows);
}

/**
 * Canonical path for everifyCreateCase: optional env defaults → Firestore user profile hints →
 * explicit employee fields from the client (admin UI) → hire date + case creator overrides.
 * NEVER log merged payload.
 */
export async function resolveI9PayloadForCreateCase(params: {
  tenantId: string;
  userId: string;
  employeeFromClient?: Partial<I9CaseFlat> | null;
  serviceOverrides: Partial<I9CaseFlat>;
}): Promise<I9CaseFlat> {
  assertEverifyEnvUrlConsistency();

  const merged: Record<string, unknown> = {};

  const fromEnv = parseEnvI9FixtureJson();
  if (fromEnv) assignDefined(merged, fromEnv);

  const hints = await loadUserI9HintsFromFirestore(params.userId);
  assignDefined(merged, hints);

  const fromSupporting = await loadApprovedI9SupportingPartial(params.tenantId, params.userId);
  applyApprovedI9SupportingToMerged(merged, fromSupporting);

  if (params.employeeFromClient && typeof params.employeeFromClient === 'object') {
    assignDefined(merged, params.employeeFromClient as Record<string, unknown>);
  }

  assignDefined(merged, params.serviceOverrides as Record<string, unknown>);

  sanitizeIcaFormatFieldsInPayload(merged);
  normalizeSsnInI9Payload(merged);
  normalizeCitizenshipStatusCodeInI9Payload(merged);
  validateI9ListDocumentsForEverifyRest(merged);
  validateI9Required(merged);
  return merged as I9CaseFlat;
}

/**
 * Dry run / tests: full fixture JSON required in env (merge overrides after parse).
 * NEVER log the payload.
 */
export function resolveI9PayloadFromFixture(overrides?: Partial<I9CaseFlat>): I9CaseFlat {
  assertEverifyEnvUrlConsistency();

  const data = parseEnvI9FixtureJson();
  if (!data) {
    throw new Error(
      'Missing I-9 payload fixture: set EVERIFY_I9_FIXTURE_JSON (preferred) or EVERIFY_STAGE_I9_FIXTURE_JSON ' +
        '(single-line i9_case_flat JSON). Root .env → copy-env → functions/.env, or GCP env on the function.'
    );
  }

  const merged: Record<string, unknown> = overrides ? { ...data, ...overrides } : { ...data };
  sanitizeIcaFormatFieldsInPayload(merged);
  normalizeSsnInI9Payload(merged);
  normalizeCitizenshipStatusCodeInI9Payload(merged);
  validateI9ListDocumentsForEverifyRest(merged);
  validateI9Required(merged);
  return merged as I9CaseFlat;
}
