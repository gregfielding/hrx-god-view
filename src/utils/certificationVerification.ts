/**
 * Hybrid Instawork + Qwick certification handling.
 * - Default: self-attestation for low-risk skills/experience (Instawork-style).
 * - Upload-required: specific certs require file upload and support Missing | Uploaded | Verified | Expired (Qwick-style).
 * Background checks, drug screens, and work authorization remain platform-controlled.
 */

export type CertificationVerificationStatus = 'missing' | 'uploaded' | 'verified' | 'expired';

/** Normalize for matching: lowercase, trim, collapse spaces */
function norm(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Substrings and patterns that identify upload-required certifications (Qwick-style). */
const UPLOAD_REQUIRED_PATTERNS: Array<{ pattern: RegExp | string; type: 'substring' | 'regex' }> = [
  { pattern: 'food handler', type: 'substring' },
  { pattern: 'food handlers', type: 'substring' },
  { pattern: 'food handler card', type: 'substring' },
  { pattern: 'alcohol server', type: 'substring' },
  { pattern: 'alcohol certification', type: 'substring' },
  { pattern: 'tips', type: 'substring' },
  { pattern: 'basset', type: 'substring' },
  { pattern: 'tam', type: 'substring' },
  { pattern: 'servsafe', type: 'substring' },
  { pattern: 'food protection manager', type: 'substring' },
  { pattern: 'cpr', type: 'substring' },
  { pattern: 'first aid', type: 'substring' },
  { pattern: 'cpr / first aid', type: 'substring' },
  { pattern: 'first aid / cpr', type: 'substring' },
  { pattern: 'forklift', type: 'substring' },
];

/**
 * Returns true if this requirement label is an upload-required certification (file upload + verification states).
 */
export function isUploadRequiredCert(label: string): boolean {
  const n = norm(label);
  if (!n) return false;
  for (const { pattern, type } of UPLOAD_REQUIRED_PATTERNS) {
    if (type === 'substring' && n.includes(pattern as string)) return true;
    if (type === 'regex' && (pattern as RegExp).test(n)) return true;
  }
  return false;
}

/** Profile cert shape: name, fileUrl?, uploadedAt?, expirationDate?, verificationStatus? */
export function getCertificationVerificationStatus(
  profileCert: { fileUrl?: string; expirationDate?: string; verificationStatus?: string } | null,
  now: Date = new Date()
): CertificationVerificationStatus {
  if (!profileCert || !profileCert.fileUrl) return 'missing';

  const exp = profileCert.expirationDate;
  if (exp) {
    const expDate = parseExpirationDate(exp);
    if (expDate && expDate < now) return 'expired';
  }

  const status = (profileCert.verificationStatus || '').toLowerCase();
  if (status === 'verified') return 'verified';
  return 'uploaded'; // has file, not verified => pending review
}

function parseExpirationDate(value: string): Date | null {
  if (!value || typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T23:59:59');
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Find a profile certification that matches the requirement label (by name).
 */
export function findProfileCertForRequirement(
  profileCerts: Array<{ name?: string; fileUrl?: string; expirationDate?: string; verificationStatus?: string }> | null,
  requirementLabel: string
): typeof profileCerts extends (infer T)[] ? T | null : null {
  if (!Array.isArray(profileCerts) || !requirementLabel) return null;
  const needle = norm(requirementLabel);
  for (const c of profileCerts) {
    const name = typeof c === 'string' ? c : (c?.name ?? '');
    if (norm(name) === needle || norm(name).includes(needle) || needle.includes(norm(name))) {
      return c as any;
    }
  }
  return null;
}
