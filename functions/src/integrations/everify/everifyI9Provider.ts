/**
 * E-Verify I-9 payload provider.
 * Assembles i9_case_flat just-in-time. NEVER store or log SSN/doc numbers.
 * ICA v31 Refactor Pack §4.4
 */

import * as admin from 'firebase-admin';
import type { I9CaseFlat } from './everifySchemas';
import { assertEverifyEnvUrlConsistency } from './everifyConfig';

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

/**
 * Canonical path for everifyCreateCase: optional env defaults → Firestore user profile hints →
 * explicit employee fields from the client (admin UI) → hire date + case creator overrides.
 * NEVER log merged payload.
 */
export async function resolveI9PayloadForCreateCase(params: {
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

  if (params.employeeFromClient && typeof params.employeeFromClient === 'object') {
    assignDefined(merged, params.employeeFromClient as Record<string, unknown>);
  }

  assignDefined(merged, params.serviceOverrides as Record<string, unknown>);

  normalizeSsnInI9Payload(merged);
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
  normalizeSsnInI9Payload(merged);
  validateI9Required(merged);
  return merged as I9CaseFlat;
}
