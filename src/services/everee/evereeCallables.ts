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
}

export interface EvereeEnsureWorkerResult {
  evereeWorkerId: string;
  /** `true` when the worker was newly provisioned in Everee on this call. */
  created: boolean;
  /** Mirrors `everee_workers/{entityId__userId}.status`. */
  status?: string | null;
  externalWorkerId?: string | null;
}

export interface EvereeCreateOnboardingSessionRequest {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  /** Where to return the worker after the Everee experience completes. */
  returnUrl?: string;
}

export interface EvereeCreateOnboardingSessionResult {
  /** Firestore `everee_embed_sessions` doc id — useful for client-side logging / correlation. */
  sessionId: string;
  /** Iframe / WebView src. One-time use; create fresh on each open. */
  embedUrl: string;
  /** Optional expiration hint from Everee; client should treat the URL as ephemeral. */
  expiresAt?: string | null;
  /** Worker-facing completion return URL surfaced back from Everee (may differ from request). */
  returnUrl?: string | null;
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
