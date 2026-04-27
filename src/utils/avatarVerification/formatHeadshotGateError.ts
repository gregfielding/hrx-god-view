/**
 * Client-side translator for the Accept-flow headshot gate error thrown by
 * `functions/src/avatar/headshotAcceptGate.ts#assertWorkerHeadshotApproved`.
 *
 * The server throws `HttpsError('failed-precondition', ..., { code, status, rejectionReason })`
 * and the Firebase callable client surfaces that as a `FirebaseError` with `.code` (prefixed
 * by 'functions/') plus `.details` (the server's third argument).
 *
 * Use this helper in any UI that invokes `respondToAssignment` or `confirmAssignmentForWorker`
 * so the message shown to the worker honors their `preferredLanguage`. Non-gate errors fall
 * through to `null`, letting the caller render a generic fallback.
 */
import { t } from '../../i18n';
import type { AvatarRejectionReason } from '../../types/avatarVerification';

export type HeadshotGateErrorCode =
  | 'HEADSHOT_MISSING'
  | 'HEADSHOT_PENDING'
  | 'HEADSHOT_REJECTED'
  | 'HEADSHOT_ERROR';

export interface HeadshotGateDetails {
  code: HeadshotGateErrorCode;
  status: 'missing' | 'pending' | 'approved' | 'rejected' | 'error';
  rejectionReason: AvatarRejectionReason | null;
}

export interface FormattedHeadshotGateError {
  code: HeadshotGateErrorCode;
  rejectionReason: AvatarRejectionReason | null;
  /** Localized message ready to show in an Alert / Snackbar. */
  message: string;
  /** Localized label for the retake CTA. */
  retakeLabel: string;
}

/**
 * Returns a translated error payload when `err` is the headshot gate, or `null` when it's
 * any other error (network, permission-denied, invalid-argument, etc.).
 */
export function formatHeadshotGateError(err: unknown): FormattedHeadshotGateError | null {
  const details = extractDetails(err);
  if (!details) return null;

  const { code, rejectionReason } = details;
  const message = messageFor(code, rejectionReason);
  const retakeLabel = t('avatarVerification.retakeButton');
  return { code, rejectionReason, message, retakeLabel };
}

/** True when the error is the Accept-flow headshot gate. */
export function isHeadshotGateError(err: unknown): boolean {
  return extractDetails(err) !== null;
}

function extractDetails(err: unknown): HeadshotGateDetails | null {
  if (!err || typeof err !== 'object') return null;
  // Firebase callable client wraps HttpsError as FirebaseError with `.code === 'functions/<grpc-code>'`.
  // We accept either that form or the raw grpc code for robustness against test harnesses.
  const codeField = (err as { code?: unknown }).code;
  const codeStr = typeof codeField === 'string' ? codeField : '';
  if (!codeStr.endsWith('failed-precondition')) return null;

  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const maybe = details as Partial<HeadshotGateDetails>;
  if (typeof maybe.code !== 'string') return null;
  if (
    maybe.code !== 'HEADSHOT_MISSING' &&
    maybe.code !== 'HEADSHOT_PENDING' &&
    maybe.code !== 'HEADSHOT_REJECTED' &&
    maybe.code !== 'HEADSHOT_ERROR'
  ) {
    return null;
  }
  return {
    code: maybe.code,
    status: (maybe.status ?? 'missing') as HeadshotGateDetails['status'],
    rejectionReason: (maybe.rejectionReason ?? null) as AvatarRejectionReason | null,
  };
}

function messageFor(
  code: HeadshotGateErrorCode,
  rejectionReason: AvatarRejectionReason | null,
): string {
  if (code === 'HEADSHOT_REJECTED' && rejectionReason) {
    // Reuse the same rejection copy we show in the profile pill so the worker sees a
    // consistent explanation regardless of which surface catches them.
    return t(`avatarVerification.rejection.${rejectionReason}`);
  }

  switch (code) {
    case 'HEADSHOT_MISSING':
      return t('avatarVerification.gateMissing');
    case 'HEADSHOT_PENDING':
      return t('avatarVerification.checkingFull');
    case 'HEADSHOT_REJECTED':
      // No specific reason captured — fall back to the generic retake nudge.
      return t('avatarVerification.gateRejectedGeneric');
    case 'HEADSHOT_ERROR':
    default:
      return t('avatarVerification.errorRetry');
  }
}
