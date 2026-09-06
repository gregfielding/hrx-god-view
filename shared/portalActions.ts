/**
 * Portal action queue — the contract between HRX (producer) and the
 * always-on portal worker (consumer) that drives the Indeed Flex agency
 * portal and SAP Fieldglass with its own logged-in browser profiles.
 *
 * Collection: `tenants/{tenantId}/portal_actions/{actionId}`
 *   actionId == idempotencyKey (see buildPortalActionId) so re-enqueueing
 *   the same logical action is a no-op while it is pending/running and a
 *   deliberate `force` after it succeeded.
 *
 * Worker presence: `tenants/{tenantId}/portal_workers/{workerId}` +
 * rolling summary at `tenants/{tenantId}/integration_health/portal_worker`.
 *
 * Mirrored byte-for-byte at src/shared/portalActions.ts — edit both.
 */

export type PortalProvider = 'indeed_flex' | 'fieldglass';

export const PORTAL_PROVIDERS: readonly PortalProvider[] = ['indeed_flex', 'fieldglass'];

export type PortalActionType =
  /** Log in, load the home page, prove the session works. Safe anytime. */
  | 'smoke_test'
  /** Indeed Flex: book a worker onto a job (optionally specific shift ids). */
  | 'book_worker'
  /** Indeed Flex: remove a booked worker from a job / shifts. */
  | 'unbook_worker'
  /** Fieldglass: submit a candidate (job seeker) to a posting. */
  | 'submit_candidate'
  /** Fieldglass: withdraw a submitted candidate from a posting. */
  | 'withdraw_candidate';

export const PORTAL_ACTION_TYPES: readonly PortalActionType[] = [
  'smoke_test',
  'book_worker',
  'unbook_worker',
  'submit_candidate',
  'withdraw_candidate',
];

/** Which provider each action type belongs to (smoke_test is universal). */
export const PORTAL_ACTION_PROVIDER: Record<Exclude<PortalActionType, 'smoke_test'>, PortalProvider> = {
  book_worker: 'indeed_flex',
  unbook_worker: 'indeed_flex',
  submit_candidate: 'fieldglass',
  withdraw_candidate: 'fieldglass',
};

export type PortalActionStatus =
  /** Waiting for a worker. `notBefore` may defer it (retry backoff). */
  | 'pending'
  /** A worker holds the lease but has not started the browser work. */
  | 'claimed'
  /** Browser work in progress. */
  | 'running'
  | 'succeeded'
  /** Terminal failure with no retry (bad payload, explicit portal refusal). */
  | 'failed'
  /** Automation could not finish and a person must act (login, unknown UI, retries exhausted). */
  | 'needs_human'
  | 'cancelled';

export const PORTAL_ACTION_OPEN_STATUSES: readonly PortalActionStatus[] = ['pending', 'claimed', 'running'];
export const PORTAL_ACTION_TERMINAL_STATUSES: readonly PortalActionStatus[] = [
  'succeeded',
  'failed',
  'needs_human',
  'cancelled',
];

/** Machine-readable failure codes; drive retry / escalation policy. */
export type PortalActionErrorCode =
  | 'LOGIN_REQUIRED'
  | 'LOGIN_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'INVALID_PAYLOAD'
  | 'SELECTOR_MISSING'
  | 'PORTAL_REJECTED'
  | 'TIMEOUT'
  | 'BROWSER_CRASH'
  | 'LEASE_EXPIRED'
  | 'UNKNOWN';

export interface PortalActionError {
  code: PortalActionErrorCode;
  message: string;
  /** ISO timestamp. */
  at: string;
  /** Signed URL (or gs:// path) of the screenshot captured at failure, when available. */
  screenshotUrl?: string;
  workerId?: string;
}

export interface PortalActionHistoryEntry {
  /** ISO timestamp. */
  at: string;
  status: PortalActionStatus;
  workerId?: string;
  note?: string;
}

/** HRX-side pointers so a queue row can be traced back to what asked for it. */
export interface PortalActionRefs {
  assignmentId?: string;
  shiftId?: string;
  jobOrderId?: string;
  placementId?: string;
  userId?: string;
  externalShiftRequestId?: string;
}

