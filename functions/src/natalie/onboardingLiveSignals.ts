/**
 * Live payroll/onboarding signals, and the rule that a stale assignment snapshot may never claim something the
 * live data says is done (2026-09-11).
 *
 * Why: `assignments.readinessSnapshotV1.requirements[]` is written once and goes stale. Greg's own C1 Events
 * account has been complete in Everee since 2026-04-30 (direct deposit verified, W-9 signed, handbook signed,
 * 2 policies, TIN verified, onboardingComplete) yet its snapshot still read `i9=missing payroll_setup=in_progress
 * handbook=missing policies=missing`, so the follow-up texted a fully onboarded 1099 worker that he owed an I-9 —
 * which Everee itself marks `i9Applicable: false`. A scan found 31 of 86 open follow-ups would text the same
 * false "still open" (both personas, both entities). Recruiters had been reporting exactly that.
 *
 * The live sources are the ones assignment readiness itself uses:
 *   `worker_payroll_accounts/{uid}__{entityKey}`, `everee_workers/{entityId}__{uid}.readinessMirror`,
 *   `entity_employments/{uid}__{entityKey}`.
 *
 * `applyLiveSignals` only ever UPGRADES a step (to complete / not_applicable). It never marks something missing,
 * so a worker who genuinely still owes a step keeps getting nudged.
 */

export interface LiveSignals {
  /** Everee says this entity's worker does/doesn't need an I-9 (1099 contractors: false) and a W-4 (they sign a W-9). */
  i9Applicable: boolean;
  w4Applicable: boolean;
  payrollComplete: boolean;
  inviteSent: boolean;
  taxDone: boolean;
  i9Done: boolean;
  handbookDone: boolean;
  policiesDone: boolean;
  onboardingComplete: boolean;
  /** Which inputs said so — for the Slack line and for debugging. */
  reasons: string[];
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== false;

/** Pure: what payroll/Everee/employment actually say right now. */
export function readLiveSignals(args: {
  payrollAccount?: Record<string, unknown> | null;
  evereeMirror?: Record<string, unknown> | null;
  employment?: Record<string, unknown> | null;
}): LiveSignals {
  const pa = args.payrollAccount ?? {};
  const m = args.evereeMirror ?? {};
  const ee = args.employment ?? {};
  const reasons: string[] = [];
  const note = (cond: boolean, why: string) => { if (cond) reasons.push(why); return cond; };

  const onboardingComplete =
    note(m.onboardingComplete === true || s(m.onboardingStatus).toUpperCase() === 'COMPLETE', 'everee onboarding complete') ||
    note(s(ee.evereeOnboardingStatus) === 'complete', 'employment everee complete');

  const payrollComplete =
    onboardingComplete ||
    note(m.directDepositReady === true || has(m.directDepositVerifiedAt), 'direct deposit verified in Everee') ||
    note(['complete', 'verified'].includes(s(pa.directDepositStatus).toLowerCase()), 'payroll account direct deposit complete') ||
    note(s(pa.payrollStatus) === 'complete' || s(ee.payrollStatus) === 'complete', 'payroll status complete');

  const inviteSent =
    payrollComplete ||
    ['invite_sent', 'account_created', 'in_progress', 'complete'].includes(s(pa.payrollStatus)) ||
    s(pa.inviteStatus) === 'sent' ||
    has(pa.inviteSentAt) ||
    has(pa.payrollInviteSentAt) ||
    Object.keys(m).length > 0;

  const taxDone =
    note(has(m.w4SignedAt) || has(m.w9SignedAt), 'tax form signed in Everee') ||
    note(s(ee.taxIdentityStatus) === 'complete', 'employment tax identity complete') ||
    note(['complete', 'submitted', 'verified'].includes(s(pa.taxFormStatus).toLowerCase()), 'payroll account tax form complete') ||
    onboardingComplete;

  const i9Applicable = m.i9Applicable !== false;
  const w4Applicable = m.w4Applicable !== false;

  return {
    i9Applicable,
    w4Applicable,
    payrollComplete,
    inviteSent,
    taxDone,
    i9Done: note(has(m.i9SignedAt) || has(ee.i9Section1CompletedAt), 'I-9 signed'),
    handbookDone: note(has(m.handbookSignedAt), 'handbook signed in Everee'),
    policiesDone: note(Number(m.policiesSignedCount ?? 0) > 0, 'policies signed in Everee'),
    onboardingComplete,
    reasons,
  };
}

export interface StepLike { key: string; label: string; status: string; actor: 'worker' | 'recruiter' }

/**
 * Pure: upgrade steps the live data says are done (or that don't apply to this entity). Never downgrades — a
 * step the snapshot calls complete stays complete, and anything still genuinely open stays open.
 */
export function applyLiveSignals<T extends StepLike>(steps: T[], live: LiveSignals): T[] {
  return steps.map((step) => {
    if (step.status === 'complete' || step.status === 'not_applicable') return step;
    const done = (): boolean => {
      switch (step.key) {
        case 'i9':
        case 'i9_section_2':
          return live.i9Done;
        case 'payroll_setup':
          return live.payrollComplete;
        case 'tax_form':
          return live.taxDone;
        case 'handbook':
          return live.handbookDone;
        case 'policies':
          return live.policiesDone;
        default:
          return false;
      }
    };
    const notApplicable = (step.key === 'i9' || step.key === 'i9_section_2') && !live.i9Applicable;
    if (notApplicable) return { ...step, status: 'not_applicable' };
    if (done()) return { ...step, status: 'complete' };
    // Everee invite is out but not finished: keep the worker on the hook, just don't call it "missing".
    if (step.key === 'payroll_setup' && live.inviteSent && step.status === 'missing') return { ...step, status: 'in_progress', actor: 'worker' as T['actor'] };
    return step;
  });
}

/**
 * Pure: may this background check be used to tell the worker their form is unstarted?
 *
 * A stale order from another job order keeps "your background check form hasn't been started" alive forever —
 * Greg's text cited a June "CORT Basic" order while he was being onboarded for a September Venue Smart shift.
 * Errored/canceled orders are never chased either.
 */
export function backgroundIsRelevant(
  check: { hrxStatus?: unknown; createdAt?: Date | null; jobOrderId?: unknown } | null | undefined,
  ctx: { jobOrderId?: string | null; startedAt?: Date | null; nowMs?: number },
): boolean {
  if (!check) return false;
  const status = s(check.hrxStatus);
  if (['error', 'canceled', 'cancelled'].includes(status)) return false;
  if (status !== 'awaiting_applicant') return true; // already moving: safe to report its real state
  const checkJo = s(check.jobOrderId);
  if (checkJo && ctx.jobOrderId && checkJo !== ctx.jobOrderId) return false;
  const created = check.createdAt?.getTime?.();
  if (!created) return true;
  const started = ctx.startedAt?.getTime?.() ?? ctx.nowMs ?? Date.now();
  // Ordered for this hire (or within a fortnight of it) — otherwise it belongs to some earlier job.
  return created >= started - 14 * 86400_000;
}
