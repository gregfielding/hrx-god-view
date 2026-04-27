/**
 * ICA / E-Verify REST attribute format guards (see API 400 ATTRIBUTE_FORMAT responses).
 */

/** ICA pattern for List B/C document numbers: /^[a-zA-Z0-9*-]*$/ */
export function sanitizeEverifyDocumentNumber(raw: string): string {
  return String(raw ?? '').replace(/[^a-zA-Z0-9*-]/g, '');
}

/** ICA pattern for case_creator_name: /^[a-zA-Z'’\-\. ]*$/ — emails and digits are invalid. */
export function sanitizeCaseCreatorNameForIca(raw: string, fallback: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return fallback;
  if (s.includes('@')) {
    s = s.slice(0, s.indexOf('@')).trim();
  }
  const cleaned = s
    .replace(/[^a-zA-Z'’\-\. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2) return cleaned.slice(0, 120);
  return fallback;
}
