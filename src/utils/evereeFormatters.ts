/**
 * Display helpers for Everee API responses (User Profile → Employment & Payroll
 * panel). All inputs are best-effort — Everee responses arrive shaped however
 * Everee feels, so each helper coerces defensively and returns "—" / "default"
 * rather than throwing.
 *
 * Nothing here writes back to Firestore; we render PII to the screen and let
 * it disappear when the component unmounts (see component doc).
 */

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Everee address shape used across `homeAddress`, `legalWorkAddress`, etc.
 * Always wrapped in a `current` object (and sometimes a `history` array we
 * ignore). Field names mirror Everee's docs. We keep both `postalCode` and
 * `zipCode`/`zip` since the worker schema has used all three across
 * revisions.
 */
export interface EvereeAddressShape {
  current?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    zipCode?: string | null;
    zip?: string | null;
  } | null;
}

export function formatEvereeAddress(addr: EvereeAddressShape | null | undefined): string {
  const c = addr?.current ?? null;
  if (!c) return '—';
  const street = [c.line1, c.line2].map((s) => (s ? String(s).trim() : '')).filter(Boolean).join(', ');
  const city = c.city ? String(c.city).trim() : '';
  const state = c.state ? String(c.state).trim() : '';
  const zip = (c.postalCode ?? c.zipCode ?? c.zip ?? '') ? String(c.postalCode ?? c.zipCode ?? c.zip).trim() : '';
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const out = [street, cityStateZip].filter(Boolean).join(', ').trim();
  return out || '—';
}

