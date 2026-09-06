/**
 * Client-side translator for the Claim Shift typed errors thrown by
 * `functions/src/claims/claimShift.ts` (via `respondToAssignment` with
 * `decision: 'claim'`).
 *
 * Server contract: `HttpsError('failed-precondition', msg, { code, ...extra })`
 * where `code` ∈ shift_filled | tier_locked | conflict | claim_cap |
 * ineligible | not_claimable. The Firebase callable client surfaces that as a
 * `FirebaseError` with `.code === 'functions/failed-precondition'` and
 * `.details` = the server's third argument. The headshot gate rides the same
 * callable with its own `HEADSHOT_*` codes — check `formatHeadshotGateError`
 * first; this helper returns null for those.
 *
 * Flutter twin: `lib/features/assignments/domain/claim_shift_error.dart`.
 */
import { t } from '../../i18n';

export type ClaimShiftErrorCode =
  | 'shift_filled'
  | 'tier_locked'
  | 'conflict'
  | 'claim_cap'
  | 'ineligible'
  | 'not_claimable';

const CODES: ReadonlySet<string> = new Set([
  'shift_filled',
  'tier_locked',
  'conflict',
  'claim_cap',
  'ineligible',
  'not_claimable',
]);

export interface ClaimShiftErrorDetails {
  code: ClaimShiftErrorCode;
  reason?: string;
  opensAtMs?: number;
  cap?: number;
  conflict?: {
    assignmentId?: string;
    jobTitle?: string;
    locationName?: string;
    startDate?: string;
    startTime?: string;
    endTime?: string;
  };
}

export interface FormattedClaimShiftError {
  code: ClaimShiftErrorCode;
  details: ClaimShiftErrorDetails;
  /** Localized message ready for the sheet's Alert. */
  message: string;
  /** True when the row should flip to a terminal "filled" state. */
  shiftFilled: boolean;
}

function formatClock(hhmm?: string): string {
  if (!hhmm || !hhmm.includes(':')) return hhmm || '';
  const [h, m] = hhmm.split(':');
  const hour = Number(h);
  if (!Number.isFinite(hour)) return hhmm;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 || 12;
  return `${display}:${m} ${ampm}`;
}

function messageFor(details: ClaimShiftErrorDetails, fallback: string): string {
  switch (details.code) {
    case 'shift_filled':
      return t('jobs.claimErrorFilled');
    case 'tier_locked': {
      const when = details.opensAtMs
        ? new Date(details.opensAtMs).toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : '';
      return when ? t('jobs.claimErrorTierLockedAt', { when }) : t('jobs.claimErrorTierLocked');
    }
    case 'conflict': {
      const c = details.conflict || {};
      const range = [formatClock(c.startTime), formatClock(c.endTime)].filter(Boolean).join('–');
      const where = c.locationName || c.jobTitle || '';
      return range || where
        ? t('jobs.claimErrorConflictAt', { time: range || '—', site: where || '—' })
        : t('jobs.claimErrorConflict');
    }
    case 'claim_cap':
      return t('jobs.claimErrorCap', { cap: String(details.cap ?? 2) });
    case 'ineligible':
      return t('jobs.claimErrorIneligible');
    case 'not_claimable':
      return details.reason === 'started' ? t('jobs.claimErrorStarted') : t('jobs.claimErrorNotClaimable');
    default:
      return fallback;
  }
}

function extractDetails(err: unknown): { details: ClaimShiftErrorDetails; rawMessage: string } | null {
  if (!err || typeof err !== 'object') return null;
  const codeField = (err as { code?: unknown }).code;
  const code = typeof codeField === 'string' ? codeField : '';
  if (code !== 'functions/failed-precondition' && code !== 'failed-precondition') return null;
  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const inner = String((details as { code?: unknown }).code ?? '');
  if (!CODES.has(inner)) return null;
  const rawMessage = String((err as { message?: unknown }).message ?? '')
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
    .trim();
  return { details: details as ClaimShiftErrorDetails, rawMessage };
}

/** Localized payload when `err` is a Claim Shift typed error; null otherwise. */
export function formatClaimShiftError(err: unknown): FormattedClaimShiftError | null {
  const extracted = extractDetails(err);
  if (!extracted) return null;
  const { details, rawMessage } = extracted;
  return {
    code: details.code,
    details,
    message: messageFor(details, rawMessage || t('jobs.claimErrorGeneric')),
    shiftFilled: details.code === 'shift_filled',
  };
}
