/**
 * EvereeAdminSyncCard — recruiter/admin-only "Sync to Everee" surface.
 *
 * Renders on the Employment tab for an entity whose payroll provider is
 * Everee + the entity has `evereeEnabled=true`. Calls the
 * `evereeEnsureWorker` callable, which is idempotent server-side
 * (`createWorkerIfNeeded` returns the existing `evereeWorkerId` without
 * re-POSTing when one is already linked).
 *
 * Out of scope for this component:
 *   - Worker-facing payroll setup embed (see `EvereePayrollSetupEmbed.tsx`)
 *   - Onboarding session creation / iframe
 *   - Cross-entity sync — a sync surface is shown per-entity tab.
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
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
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
  /** Mirror of `entity_employments.evereeWorkerId` if the worker is already linked. */
  initialEvereeWorkerId?: string | null;
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
  initialEvereeWorkerId,
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

  const [evereeWorkerId, setEvereeWorkerId] = useState<string | null>(
    initialEvereeWorkerId ?? null,
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Pick up a parent-provided id refresh (overview refetch / tab switch).
  useEffect(() => {
    setEvereeWorkerId(initialEvereeWorkerId ?? null);
  }, [initialEvereeWorkerId]);

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
      setEvereeWorkerId(id);
      setToast({
        severity: 'success',
        message: result.data?.created
          ? `Created Everee worker ${id}`
          : `Already linked — Everee worker ${id}`,
      });
      onSynced?.(id);
    } catch (err: unknown) {
      const msg = formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setSyncing(false);
    }
  }, [entityId, onSynced, tenantId, userId, workerType]);

  if (!canManage) return null;
  if (!entityId) return null;

  const buttonLabel = evereeWorkerId ? 'Re-sync to Everee' : 'Sync to Everee';
  const buttonTooltip = evereeWorkerId
    ? `Returns the existing Everee worker id (${evereeWorkerId}); no new worker is created.`
    : 'Creates the worker in Everee (sandbox). Idempotent — safe to click again.';

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
        <Tooltip title={buttonTooltip}>
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
              onClick={handleClick}
              disabled={syncing}
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
