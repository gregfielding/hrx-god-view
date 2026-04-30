/**
 * EE.4 — pure helpers extracted from `WorkerPayrollEvereeTenant.tsx` so
 * they can be unit-tested without dragging React / `react-router-dom` /
 * Firebase imports into the test environment.
 *
 * Layer 1 — iframe message matchers
 *   - `looksLikeOnboardingCompleteMessage`: strict whitelist of dedicated
 *     event-name fields and exact-match terminal events. Anything
 *     containing intermediate-step fragments is rejected.
 *   - `looksLikeAlreadyCompleteError` / `looksLikeNotYetCompleteError`:
 *     EMB-201 / EMB-202 toast detection from the iframe payload (used
 *     by the dispatch handler to swap experiences).
 *
 * Layer 2 — experience-type decision (post-EE.4 simplification)
 *   - `decideExperienceType`: pure function that takes the result of the
 *     server-side preflight (`evereeGetMyOnboardingStatus`) plus any
 *     forced override and returns `WORKER_HOME` / `ONBOARDING`. The
 *     local-stamp fallback that previously fed this decision is gone —
 *     when the API is unreachable we default to `ONBOARDING`.
 *
 * Layer 3 — TTL on optimistic stamps (legacy; preserved for the read
 * side until Phase 4 removes the writes entirely)
 *   - `isStampWithinTtl`: tolerates Firestore Timestamp / `{seconds,
 *     nanoseconds}` / numeric-millis inputs.
 *
 * Iframe dispatch
 *   - `dispatchEvereeIframeMessage`: pure router from incoming iframe
 *     payload → side-effect callbacks (`onComplete` / `onNotYetComplete`).
 *     No Firestore writes — webhooks + reconcile are canonical now.
 */

import type { EvereeEmbedExperienceType } from '../../../services/everee/evereeCallables';

/**
 * Strict whitelist of "this iframe message means onboarding is fully
 * done, request `WORKER_HOME` next time".
 *
 * The pre-EE.4 matcher used the substring regex
 * `/WORKER_ONBOARDING_COMPLETE|ONBOARDING_COMPLETE|onboarding[._-]?complete/i`,
 * which matched any envelope containing those substrings — including
 * intermediate Everee SDK events like `BANK_ONBOARDING_COMPLETE_STEP_3`,
 * `I9_SECTION_1_ONBOARDING_COMPLETE`, or any free-form payload mentioning
 * the substring "onboarding-complete". A single false positive was
 * enough to deadlock the worker:
 *
 *   1) Stamp `clientObservedOnboardingCompleteAt` on the link doc.
 *   2) Next page load: `detectOnboardingComplete` reads the stamp →
 *      requests `WORKER_HOME` → Everee correctly returns EMB-202
 *      ("Onboarding not yet complete") because the worker's actual
 *      `onboardingStatus` is still `IN_PROGRESS`.
 *   3) The EMB-202 toast lives **inside** the iframe; the host bridge is
 *      broken (separate EMB-102 issue blocked on Everee support), so the
 *      message never reaches our recovery handler. Stamp stays. Deadlock.
 *
 * Policy: prefer false negatives over false positives. Be paranoid about
 * what we accept as a terminal completion event. If we miss a real
 * completion, the server-side preflight on the next page load
 * (`evereeGetMyOnboardingStatus`, EE.4 Layer 2) will catch it and route
 * the worker to `WORKER_HOME` correctly — no harm done. If we accept a
 * false positive, the worker is locked out until someone manually clears
 * the stamp via `evereeAdminClearStaleStamps`.
 */
const EVEREE_TERMINAL_ONBOARDING_EVENTS = new Set<string>([
  'WORKER_ONBOARDING_COMPLETE',
  'WORKER_ONBOARDING_COMPLETED',
  'WORKER_ONBOARDED',
  'ONBOARDING_COMPLETE',
  'ONBOARDING_COMPLETED',
  'ONBOARDING_FINISHED',
]);

const INTERMEDIATE_EVENT_FRAGMENTS = [
  'STEP',
  'SECTION',
  'PROGRESS',
  'STARTED',
  'SAVED',
  'UPDATED',
  'BANK',
  'I9',
  'I_9',
  'DD',
  'DIRECT_DEPOSIT',
  'W4',
  'W_4',
  'W9',
  'W_9',
  'PERSONAL_INFO',
  'TAX',
  'IDENTITY',
  'SETUP',
  'PARTIAL',
  'IN_PROGRESS',
  'INPROGRESS',
];

