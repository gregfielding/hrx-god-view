/**
 * Typed httpsCallable wrappers for the Everee integration backend.
 *
 * Backend source: `functions/src/integrations/everee/evereeCallables.ts`.
 * Gate: these all throw `failed-precondition` when `EVEREE_ENABLED !== 'true'`
 * at the process level or when the entity's `evereeEnabled` flag is unset —
 * see `requireEvereeEnabledEntity` in `evereeConfig.ts`.
 *
 * The callables are exposed via `evereeGate.ts` so names always resolve in the
 * deployed functions list even while Everee is gated off; they just refuse to
 * do any work until the flag flips.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

export type EvereeWorkerType = 'employee' | 'contractor';

export interface EvereeEnsureWorkerRequest {
  tenantId: string;
  entityId: string;
  userId: string;
  workerType?: EvereeWorkerType;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /**
   * Per-call approval-group override (string per Everee API). Falls back to
   * the entity's `evereeApprovalGroupId` when omitted. Applied to BOTH
   * employee + contractor create paths.
   */
  approvalGroupId?: string;
}

export interface EvereeEnsureWorkerResult {
  evereeWorkerId: string;
  /** `true` when the worker was newly provisioned in Everee on this call. */
  created: boolean;
  /** Mirrors `everee_workers/{entityId__userId}.status`. */
  status?: string | null;
  externalWorkerId?: string | null;
}

/**
 * Everee Embed Components (developer.everee.com/docs/everee-embed). Defaults to
 * `ONBOARDING` (V2_0) when omitted; once the worker has finished onboarding,
 * the worker-facing payroll page should switch to `WORKER_HOME` (V1_0) so the
 * worker stays inside HRX instead of being redirected to account.everee.com.
 */
export type EvereeEmbedExperienceType =
  | 'ONBOARDING'
  | 'WORKER_HOME'
  | 'PAYMENT_HISTORY'
  | 'TAX_DOCUMENTS'
  | 'PAYMENT_DEPOSIT'
  | 'HOME_ADDRESS';

export interface EvereeCreateOnboardingSessionRequest {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  /** Where to return the worker after the Everee experience completes. */
  returnUrl?: string;
  /** Defaults to `ONBOARDING` when omitted. */
  experienceType?: EvereeEmbedExperienceType;
  /** Defaults per Everee's published table (`V2_0` for ONBOARDING, `V1_0` for the rest). */
  experienceVersion?: string;
}

export interface EvereeCreateOnboardingSessionResult {
  /** Firestore `everee_embed_sessions` doc id — useful for client-side logging / correlation. */
  sessionId: string;
  /** Iframe / WebView src. One-time use; create fresh on each open. */
  embedUrl: string;
  /** Same as `embedUrl` — server mirrors Everee `url`. */
  url?: string;
  /** Allowed parent origin for `postMessage` checks (from Everee or derived from `url`). */
  origin?: string;
  /** Session TTL hint (milliseconds). */
  expiresInMs?: number;
  /** Optional expiration hint from Everee; client should treat the URL as ephemeral. */
  expiresAt?: string | null;
  /** Worker-facing completion return URL surfaced back from Everee (may differ from request). */
  returnUrl?: string | null;
  /** Echo of the experience that was actually requested — useful for client diagnostics. */
  experienceType?: EvereeEmbedExperienceType;
  experienceVersion?: string;
  /**
   * Bridge name Everee will look up on `window` when delivering UI events
   * (V2_0 embeds). The host MUST register `window[eventHandlerName]` with a
   * `postMessage` method *before* the iframe boots, otherwise the embed
   * stalls on `EMB-102`. See `src/utils/everee/hostMessageBridge.ts`.
   */
  eventHandlerName?: string;
}

export interface EvereePayHistoryItem {
  statementId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  payDate?: string | null;
  gross?: number | null;
  net?: number | null;
  currency?: string | null;
  status?: string | null;
}

export interface EvereeGetPayHistoryRequest {
  tenantId: string;
  entityId: string;
  /** Omit to default to the caller's own UID (server-side resolution). */
  userId?: string;
}

export interface EvereeGetPayHistoryResult {
  items: EvereePayHistoryItem[];
  nextCursor?: string | null;
}

export interface EvereeGetPayStatementRequest {
  tenantId: string;
  entityId: string;
  userId?: string;
  statementId: string;
}

