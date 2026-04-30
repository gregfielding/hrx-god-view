/**
 * Everee payroll iframe — `/c1/workers/payroll/:evereeTenantId`
 *
 * Picks the right Everee Embed Component automatically:
 *   - `ONBOARDING` (V2_0) until the worker has finished payroll setup.
 *   - `WORKER_HOME` (V1_0) once they're done — keeps them inside HRX instead
 *     of bouncing them to account.everee.com.
 *
 * Canonical "done" signal (post-EE.4):
 *   - `evereeGetMyOnboardingStatus` callable → Everee `GET /api/v2/workers/{id}`
 *     → `inspectEvereeOnboardingState` (Layer 2 unanimity rule:
 *     `onboardingComplete: true` AND `onboardingStatus: 'COMPLETE'`).
 *   - That callable also writes the canonical
 *     `everee_workers.apiObservedOnboardingCompleteAt` and clears stale
 *     stamps when Everee says the worker isn't done.
 *   - The webhook (`worker.onboarding-completed` → `evereeReconcileWorker`)
 *     writes the same canonical stamp end-to-end within seconds.
 *
 * Iframe events are advisory UX hints only — they drive optimistic
 * `setForcedExperience` swaps (sub-second perceived responsiveness) but
 * never write to Firestore. EMB-201 → swap to `WORKER_HOME`; EMB-202 →
 * swap back to `ONBOARDING`.
 *
 * Sessions are short-lived; we always create a fresh one on mount / swap /
 * "Try again" and never cache the URL in component state across reloads.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EE.4 simplification audit (Phase 1 → Phase 2 changes applied here)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Pre-EE.4 the bridge (EMB-102) AND webhooks (WH.1) were both broken,
 * so we trusted iframe events as canonical and stamped Firestore from
 * them via `softMarkOnboardingComplete()` / `clearStaleOnboardingCompleteStamps()`.
 * That trust pattern caused the EMB-202 deadlock: a false-positive
 * iframe message stamped the link doc, the next page load re-read the
 * stamp and asked for `WORKER_HOME`, Everee correctly rejected with
 * EMB-202, the broken bridge swallowed the recovery toast, and the
 * worker was stuck. Now (EE.7 + WH.1 + E.1–E.4 all landed):
 *
 *   load-bearing │ kept                 (server preflight + reconcile)
 *   vestigial    │ removed write calls  (softMark/clearStale invocations)
 *   risky        │ removed local-stamp  (replaced with API-canonical decision)
 *
 * Specifically removed:
 *   • Iframe terminal event → `softMarkOnboardingComplete` Firestore write.
 *     The webhook + reconcile path now writes `apiObservedOnboardingCompleteAt`
 *     end-to-end within seconds; the optimistic stamp was duplicate work.
 *   • EMB-202 dispatch + EMB-202 server-rejection → `clearStaleOnboardingCompleteStamps`.
 *     The server preflight (`evereeGetMyOnboardingStatus`) clears stale
 *     stamps inversely whenever Everee API says onboarding isn't done,
 *     so the client-side delete was duplicate work too.
 *   • `localHintSaysComplete` from the experience decision matrix.
 *     `decideExperienceType` now defaults to `ONBOARDING` when the
 *     server preflight fails — at worst one extra session swap, at best
 *     no permanent lockout.
 *
 * Specifically kept (load-bearing defense):
 *   • EMB-201 / EMB-202 `setForcedExperience` swap paths (UI optimism only).
 *   • `forcedExperience` user-driven retry button.
 *   • EMB-201 server-rejection → swap to `WORKER_HOME`.
 *   • Iframe terminal event matcher (`looksLikeOnboardingCompleteMessage`).
 *
 * Phase 4 follow-up PR will delete the now-unused helper functions
 * (`softMarkOnboardingComplete`, `clearStaleOnboardingCompleteStamps`,
 * `detectOnboardingComplete`) and mark the related fields deprecated
 * on the `everee_workers` schema. Kept unused-but-defined here so this
 * PR stays single-file-revertable.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteField, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  evereeCreateOnboardingSession,
  evereeGetMyOnboardingStatus,
  type EvereeCreateOnboardingSessionResult,
  type EvereeEmbedExperienceType,
  type EvereeGetMyOnboardingStatusResult,
} from '../../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import {
  attachEvereePortChannel,
  canonicalEvereeOrigin,
  EVEREE_DEFAULT_HOST_HANDLER_NAME,
  registerEvereeHostBridge,
} from '../../../utils/everee/hostMessageBridge';
import {
  decideExperienceType,
  dispatchEvereeIframeMessage,
  isStampWithinTtl,
  ONBOARDING_COMPLETE_STAMP_TTL_MS,
} from './workerPayrollEvereeMatchers';

type Phase =
  | { state: 'loading' }
  | {
      state: 'ready';
      embedUrl: string;
      allowedOrigin: string;
      expiresInMs: number;
      experienceType: EvereeEmbedExperienceType;
      /** Bridge name Everee will look up on `window`; default `hrx_default`. */
      eventHandlerName: string;
    }
  | { state: 'expired' }
  | { state: 'error'; message: string }
  | { state: 'forbidden' };

