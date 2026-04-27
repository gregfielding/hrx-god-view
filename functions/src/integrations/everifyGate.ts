/**
 * E-Verify gate: load the real E-Verify integration only when EVERIFY_ENABLED=true.
 * When false or unset, we never require('./everify'), so EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD
 * are not requested at deploy time. Set EVERIFY_ENABLED=true in .env when you have active ICA creds.
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { CALLABLE_BROWSER_CORS } from './callableBrowserCors';

// Deploy-time Node often has no shell env; predeploy writes root → functions/.env — load before gating.
loadEnv({ path: resolve(__dirname, '../../.env') });
const gcpProject = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (gcpProject) {
  loadEnv({ path: resolve(__dirname, `../../.env.${gcpProject}`), override: true });
}

const DISABLED_MSG =
  'E-Verify is disabled. Set EVERIFY_ENABLED=true and configure EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD.';

const stubCallable = onCall({ cors: CALLABLE_BROWSER_CORS }, async () => {
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

// Avoid schedule:'off' here — Cloud Scheduler can 400 on deploy; Jan 1 00:00 UTC yearly is effectively inert.
const stubScheduled = onSchedule(
  { schedule: '0 0 1 1 *', timeZone: 'UTC', region: 'us-central1' },
  async () => {}
);

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
export const everifyRecordWorkerDecision = everify?.everifyRecordWorkerDecision ?? stubCallable;
export const everifyMarkReferralInitiated = everify?.everifyMarkReferralInitiated ?? stubCallable;
export const everifyRecordNoticeGenerated = everify?.everifyRecordNoticeGenerated ?? stubCallable;
export const everifyCloseCaseManual = everify?.everifyCloseCaseManual ?? stubCallable;
export const everifySoapCreateCase = everify?.everifySoapCreateCase ?? stubCallable;
export const onUserEmploymentUpdatedEverify = everify?.onUserEmploymentUpdatedEverify ?? stubTrigger;
export const onEverifyCaseUpdatedSyncOnboarding = everify?.onEverifyCaseUpdatedSyncOnboarding ?? stubEverifyCaseTrigger;
export const processEverifyCaseFromEmployment = everify?.processEverifyCaseFromEmployment ?? stubHttp;
export const scheduledEverifyPoller = everify?.scheduledEverifyPoller ?? stubScheduled;
