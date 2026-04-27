/**
 * Submit-time merge: latest Firestore user doc + optional client session snapshot.
 * Used so prescreen scoring / hiring automation do not depend on a stale snapshot
 * or on Firestore write ordering vs. the submit request.
 */

const STRING_KEYS = new Set([
  'phone',
  'phoneE164',
  'city',
  'state',
  'zip',
  'resumeUrl',
  'resumeStoragePath',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Whitelist merge: `overlay` keys override `base` for profile fields used in prescreen eligibility / context.
 */
export function mergeEnrichedUserDocForPrescreenSubmit(
  base: Record<string, unknown> | undefined,
  overlay: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base || {}) };
  if (!overlay || !isPlainObject(overlay)) return out;

  for (const key of Object.keys(overlay)) {
    const v = overlay[key];
    if (v === undefined) continue;
    if (key === 'addressInfo' && isPlainObject(v)) {
      const prev = isPlainObject(out.addressInfo) ? (out.addressInfo as Record<string, unknown>) : {};
      out.addressInfo = { ...prev, ...v };
      continue;
    }
    if (key === 'resume' && isPlainObject(v)) {
      const prev = isPlainObject(out.resume) ? (out.resume as Record<string, unknown>) : {};
      out.resume = { ...prev, ...v };
      continue;
    }
    if (key === 'skills' && Array.isArray(v)) {
      out.skills = v;
      continue;
    }
    if (key === 'phoneVerified' && typeof v === 'boolean') {
      out.phoneVerified = v;
      continue;
    }
    if (STRING_KEYS.has(key) && typeof v === 'string') {
      out[key] = v;
      continue;
    }
    if (key === 'phoneVerifiedAt') {
      out.phoneVerifiedAt = v;
    }
  }

  return out;
}

/** Parse and sanitize optional client payload (HTTPS callable input). */
export function parseSessionProfileEnhancements(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (!isPlainObject(raw)) return undefined;
  const o: Record<string, unknown> = {};

  if ('skills' in raw && Array.isArray(raw.skills) && raw.skills.length <= 500) {
    o.skills = raw.skills;
  }
  if ('resume' in raw && isPlainObject(raw.resume)) {
    o.resume = raw.resume;
  }
  if ('addressInfo' in raw && isPlainObject(raw.addressInfo)) {
    o.addressInfo = raw.addressInfo;
  }
  if ('phoneVerified' in raw && typeof raw.phoneVerified === 'boolean') {
    o.phoneVerified = raw.phoneVerified;
  }
  for (const k of STRING_KEYS) {
    if (k in raw && typeof raw[k] === 'string' && String(raw[k]).length <= 2000) {
      o[k] = raw[k];
    }
  }
  if ('phoneVerifiedAt' in raw && raw.phoneVerifiedAt !== undefined) {
    o.phoneVerifiedAt = raw.phoneVerifiedAt;
  }

  return Object.keys(o).length > 0 ? o : undefined;
}
