/**
 * USCIS ICA create-draft preflight: citizenship/document rules **after** applyRestDraftPayloadNormalization.
 * Aligns with `src/constants/everifyI9DocumentWizard.ts` List A presets (REST enums).
 * NEVER log payload fields that contain PII.
 */

import { logger } from 'firebase-functions/v2';

const REST_CITIZENSHIP = new Set([
  'US_CITIZEN',
  'NONCITIZEN',
  'LAWFUL_PERMANENT_RESIDENT',
  'ALIEN_AUTHORIZED_TO_WORK',
  'NONCITIZEN_AUTHORIZED_TO_WORK',
]);

/** List A document_a_type_code → required i9_case_flat identity-doc number field(s) (one must be non-empty). */
const LIST_A_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  US_PASSPORT: ['us_passport_number'],
  US_PASSPORT_RECEIPT: ['us_passport_number'],
  FORM_I551: ['i551_number'],
  FORM_I766: ['i766_number'],
  /** Confirm enum names against ICA PDF; fields per ICA i9_case_flat. */
  FOREIGN_PASSPORT: ['foreign_passport_number'],
  US_VISA: ['visa_number'],
  FORM_I94: ['i94_number'],
  SEVIS: ['sevis_number'],
};

/**
 * Allowed List A document for citizenship (wizard + extended work-auth docs).
 * When List A is used, enforce alignment for known preset codes.
 */
const CITIZENSHIP_TO_ALLOWED_LIST_A = new Map<string, Set<string>>([
  ['US_CITIZEN', new Set(['US_PASSPORT', 'US_PASSPORT_RECEIPT'])],
  ['NONCITIZEN', new Set(['US_PASSPORT', 'US_PASSPORT_RECEIPT'])],
  ['LAWFUL_PERMANENT_RESIDENT', new Set(['FORM_I551'])],
  ['ALIEN_AUTHORIZED_TO_WORK', new Set(['FORM_I766', 'FOREIGN_PASSPORT', 'US_VISA', 'FORM_I94', 'SEVIS'])],
  ['NONCITIZEN_AUTHORIZED_TO_WORK', new Set(['FORM_I766', 'FOREIGN_PASSPORT', 'US_VISA', 'FORM_I94', 'SEVIS'])],
]);

/** Preset List A codes we enforce for citizenship↔document alignment (custom ICA enums skip this check). */
const PRESET_LIST_A_FOR_CITIZENSHIP_CHECK = new Set([
  'US_PASSPORT',
  'US_PASSPORT_RECEIPT',
  'FORM_I551',
  'FORM_I766',
  'FOREIGN_PASSPORT',
  'US_VISA',
  'FORM_I94',
  'SEVIS',
]);

/** List B / C codes we partially validate (state / number hints). */
const LIST_B_STATE_CODES = new Set(['DRIVERS_LICENSE', 'GOVERNMENT_ID_CARD']);

export type ExtendedListAPreflightMode = 'off' | 'warn' | 'error';

function extendedListAMode(): ExtendedListAPreflightMode {
  const raw = String(process.env.EVERIFY_PREFLIGHT_EXTENDED_LISTA || 'warn').toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'error' || raw === 'true' || raw === '1') return 'error';
  return 'warn';
}

const EXTENDED_LIST_A_CODES = new Set(['FOREIGN_PASSPORT', 'US_VISA', 'FORM_I94', 'SEVIS']);

function normStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function nonEmpty(v: unknown): boolean {
  return normStr(v) !== '';
}

/** US state for List B identity docs (2-letter). */
function normUsState(v: unknown): string {
  const s = normStr(v).toUpperCase();
  return s.length === 2 ? s : '';
}

/**
 * Reject disallowed SSN patterns after ###-##-#### normalization.
 */
function validateSsnNotDisallowedTestPattern(data: Record<string, unknown>): void {
  const s = normStr(data.ssn);
  if (!/^\d{3}-\d{2}-\d{4}$/.test(s)) {
    throw new Error('E-Verify preflight: ssn must be normalized to ###-##-####.');
  }
  const DISALLOWED = new Set([
    '000-00-0000',
    '666-00-0000',
    '123-45-6789',
    '111-11-1111',
    '999-99-9999',
  ]);
  if (DISALLOWED.has(s)) {
    throw new Error('E-Verify preflight: ssn must not use a disallowed test or invalid pattern.');
  }
}

function validateListBcPerType(data: Record<string, unknown>): void {
  const hasB = nonEmpty(data.document_b_type_code);
  const hasC = nonEmpty(data.document_c_type_code);
  if (!hasB || !hasC) return;

  const bCode = normStr(data.document_b_type_code);
  if (LIST_B_STATE_CODES.has(bCode) && !normUsState(data.us_state_code)) {
    throw new Error(
      `E-Verify preflight: document_b_type_code "${bCode}" requires us_state_code (2-letter state).`,
    );
  }

  const cCode = normStr(data.document_c_type_code);
  if (cCode === 'SOCIAL_SECURITY_CARD') {
    const n = normStr(data.document_c_number).replace(/\D/g, '');
    if (n && n.length !== 9) {
      logger.warn('everify.preflight_ssn_card_format', {
        message: 'document_c_number for SOCIAL_SECURITY_CARD should be 9 digits when provided',
      });
    }
  }
}

