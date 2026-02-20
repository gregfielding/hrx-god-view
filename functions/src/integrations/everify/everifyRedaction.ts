/**
 * E-Verify redaction helpers.
 * Strip sensitive fields before storing raw response.
 * HRX E-Verify Master Plan §1.5, §3.5
 */

const SENSITIVE_KEYS = new Set([
  'ssn',
  'ssn1',
  'ssn2',
  'ssn3',
  'socialSecurityNumber',
  'aNumber',
  'alienNumber',
  'passportNumber',
  'documentNumber',
  'i9DocumentA',
  'i9DocumentB',
  'i9DocumentC',
  'photo',
  'image',
  'documentImage',
]);

/** Whitelist of non-PII fields allowed in stored raw response. ICA v31. */
const WHITELIST_RAW_KEYS = new Set([
  'case_number',
  'case_status',
  'case_status_display',
  'case_eligibility_statement',
  'ssa_referral_status',
  'dhs_referral_status',
  'dhs_referral_due_date',
  'dhs_referral_created_at',
  'dhs_referral_contact_by_date',
  'ev_star_referral_due_date',
  'ev_star_referral_created_at',
  'ev_star_referral_contact_by_date',
]);

/** Whitelist non-PII response keys for Firestore. Safer than blacklist. */
export function whitelistEverifyRaw(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of WHITELIST_RAW_KEYS) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

/**
 * Redact sensitive fields from an object (recursive, shallow on arrays).
 */
export function redactSensitiveFields(obj: unknown): Record<string, unknown> | null {
  if (obj == null || typeof obj !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes('ssn') || lower.includes('document')) {
      continue;
    }
    if (value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const nested = redactSensitiveFields(value);
      if (nested != null) out[key] = nested;
    } else {
      out[key] = value;
    }
  }
  return out;
}
