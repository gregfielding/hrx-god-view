/**
 * Best-effort E.164 for SMS (Twilio) from user document fields.
 */
export function normalizeUserPhoneToE164(
  userData: { phoneE164?: unknown; phone?: unknown } | null | undefined
): string | null {
  const raw = String(userData?.phoneE164 || userData?.phone || '').trim();
  if (!raw) return null;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '');
    return digits.length >= 10 ? `+${digits}` : null;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}
