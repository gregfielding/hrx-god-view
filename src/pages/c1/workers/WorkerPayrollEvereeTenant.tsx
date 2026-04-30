/**
 * Everee payroll iframe — `/c1/workers/payroll/:evereeTenantId`
 *
 * Picks the right Everee Embed Component automatically:
 *   - `ONBOARDING` (V2_0) until the worker has finished payroll setup.
 *   - `WORKER_HOME` (V1_0) once they're done — keeps them inside HRX instead
 *     of bouncing them to account.everee.com.
 *
 * "Done" is signalled by any of:
 *   - `tenants/{tid}/everee_workers/{entityId__uid}.status === 'onboarding_complete'`
 *     (set by the `worker.onboarding-completed` webhook → authoritative)
 *   - The Everee iframe posts a completion event (UX-only optimistic swap).
 *   - The Everee iframe renders `EMB-201` ("Onboarding already complete") —
 *     auto-retry with `WORKER_HOME` instead of leaving the worker stuck.
 *
 * Sessions are short-lived; we always create a fresh one on mount / swap /
 * "Try again" and never cache the URL in component state across reloads.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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

type Phase =
  | { state: 'loading' }
  | {
      state: 'ready';
      embedUrl: string;
      allowedOrigin: string;
      expiresInMs: number;
      experienceType: EvereeEmbedExperienceType;
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
      // hasn't updated `status` yet.
      if (data.clientObservedOnboardingCompleteAt) return true;
      if (data.apiObservedOnboardingCompleteAt) return true;
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

/** Best-effort UX mirror: stamp the link doc so subsequent loads pick WORKER_HOME immediately. */
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

/** Heuristic: was this an Everee `WORKER_ONBOARDING_COMPLETE`-style postMessage? */
function looksLikeOnboardingCompleteMessage(payload: unknown): boolean {
  if (!payload) return false;
  const candidates: string[] = [];
  if (typeof payload === 'string') candidates.push(payload);
  else if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    for (const k of ['type', 'event', 'name', 'kind', 'status', 'state']) {
      const v = p[k];
      if (typeof v === 'string') candidates.push(v);
    }
  }
  return candidates.some((c) => /WORKER_ONBOARDING_COMPLETE|ONBOARDING_COMPLETE|onboarding[._-]?complete/i.test(c));
}

/** Heuristic: is the iframe rendering the EMB-201 "already complete" page? */
function looksLikeAlreadyCompleteError(payload: unknown): boolean {
  if (!payload) return false;
  const blobs: string[] = [];
  if (typeof payload === 'string') blobs.push(payload);
  else if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    for (const k of ['code', 'errorCode', 'embErrorCode', 'message', 'error', 'reason']) {
      const v = p[k];
      if (typeof v === 'string') blobs.push(v);
    }
    if (typeof p.error === 'object' && p.error) {
      for (const v of Object.values(p.error as Record<string, unknown>)) {
        if (typeof v === 'string') blobs.push(v);
      }
    }
  }
  return blobs.some((b) => /EMB-201|Onboarding\s+already\s+complete/i.test(b));
}

