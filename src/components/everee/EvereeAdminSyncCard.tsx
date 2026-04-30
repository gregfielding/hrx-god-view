/**
 * EvereeAdminSyncCard — recruiter/admin-only "Sync to Everee" surface.
 *
 * Renders on the Employment tab for an entity whose payroll provider is
 * Everee + the entity has `evereeEnabled=true`. Calls the
 * `evereeEnsureWorker` callable, which is idempotent server-side
 * (`createWorkerIfNeeded` returns the existing worker id without re-POSTing
 * when one is already linked — checked first via
 * `users/{uid}.evereeWorkerIds[evereeTenantId]`, then via the
 * `everee_workers` linkage doc).
 *
 * Multi-Everee-tenant model: each C1 entity points at its own Everee tenant
 * (Sandbox=2320, future Select=X, Events=Y). A worker accumulates one
 * `evereeWorkerId` per Everee tenant they're provisioned in. This card
 * displays the id for *this entity's* Everee tenant only — sourced from the
 * user-record map keyed by `evereeTenantId` (resolved live from the entity
 * doc).
 *
 * Out of scope for this component:
 *   - Worker-facing payroll setup embed (see `EvereePayrollSetupEmbed.tsx`)
 *   - Onboarding session creation / iframe
 *
 * Permission gate (mirrors backend `canManageEveree`): caller must be HRX
 * or carry an Admin / Recruiter / Manager claim on this tenant. Workers
 * never see this card.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import RestoreIcon from '@mui/icons-material/Restore';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { useAuth } from '../../contexts/AuthContext';
import {
  evereeAdminRecreateWorkerOnboarding,
  evereeEnsureWorker,
  type EvereeWorkerType,
} from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface EvereeAdminSyncCardProps {
  tenantId: string;
  entityId: string | null;
  /** Worker uid (Firebase Auth uid; same as `users/{uid}` doc id). */
  userId: string;
  workerType?: EvereeWorkerType;
  /** Optional callback so the parent can refetch overview after a successful sync. */
  onSynced?: (evereeWorkerId: string) => void;
}

