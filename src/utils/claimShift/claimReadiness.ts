/**
 * Claim readiness — web mirror of the server rules in
 * functions/src/claims/claimShiftPolicy.ts (`isPayrollReadyForClaim`,
 * `evaluateClaimReadiness`) and functions/src/avatar/headshotAcceptGate.ts
 * (`evaluateHeadshotGate`, minus the worked-before grace period). Used to
 * pre-render "Finish setup to claim" before the tap; the server gate stays
 * authoritative. Flutter twin: lib/features/assignments/domain/claim_readiness.dart.
 */

/** Entities a worker can get hired at on their own: C1 Events hires everyone. */
export const SELF_SERVE_HIRE_ENTITY_IDS: ReadonlySet<string> = new Set(['c1_events_llc']);

export type ClaimReadinessKind = 'ready' | 'start_onboarding' | 'setup_in_progress' | 'not_hired' | 'employment_ended';

type Row = Record<string, unknown>;

const ENDED_EMPLOYMENT_STATUSES = new Set(['terminated', 'inactive', 'blocked']);
const lowerTrim = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** Payroll is finished at this entity. Rows must already be filtered to this user + entity. */
export function isPayrollReadyForClaim(employments: ReadonlyArray<Row>, link: Row | null | undefined): boolean {
  if (link && (lowerTrim(link.status) === 'onboarding_complete' || Boolean(link.apiObservedOnboardingCompleteAt))) {
    return true;
  }
  return employments.some((e) => {
    if (ENDED_EMPLOYMENT_STATUSES.has(lowerTrim(e.status))) return false;
    return (
      lowerTrim(e.status) === 'active' ||
      e.onboardingComplete === true ||
      lowerTrim(e.evereeOnboardingStatus) === 'complete' ||
      Boolean(e.payrollOnboardingCompletedAt) ||
      lowerTrim(e.payrollStatus) === 'complete'
    );
  });
}

export function evaluateClaimReadiness(args: {
  entityId: string;
  employments: ReadonlyArray<Row>;
  link: Row | null | undefined;
}): ClaimReadinessKind {
  const live = args.employments.filter((e) => !ENDED_EMPLOYMENT_STATUSES.has(lowerTrim(e.status)));
  if (args.employments.length > 0 && live.length === 0) return 'employment_ended';
  if (isPayrollReadyForClaim(live, args.link)) return 'ready';
  if (live.length > 0) return 'setup_in_progress';
  return SELF_SERVE_HIRE_ENTITY_IDS.has(args.entityId) ? 'start_onboarding' : 'not_hired';
}

/** The worker must finish payroll setup before claiming ("Finish setup to claim"). */
export function claimNeedsSetup(kind: ClaimReadinessKind | null | undefined): boolean {
  return kind === 'start_onboarding' || kind === 'setup_in_progress';
}

const BLOCKING_REJECTION_REASONS = new Set(['no_face', 'multiple_faces', 'inappropriate', 'manual_override']);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Headshot won't block a claim (server `evaluateHeadshotGate` allow, without the grace period). */
export function isHeadshotReadyForClaim(user: Row | null | undefined): boolean {
  if (!user) return false;
  const workerProfile = (user.workerProfile ?? null) as Row | null;
  const photo = [user.avatar, user.photoUrl, workerProfile?.photoUrl, user['workerProfile.photoUrl']].find(nonEmpty);
  if (!photo) return false;
  const verification = (user.avatarVerification ?? null) as Row | null;
  const status = lowerTrim(verification?.status);
  if (!verification || !status) return true;
  const judged = nonEmpty(verification.sourceAvatarUrl) ? verification.sourceAvatarUrl.trim() : '';
  const currentAvatar = nonEmpty(user.avatar) ? user.avatar.trim() : photo.trim();
  if (judged && judged !== currentAvatar && judged !== photo.trim()) return true;
  if (status === 'approved' || status === 'pending' || status === 'error') return true;
  const reason = lowerTrim(verification.rejectionReason);
  return Boolean(reason) && !BLOCKING_REJECTION_REASONS.has(reason);
}