const ONBOARDING_COMPLETE_STATUSES = new Set(['onboarding_complete', 'complete', 'completed']);
const COMPLETE_PAYROLL_STATUSES = new Set(['complete', 'completed', 'done']);

async function resolveEntityForEvereeTenant(
  tenantId: string,
  evereeTenantId: string,
): Promise<{ entityId: string } | null> {
  const trimmed = evereeTenantId.trim();
  /** Entity docs may store Everee tenant id as string or number — Firestore equality is type-sensitive. */
  const candidates: Array<string | number> = [trimmed];
  if (/^\d+$/.test(trimmed)) {
    candidates.push(parseInt(trimmed, 10));
  }
  for (const c of candidates) {
    const q = query(
      collection(db, 'tenants', tenantId, 'entities'),
      where('evereeTenantId', '==', c),
      limit(2),
    );
    const snap = await getDocs(q);
    const d = snap.docs[0];
    if (d) return { entityId: d.id };
  }
  return null;
}

function pickEvereeWorkerIdFromUserMap(
  ewMap: Record<string, unknown>,
  evereeTenantId: string,
): string {
  const t = evereeTenantId.trim();
  const tryKeys = [t, String(Number(t))];
  for (const k of tryKeys) {
    const v = ewMap[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * EE.4 Phase 2 — kept for diagnostic logging only. Pre-EE.4 this fed
 * `localHintSaysComplete` into the experience-type decision matrix; that
 * fallback is gone (see `decideExperienceType` — API truth wins, API
 * failure defaults to `ONBOARDING`). The function is preserved so the
 * `console.debug('[everee.session] experience decision', ...)` payload
 * still records whether local stamps disagreed with the API truth — useful
 * for ops triage when an EMB-202 escapes the preflight. Phase 4 will
 * delete it once we're confident the simplified flow is stable.
 */
/** Has this worker already finished onboarding for this entity (per Firestore mirrors)? */
async function detectOnboardingComplete(
  tenantId: string,
  entityId: string,
  uid: string,
): Promise<boolean> {
  try {
    const linkSnap = await getDoc(
      doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${uid}`),
    );
    if (linkSnap.exists()) {
      const data = linkSnap.data() as {
        status?: string;
        onboardingCompletedAt?: unknown;
        clientObservedOnboardingCompleteAt?: unknown;
        apiObservedOnboardingCompleteAt?: unknown;
      };
      if (data.onboardingCompletedAt) return true;
      // UX-only hints we stamp when the iframe (`clientObserved…`) or our
      // server-side Everee API preflight (`apiObserved…`) tells us the worker
      // is already done — used to prevent EMB-201 ("Onboarding already
      // complete") loops on subsequent loads when the canonical webhook
      // hasn't updated `status` yet. EE.4 Layer 3 — only trust these
      // hints inside the TTL window; older stamps are ignored so the
      // server preflight on the next load gets to re-decide. (Stamps
      // older than the TTL are usually fine; the gate is here to escape
      // a bad-stamp deadlock if the preflight is also unreachable.)
      if (
        data.clientObservedOnboardingCompleteAt &&
        isStampWithinTtl(data.clientObservedOnboardingCompleteAt, ONBOARDING_COMPLETE_STAMP_TTL_MS)
      ) {
        return true;
      }
      if (
        data.apiObservedOnboardingCompleteAt &&
        isStampWithinTtl(data.apiObservedOnboardingCompleteAt, ONBOARDING_COMPLETE_STAMP_TTL_MS)
      ) {
        return true;
      }
      if (data.status && ONBOARDING_COMPLETE_STATUSES.has(String(data.status).toLowerCase())) {
        return true;
      }
    }
  } catch {
    /* ignore — fall back to other signals */
  }
  try {
    const empSnap = await getDocs(
      query(
        collection(db, 'tenants', tenantId, 'entity_employments'),
        where('userId', '==', uid),
        where('entityId', '==', entityId),
        limit(2),
      ),
    );
    for (const d of empSnap.docs) {
      const data = d.data() as { payrollStatus?: string; payrollOnboardingCompletedAt?: unknown };
      if (data.payrollOnboardingCompletedAt) return true;
      const ps = String(data.payrollStatus || '').toLowerCase();
      if (ps && COMPLETE_PAYROLL_STATUSES.has(ps)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * EE.4 Phase 2 — UNUSED. Kept here unreferenced through Phase 3 so this
 * PR stays single-file-revertable; Phase 4 follow-up PR will delete the
 * function plus its `firebase/firestore` imports (`setDoc`,
 * `serverTimestamp`).
 *
 * Pre-EE.4 the dispatch handler called this on every iframe terminal
 * event (`WORKER_ONBOARDING_COMPLETE`) and EMB-201 toast to optimistically
 * stamp `clientObservedOnboardingCompleteAt` so the next session create
 * would pick `WORKER_HOME`. With the bridge (EE.7) and webhooks (WH.1)
 * both working, the canonical webhook → reconcile path writes
 * `apiObservedOnboardingCompleteAt` end-to-end within seconds, so the
 * optimistic stamp was duplicate work — and it caused the EMB-202
 * deadlock when an intermediate-step iframe message slipped past the
 * matcher (now hardened in `looksLikeOnboardingCompleteMessage`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function softMarkOnboardingComplete(
  tenantId: string,
  entityId: string,
  uid: string,
  reason: string,
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${uid}`),
      {
        // Webhook is still authoritative for `status`; we only stamp a UX-only hint
        // here so we don't accidentally race the canonical state machine.
        clientObservedOnboardingCompleteAt: serverTimestamp(),
        clientObservedOnboardingCompleteReason: reason,
      },
      { merge: true },
    );
  } catch {
    /* ignore — UX-only */
  }
}

/**
 * EE.4 Phase 2 — UNUSED. Kept here unreferenced through Phase 3 so this
 * PR stays single-file-revertable; Phase 4 follow-up PR will delete the
 * function plus its `firebase/firestore` imports (`deleteField`).
 *
 * Pre-EE.4 the dispatch handler and the preflight-inverse branch called
 * this to wipe stale `clientObservedOnboardingCompleteAt` /
 * `apiObservedOnboardingCompleteAt` stamps after EMB-202 errors. The
 * server preflight (`evereeGetMyOnboardingStatus`) now does this clear
 * itself when Everee API authoritatively says the worker isn't done
 * (see `functions/src/integrations/everee/evereeCallables.ts:380-400`),
 * so the client-side delete was duplicate work.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function clearStaleOnboardingCompleteStamps(
  tenantId: string,
  entityId: string,
  uid: string,
  reason: string,
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${uid}`),
      {
        clientObservedOnboardingCompleteAt: deleteField(),
        clientObservedOnboardingCompleteReason: deleteField(),
        apiObservedOnboardingCompleteAt: deleteField(),
        clientObservedOnboardingCompleteCleared: serverTimestamp(),
        clientObservedOnboardingCompleteClearedReason: reason,
      },
      { merge: true },
    );
  } catch {
    /* ignore — UX-only */
  }
}