export interface EvereePayStatement extends EvereePayHistoryItem {
  /** Signed (short-lived) PDF URL. Never store long-term on the client. */
  pdfUrl?: string | null;
  earnings?: Array<{ label: string; amount: number | null }> | null;
  deductions?: Array<{ label: string; amount: number | null }> | null;
  taxes?: Array<{ label: string; amount: number | null }> | null;
}

export interface EvereePingRequest {
  tenantId: string;
  entityId: string;
}

export interface EvereePingResult {
  ok: boolean;
  evereeTenantId?: string | null;
  evereeEnvironment?: 'sandbox' | 'production' | null;
  latencyMs?: number | null;
}

export const evereePing = httpsCallable<EvereePingRequest, EvereePingResult>(
  functions,
  'evereePing',
);

export const evereeEnsureWorker = httpsCallable<
  EvereeEnsureWorkerRequest,
  EvereeEnsureWorkerResult
>(functions, 'evereeEnsureWorker');

/**
 * Push the worker's current HRX home address to Everee for an
 * ALREADY-PROVISIONED worker. Use when a recruiter has fixed a stale
 * profile address and needs to PUT the new value to Everee without
 * recreating the worker record.
 *
 * Server: `evereeUpdateWorkerAddress` — same auth/permission gate as
 * `evereeEnsureWorker`. Throws `failed-precondition` if the worker
 * isn't yet linked to the entity's Everee tenant, or if the HRX
 * address extractor still returns null.
 */
export interface EvereeUpdateWorkerAddressRequest {
  tenantId: string;
  entityId: string;
  userId: string;
}

