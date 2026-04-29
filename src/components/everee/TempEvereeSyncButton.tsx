/**
 * TempEvereeSyncButton — TEMPORARY sandbox-validation button.
 *
 * Always-fire mode. No client-side gating beyond the role check. Calls the
 * server-side `evereeTempSandboxSync` callable, which hardcodes Everee
 * tenant 2320 (sandbox) + synthetic entity id `_temp_sandbox` and bypasses
 * `requireEvereeEnabledEntity`. The point is to fire `POST /v2/workers`
 * against the real Everee sandbox so we can lock the API contract; once
 * that's done, this whole component (and the temp callable) gets ripped
 * out and `EvereeAdminSyncCard` (per-entity, properly gated) takes over.
 *
 * Console output on click:
 *   [everee.sync] → calling evereeTempSandboxSync with <input>
 *   [everee.sync] ← callable result <result.data>
 *   [everee.sync] ← Everee API _debug <_debug payload>
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth, useActiveTenantId } from '../../contexts/AuthContext';
import { evereeTempSandboxSync } from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface TempEvereeSyncButtonProps {
  uid: string;
  /** Optional override; falls back to `useActiveTenantId()` so this button can drop into any header without prop plumbing. */
  tenantId?: string | null;
}

const TempEvereeSyncButton: React.FC<TempEvereeSyncButtonProps> = ({
  uid,
  tenantId: tenantIdProp,
}) => {
  const { isHRX, currentClaimsRole } = useAuth();
  const activeTenantId = useActiveTenantId();
  const tenantId = tenantIdProp ?? activeTenantId ?? null;
  const canManage =
    isHRX ||
    currentClaimsRole === 'Admin' ||
    currentClaimsRole === 'Recruiter' ||
    currentClaimsRole === 'Manager';

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(
    null,
  );

  const handleClick = useCallback(async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      // Pull worker contact inline so Everee gets real data on first sync.
      let contact: {
        email?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
      } = {};
      try {
        const userSnap = await getDoc(doc(db, `users/${uid}`));
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
        // non-blocking
      }

      const callableInput = {
        tenantId,
        userId: uid,
        workerType: 'employee' as const,
        ...contact,
      };
      // eslint-disable-next-line no-console
      console.log('[everee.sync] → calling evereeTempSandboxSync with', callableInput);

      const result = await evereeTempSandboxSync(callableInput);

      // eslint-disable-next-line no-console
      console.log('[everee.sync] ← callable result', result.data);
      // eslint-disable-next-line no-console
      console.log(
        '[everee.sync] ← Everee API _debug',
        result.data?._debug ?? '(no debug payload)',
      );

      const id = result.data?.evereeWorkerId?.trim();
      if (!id) throw new Error('Everee did not return a worker id (see console).');
      setToast({
        severity: 'success',
        message: result.data?.created
          ? `Created Everee worker ${id} (see console)`
          : `Already linked — Everee worker ${id} (see console)`,
      });
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      // eslint-disable-next-line no-console
      console.error('[everee.sync] ← error', err);
      setToast({ severity: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  }, [tenantId, uid]);

  if (!canManage) return null;

  const disabledReason = !tenantId ? 'No active tenant context.' : null;
  const tooltip = disabledReason
    ? disabledReason
    : 'Calls evereeTempSandboxSync → Everee sandbox tenant 2320. Full request/response logged to browser console.';

  return (
    <Box sx={{ mt: 1.5, width: '100%', maxWidth: 220 }}>
      <Tooltip title={tooltip}>
        <span>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            color="warning"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
            onClick={handleClick}
            disabled={busy || Boolean(disabledReason)}
            sx={{ fontSize: '0.72rem', textTransform: 'none' }}
          >
            {busy ? 'Syncing…' : 'Add to Everee (test)'}
          </Button>
        </span>
      </Tooltip>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5, lineHeight: 1.25, fontFamily: 'monospace' }}
      >
        {disabledReason ?? 'sandbox tenant 2320 → POST /v2/workers'}
      </Typography>
      <Snackbar
        open={!!toast}
        autoHideDuration={6000}
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

export default TempEvereeSyncButton;