const WorkerPayrollEvereeTenant: React.FC = () => {
  const { evereeTenantId: evereeTenantIdRaw } = useParams<{ evereeTenantId: string }>();
  const evereeTenantId = evereeTenantIdRaw ? decodeURIComponent(evereeTenantIdRaw) : '';
  const { user, tenantId, tenantIds } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid;
  /**
   * EE.3 — `tenantIds` is a fresh array reference on every `AuthProvider`
   * render (the provider rebuilds its context value object each time any
   * piece of auth state updates: `users/{uid}` snapshot fires, `activeTenant`
   * load completes, preferred-language one-shot write, etc.). Putting the
   * raw array into `startSession`'s `useCallback` deps therefore rebuilt
   * the callback on every parent re-render, which re-fired the
   * `useEffect([startSession, ...])` below, which called
   * `setPhase({ state: 'loading' })` — unmounting the iframe and creating
   * a fresh Everee session each cycle. The visible symptom is the embed
   * "flashing" / spinning repeatedly on `/c1/workers/payroll/:id`.
   *
   * Resolving the array to a primitive string here lets `useCallback`'s
   * `Object.is` check short-circuit when the *value* is unchanged, even
   * if the array identity isn't.
   */
  const scopeTenantId = tenantId || tenantIds[0] || '';

  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  /** When set, force this experience on the next session create instead of auto-detecting. */
  const [forcedExperience, setForcedExperience] = useState<EvereeEmbedExperienceType | null>(null);
  const expireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSwapRef = useRef<EvereeEmbedExperienceType | null>(null);
  /**
   * EE.7 — required for `attachEvereePortChannel` to install a `MessageChannel`
   * port into the iframe on its `load` event (the documented Web/React
   * iframe handshake). Without this ref the documented V2 bridge never
   * attaches and Everee surfaces EMB-102 ("No event handler has been
   * registered") inside the iframe forever.
   */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  /**
   * EE.3 — monotonically-increasing token. Bumped on every `startSession`
   * fire (and on unmount via the outer `useEffect` cleanup). All `setPhase`
   * calls inside `startSession` first verify their captured token still
   * matches `currentRequestRef.current`; if a newer fire (or unmount)
   * superseded them, they no-op. This is defense-in-depth against any
   * future dep-instability regression: even if `startSession` somehow re-
   * fires while a previous invocation is still in flight, the stale
   * completions can't overwrite the newer phase / cause the iframe to
   * thrash. (The leak we just fixed was at the dep level — see the
   * `scopeTenantId` derivation above — but this guard makes the symptom
   * recoverable rather than catastrophic if a fresh dep regression slips
   * past review.)
   */
  const currentRequestRef = useRef(0);
  /** Counter for the EE.3 debug log so re-fires are visible in the console. */
  const startSessionInvocationsRef = useRef(0);

  const clearExpireTimer = useCallback(() => {
    if (expireTimerRef.current) {
      clearTimeout(expireTimerRef.current);
      expireTimerRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!uid || !scopeTenantId || !evereeTenantId) {
      setPhase({ state: 'error', message: 'Missing session context.' });
      return;
    }
    const requestId = ++currentRequestRef.current;
    const invocation = ++startSessionInvocationsRef.current;
    // EE.3 — at steady state this should fire exactly once on mount, plus
    // once per user-driven retry (`Try again` / `forcedExperience` swap).
    // Anything north of ~5 fires within the first 30 s indicates a fresh
    // dep-stability regression — investigate before shipping.
    // eslint-disable-next-line no-console
    console.debug('[everee.session] startSession fired', {
      invocation,
      requestId,
      uid,
      scopeTenantId,
      evereeTenantId,
      forcedExperience,
    });
    const isStale = () => currentRequestRef.current !== requestId;
    clearExpireTimer();
    setPhase({ state: 'loading' });
    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (isStale()) return;
      const ewMap = (userSnap.data()?.evereeWorkerIds ?? {}) as Record<string, unknown>;
      const evereeWorkerId = pickEvereeWorkerIdFromUserMap(ewMap, evereeTenantId);
      if (!evereeWorkerId) {
        setPhase({ state: 'forbidden' });
        return;
      }
      const resolved = await resolveEntityForEvereeTenant(scopeTenantId, evereeTenantId);
      if (isStale()) return;
      if (!resolved) {
        setPhase({
          state: 'error',
          message:
            'Could not resolve payroll configuration for this employer. Contact support if this persists.',
        });
        return;
      }
      // EE.4 Phase 2 — diagnostic-only read of the local Firestore
      // stamps. Used to log when local state disagreed with the API
      // truth (helpful for ops triage when an EMB-202 escapes the
      // preflight) but **never** fed into the experience-type decision.
      // See the audit comment block at the top of this file.
      const localHintSaysComplete = await detectOnboardingComplete(
        scopeTenantId,
        resolved.entityId,
        uid,
      );
      if (isStale()) return;
      // EE.4 — Server-side preflight is the **only** authority for the
      // experience pick. `evereeGetMyOnboardingStatus` wraps Everee's
      // `GET /api/v2/workers/{id}` and applies the Layer 2 unanimity
      // rule (`onboardingComplete: true` AND `onboardingStatus:
      // 'COMPLETE'`); when Everee says the worker isn't done it also
      // clears any stale `clientObservedOnboardingCompleteAt` /
      // `apiObservedOnboardingCompleteAt` stamps server-side, so the
      // client doesn't need a parallel cleanup path.
      //
      // API failure → `decideExperienceType` returns `ONBOARDING` (safe
      // default). Pre-EE.4 we used to fall back to the local Firestore
      // stamps in this branch; that was the deadlock fuel — a single
      // false-positive iframe message would persist as a stale stamp
      // and the next preflight outage would lock the worker out of
      // onboarding by misrouting them to `WORKER_HOME`.
      let apiSaysComplete = false;
      let apiPreflightOk = false;
      let preflightDiagnostic: {
        onboardingStatus?: string | null;
        onboardingCompleteSignal?: boolean | null;
      } = {};
      if (!forcedExperience) {
        try {
          const statusRes = await evereeGetMyOnboardingStatus({
            tenantId: scopeTenantId,
            entityId: resolved.entityId,
            evereeWorkerId,
          });
          if (isStale()) return;
          const statusData = statusRes.data as
            | EvereeGetMyOnboardingStatusResult
            | undefined;
          if (statusData?.ok) {
            apiPreflightOk = true;
            apiSaysComplete = statusData.onboardingComplete === true;
            preflightDiagnostic = {
              onboardingStatus: statusData.onboardingStatus ?? null,
              onboardingCompleteSignal: statusData.onboardingCompleteSignal ?? null,
            };
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[everee embed] preflight status check failed', err);
        }
      }

      const experienceType = decideExperienceType({
        forcedExperience,
        apiPreflightOk,
        apiSaysComplete,
      });
      // eslint-disable-next-line no-console
      console.debug('[everee.session] experience decision', {
        requestId,
        forcedExperience,
        apiPreflightOk,
        apiSaysComplete,
        // EE.4 diagnostic — surfaces local-stamp drift without using it
        // for decisions. Should converge to false in steady state.
        localHintSaysComplete,
        localHintMatchesApi: apiPreflightOk
          ? localHintSaysComplete === apiSaysComplete
          : null,
        experienceType,
        ...preflightDiagnostic,
      });
      lastSwapRef.current = experienceType;
      const sessionRes = await evereeCreateOnboardingSession({
        tenantId: scopeTenantId,
        entityId: resolved.entityId,
        userId: uid,
        evereeWorkerId,
        experienceType,
        returnUrl:
          typeof window !== 'undefined'
            ? `${window.location.origin}/c1/workers/payroll/${encodeURIComponent(evereeTenantId)}`
            : undefined,
      });
      if (isStale()) return;
      const raw = sessionRes.data as EvereeCreateOnboardingSessionResult | undefined;
      const embedUrl = String(raw?.embedUrl ?? raw?.url ?? '').trim();
      const expiresInMs =
        typeof raw?.expiresInMs === 'number' && Number.isFinite(raw.expiresInMs)
          ? raw.expiresInMs
          : 3600000;
      if (!embedUrl) {
        setPhase({ state: 'error', message: 'Payroll service did not return an embed URL.' });
        return;
      }
      // Canonicalize via `new URL(...).origin` so a server-supplied value with
      // a trailing slash (`https://app.everee.com/`) survives the strict
      // equality check against `MessageEvent.origin` (`https://app.everee.com`,
      // never trailing-slashed per RFC 6454). Without this, every postMessage
      // from the iframe is rejected and the embed stalls on the loading
      // spinner. Falls through to the embed URL's origin if the server didn't
      // return one (or returned something unparseable).
      const originOk =
        canonicalEvereeOrigin(raw?.origin) || canonicalEvereeOrigin(embedUrl);
      const handlerNameFromServer =
        typeof raw?.eventHandlerName === 'string' && raw.eventHandlerName.trim()
          ? raw.eventHandlerName.trim()
          : EVEREE_DEFAULT_HOST_HANDLER_NAME;
      setPhase({
        state: 'ready',
        embedUrl,
        allowedOrigin: originOk,
        expiresInMs,
        experienceType,
        eventHandlerName: handlerNameFromServer,
      });
      expireTimerRef.current = setTimeout(() => {
        // Only emit `expired` if this session is still the current one.
        if (isStale()) return;
        setPhase({ state: 'expired' });
      }, expiresInMs);
    } catch (e: unknown) {
      if (isStale()) return;
      const message = formatFirebaseHttpsError(e) || 'Could not start payroll session.';
      // If the server rejected ONBOARDING because the worker is already done,
      // auto-retry with WORKER_HOME so the worker isn't left staring at a wall.
      if (
        lastSwapRef.current !== 'WORKER_HOME' &&
        /EMB-201|Onboarding\s+already\s+complete|ONBOARDING\s+experience\s+is\s+only\s+available/i.test(
          message,
        )
      ) {
        // eslint-disable-next-line no-console
        console.info('[everee embed] swapping to WORKER_HOME after server rejection', { message });
        setForcedExperience('WORKER_HOME');
        return;
      }
      // Symmetric counterpart for EMB-202 ("Onboarding not yet complete /
      // Only the ONBOARDING experience is available"). EE.4 Phase 2 — UI
      // swap only; the server preflight (`evereeGetMyOnboardingStatus`)
      // already clears any stale `apiObservedOnboardingCompleteAt` /
      // `clientObservedOnboardingCompleteAt` stamps server-side when
      // Everee API says the worker isn't done, so this client-side
      // recovery just needs to flip the requested experience.
      if (
        lastSwapRef.current !== 'ONBOARDING' &&
        /EMB-202|Onboarding\s+not\s+yet\s+complete|Only\s+the\s+ONBOARDING\s+experience/i.test(
          message,
        )
      ) {
        // eslint-disable-next-line no-console
        console.info('[everee embed] swapping to ONBOARDING after server rejection', { message });
        setForcedExperience('ONBOARDING');
        return;
      }
      setPhase({ state: 'error', message });
    }
  }, [uid, scopeTenantId, evereeTenantId, clearExpireTimer, forcedExperience]);

  useEffect(() => {
    void startSession();
    return () => {
      clearExpireTimer();
      // EE.3 — bump the request token so any in-flight `startSession` invocation
      // (Firestore reads, Everee callable, EMB-201/202 retry handlers) marks
      // itself stale and no-ops on completion. Without this the outer effect's
      // cleanup only stops the expire timer; awaited work would still resolve
      // and call `setPhase` on an unmounted component (warns in dev) or write
      // to the wrong session if the dep array somehow re-fired.
      currentRequestRef.current += 1;
    };
  }, [startSession, clearExpireTimer]);

  /**
   * Auto-swap to WORKER_HOME if the iframe tells us onboarding finished or
   * renders the "already complete" error. We can't always rely on the webhook
   * (network delay or — pre-signature-fix — silent rejection), so the iframe
   * itself is the most reliable real-time signal.
   *
   * The Everee SDK delivers events through one of two channels depending on
   * the experience version:
   *   - V1_0 (`WORKER_HOME` etc.): `parent.postMessage(envelope, origin, [port])`
   *     → caught by our `window.addEventListener('message', …)`.
   *   - V2_0 (`ONBOARDING`): `window[eventHandlerName].postMessage(envelope)`
   *     → caught by our host bridge registered below. Without the bridge, V2
   *     embeds render an `EMB-102` toast and never start.
   */
  /**
   * EE.3 — derive primitives from `phase` so the host-bridge `useEffect`
   * below depends on string equality, not on `phase`'s object identity.
   * `setPhase({...})` always allocates a new object; if we kept `phase`
   * directly in the dep array, every `loading → ready` cycle (and every
   * stale completion that managed to slip past the `isStale()` guard above)
   * would tear down and re-register the `window[handlerName]` host bridge —
   * which the V2_0 iframe interprets as a missing handler and surfaces as
   * EMB-102. Comparing by value collapses cycles of "same ready content
   * with a fresh wrapper object" into a single bridge registration.
   */
  const phaseReady = phase.state === 'ready';
  const allowedOrigin = phaseReady ? phase.allowedOrigin : '';
  const currentExperience = phaseReady ? phase.experienceType : null;
  const handlerName = phaseReady ? phase.eventHandlerName : '';
  /**
   * EE.7 — derive the iframe `src` as a primitive so the bridge `useEffect`
   * below re-fires when Everee returns a new ephemeral session URL on the
   * same `phase.state === 'ready'` cycle (e.g. silent renewal, experience
   * swap, or the auto-retry path). A `MessagePort` can only be transferred
   * once; without re-attaching, the next iframe `load` would try to
   * re-post the already-transferred port and silently no-op, locking the
   * new session into another EMB-102 deadlock.
   */
  const phaseEmbedUrl = phaseReady ? phase.embedUrl : '';

  useEffect(() => {
    if (!phaseReady || !handlerName) return;
    const allowed = allowedOrigin;

    const dispatch = (
      payload: unknown,
      source: 'window.message' | 'host.bridge' | 'host.port',
    ) => {
      // eslint-disable-next-line no-console
      console.log('[everee embed message]', { source, data: payload });
      // EE.4 Phase 2 Change 1 — iframe events are advisory UI hints
      // only. NO Firestore writes here. The webhook + reconcile path
      // owns canonical `apiObservedOnboardingCompleteAt`/`status`; this
      // dispatcher exists purely to swap which Embed Component is
      // mounted in the parent shell for sub-second perceived
      // responsiveness.
      dispatchEvereeIframeMessage(payload, {
        currentExperience,
        onComplete: () => setForcedExperience('WORKER_HOME'),
        onNotYetComplete: () => setForcedExperience('ONBOARDING'),
      });
    };

    const onMsg = (event: MessageEvent) => {
      // Only honour messages from Everee's iframe origin (when known).
      if (allowed && event.origin !== allowed) return;
      dispatch(event.data, 'window.message');
    };
    window.addEventListener('message', onMsg);

    const bridge = registerEvereeHostBridge({
      handlerName,
      onMessage: (msg) => dispatch(msg, 'host.bridge'),
    });

    // EE.7 — the canonical Web/React iframe transport
    // (https://developer.everee.com/docs/web-react-iframe). Pre-EE.7 we
    // only registered the `window[handlerName]` bridge above, which the V2
    // SDK in browsers doesn't actually probe for (that's the WKWebView
    // path). The result was an EMB-102 toast on every ONBOARDING mount
    // and a swallowed EMB-202 recovery signal — the deadlock at the heart
    // of every "stuck onboarding" report. The port-channel attach is
    // additive: V1_0 (`WORKER_HOME`) embeds keep using the
    // `parent.postMessage` path caught by `onMsg` above, and the
    // window-property bridge stays as a defensive fallback.
    const portChannel = iframeRef.current
      ? attachEvereePortChannel(iframeRef.current, {
          onMessage: (msg) => dispatch(msg, 'host.port'),
        })
      : null;

    return () => {
      window.removeEventListener('message', onMsg);
      bridge.unregister();
      portChannel?.unregister();
    };
    // EE.3 — deps are all primitives (string / null) so `Object.is` collapses
    // re-renders that don't actually change the bridge configuration. This
    // also dodges the `tenantIds` array-reference instability from
    // `useAuth()` (the same trap that re-fired `startSession` above).
    // EE.7 — `phaseEmbedUrl` is in here on purpose: each new ephemeral
    // session URL needs a fresh `MessageChannel`, so we want the effect
    // to tear down + re-attach when the iframe's `src` changes.
  }, [
    phaseReady,
    phaseEmbedUrl,
    allowedOrigin,
    currentExperience,
    handlerName,
    scopeTenantId,
    uid,
    evereeTenantId,
  ]);

  const iframeOrigin = useMemo(() => {
    if (phase.state !== 'ready') return '';
    try {
      return new URL(phase.embedUrl).origin;
    } catch {
      return '';
    }
  }, [phase]);

  useEffect(() => {
    if (!allowedOrigin || !iframeOrigin || iframeOrigin === allowedOrigin) return;
    // eslint-disable-next-line no-console
    console.warn('[everee embed] origin mismatch — postMessage checks use API origin', {
      apiOrigin: allowedOrigin,
      iframeOrigin,
    });
    // EE.3 — same primitive-dep pattern as the host-bridge effect above.
  }, [allowedOrigin, iframeOrigin]);

  if (!uid || (!tenantId && (!tenantIds || tenantIds.length === 0))) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Sign in to view payroll.</Typography>
      </Box>
    );
  }

  if (!evereeTenantId) {
    return <Navigate to="/c1/workers/payroll" replace />;
  }

  if (phase.state === 'forbidden') {
    return (
      <Box sx={{ p: 3, maxWidth: 560 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          No payroll account found for this employer.
        </Alert>
        <Button variant="contained" onClick={() => navigate('/c1/workers/payroll')}>
          Back
        </Button>
      </Box>
    );
  }

  if (phase.state === 'error') {
    return (
      <Box sx={{ p: 3, maxWidth: 560 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {phase.message}
        </Alert>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => void startSession()}>
            Try again
          </Button>
          {forcedExperience !== 'WORKER_HOME' && (
            <Button
              variant="text"
              onClick={() => {
                setForcedExperience('WORKER_HOME');
              }}
            >
              I&apos;ve already finished onboarding
            </Button>
          )}
        </Stack>
      </Box>
    );
  }

  if (phase.state === 'expired') {
    return (
      <Box sx={{ p: 3, maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This payroll session expired. Refresh to continue.
        </Typography>
        <Button variant="contained" onClick={() => void startSession()}>
          Refresh session
        </Button>
      </Box>
    );
  }

  if (phase.state === 'loading') {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        minHeight: 480,
        p: 1,
      }}
    >
      <Box
        component="iframe"
        ref={iframeRef}
        title={phase.experienceType === 'WORKER_HOME' ? 'Payroll account' : 'Payroll onboarding'}
        src={phase.embedUrl}
        sx={{
          flex: 1,
          width: '100%',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.default',
        }}
      />
      {phase.experienceType === 'ONBOARDING' && (
        <Box sx={{ pt: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setForcedExperience('WORKER_HOME');
            }}
          >
            I&apos;ve already finished onboarding — open my account
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default WorkerPayrollEvereeTenant;
