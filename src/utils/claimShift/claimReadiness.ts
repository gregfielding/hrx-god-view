/**
 * Claim readiness — web mirror of the server rules in
 * functions/src/claims/claimShiftPolicy.ts (`isPayrollReadyForClaim`,
 * `evaluateClaimReadiness`) and functions/src/avatar/headshotAcceptGate.ts
 * (`evaluateHeadshotGate`, minus the worked-before grace period). Used to
 * pre-render "Finish setup to claim" before the tap; the server gate stays
 * authoritative. Flutter twin: lib/features/assignments/domain/claim_readiness.dart.
 */

/** C1 Events — 1099 on-call entity that hires everyone who applies. */
export const C1_EVENTS_ENTITY_ID = 'c1_events_llc';

/** Entities a worker can get hired at on their own: C1 Events hires everyone. */
export const SELF_SERVE_HIRE_ENTITY_IDS: ReadonlySet<string> = new Set([C1_EVENTS_ENTITY_ID]);

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

export interface EventsSetupSteps {
  photo: boolean;
  directDeposit: boolean;
  taxForm: boolean;
}

/**
 * C1 Events setup checklist — profile photo · direct deposit · 1099 tax form
 * (Greg 2026-09-11: an applicant who isn't fully set up is prompted for all
 * three). Finished payroll marks both payroll steps done: the readiness
 * mirror's `w9SignedAt` was missing on 969 of 2,255 Everee-complete C1 Events
 * workers that day, so the mirror's per-step flags only matter mid-setup.
 * `link` = `everee_workers/{entityId}__{uid}` (carries `readinessMirror`).
 */
export function eventsSetupSteps(args: {
  photoReady: boolean;
  payrollReady: boolean;
  link: Row | null | undefined;
}): EventsSetupSteps {
  const mirror = (args.link?.readinessMirror ?? null) as Row | null;
  return {
    photo: args.photoReady,
    directDeposit:
      args.payrollReady ||
      mirror?.directDepositReady === true ||
      Boolean(mirror?.directDepositVerifiedAt) ||
      Number(mirror?.bankAccountCount ?? 0) > 0,
    taxForm: args.payrollReady || Boolean(mirror?.w9SignedAt),
  };
}

export function isEventsSetupComplete(steps: EventsSetupSteps): boolean {
  return steps.photo && steps.directDeposit && steps.taxForm;
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
