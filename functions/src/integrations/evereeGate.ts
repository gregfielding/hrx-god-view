/**
 * Everee gate: load the real Everee integration only when EVEREE_ENABLED=true.
 * When false or unset, stubs short-circuit so the deploy still exposes the
 * function names (required by `firebase deploy --only functions:evereeWebhook`
 * to resolve) but they refuse to do any work.
 */

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const DISABLED_MSG =
  'Everee is disabled. Set EVEREE_ENABLED=true and configure entity Everee settings.';

const stubCallable = onCall(async () => {
  throw new HttpsError('failed-precondition', DISABLED_MSG);
});

/** HTTP stub for the webhook — returns 503 until Everee is turned on. */
const stubWebhook = onRequest(async (_req, res) => {
  res.status(503).send(DISABLED_MSG);
});

/**
 * Firestore trigger stub. Harmless no-op; when the real handler lands via
 * EVEREE_ENABLED=true this gets replaced, and any docs written under
 * `everee_webhook_events` before then will never exist anyway because the
 * webhook stub refuses the POST.
 */
const stubWebhookTrigger = onDocumentCreated(
  'tenants/{tenantId}/everee_webhook_events/{eventId}',
  async () => {
    // intentional no-op; gate closed.
  },
);

/**
 * Scheduled-function stub. The real `evereeReconcileCron` runs every 2h;
 * when the gate is closed we still register a no-op schedule so the
 * function name resolves at deploy time and Firebase doesn't drop the
 * job from the catalog (which would force a re-create when the gate
 * flips, losing the schedule history).
 */
const stubSchedule = onSchedule({ schedule: 'every 24 hours' }, async () => {
  // intentional no-op; gate closed.
});

let everee: typeof import('./everee') | null = null;
if (process.env.EVEREE_ENABLED === 'true') {
  everee = require('./everee');
}

export const evereePing = everee?.evereePing ?? stubCallable;
export const evereeEnsureWorker = everee?.evereeEnsureWorker ?? stubCallable;
export const evereeCreateOnboardingSession = everee?.evereeCreateOnboardingSession ?? stubCallable;
export const evereeGetPayHistory = everee?.evereeGetPayHistory ?? stubCallable;
export const evereeGetPayStatement = everee?.evereeGetPayStatement ?? stubCallable;
export const evereeAdminPushShift = everee?.evereeAdminPushShift ?? stubCallable;
export const evereeAdminPreparePayout = everee?.evereeAdminPreparePayout ?? stubCallable;
export const evereeAdminGetWorker = everee?.evereeAdminGetWorker ?? stubCallable;
export const evereeAdminGetWorkerDocuments =
  everee?.evereeAdminGetWorkerDocuments ?? stubCallable;
export const evereeAdminGetWorkerW9 = everee?.evereeAdminGetWorkerW9 ?? stubCallable;
export const evereeAdminGetWorkerW4 = everee?.evereeAdminGetWorkerW4 ?? stubCallable;
export const evereeGetMyOnboardingStatus =
  everee?.evereeGetMyOnboardingStatus ?? stubCallable;
export const evereeAdminClearStaleStamps =
  everee?.evereeAdminClearStaleStamps ?? stubCallable;
export const evereeAdminRecreateWorkerOnboarding =
  everee?.evereeAdminRecreateWorkerOnboarding ?? stubCallable;
// E.1 + E.2 — readiness snapshot reconcile callable + 2h cron sweep.
export const evereeAdminReconcileWorker =
  everee?.evereeAdminReconcileWorker ?? stubCallable;
// Phase B (May 2026) — approval-group runtime control.
export const evereeListApprovalGroups =
  everee?.evereeListApprovalGroups ?? stubCallable;
export const evereeAssignApprovalGroup =
  everee?.evereeAssignApprovalGroup ?? stubCallable;
export const evereeReassignAllWorkersToGroup =
  everee?.evereeReassignAllWorkersToGroup ?? stubCallable;
// May 14 2026 — hosted-onboarding remediation (account-access lockout escape hatch).
export const evereeGetHostedOnboardingUrl =
  everee?.evereeGetHostedOnboardingUrl ?? stubCallable;
export const evereeSendHostedOnboardingLink =
  everee?.evereeSendHostedOnboardingLink ?? stubCallable;
export const evereeReconcileCron = everee?.evereeReconcileCron ?? stubSchedule;
export const evereeWebhook = everee?.evereeWebhook ?? stubWebhook;
export const onEvereeWebhookEventCreated =
  everee?.onEvereeWebhookEventCreated ?? stubWebhookTrigger;
