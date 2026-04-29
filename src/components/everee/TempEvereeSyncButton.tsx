/**
 * TempEvereeSyncButton — TEMPORARY sandbox-validation button.
 *
 * Renders directly under the avatar on `UserProfileHeader` while we lock in
 * the Everee API contract. Auto-resolves the worker's first Everee-configured
 * `entity_employments` record, calls `evereeEnsureWorker`, and console-logs
 * everything (request payload sent to the callable + the full Everee API
 * request/response echoed back via the callable's `_debug` field).
 *
 * Remove this component (and the wiring in `UserProfileHeader.tsx`) once the
 * sandbox contract is verified and the canonical sync surface
 * (`EvereeAdminSyncCard` on the Employment tab) is the only entry point.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Tooltip,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { useAuth, useActiveTenantId } from '../../contexts/AuthContext';
import { evereeEnsureWorker } from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface TempEvereeSyncButtonProps {
  uid: string;
  /** Optional override; falls back to `useActiveTenantId()` so this button can drop into any header without prop plumbing. */
  tenantId?: string | null;
}

interface ResolvedTarget {
  entityId: string;
  entityKey?: string;
  evereeTenantId?: string | null;
  evereeEnabled?: boolean;
}

const TempEvereeSyncButton: React.FC<TempEvereeSyncButtonProps> = ({ uid, tenantId: tenantIdProp }) => {
  const { isHRX, currentClaimsRole } = useAuth();
  const activeTenantId = useActiveTenantId();
  const tenantId = tenantIdProp ?? activeTenantId ?? null;
  const canManage =
    isHRX ||
    currentClaimsRole === 'Admin' ||
    currentClaimsRole === 'Recruiter' ||
    currentClaimsRole === 'Manager';

  const [resolving, setResolving] = useState(false);
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Resolve the first Everee-configured entity employment for this worker.
  // For the temp button we deliberately just take the first hit; the canonical
  // surface (`EvereeAdminSyncCard`) handles per-entity selection properly.
  useEffect(() => {
    if (!canManage || !tenantId || !uid) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setResolving(true);
      setResolveError(null);
      try {
        const eeSnap = await getDocs(
          query(collection(db, p.entityEmployments(tenantId)), where('userId', '==', uid)),
        );
        if (cancelled) return;
        const firstWithEntity = eeSnap.docs
          .map((d) => d.data() as { entityId?: string | null; entityKey?: string })
          .find((row) => typeof row.entityId === 'string' && row.entityId);
        if (!firstWithEntity?.entityId) {
          setTarget(null);
          return;
        }
        const entityId = firstWithEntity.entityId as string;
        let evereeTenantId: string | null = null;
        let evereeEnabled = false;
        try {
          const entitySnap = await getDoc(doc(db, p.entity(tenantId, entityId)));
          const e = entitySnap.data() ?? {};
          evereeTenantId =
            typeof e.evereeTenantId === 'string' && e.evereeTenantId.trim()
              ? e.evereeTenantId.trim()
              : null;
          evereeEnabled = e.evereeEnabled === true;
        } catch {
          // tolerate — button still renders, callable will surface the actual reason on click
        }
        if (!cancelled) {
          setTarget({
            entityId,
            entityKey: firstWithEntity.entityKey,
            evereeTenantId,
            evereeEnabled,
          });
        }
      } catch (err) {
        if (!cancelled) setResolveError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setResolving(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [canManage, tenantId, uid]);

  const handleClick = useCallback(async () => {
    if (!tenantId || !target?.entityId) return;
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
        entityId: target.entityId,
        userId: uid,
        workerType: 'employee' as const,
        ...contact,
      };
      // eslint-disable-next-line no-console
      console.log('[everee.sync] → calling evereeEnsureWorker with', callableInput);

      const result = await evereeEnsureWorker(callableInput);

      // eslint-disable-next-line no-console
      console.log('[everee.sync] ← callable result', result.data);
      // eslint-disable-next-line no-console
      console.log('[everee.sync] ← Everee API _debug', result.data?._debug ?? '(no debug payload)');

      const id = result.data?.evereeWorkerId?.trim();
      if (!id) throw new Error('Everee did not return a worker id (see console).');
      setToast({
        severity: 'success',
        message: result.data?.created
          ? `Created Everee worker ${id} (see console for full request/response)`
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
  }, [target, tenantId, uid]);

  if (!canManage) return null;

  // Disabled tooltips so it's obvious *why* the button can't fire — recruiters
  // tend to assume "no button" means "broken integration".
  const disabledReason = !tenantId
    ? 'No active tenant context.'
    : resolving
      ? 'Resolving worker → entity employment…'
      : resolveError
        ? `Could not resolve entity employment: ${resolveError}`
        : !target
          ? 'Worker has no entity employment record yet.'
          : !target.evereeTenantId
            ? 'Worker\'s entity is not linked to an Everee tenant.'
            : !target.evereeEnabled
              ? 'Everee is not enabled on this entity (set evereeEnabled=true).'
              : null;

  const tooltip = disabledReason
    ? disabledReason
    : `Calls evereeEnsureWorker for entity ${target?.entityId} → Everee tenant ${target?.evereeTenantId}. Full request/response logged to browser console.`;

  return (
    <Box sx={{ mt: 1.5, width: '100%', maxWidth: 200 }}>
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