export function looksLikeOnboardingCompleteMessage(payload: unknown): boolean {
  if (!payload) return false;
  const candidates: string[] = [];
  if (typeof payload === 'string') candidates.push(payload);
  else if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    // Pull from dedicated event-name fields only. `status` / `state` /
    // free-form fields carry intermediate progress and are *not* safe
    // signals of terminal completion.
    for (const k of ['type', 'event', 'eventType', 'name', 'kind']) {
      const v = p[k];
      if (typeof v === 'string') candidates.push(v);
    }
  }
  for (const raw of candidates) {
    const s = String(raw).trim().toUpperCase();
    if (!s) continue;
    if (!EVEREE_TERMINAL_ONBOARDING_EVENTS.has(s)) continue;
    // Exact-match required; defensively reject anything containing
    // intermediate-event fragments even if the exact string happened to
    // pass the whitelist (belt-and-braces — Everee could ship a
    // `WORKER_ONBOARDING_COMPLETE_STEP_4` constant tomorrow).
    if (INTERMEDIATE_EVENT_FRAGMENTS.some((frag) => s.includes(frag))) continue;
    return true;
  }
  return false;
}

/**
 * EE.4 Layer 3 — TTL on the optimistic UX stamps. Past this age the
 * client-observed / API-observed completion stamps are ignored when
 * computing `detectOnboardingComplete`. The Layer 2 server preflight is
 * still canonical (and is what writes `apiObservedOnboardingCompleteAt`),
 * so the only practical effect of the TTL is shortening the recovery
 * window when the server preflight isn't reachable (e.g. callable
 * outage). One hour is enough to cover normal session-renewal cycles
 * without strangling actually-complete workers; the canonical webhook
 * (`onboardingCompletedAt`) is still trusted forever.
 */
export const ONBOARDING_COMPLETE_STAMP_TTL_MS = 60 * 60 * 1000; // 1 hour

export function isStampWithinTtl(value: unknown, ttlMs: number): boolean {
  if (!value) return false;
  // Firestore Timestamp objects have a `.toMillis()`; serverTimestamp
  // sentinels resolve to a Timestamp by the time the client reads them.
  let ms: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) ms = value;
  else if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try {
      ms = (value as { toMillis: () => number }).toMillis();
    } catch {
      ms = null;
    }
  } else if (
    typeof (value as { seconds?: number }).seconds === 'number' &&
    Number.isFinite((value as { seconds: number }).seconds)
  ) {
    // Plain `{ seconds, nanoseconds }` shape (Firestore REST / converted).
    ms = (value as { seconds: number }).seconds * 1000;
  }
  if (ms === null) return false;
  return Date.now() - ms < ttlMs;
}

/** Heuristic: pull all stringy fields out of an iframe message envelope for pattern checks. */
function flattenMessageBlobs(payload: unknown): string[] {
  if (!payload) return [];
  const blobs: string[] = [];
  if (typeof payload === 'string') {
    blobs.push(payload);
    return blobs;
  }
  if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    for (const k of [
      'code',
      'errorCode',
      'embErrorCode',
      'message',
      'errorMessage',
      'error',
      'reason',
    ]) {
      const v = p[k];
      if (typeof v === 'string') blobs.push(v);
    }
    if (typeof p.error === 'object' && p.error) {
      for (const v of Object.values(p.error as Record<string, unknown>)) {
        if (typeof v === 'string') blobs.push(v);
      }
    }
  }
  return blobs;
}

/** Heuristic: is the iframe rendering the EMB-201 "already complete" page? */
export function looksLikeAlreadyCompleteError(payload: unknown): boolean {
  return flattenMessageBlobs(payload).some((b) =>
    /EMB-201|Onboarding\s+already\s+complete/i.test(b),
  );
}

/**
 * Heuristic: is the iframe rendering the EMB-202 "not yet complete" page?
 *
 * Symmetric to EMB-201 — fires when we asked for `WORKER_HOME` (or any
 * non-onboarding experience) on a worker that hasn't actually finished
 * payroll setup. Post-EE.4 this should be near-impossible: the server
 * preflight in `startSession` is canonical and only flips to
 * `WORKER_HOME` when Everee API agrees onboarding is complete. Kept as a
 * defensive backstop only (e.g. preflight outage + manually-set forced
 * experience).
 */
export function looksLikeNotYetCompleteError(payload: unknown): boolean {
  return flattenMessageBlobs(payload).some((b) =>
    /EMB-202|Onboarding\s+not\s+yet\s+complete|Only\s+the\s+ONBOARDING\s+experience/i.test(b),
  );
}