export function formatBankAllocation(
  amount: number | null | undefined,
  type: 'PERCENT' | 'FIXED' | string | null | undefined,
): string {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  const n = Number(amount);
  const t = String(type || '').trim().toUpperCase();
  if (t === 'PERCENT') {
    // Everee returns 1 = 100%, 0.5 = 50%. Show whole percent unless we have a
    // fractional component worth surfacing.
    const pct = n * 100;
    const rounded = Math.round(pct * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`;
  }
  if (t === 'FIXED') {
    return `$${n.toFixed(2)}`;
  }
  return `${n}`;
}

/**
 * E.4 — TIN-status chip color. Adds `info` to the union so
 * `SENT_FOR_VERIFICATION` can render its own color (blue) distinct from
 * the never-submitted state. Pre-E.4 the union already declared `warning`
 * but no branch returned it; we still don't (Everee's TIN state machine
 * has no "warning" tier — only verified / submitted / not-submitted /
 * mismatch). The `warning` member is kept on the union for forward-compat
 * (e.g. if Everee adds an "EXPIRING" state we want to slot in without a
 * type break).
 */
export type TinStatusColor = 'success' | 'warning' | 'error' | 'info' | 'default';

export interface TinStatusDisplay {
  label: string;
  color: TinStatusColor;
}

/**
 * E.4 — Map Everee's 4-state TIN-verification machine to a chip-friendly
 * { label, color } pair. The four states mirror
 * `EvereeTinVerificationStatus` (see
 * `functions/src/integrations/everee/evereeReadinessMirror.ts`) and the
 * canonical mapping in `shared/readinessStatusFromEvereeMirror.ts` (E.3):
 *
 *   - `VERIFIED`              → success / "IRS verified"
 *   - `SENT_FOR_VERIFICATION` → info    / "Submitted to IRS"
 *   - `NEEDS_VERIFICATION`    → default / "Not submitted"
 *   - `MISMATCH`              → error   / "IRS rejected — needs correction"
 *
 * Aliases handled:
 *   - `NEEDS_VERIFY`          → treated as `NEEDS_VERIFICATION`
 *   - `INVALID`               → treated as `MISMATCH`
 *   - `PENDING` / `SUBMITTED` → treated as `SENT_FOR_VERIFICATION`
 *     (Everee historically used `PENDING` interchangeably with
 *     `SENT_FOR_VERIFICATION`; collapsing them avoids the pre-E.4
 *     bug where `PENDING` rendered identically to "never submitted".)
 *
 * Labels are intentionally **short** (status-only, no "SSN:" / "TIN:"
 * prefix). The single in-app caller — `EmployeePayrollSection.tsx` — uses
 * this inside a row labeled "TIN verification:", so a prefix would
 * double-up. Chip-strip surfaces that lack row context (header chip,
 * matrix cells) should source their copy from
 * `getReadinessItemDisplay({ requirementType: 'tin_verification', … })`
 * which returns the prefixed labels per the E.4 spec ("SSN: IRS
 * verified" / "SSN: Submitted to IRS" / etc.).
 */
export function formatTinStatus(status: string | null | undefined): TinStatusDisplay {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'VERIFIED') return { label: 'IRS verified', color: 'success' };
  if (s === 'SENT_FOR_VERIFICATION' || s === 'PENDING' || s === 'SUBMITTED') {
    return { label: 'Submitted to IRS', color: 'info' };
  }
  if (s === 'NEEDS_VERIFICATION' || s === 'NEEDS_VERIFY') {
    return { label: 'Not submitted', color: 'default' };
  }
  if (s === 'MISMATCH' || s === 'INVALID') {
    return { label: 'IRS rejected — needs correction', color: 'error' };
  }
  if (!s) return { label: 'Unknown', color: 'default' };
  return { label: titleCase(s) || 'Unknown', color: 'default' };
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Parse Everee date strings ("YYYY-MM-DD" or full ISO) without losing a day to
 * timezone shifts. Pure date strings are pinned to UTC noon so US tz never
 * pulls them back to the previous day.
 */
function parseEvereeDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0));
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatEvereeShortDate(input: string | null | undefined): string {
  const d = parseEvereeDate(input);
  if (!d) return '—';
  // For YYYY-MM-DD inputs we anchored to UTC noon, so reading UTC components
  // gives the same calendar day everywhere.
  const useUTC = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim());
  const month = useUTC ? d.getUTCMonth() : d.getMonth();
  const day = useUTC ? d.getUTCDate() : d.getDate();
  const year = useUTC ? d.getUTCFullYear() : d.getFullYear();
  return `${MONTHS_SHORT[month]} ${day}, ${year}`;
}

export function formatEvereeShortDateTime(input: string | null | undefined): string {
  const d = parseEvereeDate(input);
  if (!d) return '—';
  // For richer timestamps we still want the local day so support people see
  // the same value as the worker.
  const month = d.getMonth();
  const day = d.getDate();
  const year = d.getFullYear();
  return `${MONTHS_SHORT[month]} ${day}, ${year}`;
}

/** MUI Chip color names accepted by `<Chip color={...}>`. */
export type EvereeMuiChipColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'error'
  | 'info'
  | 'warning';

export type EvereeWorkerFileDocumentType = 'TAXES' | 'ONBOARDING' | 'POLICY';

/**
 * Human-facing label for a file document-type bucket. Group headers in the
 * "Files" section of the Employment & Payroll panel call this.
 */
export function formatDocumentTypeLabel(type: EvereeWorkerFileDocumentType): string {
  switch (type) {
    case 'TAXES':
      return 'Tax Documents';
    case 'ONBOARDING':
      return 'Onboarding';
    case 'POLICY':
      return 'Company Policies';
    default:
      return 'Other';
  }
}

/**
 * Chip color for a file document-type. Tax = `info` (blue), Onboarding =
 * `default` (neutral), Policy = `secondary` (purple) so the three groups
 * are immediately distinguishable in dense lists.
 */
export function formatDocumentTypeColor(type: EvereeWorkerFileDocumentType): EvereeMuiChipColor {
  switch (type) {
    case 'TAXES':
      return 'info';
    case 'ONBOARDING':
      return 'default';
    case 'POLICY':
      return 'secondary';
    default:
      return 'default';
  }
}
