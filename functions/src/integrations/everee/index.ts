/**
 * Everee integration module (HRX Everee Master Plan).
 */

export {
  evereePing,
  evereeEnsureWorker,
  evereeCreateOnboardingSession,
  evereeGetPayHistory,
  evereeGetPayStatement,
  evereeAdminPushShift,
  evereeAdminPreparePayout,
  evereeAdminGetWorker,
  evereeAdminGetWorkerDocuments,
  evereeAdminGetWorkerW9,
  evereeAdminGetWorkerW4,
  evereeGetMyOnboardingStatus,
  evereeAdminClearStaleStamps,
} from './evereeCallables';
export { evereeAdminRecreateWorkerOnboarding } from './evereeAdminRecreateWorkerOnboarding';
// Phase B (May 2026) — admin runtime control over Everee approval-group routing.
export {
  evereeListApprovalGroups,
  evereeAssignApprovalGroup,
  evereeReassignAllWorkersToGroup,
} from './evereeApprovalGroupCallables';
// May 14 2026 — hosted-onboarding remediation for Everee `accountAccessPermitted: false`
// lockouts. Mints a fresh `app.everee.com/account-setup/<token>` URL and
// optionally SMSes it to the worker. See `evereeHostedOnboardingCallables.ts`
// docstring for the full incident write-up.
export {
  evereeGetHostedOnboardingUrl,
  evereeSendHostedOnboardingLink,
} from './evereeHostedOnboardingCallables';
// E.1 + E.2 — readiness snapshot reconcile (manual / admin) + cron sweep.
export { evereeAdminReconcileWorker } from './evereeReconcileWorker';
export { evereeReconcileCron } from './evereeReconcileCron';
export { evereeWebhook, onEvereeWebhookEventCreated } from './evereeWebhook';
