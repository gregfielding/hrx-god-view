/**
 * User-group hiring is RETIRED (Greg 2026-09-11: "retire group hiring now" —
 * the new plan takes precedence; docs/claude/project_events_onboarding_claim_readiness.md).
 *
 * Replaced by:
 *   - C1 Events: everyone who applies to a C1 Events posting is hired
 *     (recruiter/eventsEntityAutoHire.ts), and workers with no employment are
 *     onboarded at their first Claim Shift tap (claims/claimReadiness.ts);
 *   - C1 Select: each job order's Hiring plan (tierAutomation/jobOrderHiringPlan).
 *
 * While true: joining a group / group applications never start onboarding,
 * the manual "hire passed candidates" execute is refused, group signup links
 * no longer report hire-everyone, and the Events rule stops deferring to
 * groups. Set false (and redeploy the callers) to bring group hiring back.
 */
export const USER_GROUP_HIRING_RETIRED = true;
