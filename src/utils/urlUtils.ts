/**
 * Returns a safe href for links. Avoids treating phone numbers as URLs
 * (e.g. "(512) 636-9409" would otherwise become https://(512)%20636-9409 and cause ERR_NAME_NOT_RESOLVED).
 */
export function toSafeHref(value: string | null | undefined): string {
  if (value == null || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  // Do not treat phone numbers as URLs
  if (/^[\d\s().\-+xX]+$/.test(trimmed)) return '';
  if (trimmed.length <= 20 && !trimmed.includes('.') && /\d{3}/.test(trimmed)) return '';
  return `https://${trimmed}`;
}