/**
 * EE.4 Phase 2 Change 2 — pure decision for which Everee Embed Component
 * to request on the next session create.
 *
 * Inputs:
 *   - `forcedExperience`: a user/dispatch-set override (e.g. EMB-201
 *     recovery → swap to `WORKER_HOME`, EMB-202 recovery → swap to
 *     `ONBOARDING`, "I've already finished onboarding" button →
 *     `WORKER_HOME`). Wins outright when set.
 *   - `apiPreflightOk`: did the server-side
 *     `evereeGetMyOnboardingStatus` callable succeed?
 *   - `apiSaysComplete`: when the preflight succeeded, did Everee report
 *     onboarding complete (per the Layer 2 unanimity rule —
 *     `onboardingComplete: true` AND `onboardingStatus: 'COMPLETE'`)?
 *
 * Decision matrix (post-simplification):
 *
 *   forcedExperience set              → forcedExperience
 *   API ok && complete                → WORKER_HOME
 *   API ok && !complete               → ONBOARDING
 *   API failed (any reason)           → ONBOARDING (safe default)
 *
 * Pre-EE.4 the API-failed branch fell back to the local
 * `clientObservedOnboardingCompleteAt` / `apiObservedOnboardingCompleteAt`
 * stamps. That fallback caused yesterday's deadlock: a single
 * false-positive iframe message stamped the link doc, the next
 * preflight failed (transient outage), the local stamp drove a
 * `WORKER_HOME` request, Everee responded EMB-202, and the EE.7-pre
 * bridge break swallowed the recovery signal. Default to `ONBOARDING`
 * instead — at worst the worker pays one extra session swap when they
 * were actually done; at best they avoid permanent lockout.
 */
export function decideExperienceType(args: {
  forcedExperience: EvereeEmbedExperienceType | null;
  apiPreflightOk: boolean;
  apiSaysComplete: boolean;
}): EvereeEmbedExperienceType {
  if (args.forcedExperience) return args.forcedExperience;
  if (args.apiPreflightOk && args.apiSaysComplete) return 'WORKER_HOME';
  return 'ONBOARDING';
}

/**
 * EE.4 Phase 2 Change 1 — pure router for iframe `postMessage` envelopes.
 *
 * Replaces the inline closure that previously wrote
 * `clientObservedOnboardingCompleteAt` to Firestore on terminal events
 * and `clientObservedOnboardingCompleteAt: deleteField()` (etc.) on
 * EMB-202 errors. Those writes were the trust layer under the broken
 * pre-EE.7 / pre-WH.1 architecture; with the bridge and webhooks now
 * working, the canonical flow is:
 *
 *   iframe terminal event → optimistic UI swap (forced experience)
 *   webhook              → reconcile → `everee_workers.{status,
 *                          apiObservedOnboardingCompleteAt}` (canonical)
 *   readiness mirror     → driven from reconcile (E.1–E.4)
 *
 * Iframe events carry zero Firestore-write authority. They drive UI
 * only. Anything else is the bug we just fixed.
 *
 * Inputs:
 *   - `payload`: raw `MessageEvent.data` (or bridge / port message) from
 *     the Everee iframe. Tolerant of strings, `{type|event|eventType|name|kind}` envelopes, and EMB error payloads.
 *   - `currentExperience`: which Embed Component is mounted right now.
 *     Used to short-circuit no-op swaps (e.g. ignore "complete" events
 *     when we're already on `WORKER_HOME`).
 *
 * Side-effect callbacks:
 *   - `onComplete()`: iframe says onboarding finished (terminal event
 *     OR EMB-201 "already complete" toast). Caller should swap to
 *     `WORKER_HOME` via `setForcedExperience`.
 *   - `onNotYetComplete()`: iframe rendered EMB-202 ("not yet
 *     complete"). Caller should swap to `ONBOARDING`. After EE.4 this
 *     should rarely fire — the server preflight prevents the wrong
 *     experience from being requested in the first place.
 */
export function dispatchEvereeIframeMessage(
  payload: unknown,
  args: {
    currentExperience: EvereeEmbedExperienceType | null;
    onComplete: () => void;
    onNotYetComplete: () => void;
  },
): void {
  const embNotYetComplete = looksLikeNotYetCompleteError(payload);
  if (embNotYetComplete && args.currentExperience !== 'ONBOARDING') {
    args.onNotYetComplete();
    return;
  }
  const onboardingComplete = looksLikeOnboardingCompleteMessage(payload);
  const embAlreadyComplete = looksLikeAlreadyCompleteError(payload);
  if (!onboardingComplete && !embAlreadyComplete) return;
  if (args.currentExperience === 'WORKER_HOME') return;
  args.onComplete();
}
