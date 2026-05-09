/**
 * Browser callable wrappers for the onboarding reminder admin surface.
 * Backend source: `functions/src/onboarding/resendOnboardingPayrollLinkCallable.ts`.
 *
 * Pairs with the scheduler at
 * `functions/src/onboarding/processWorkerOnboardingReminders.ts` — manual
 * resends produce the *same* SMS body + URL the cadence would send, so a
 * recruiter-initiated nudge and an automated reminder look identical to the
 * worker. The two implementations must stay in lockstep; see the reminder
 * scheduler's `sendOnboardingReminderSms` for the canonical variant logic.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export interface ResendOnboardingPayrollLinkRequest {
  tenantId: string;
  userId: string;
  /** Hiring entity id (the entity the worker is being onboarded into).
   *  Backend reconstructs the pipelineId as `${userId}__${entityKey}` after
   *  reading `entityKey` from the entity doc — clients don't need to know
   *  the pipelineId shape. */
  entityId: string;
}

export interface ResendOnboardingPayrollLinkResult {
  ok: boolean;
  pipelineId: string;
  variant: 'standard' | 'events';
  /** Final URL embedded in the SMS — surface in the success toast so the
   *  recruiter can copy it for follow-up channels (email, Slack, etc.). */
  link: string;
  /** Set when `ok === false`: missing_phone, invalid_e164, missing_link,
   *  sms_failed, employment_not_found, user_not_found. */
  reason?: string;
  twilioError?: string;
}

export const resendOnboardingPayrollLinkCallable = httpsCallable<
  ResendOnboardingPayrollLinkRequest,
  ResendOnboardingPayrollLinkResult
>(functions, 'resendOnboardingPayrollLink');

/**
 * Recruiter-triggered "Restart Everee Onboarding" callable.
 * Backend source: `functions/src/onboarding/restartEvereeOnboardingCallable.ts`.
 *
 * Use cases:
 *   1. **Stuck-on-legacy-payroll restart** — worker is in Everee but their
 *      `entity_employments` row is stuck with `payrollStatus: 'complete'`
 *      from a prior payroll system (e.g. TempWorks pre-migration), which
 *      both (a) hides the Everee payroll step in the My Employment hub
 *      and (b) tells `processWorkerOnboardingReminders` to skip them.
 *   2. **Pre-Everee migration restart (May 2026 +)** — worker started
 *      onboarding on this entity *before* it was wired to Everee, so no
 *      Everee shell exists yet. The callable provisions the shell inline
 *      via the same idempotent helper the "Sync to Everee" button uses,
 *      then continues with the cadence reset. `evereeShellProvisioned`
 *      in the result tells the client which path was taken so the toast
 *      can read "Provisioned Everee + restarted onboarding" vs. just
 *      "Restarted onboarding".
 *
 * The callable resets the relevant fields, schedules a fresh R1–R{N}
 * cadence anchored at "now", and fires R1 inline so the recruiter sees
 * the SMS go out immediately.
 *
 * Reasons returned on `ok=false`:
 *   - `entity_not_everee`     — entity isn't Everee-enabled / no evereeTenantId.
 *   - `employment_not_found`  — no `entity_employments` row for this user/entity.
 *   - `user_not_found`        — `users/{uid}` doc missing.
 *   - `everee_provision_failed` — inline `createWorkerIfNeeded` rejected;
 *                               see `twilioError` field for raw message.
 *   - `missing_phone` / `invalid_e164` — phone unusable; data was reset but R1
 *                               couldn't be sent (recruiter can copy `link`
 *                               from the result and share it manually).
 *   - `missing_link`          — couldn't resolve any URL to send.
 *   - `sms_failed`            — Twilio send failure (see `twilioError`).
 *
 * `needs_sync` is no longer returned — the callable handles that branch
 * inline via `evereeShellProvisioned: true` instead.
 */
export interface RestartEvereeOnboardingRequest {
  tenantId: string;
  userId: string;
  /** Hiring entity id (the Everee-enabled entity the worker is being
   *  re-onboarded into). Backend reads `entityKey` from this entity's doc
   *  (or derives from the entity name when the field is missing). */
  entityId: string;
}

export interface RestartEvereeOnboardingResult {
  ok: boolean;
  pipelineId: string;
  variant: 'standard' | 'events';
  /** R1 link the SMS went out with — copy it for follow-up channels when
   *  ok=false because of missing_phone / invalid_e164. */
  link: string;
  /** ISO timestamps for the freshly-scheduled cadence. R4/R5 only present
   *  for events (1099) workers. */
  scheduledReminders: {
    r1: string;
    r2: string;
    r3: string;
    r4?: string;
    r5?: string;
  };
  /** True when this restart had to provision the Everee shell inline
   *  (legacy-pre-Everee migration path). Used for richer toast copy. */
  evereeShellProvisioned?: boolean;
  reason?:
    | 'entity_not_everee'
    | 'employment_not_found'
    | 'user_not_found'
    | 'everee_provision_failed'
    | 'missing_phone'
    | 'invalid_e164'
    | 'missing_link'
    | 'sms_failed';
  twilioError?: string;
}

export const restartEvereeOnboardingCallable = httpsCallable<
  RestartEvereeOnboardingRequest,
  RestartEvereeOnboardingResult
>(functions, 'restartEvereeOnboarding');
