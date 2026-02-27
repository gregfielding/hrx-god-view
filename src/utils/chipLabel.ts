/**
 * Ensures a value is safe to use as a React Chip/child label.
 * Handles objects with name, degree, jobTitle, title, canonicalId, etc.
 * Never returns an object - always returns a string to avoid "Objects are not valid as a React child".
 */
export function toChipLabel(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    const name =
      o.name ??
      o.degree ??
      o.jobTitle ??
      o.title ??
      o.label ??
      o.language ??
      o.program ??
      o.school ??
      o.canonicalId ??
      o.value ??
      o.fileName ??
      o.institution ??
      o.company ??
      o.employer;
    if (typeof name === 'string') return name;
  }
  return String(v ?? '');
}