export interface EvereeUpdateWorkerAddressResult {
  ok: true;
  evereeWorkerId: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

export const evereeUpdateWorkerAddress = httpsCallable<
  EvereeUpdateWorkerAddressRequest,
  EvereeUpdateWorkerAddressResult
>(functions, 'evereeUpdateWorkerAddress');

export const evereeCreateOnboardingSession = httpsCallable<
  EvereeCreateOnboardingSessionRequest,
  EvereeCreateOnboardingSessionResult
>(functions, 'evereeCreateOnboardingSession');

export const evereeGetPayHistory = httpsCallable<
  EvereeGetPayHistoryRequest,
  EvereeGetPayHistoryResult
>(functions, 'evereeGetPayHistory');

export const evereeGetPayStatement = httpsCallable<
  EvereeGetPayStatementRequest,
  EvereePayStatement | null
>(functions, 'evereeGetPayStatement');

export interface EvereeGetMyOnboardingStatusRequest {
  tenantId: string;
  entityId: string;
  evereeWorkerId: string;
  /** Defaults to caller's UID server-side; admins may pass another worker. */
  userId?: string;
}

export type EvereeGetMyOnboardingStatusResult =
  | {
      ok: true;
      onboardingComplete: boolean;
      accountClaimed: boolean | null;
      /**
       * EE.4 — raw `onboardingStatus` from `GET /api/v2/workers/{id}` (uppercased).
       * Surfaces alongside `onboardingComplete` so the client can enforce
       * the unanimity rule before requesting `WORKER_HOME` (only when both
       * `onboardingComplete: true` AND `onboardingStatus: 'COMPLETE'`).
       * Null when Everee didn't return a status string.
       */
      onboardingStatus: string | null;
      /**
       * EE.4 — raw `onboardingComplete` boolean as Everee sent it.
       * Differs from the top-level `onboardingComplete` when the server-side
       * matcher applied unanimity logic (e.g. boolean said true but
       * `onboardingStatus` disagreed). Mostly useful for diagnostics.
       */
      onboardingCompleteSignal: boolean | null;
    }
  | {
      ok: false;
      onboardingComplete: null;
      accountClaimed: null;
      reason: 'everee_api_call_failed';
    };

/**
 * Worker-callable preflight: ask Everee whether the worker has finished
 * onboarding before deciding which Embed Component to request. Status flags
 * only — no PII.
 */
export const evereeGetMyOnboardingStatus = httpsCallable<
  EvereeGetMyOnboardingStatusRequest,
  EvereeGetMyOnboardingStatusResult
>(functions, 'evereeGetMyOnboardingStatus');

export interface EvereeAdminGetWorkerRequest {
  tenantId: string;
  entityId: string;
  evereeWorkerId: string;
  /**
   * Subject of the fetch. When the caller is a worker fetching their own
   * record, this should match the auth uid (server defaults to the caller).
   * Recruiters/admins may pass another worker's uid.
   */
  userId?: string;
}

export interface EvereeAdminGetWorkerResult {
  ok: true;
  evereeWorkerId: string;
  evereeTenantId: string;
  /** Raw `GET /api/v2/workers/{id}` response — PII-bearing. Display, don't store. */
  response: unknown;
}

/**
 * Live "fetch the worker straight from Everee" callable. Used by both the
 * admin debug button on User Profile and the worker-facing Employment &
 * Payroll panel — gate is `canSelfOrManageEveree`, so workers can pull
 * their own record while recruiters can pull anyone's. Response is PII;
 * render it to the screen and never persist it to Firestore.
 */
export const evereeAdminGetWorker = httpsCallable<
  EvereeAdminGetWorkerRequest,
  EvereeAdminGetWorkerResult
>(functions, 'evereeAdminGetWorker');

export interface EvereeAdminClearStaleStampsRequest {
  tenantId: string;
  entityId: string;
  /** Worker's HRX uid (subject of the clear). */
  userId: string;
  /** Free-form audit reason; defaults server-side to `admin_csa_clear`. */
  reason?: string;
}

export interface EvereeAdminClearStaleStampsResult {
  ok: true;
  /** Field names actually deleted from the link doc this call. Empty when no-op. */
  cleared: string[];
  reason: 'link_doc_missing' | 'nothing_to_clear' | string;
}

/**
 * EE.4 — admin/CSA recovery: clears optimistic onboarding-completion
 * stamps that left a worker stuck requesting `WORKER_HOME` (Everee
 * responds EMB-202 because onboarding isn't actually finished).
 *
 * Gated to `canManageEveree` server-side. Worker self-clear is implicit
 * via the preflight inverse-mirror; this callable exists for cases where
 * the preflight is unreachable or the worker can't refresh themselves.
 */
export const evereeAdminClearStaleStamps = httpsCallable<
  EvereeAdminClearStaleStampsRequest,
  EvereeAdminClearStaleStampsResult
>(functions, 'evereeAdminClearStaleStamps');

export interface EvereeAdminRecreateWorkerOnboardingRequest {
  tenantId: string;
  entityId: string;
  /** Worker's HRX uid — the doc subject. */
  userId: string;
}

export interface EvereeAdminRecreateWorkerOnboardingResult {
  ok: true;
  /** `${userId}__${entityKey}` — the worker_onboarding doc id we wrote (or found). */
  pipelineId: string;
  /** `${entityId}__${userId}` — the everee_workers linkage doc id. */
  linkageDocId: string;
  /** True iff the worker_onboarding doc was actually written this call. */
  workerOnboardingRecreated: boolean;
  /** True iff the everee_workers linkage doc was actually written this call. */
  evereeWorkersLinkageRecreated: boolean;
  /** Resolved entity context (for the toast copy). */
  entityKey: 'workforce' | 'select' | 'events';
  entityName: string;
  /** Worker id from `users.evereeWorkerIds[evereeTenantId]`, when available. */
  evereeWorkerId: string | null;
  evereeTenantId: string | null;
}

/**
 * EE.5 — admin/CSA recovery for accidental Firestore deletions of the
 * Everee worker setup. Recreates the canonical worker_onboarding doc
 * AND the everee_workers linkage doc when missing, idempotently and
 * without re-triggering messaging or touching entity_employments.
 *
 * Refuses when there is no `entity_employments/{userId}__{entityKey}`
 * doc — recovery should never invent an employment that didn't exist.
 *
 * Gated to `canManageEveree` server-side.
 */
export const evereeAdminRecreateWorkerOnboarding = httpsCallable<
  EvereeAdminRecreateWorkerOnboardingRequest,
  EvereeAdminRecreateWorkerOnboardingResult
>(functions, 'evereeAdminRecreateWorkerOnboarding');

export interface EvereeAdminGetWorkerDocumentsRequest {
  tenantId: string;
  entityId: string;
  evereeWorkerId: string;
  userId?: string;
}

/** Item shape returned by Everee `GET /api/v2/workers/files` (locked endpoint). */
export interface EvereeWorkerFile {
  documentType: 'TAXES' | 'ONBOARDING' | 'POLICY';
  fileName: string;
  taxYear?: string;
  mimeType: string;
  publishedAt: string;
  downloadUrl: string;
}

export interface EvereeAdminGetWorkerDocumentsResult {
  ok: boolean;
  evereeWorkerId: string;
  evereeTenantId?: string;
  files: EvereeWorkerFile[];
  /** Populated only when `ok === false` — raw error message from `evereeRequest`. */
  error?: string;
}

/**
 * Worker-signed file index (`GET /api/v2/workers/files`). Endpoint is locked
 * post-pilot; the wrapper response shape no longer carries `attempts` /
 * discovery noise.
 */
export const evereeAdminGetWorkerDocuments = httpsCallable<
  EvereeAdminGetWorkerDocumentsRequest,
  EvereeAdminGetWorkerDocumentsResult
>(functions, 'evereeAdminGetWorkerDocuments');

export interface EvereeAdminGetWorkerTaxFormRequest {
  tenantId: string;
  entityId: string;
  evereeWorkerId: string;
  /** Subject; defaults to caller's UID server-side. */
  userId?: string;
}

/**
 * `applicable: false` ⇒ Everee returned 404 because this worker doesn't have
 * a form of this kind on file (e.g. asking a W-2 worker for their W-9).
 * `applicable: true` + `error` ⇒ a real upstream failure the panel should
 * surface inline.
 */
export type EvereeAdminGetWorkerTaxFormResult =
  | {
      ok: true;
      applicable: true;
      /** Raw Everee response — render defensively, schemas drift across pilot revisions. */
      response: unknown;
    }
  | {
      ok: false;
      applicable: false;
    }
  | {
      ok: false;
      applicable: true;
      error: string;
    };

/**
 * `GET /api/v2/workers/{id}/w9-info` — contractor (1099) signed W-9 details.
 * 404 ⇒ worker is W-2 (panel hides the W-9 card cleanly).
 */
export const evereeAdminGetWorkerW9 = httpsCallable<
  EvereeAdminGetWorkerTaxFormRequest,
  EvereeAdminGetWorkerTaxFormResult
>(functions, 'evereeAdminGetWorkerW9');

/**
 * `GET /api/v2/workers/{id}/w-4-tax-withholding-settings` — employee (W-2)
 * withholding settings. 404 ⇒ worker is a contractor (panel hides W-4 card).
 */
export const evereeAdminGetWorkerW4 = httpsCallable<
  EvereeAdminGetWorkerTaxFormRequest,
  EvereeAdminGetWorkerTaxFormResult
>(functions, 'evereeAdminGetWorkerW4');

// ─────────────────────────────────────────────────────────────────────
// Phase B (May 2026) — Everee approval-group runtime control.
// Backend source: functions/src/integrations/everee/evereeApprovalGroupCallables.ts
// ─────────────────────────────────────────────────────────────────────

export interface EvereeApprovalGroupSummary {
  /** Stable Everee id (string per Everee API; e.g. "7900"). */
  id: string;
  /** Display name; absent when Everee returns the group without a label. */
  name?: string;
  description?: string | null;
  /** Pass-through original record for diagnostics — schema drifts across tenants. */
  raw?: Record<string, unknown>;
}

export interface EvereeListApprovalGroupsRequest {
  tenantId: string;
  entityId: string;
}

export interface EvereeListApprovalGroupsResult {
  ok: true;
  evereeTenantId: string;
  groups: EvereeApprovalGroupSummary[];
}

/**
 * Lists every approval group available in the entity's Everee tenant.
 * Powers the EntitiesPage dropdown so admins pick from real ids instead of
 * pasting them by hand. Admin-only.
 */
export const evereeListApprovalGroups = httpsCallable<
  EvereeListApprovalGroupsRequest,
  EvereeListApprovalGroupsResult
>(functions, 'evereeListApprovalGroups');

export interface EvereeAssignApprovalGroupRequest {
  tenantId: string;
  entityId: string;
  /** Worker subject — must already have an Everee linkage doc. */
  userId: string;
  /**
   * Target group id (string). Pass `null` to clear the worker's assignment.
   * `undefined` is rejected — explicit intent is required.
   */
  approvalGroupId: string | null;
}

export interface EvereeAssignApprovalGroupResult {
  ok: true;
  userId: string;
  externalWorkerId: string;
  approvalGroupId: string | null;
  /** Approval group recorded on the linkage doc before this call (UX hint only). */
  previousApprovalGroupId: string | null;
}

/**
 * Re-assign a single Everee worker to a different approval group, or clear
 * by passing `approvalGroupId: null`. Admin-only. Refuses when the linkage
 * doc is missing, has no externalWorkerId, or points at a different
 * evereeTenantId than the entity (drift — needs the repair workflow).
 */
export const evereeAssignApprovalGroup = httpsCallable<
  EvereeAssignApprovalGroupRequest,
  EvereeAssignApprovalGroupResult
>(functions, 'evereeAssignApprovalGroup');

export interface EvereeReassignAllWorkersToGroupRequest {
  tenantId: string;
  entityId: string;
  /** Target group id (string). Pass `null` to clear all assignments. */
  approvalGroupId: string | null;
  /** Defaults to `true` server-side. Pass `false` to actually mutate Everee. */
  dryRun?: boolean;
}

export interface EvereeReassignAllWorkersToGroupResult {
  ok: true;
  /** Mirrors the input; `true` means nothing was changed. */
  dryRun: boolean;
  evereeTenantId: string;
  approvalGroupId: string | null;
  /** Number of workers that need a change (already-correct workers are skipped). */
  candidates: number;
  /** Always 0 in a dry-run. */
  succeeded: number;
  failed: number;
  /** Capped at 25 entries server-side; full failure list lives in function logs. */
  failures: Array<{
    userId: string | null;
    externalWorkerId: string;
    error: string;
  }>;
}

/**
 * Bulk re-assign every worker in an entity to a target group (or clear).
 * Defaults to `dryRun: true` for safety — admins must opt in to writes.
 * Hard-capped at 1000 candidates per invocation; for larger entities use
 * the scratch backfill script (paginates without callable timeouts).
 */
export const evereeReassignAllWorkersToGroup = httpsCallable<
  EvereeReassignAllWorkersToGroupRequest,
  EvereeReassignAllWorkersToGroupResult
>(functions, 'evereeReassignAllWorkersToGroup');

// ─────────────────────────────────────────────────────────────────────
// Hosted-onboarding remediation (May 14, 2026 — accountAccessPermitted=false lockout)
// Backend source: functions/src/integrations/everee/evereeHostedOnboardingCallables.ts
// ─────────────────────────────────────────────────────────────────────

export interface EvereeGetHostedOnboardingUrlRequest {
  tenantId: string;
  entityId: string;
  userId: string;
}

export interface EvereeGetHostedOnboardingUrlResult {
  ok: true;
  hostedUrl: string;
  evereeTenantId: string;
}

/**
 * Mints a fresh `app.everee.com/account-setup/<token>` URL for the worker
 * via Everee's `/integration/v1/workers/onboarding-access-details` endpoint.
 * This is the documented escape hatch for workers whose embed sessions are
 * blocked by Everee's anti-fraud `accountAccessPermitted: false` flag —
 * the hosted flow uses a different signing context than embed tokens.
 *
 * Each call mints a new short-lived token; safe to call repeatedly.
 * Admin-only (`canManageOnboarding`).
 */
export const evereeGetHostedOnboardingUrl = httpsCallable<
  EvereeGetHostedOnboardingUrlRequest,
  EvereeGetHostedOnboardingUrlResult
>(functions, 'evereeGetHostedOnboardingUrl');

export interface EvereeSendHostedOnboardingLinkRequest {
  tenantId: string;
  entityId: string;
  userId: string;
  /** Optional override of the default SMS body. */
  customMessage?: string | null;
}

export interface EvereeSendHostedOnboardingLinkResultOk {
  ok: true;
  hostedUrl: string;
  twilioSid: string | null;
  auditRefPath: string;
}

export interface EvereeSendHostedOnboardingLinkResultFail {
  ok: false;
  reason: 'user_not_found' | 'missing_phone' | 'invalid_e164' | 'twilio_failed';
  /** Set when the URL was minted but the SMS step failed (`twilio_failed`). */
  hostedUrl: string | null;
  twilioError?: string | null;
}

export type EvereeSendHostedOnboardingLinkResult =
  | EvereeSendHostedOnboardingLinkResultOk
  | EvereeSendHostedOnboardingLinkResultFail;

/**
 * Mints a fresh hosted-onboarding URL and SMSes it to the worker, with
 * full audit trail in `tenants/{tid}/onboarding_reminder_audit`. Admin-only.
 *
 * Returns `{ ok: false, hostedUrl }` (with the URL still set) on
 * `twilio_failed` so the admin can copy/paste manually as a fallback.
 */
export const evereeSendHostedOnboardingLink = httpsCallable<
  EvereeSendHostedOnboardingLinkRequest,
  EvereeSendHostedOnboardingLinkResult
>(functions, 'evereeSendHostedOnboardingLink');