interface WorkerContact {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

const EvereeAdminSyncCard: React.FC<EvereeAdminSyncCardProps> = ({
  tenantId,
  entityId,
  userId,
  workerType,
  onSynced,
}) => {
  const { isHRX, currentClaimsRole } = useAuth();
  const canManage = useMemo(
    () =>
      isHRX ||
      currentClaimsRole === 'Admin' ||
      currentClaimsRole === 'Recruiter' ||
      currentClaimsRole === 'Manager',
    [isHRX, currentClaimsRole],
  );

  const [evereeTenantId, setEvereeTenantId] = useState<string | null>(null);
  const [evereeWorkerIdsMap, setEvereeWorkerIdsMap] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Resolve the Everee tenant id for this entity once (entity config rarely changes;
  // a one-shot read is enough — the live subscription is on the user doc below).
  useEffect(() => {
    if (!entityId) {
      setEvereeTenantId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, p.entity(tenantId, entityId)));
        if (cancelled) return;
        const tid = snap.data()?.evereeTenantId;
        setEvereeTenantId(typeof tid === 'string' && tid.trim() ? tid.trim() : null);
      } catch {
        if (!cancelled) setEvereeTenantId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, entityId]);

  // Live subscription to the user's Everee linkage map so the chip reflects
  // post-sync writes from this client + any other surface (Stage 2 trigger,
  // backfill scripts) without a manual reload.
  useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(doc(db, `users/${userId}`), (snap) => {
      const map = (snap.data()?.evereeWorkerIds ?? {}) as Record<string, string>;
      setEvereeWorkerIdsMap(map && typeof map === 'object' ? map : {});
    });
    return () => unsub();
  }, [userId]);

  const evereeWorkerId = evereeTenantId ? evereeWorkerIdsMap[evereeTenantId] ?? null : null;

  const handleClick = useCallback(async () => {
    if (!entityId) {
      setError('This entity is not yet linked to Everee.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      // Resolve worker contact info inline. Field shapes vary across legacy
      // worker docs; keep this lookup tolerant rather than typing the whole
      // user schema here.
      let contact: WorkerContact = {};
      try {
        const userSnap = await getDoc(doc(db, `users/${userId}`));
        const u = (userSnap.data() ?? {}) as Record<string, unknown>;
        contact = {
          email: typeof u.email === 'string' ? u.email : undefined,
          firstName: typeof u.firstName === 'string' ? u.firstName : undefined,
          lastName: typeof u.lastName === 'string' ? u.lastName : undefined,
          phone:
            typeof u.phone === 'string'
              ? u.phone
              : typeof u.phoneNumber === 'string'
                ? (u.phoneNumber as string)
                : undefined,
        };
      } catch {
        // Non-blocking — server will still create a worker shell with just externalId.
      }

      const result = await evereeEnsureWorker({
        tenantId,
        entityId,
        userId,
        workerType,
        ...contact,
      });
      const id = result.data?.evereeWorkerId?.trim() || null;
      if (!id) {
        throw new Error('Everee did not return a worker id.');
      }
      setToast({
        severity: 'success',
        message: result.data?.created
          ? `Created Everee worker ${id}`
          : `Already linked — Everee worker ${id}`,
      });
      onSynced?.(id);
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setSyncing(false);
    }
  }, [entityId, onSynced, tenantId, userId, workerType]);

  // EE.5 — admin/CSA recovery surface for Firestore deletions of either
  // `worker_onboarding/{userId}__{entityKey}` or
  // `everee_workers/{entityId}__{userId}`. Idempotent server-side.
  const handleRecreate = useCallback(async () => {
    if (!entityId) {
      setError('This entity is not yet linked to Everee.');
      return;
    }
    setRecovering(true);
    setError(null);
    try {
      const result = await evereeAdminRecreateWorkerOnboarding({
        tenantId,
        entityId,
        userId,
      });
      const data = result.data;
      const parts: string[] = [];
      if (data.workerOnboardingRecreated) {
        parts.push(`Recreated worker_onboarding/${data.pipelineId}`);
      }
      if (data.evereeWorkersLinkageRecreated) {
        parts.push(`Restored everee_workers/${data.linkageDocId}`);
      }
      const message =
        parts.length > 0
          ? parts.join(' · ')
          : `Both docs already present for ${data.entityName} — no recovery needed.`;
      setToast({ severity: 'success', message });
      onSynced?.(data.evereeWorkerId ?? '');
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setRecovering(false);
    }
  }, [entityId, onSynced, tenantId, userId]);

  if (!canManage) return null;

  // Disabled-with-tooltip path — keeps the card visible so recruiters know the
  // surface exists, even when this entity isn't ready for Everee provisioning.
  const disabledReason = !entityId
    ? 'Worker must have an entity employment record first.'
    : !evereeTenantId
      ? 'This entity is not yet linked to an Everee tenant.'
      : null;

  const buttonLabel = evereeWorkerId ? 'Re-sync to Everee' : 'Sync to Everee';
  const buttonTooltip = disabledReason
    ? disabledReason
    : evereeWorkerId
      ? `Returns the existing Everee worker id (${evereeWorkerId}); no new worker is created.`
      : 'Creates the worker in Everee (sandbox). Idempotent — safe to click again.';
  const recreateTooltip = disabledReason
    ? disabledReason
    : 'Recreates the worker_onboarding doc and the everee_workers linkage doc when either has been deleted from Firestore. Does not change employment state, does not re-fire onboarding messaging.';

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'action.hover',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Everee
        </Typography>
        {evereeTenantId ? (
          <Chip
            size="small"
            variant="outlined"
            label={`tenant: ${evereeTenantId}`}
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
          />
        ) : null}
        {evereeWorkerId ? (
          <Chip
            size="small"
            variant="outlined"
            color="success"
            label={`workerId: ${evereeWorkerId}`}
            sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
          />
        ) : (
          <Chip size="small" variant="outlined" label="Not linked" />
        )}
        <Box sx={{ flex: 1 }} />
        {/*
          EE.5 "Recreate worker onboarding" button — temporarily hidden by
          request. Backend callable (`evereeAdminRecreateWorkerOnboarding`)
          and the `handleRecreate` handler stay wired so we can restore the
          button by removing this comment when the recovery surface is
          needed again.
        <Tooltip title={recreateTooltip}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                recovering ? <CircularProgress size={14} color="inherit" /> : <RestoreIcon />
              }
              onClick={handleRecreate}
              disabled={recovering || syncing || Boolean(disabledReason)}
            >
              Recreate worker onboarding
            </Button>
          </span>
        </Tooltip>
        */}
        <Tooltip title={buttonTooltip}>
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
              onClick={handleClick}
              disabled={syncing || recovering || Boolean(disabledReason)}
            >
              {buttonLabel}
            </Button>
          </span>
        </Tooltip>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      ) : null}
      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
};

export default EvereeAdminSyncCard;
