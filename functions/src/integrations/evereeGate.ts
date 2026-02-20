/**
 * Everee gate: load the real Everee integration only when EVEREE_ENABLED=true.
 * When false or unset, stub callables throw failed-precondition.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';

const DISABLED_MSG =
  'Everee is disabled. Set EVEREE_ENABLED=true and configure entity Everee settings.';

const stubCallable = onCall(async () => {
  throw new HttpsError('failed-precondition', DISABLED_MSG);
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
