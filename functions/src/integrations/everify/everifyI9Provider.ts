/**
 * E-Verify I-9 payload provider.
 * Assembles i9_case_flat just-in-time. NEVER store or log SSN/doc numbers.
 * ICA v31 Refactor Pack §4.4
 */

import * as functions from 'firebase-functions';
import type { I9CaseFlat } from './everifySchemas';
import { getEverifyEnv, getEverifyBaseUrl } from './everifyConfig';

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

/**
 * Load and validate i9_case_flat from env or functions.config.
 * Optionally merge overrides (e.g. date_of_hire from employment).
 * Stage-only: throws if EVERIFY_ENV !== "stage" and base URL does not contain stage-everify.
 * NEVER log the payload.
 */
export function resolveI9PayloadFromFixture(overrides?: Partial<I9CaseFlat>): I9CaseFlat {
  const env = getEverifyEnv();
  const baseUrl = getEverifyBaseUrl();
  const isStage =
    env === 'stage' || baseUrl.includes('stage-everify');

  if (!isStage) {
    throw new Error('Fixture payload is stage-only.');
  }

  const raw =
    process.env.EVERIFY_STAGE_I9_FIXTURE_JSON ||
    (functions.config()?.everify as { stage_i9_fixture_json?: string } | undefined)?.stage_i9_fixture_json;

  if (!raw || typeof raw !== 'string') {
    throw new Error(
      'Missing I-9 fixture. Set EVERIFY_STAGE_I9_FIXTURE_JSON or functions.config().everify.stage_i9_fixture_json'
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid EVERIFY_STAGE_I9_FIXTURE_JSON (must be valid JSON)');
  }

  const missing: string[] = [];
  for (const key of REQUIRED_FIELDS) {
    const val = data[key];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`I-9 fixture missing required fields: ${missing.join(', ')}`);
  }

  const merged = overrides ? { ...data, ...overrides } : data;
  return merged as I9CaseFlat;
}