function validateExtendedListAFields(
  docA: string,
  data: Record<string, unknown>,
  mode: ExtendedListAPreflightMode,
): void {
  if (!EXTENDED_LIST_A_CODES.has(docA)) return;
  if (mode === 'off') return;

  const required = LIST_A_REQUIRED_FIELDS[docA];
  if (!required) return;
  const ok = required.some((field) => nonEmpty(data[field]));
  const needsCountry = docA === 'FOREIGN_PASSPORT' && !nonEmpty(data.country_code);

  if (ok && !needsCountry) return;

  const msg =
    `E-Verify preflight: document_a_type_code "${docA}" expects fields: ${required.join(', ')}` +
    (needsCountry ? ' and country_code.' : '.');

  if (mode === 'warn') {
    logger.warn('everify.preflight_extended_list_a', {
      document_a_type_code: docA,
      rule: 'EXTENDED_LIST_A_FIELDS',
      message: msg,
    });
    return;
  }

  throw new Error(msg);
}

/**
 * Sanitized summary for logging (no PII).
 */
export function summarizeI9PayloadForPreflightLog(data: Record<string, unknown>): Record<string, unknown> {
  return {
    citizenship_status_code:
      typeof data.citizenship_status_code === 'string' ? data.citizenship_status_code : undefined,
    hasDocumentA: Boolean(data.document_a_type_code),
    document_a_type_code:
      typeof data.document_a_type_code === 'string' ? data.document_a_type_code : undefined,
    hasDocumentB: Boolean(data.document_b_type_code),
    hasDocumentC: Boolean(data.document_c_type_code),
  };
}

/**
 * Throw with a stable prefix so callers can map to user-facing errors without logging raw payload.
 */
export function preflightI9CreateCasePayloadAfterNormalization(data: Record<string, unknown>): void {
  validateSsnNotDisallowedTestPattern(data);

  const c = normStr(data.citizenship_status_code);
  if (!c || !REST_CITIZENSHIP.has(c)) {
    throw new Error(
      `E-Verify preflight: citizenship_status_code must be a USCIS REST enum ` +
        `(${[...REST_CITIZENSHIP].join(', ')}). Got: ${c || '(empty)'}.`,
    );
  }

  for (const key of ['date_of_birth', 'date_of_hire'] as const) {
    const s = normStr(data[key]);
    if (!isYmd(s)) {
      throw new Error(`E-Verify preflight: ${key} must be YYYY-MM-DD.`);
    }
  }

  const exp = normStr(data.expiration_date);
  if (exp && !isYmd(exp)) {
    throw new Error('E-Verify preflight: expiration_date must be YYYY-MM-DD when provided.');
  }

  const hasA = nonEmpty(data.document_a_type_code);
  const hasB = nonEmpty(data.document_b_type_code);
  const hasC = nonEmpty(data.document_c_type_code);

  const extMode = extendedListAMode();

  if (hasA) {
    const docA = normStr(data.document_a_type_code);
    if (PRESET_LIST_A_FOR_CITIZENSHIP_CHECK.has(docA)) {
      const allowedForCit = CITIZENSHIP_TO_ALLOWED_LIST_A.get(c);
      if (allowedForCit && !allowedForCit.has(docA)) {
        throw new Error(
          `E-Verify preflight: document_a_type_code "${docA}" is not valid for citizenship_status_code "${c}".`,
        );
      }
    }

    validateExtendedListAFields(docA, data, extMode);

    const required = LIST_A_REQUIRED_FIELDS[docA];
    if (required && !EXTENDED_LIST_A_CODES.has(docA)) {
      const ok = required.some((field) => nonEmpty(data[field]));
      if (!ok) {
        throw new Error(
          `E-Verify preflight: document_a_type_code "${docA}" requires one of: ${required.join(', ')}.`,
        );
      }
    }
  }

  if (hasB && hasC) {
    if (!nonEmpty(data.document_bc_number)) {
      throw new Error(
        'E-Verify preflight: List B+C path requires document_bc_number (List B identity document number).',
      );
    }
    const hasExp = nonEmpty(data.expiration_date);
    const noExp = data.no_expiration_date === true;
    if (!hasExp && !noExp) {
      throw new Error(
        'E-Verify preflight: List B+C path requires expiration_date or no_expiration_date=true (ICA).',
      );
    }
    validateListBcPerType(data);
  }

  const empEmail = normStr(data.employee_email_address).toLowerCase();
  const creatorEmail = normStr(data.case_creator_email_address).toLowerCase();
  if (empEmail && creatorEmail && empEmail === creatorEmail) {
    throw new Error(
      'E-Verify preflight: employee_email_address must not equal case_creator_email_address (ICA rule).',
    );
  }
}