export interface PortalActionCreatedBy {
  kind: 'system' | 'user' | 'script';
  /** users/{uid} for kind 'user'; free-form label otherwise. */
  id?: string;
}

// --- Payloads ---------------------------------------------------------------

export interface SmokeTestPayload {
  /** Optional page to load after login (defaults to the portal home). */
  url?: string;
}

export interface BookWorkerPayload {
  flexJobId: string;
  /** Flex worker id when known (preferred); otherwise the worker's display name. */
  flexWorkerId?: string;
  workerName?: string;
  /** Specific Flex shift ids to book; omit for every open shift on the job. */
  flexShiftIds?: string[];
}

export type UnbookWorkerPayload = BookWorkerPayload;

export interface SubmitCandidatePayload {
  /** e.g. SDXOJP00188954 */
  postingId: string;
  candidate: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    /** Fieldglass job-seeker id if this person already exists in Fieldglass. */
    fieldglassJobSeekerId?: string;
  };
  /** Pay rate to offer, when the posting lets the supplier set one. */
  payRate?: number;
}

export interface WithdrawCandidatePayload {
  postingId: string;
  fieldglassJobSeekerId?: string;
  candidateName?: string;
}

export type PortalActionPayloadMap = {
  smoke_test: SmokeTestPayload;
  book_worker: BookWorkerPayload;
  unbook_worker: UnbookWorkerPayload;
  submit_candidate: SubmitCandidatePayload;
  withdraw_candidate: WithdrawCandidatePayload;
};

export interface PortalActionLease {
  workerId: string;
  /** ISO timestamp. */
  claimedAt: string;
  /** ISO timestamp — past this, a sweeper may requeue the action. */
  expiresAt: string;
}

/**
 * The Firestore document. Timestamps that the queue sorts/filters on
 * (`createdAt`, `notBefore`, `updatedAt`) are Firestore Timestamps; the
 * ISO strings inside `lease`/`history`/`lastError` are plain data.
 */
export interface PortalActionDoc<A extends PortalActionType = PortalActionType> {
  tenantId: string;
  provider: PortalProvider;
  action: A;
  status: PortalActionStatus;
  payload: PortalActionPayloadMap[A];
  refs: PortalActionRefs;
  idempotencyKey: string;
  /** Lower runs first. Default 100. */
  priority: number;
  attempts: number;
  maxAttempts: number;
  /** Firestore Timestamp | null — do not run before this instant. */
  notBefore: unknown | null;
  lease: PortalActionLease | null;
  lastError: PortalActionError | null;
  result: Record<string, unknown> | null;
  history: PortalActionHistoryEntry[];
  createdBy: PortalActionCreatedBy;
  /** Firestore Timestamps. */
  createdAt: unknown;
  updatedAt: unknown;
  startedAt?: unknown | null;
  finishedAt?: unknown | null;
}

export const PORTAL_ACTION_DEFAULT_PRIORITY = 100;
export const PORTAL_ACTION_DEFAULT_MAX_ATTEMPTS = 3;
export const PORTAL_ACTION_HISTORY_CAP = 30;

// --- Worker presence ---------------------------------------------------------

export type PortalSessionState = 'unknown' | 'logged_in' | 'login_required' | 'login_failed' | 'browser_error';

export interface PortalWorkerSessionInfo {
  state: PortalSessionState;
  /** ISO timestamp. */
  checkedAt: string;
  note?: string;
}

export interface PortalWorkerDoc {
  workerId: string;
  hostname: string;
  pid: number;
  version: string;
  enabledProviders: PortalProvider[];
  /** Firestore Timestamps. */
  startedAt: unknown;
  lastHeartbeatAt: unknown;
  stoppedAt?: unknown | null;
  status: 'starting' | 'idle' | 'busy' | 'stopped';
  busyWith?: { actionId: string; provider: PortalProvider; action: PortalActionType; since: string } | null;
  sessions: Partial<Record<PortalProvider, PortalWorkerSessionInfo>>;
  counters: { succeeded: number; failed: number; needsHuman: number };
}

