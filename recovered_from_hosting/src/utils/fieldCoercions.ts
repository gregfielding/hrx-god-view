export function toNumberSafe(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

export function toISODate(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

export function coerceSelect<T extends string>(value: any, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string') {
    const norm = value.toLowerCase();
    const match = (allowed as readonly string[]).find(a => a.toLowerCase() === norm);
    return (match as T) || fallback;
  }
  return fallback;
}


