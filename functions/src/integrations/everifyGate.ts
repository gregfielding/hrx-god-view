/**
 * E-Verify gate: load the real E-Verify integration only when EVERIFY_ENABLED=true.
 * When false or unset, we never require('./everify'), so EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD
 * are not requested at deploy time. Set EVERIFY_ENABLED=true in .env when you have active ICA creds.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const DISABLED_MSG =
  'E-Verify is disabled. Set EVERIFY_ENABLED=true and configure EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD.';

const stubCallable = onCall(async () => {
  throw new HttpsError('failed-precondition', DISABLED_MSG);
});

const stubTrigger = onDocumentUpdated(
  { document: 'tenants/{tenantId}/user_employments/{employmentId}', region: 'us-central1' },
  async () => {}
);
const stubEverifyCaseTrigger = onDocumentUpdated(
  { document: 'tenants/{tenantId}/everify_cases/{caseId}', region: 'us-central1' },
  async () => {}
);

const stubHttp = onRequest({ region: 'us-central1' }, async (_, res) => {
  res.status(503).json({ ok: false, error: DISABLED_MSG });
});

const stubScheduled = onSchedule({ schedule: 'off', region: 'us-central1' }, async () => {});

let everify: typeof import('./everify') | null = null;
if (process.env.EVERIFY_ENABLED === 'true') {
  everify = require('./everify');
}

export const everifyCreateCase = everify?.everifyCreateCase ?? stubCallable;
export const everifyCheckEligibility = everify?.everifyCheckEligibility ?? stubCallable;
export const everifyPingAuth = everify?.everifyPingAuth ?? stubCallable;
export const everifyDryRunCreateAndSubmit = everify?.everifyDryRunCreateAndSubmit ?? stubCallable;
export const everifyListCases = everify?.everifyListCases ?? stubCallable;
export const everifyRetryCase = everify?.everifyRetryCase ?? stubCallable;
export const everifyExceptionAction = everify?.everifyExceptionAction ?? stubCallable;
export const everifyMarkEmployeeNotified = everify?.everifyMarkEmployeeNotified ?? stubCallable;
export const everifyMarkContested = everify?.everifyMarkContested ?? stubCallable;
export const everifyMarkReferralInitiated = everify?.everifyMarkReferralInitiated ?? stubCallable;
export const everifyCloseCaseManual = everify?.everifyCloseCaseManual ?? stubCallable;
export const onUserEmploymentUpdatedEverify = everify?.onUserEmploymentUpdatedEverify ?? stubTrigger;
export const onEverifyCaseUpdatedSyncOnboarding = everify?.onEverifyCaseUpdatedSyncOnboarding ?? stubEverifyCaseTrigger;
export const processEverifyCaseFromEmployment = everify?.processEverifyCaseFromEmployment ?? stubHttp;
export const scheduledEverifyPoller = everify?.scheduledEverifyPoller ?? stubScheduled;