const WorkerPayrollEvereeTenant: React.FC = () => {
  const { evereeTenantId: evereeTenantIdRaw } = useParams<{ evereeTenantId: string }>();
  const evereeTenantId = evereeTenantIdRaw ? decodeURIComponent(evereeTenantIdRaw) : '';
  const { user, tenantId, tenantIds } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid;

  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  /** When set, force this experience on the next session create instead of auto-detecting. */
  const [forcedExperience, setForcedExperience] = useState<EvereeEmbedExperienceType | null>(null);
  const expireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSwapRef = useRef<EvereeEmbedExperienceType | null>(null);

  const clearExpireTimer = useCallback(() => {
    if (expireTimerRef.current) {
      clearTimeout(expireTimerRef.current);
      expireTimerRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    const scopeTenantId = tenantId || tenantIds[0];
    if (!uid || !scopeTenantId || !evereeTenantId) {
      setPhase({ state: 'error', message: 'Missing session context.' });
      return;
    }
    clearExpireTimer();
    setPhase({ state: 'loading' });
    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      const ewMap = (userSnap.data()?.evereeWorkerIds ?? {}) as Record<string, unknown>;
      const evereeWorkerId = pickEvereeWorkerIdFromUserMap(ewMap, evereeTenantId);
      if (!evereeWorkerId) {
        setPhase({ state: 'forbidden' });
        return;
      }
      const resolved = await resolveEntityForEvereeTenant(scopeTenantId, evereeTenantId);
      if (!resolved) {
        setPhase({
          state: 'error',
          message:
            'Could not resolve payroll configuration for this employer. Contact support if this persists.',
        });
        return;
      }
      let detectedComplete = await detectOnboardingComplete(
        scopeTenantId,
        resolved.entityId,
        uid,
      );
      // Server-side preflight: ask Everee directly. Necessary because their
      // iframe posts EMB-201 over `host MessagePort` / `webkit.messageHandlers`,
      // neither of which exists in a browser tab — so we'd otherwise have no
      // way of knowing the worker is done until the webhook side processes
      // `worker.onboarding-completed`. The callable also mirrors the result
      // back to the link doc, so subsequent loads short-circuit through the
      // Firestore check above.
      if (!detectedComplete && !forcedExperience) {
        try {
          const statusRes = await evereeGetMyOnboardingStatus({
            tenantId: scopeTenantId,
            entityId: resolved.entityId,
            evereeWorkerId,
          });
          const statusData = statusRes.data as
            | EvereeGetMyOnboardingStatusResult
            | undefined;
          if (statusData?.ok && statusData.onboardingComplete) {
            detectedComplete = true;
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[everee embed] preflight status check failed', err);
        }
      }
      const experienceType: EvereeEmbedExperienceType =
        forcedExperience ?? (detectedComplete ? 'WORKER_HOME' : 'ONBOARDING');
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
      const raw = sessionRes.data as EvereeCreateOnboardingSessionResult | undefined;
      const embedUrl = String(raw?.embedUrl ?? raw?.url ?? '').trim();
      const allowedOrigin = String(raw?.origin ?? '').trim();
      const expiresInMs =
        typeof raw?.expiresInMs === 'number' && Number.isFinite(raw.expiresInMs)
          ? raw.expiresInMs
          : 3600000;
      if (!embedUrl) {
        setPhase({ state: 'error', message: 'Payroll service did not return an embed URL.' });
        return;
      }
      let originOk = allowedOrigin;
      if (!originOk) {
        try {
          originOk = new URL(embedUrl).origin;
        } catch {
          originOk = '';
        }
      }
      setPhase({
        state: 'ready',
        embedUrl,
        allowedOrigin: originOk,
        expiresInMs,
        experienceType,
      });
      expireTimerRef.current = setTimeout(() => {
        setPhase({ state: 'expired' });
      }, expiresInMs);
    } catch (e: unknown) {
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
      setPhase({ state: 'error', message });
    }
  }, [uid, tenantId, tenantIds, evereeTenantId, clearExpireTimer, forcedExperience]);

  useEffect(() => {
    void startSession();
    return () => {
      clearExpireTimer();
    };
  }, [startSession, clearExpireTimer]);

  /**
   * Auto-swap to WORKER_HOME if the iframe tells us onboarding finished or
   * renders the "already complete" error. We can't always rely on the webhook
   * (network delay or — pre-signature-fix — silent rejection), so the iframe
   * itself is the most reliable real-time signal.
   */
  useEffect(() => {
    if (phase.state !== 'ready') return;
    const allowed = phase.allowedOrigin;
    const currentExperience = phase.experienceType;
    const onMsg = (event: MessageEvent) => {
      // Only honour messages from Everee's iframe origin (when known).
      if (allowed && event.origin !== allowed) return;
      const payload = event.data;
      // eslint-disable-next-line no-console
      console.log('[everee embed message]', { origin: event.origin, data: payload });

      const onboardingComplete = looksLikeOnboardingCompleteMessage(payload);
      const embAlreadyComplete = looksLikeAlreadyCompleteError(payload);
      if (!onboardingComplete && !embAlreadyComplete) return;
      if (currentExperience === 'WORKER_HOME') return;
      const scopeTenantId = tenantId || tenantIds[0];
      if (uid && scopeTenantId) {
        // Best-effort mirror; webhook still owns canonical `status`.
        void resolveEntityForEvereeTenant(scopeTenantId, evereeTenantId).then((resolved) => {
          if (!resolved) return;
          void softMarkOnboardingComplete(
            scopeTenantId,
            resolved.entityId,
            uid,
            onboardingComplete ? 'iframe.onboarding_complete' : 'iframe.emb_201',
          );
        });
      }
      setForcedExperience('WORKER_HOME');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [phase, tenantId, tenantIds, uid, evereeTenantId]);

  const iframeOrigin = useMemo(() => {
    if (phase.state !== 'ready') return '';
    try {
      return new URL(phase.embedUrl).origin;
    } catch {
      return '';
    }
  }, [phase]);

  useEffect(() => {
    const allowed = phase.state === 'ready' ? phase.allowedOrigin : '';
    if (!allowed || !iframeOrigin || iframeOrigin === allowed) return;
    // eslint-disable-next-line no-console
    console.warn('[everee embed] origin mismatch — postMessage checks use API origin', {
      apiOrigin: allowed,
      iframeOrigin,
    });
  }, [phase, iframeOrigin]);

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
