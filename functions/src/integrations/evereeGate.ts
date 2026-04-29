/**
 * Everee gate: load the real Everee integration only when EVEREE_ENABLED=true.
 * When false or unset, stubs short-circuit so the deploy still exposes the
 * function names (required by `firebase deploy --only functions:evereeWebhook`
 * to resolve) but they refuse to do any work.
 */

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

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
export const evereeWebhook = everee?.evereeWebhook ?? stubWebhook;
export const onEvereeWebhookEventCreated =
  everee?.onEvereeWebhookEventCreated ?? stubWebhookTrigger;
// TEMP — sandbox API contract validation; remove with TempEvereeSyncButton.tsx.
export const evereeTempSandboxSync = everee?.evereeTempSandboxSync ?? stubCallable;