// --- Helpers (pure; shared by producer, consumer, and tests) -----------------

/** Firestore doc ids must avoid `/`; keep the key readable and bounded. */
export function sanitizePortalActionIdPart(part: string): string {
  return String(part)
    .trim()
    .replace(/[^A-Za-z0-9_.\-@+]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Deterministic idempotency key / doc id, e.g.
 *   indeed_flex__book_worker__530960__XN7lks...
 * Parts are the natural key of the action (job id + worker id, posting id +
 * candidate email, …). Empty parts are dropped.
 */
export function buildPortalActionId(
  provider: PortalProvider,
  action: PortalActionType,
  parts: Array<string | number | null | undefined>,
): string {
  const cleaned = parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .map((p) => sanitizePortalActionIdPart(String(p)));
  return [provider, action, ...cleaned].join('__').slice(0, 900);
}

/** Retry backoff: 5m, 10m, 20m, … capped at 60m. `attempt` is 1-based (attempts already made). */
export function portalActionRetryDelayMs(attempt: number): number {
  const base = 5 * 60 * 1000;
  const cap = 60 * 60 * 1000;
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(cap, base * 2 ** (n - 1));
}

/** Policy for what happens after an error. */
export interface PortalActionErrorPolicy {
  retryable: boolean;
  needsHuman: boolean;
}

export function portalActionErrorPolicy(code: PortalActionErrorCode): PortalActionErrorPolicy {
  switch (code) {
    case 'LOGIN_REQUIRED':
    case 'SELECTOR_MISSING':
    case 'TIMEOUT':
    case 'BROWSER_CRASH':
    case 'LEASE_EXPIRED':
    case 'UNKNOWN':
      return { retryable: true, needsHuman: false };
    case 'LOGIN_FAILED':
    case 'NOT_IMPLEMENTED':
      return { retryable: false, needsHuman: true };
    case 'INVALID_PAYLOAD':
    case 'PORTAL_REJECTED':
      return { retryable: false, needsHuman: false };
    default:
      return { retryable: false, needsHuman: true };
  }
}

/**
 * Decide the next status for an action that just errored.
 * Exhausting `maxAttempts` on a retryable error escalates to needs_human
 * (a person should look, not a silent 'failed').
 */
export function nextStatusAfterError(
  code: PortalActionErrorCode,
  attempts: number,
  maxAttempts: number,
): Extract<PortalActionStatus, 'pending' | 'failed' | 'needs_human'> {
  const policy = portalActionErrorPolicy(code);
  if (policy.retryable) return attempts < maxAttempts ? 'pending' : 'needs_human';
  return policy.needsHuman ? 'needs_human' : 'failed';
}

export function providerForAction(action: PortalActionType, explicit?: PortalProvider): PortalProvider {
  if (action === 'smoke_test') {
    if (!explicit) throw new Error('smoke_test requires an explicit provider');
    return explicit;
  }
  const inferred = PORTAL_ACTION_PROVIDER[action];
  if (explicit && explicit !== inferred) {
    throw new Error(`action ${action} belongs to ${inferred}, not ${explicit}`);
  }
  return inferred;
}

/** Natural-key parts for the standard actions, so producers agree on ids. */
export function defaultPortalActionKeyParts<A extends PortalActionType>(
  action: A,
  payload: PortalActionPayloadMap[A],
): Array<string | undefined> {
  switch (action) {
    case 'book_worker':
    case 'unbook_worker': {
      const p = payload as BookWorkerPayload;
      return [p.flexJobId, p.flexWorkerId || p.workerName, (p.flexShiftIds || []).slice().sort().join('+') || undefined];
    }
    case 'submit_candidate': {
      const p = payload as SubmitCandidatePayload;
      const c = p.candidate;
      return [p.postingId, c.fieldglassJobSeekerId || c.email || `${c.firstName}-${c.lastName}`];
    }
    case 'withdraw_candidate': {
      const p = payload as WithdrawCandidatePayload;
      return [p.postingId, p.fieldglassJobSeekerId || p.candidateName];
    }
    case 'smoke_test':
    default:
      return [];
  }
}
