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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SmsIcon from '@mui/icons-material/Sms';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { useAuth } from '../../contexts/AuthContext';
import {
  evereeAdminRecreateWorkerOnboarding,
  evereeEnsureWorker,
  evereeUpdateWorkerAddress,
  type EvereeWorkerType,
} from '../../services/everee/evereeCallables';
import {
  resendOnboardingPayrollLinkCallable,
  restartEvereeOnboardingCallable,
} from '../../services/onboardingReminderCallables';
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

/**
 * Module-level dedupe for the silent auto-sync. Keyed by
 * `${entityId}:${userId}:${evereeTenantId}`. The instance-level
 * `autoSyncedKeyRef` (below) handles the common case, but a parent
 * unmount/remount cycle (e.g. EmploymentV2Tab toggling its centered
 * spinner mid-flight) wipes the ref. Without this set, an erroneous
 * `created=true` response from the server — or any future regression
 * that causes parent refetches mid-auto-sync — would re-fire the
 * silent sync on every remount and visually flash the panel.
 *
 * Lifetime: page tab. Cleared by full reload. We deliberately don't
 * use sessionStorage because (a) the dedupe only needs to survive
 * remounts within the same SPA session, and (b) we don't want stale
 * entries blocking a manual user-triggered refresh after navigating
 * away and back.
 */
const silentAutoSyncFiredKeys = new Set<string>();

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
  const {
    isHRX,
    currentClaimsRole,
    claimsRoles,
    securityLevel,
    tenantRolesFromProfile,
    legacyUserSecurityLevel,
  } = useAuth();
  // Mirrors backend `canManageEveree` (`functions/src/integrations/everee/
  // evereeAccessGate.ts`). Resolution order:
  //   1. HRX bypass.
  //   2. Active-tenant claims role in Admin/Manager/Recruiter (fast path).
  //   3. Per-tenant Firestore role for THIS card's tenant in admin/manager.
  //   4. Per-tenant Firestore securityLevel for THIS card's tenant >= 5.
  //   5. Top-level user securityLevel fallback >= 5.
  // The previous gate stopped at (2) which hid the card from tenant
  // admins/recruiters whose `setTenantRole` claim-sync had never run —
  // they had `securityLevel: '5'`/`'6'`/`'7'` in Firestore but no
  // `currentClaimsRole`, so backend allowed them but the UI never
  // rendered the buttons. May 2026.
  const canManage = useMemo(() => {
    if (isHRX) return true;
    if (
      currentClaimsRole === 'Admin' ||
      currentClaimsRole === 'Recruiter' ||
      currentClaimsRole === 'Manager'
    ) {
      return true;
    }
    const profileRole = String(tenantRolesFromProfile[tenantId]?.role || '')
      .trim()
      .toLowerCase();
    if (profileRole === 'admin' || profileRole === 'manager' || profileRole === 'super_admin') {
      return true;
    }
    const levels: Array<unknown> = [
      claimsRoles[tenantId]?.securityLevel,
      tenantRolesFromProfile[tenantId]?.securityLevel,
      securityLevel,
      legacyUserSecurityLevel,
    ];
    for (const raw of levels) {
      const n = Number.parseInt(String(raw ?? '0').trim(), 10);
      if (Number.isFinite(n) && n >= 5) return true;
    }
    return false;
  }, [
    isHRX,
    currentClaimsRole,
    claimsRoles,
    tenantRolesFromProfile,
    securityLevel,
    legacyUserSecurityLevel,
    tenantId,
  ]);

  const [evereeTenantId, setEvereeTenantId] = useState<string | null>(null);
  const [evereeWorkerIdsMap, setEvereeWorkerIdsMap] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resending, setResending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [pushingAddress, setPushingAddress] = useState(false);
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

  /**
   * Core sync action shared by the manual button and the on-mount
   * auto-run effect below. The `silent` flag suppresses the success
   * toast and any error toast — the auto-run on every page load
   * shouldn't spawn a Snackbar each time. Errors still set the inline
   * `error` Alert state so a failed auto-sync is visible (just not
   * disruptive). May 2026.
   */
  const performSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!entityId) {
        if (!silent) setError('This entity is not yet linked to Everee.');
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
        const created = !!result.data?.created;
        if (!silent) {
          setToast({
            severity: 'success',
            message: created
              ? `Created Everee worker ${id}`
              : `Already linked — Everee worker ${id}`,
          });
        }
        // Bug fix (2026-05-11): the silent auto-run on mount used to fire
        // `onSynced` unconditionally, which triggers a parent refetch
        // (`EmploymentV2Tab` shows a centered <CircularProgress /> while
        // loading, which UNMOUNTS this card). On re-mount, the
        // `autoSyncedKeyRef` is fresh and the auto-run fires again →
        // re-mount loop = visible "screen flashing" on the Employment tab
        // for any worker already linked to Everee. Skip the parent
        // refetch when this is the silent auto-run AND nothing was
        // actually created — a no-op sync has nothing for the parent to
        // re-read. Manual clicks (`silent === false`) still notify so
        // recruiters see the panel refresh after a real action.
        if (!silent || created) {
          onSynced?.(id);
        }
      } catch (err: unknown) {
        const msg =
          formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
        setError(msg);
        if (!silent) {
          setToast({ severity: 'error', message: msg });
        }
      } finally {
        setSyncing(false);
      }
    },
    [entityId, onSynced, tenantId, userId, workerType],
  );

  const handleClick = useCallback(() => performSync(), [performSync]);

  /**
   * Auto-run the same idempotent sync on mount so the recruiter doesn't
   * have to click into Employment → scroll → "Re-sync to Everee" on
   * every visit. The backend is idempotent (`createWorkerIfNeeded`
   * returns the existing id without re-POSTing when the linkage doc
   * already maps), so this is safe to fire once per (entity, user)
   * combo. We track the firing in a ref so HMR / re-renders don't
   * re-run it; tab-switching between entities still triggers a fresh
   * auto-run because each entity panel mounts its own card.
   *
   * Gates:
   *   - `canManage`: workers never see this card, so don't auto-run.
   *   - `entityId` + `evereeTenantId`: skip when the entity isn't
   *     wired to Everee (matches the disabled-button branch).
   *
   * The auto-run is silent on success (no toast — would pop on every
   * page visit) and silent on error toast too (failures still show in
   * the inline `error` Alert below). Manual clicks keep their toasts.
   */
  const autoSyncedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canManage) return;
    if (!entityId || !evereeTenantId || !userId) return;
    const key = `${entityId}:${userId}:${evereeTenantId}`;
    if (autoSyncedKeyRef.current === key) return;
    // Belt-and-suspenders against remount loops: even across
    // unmount/remount cycles within this page session, only auto-fire
    // the silent sync once per (entity, user, evereeTenantId) combo.
    if (silentAutoSyncFiredKeys.has(key)) {
      autoSyncedKeyRef.current = key;
      return;
    }
    autoSyncedKeyRef.current = key;
    silentAutoSyncFiredKeys.add(key);
    void performSync({ silent: true });
  }, [canManage, entityId, evereeTenantId, userId, performSync]);

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

  // Manual "Resend payroll link" — fires the same SMS the scheduler at
  // `processWorkerOnboardingReminders.ts` would send (events / 1099 → direct
  // payroll iframe URL with payroll-only copy; W2 → My Employment hub link
  // with the standard "I-9 + payroll" copy). Useful when a worker says
  // they didn't get the link, deleted the prior SMS, or the recruiter
  // wants to force a nudge before the next R{N} due time.
  //
  // Backend (`resendOnboardingPayrollLinkCallable`) is idempotent — it
  // does NOT update `onboardingReminderNSentAt` so future automated
  // reminders still fire on schedule. Audited as `reminderNumber: 0`
  // (manual sentinel) in `tenants/{tid}/onboarding_reminder_audit`.
  /**
   * Push the current HRX home address to Everee for an already-linked
   * worker. This is the action that fixes the "Everee blocked" chip:
   * after the recruiter updates the worker's profile address, this
   * button PUTs the new value to `/api/v2/workers/{id}/address` so
   * Everee's anti-fraud engine releases the lock on the next session.
   */
  const handlePushAddress = useCallback(async () => {
    if (!entityId) {
      setError('This entity is not yet linked to an Everee tenant.');
      return;
    }
    setPushingAddress(true);
    setError(null);
    try {
      const result = await evereeUpdateWorkerAddress({ tenantId, entityId, userId });
      const addr = result.data.address;
      const fmt =
        `${addr.line1}${addr.line2 ? ` ${addr.line2}` : ''}, ${addr.city}, ${addr.state} ${addr.postalCode}`;
      setToast({
        severity: 'success',
        message: `Address pushed to Everee: ${fmt}`,
      });
    } catch (err: unknown) {
      const msg = formatFirebaseHttpsError(err) ?? (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setPushingAddress(false);
    }
  }, [entityId, tenantId, userId]);

  const handleResendPayrollLink = useCallback(async () => {
    if (!entityId) {
      setError('This entity is not yet linked to an Everee tenant.');
      return;
    }
    setResending(true);
    setError(null);
    try {
      const result = await resendOnboardingPayrollLinkCallable({
        tenantId,
        userId,
        entityId,
      });
      const data = result.data;
      if (data.ok) {
        const variantLabel = data.variant === 'events' ? 'direct payroll link' : 'onboarding link';
        setToast({
          severity: 'success',
          message: `SMS sent — ${variantLabel}`,
        });
      } else {
        // Map backend reason codes to human-readable text. Keep the link
        // visible in the toast so the recruiter can manually share via
        // another channel (email / DM) when SMS isn't deliverable.
        const reasonLabel = (() => {
          switch (data.reason) {
            case 'missing_phone':
              return 'No phone number on file for this worker.';
            case 'invalid_e164':
              return 'Phone number is not in a valid SMS format.';
            case 'missing_link':
              return "Couldn't build a payroll link (entity may not be Everee-linked).";
            case 'sms_failed':
              return `SMS failed to send${data.twilioError ? `: ${data.twilioError}` : ''}.`;
            case 'employment_not_found':
              return 'No active employment record for this worker on this entity.';
            case 'user_not_found':
              return 'User document not found.';
            default:
              return data.reason || 'Unknown error.';
          }
        })();
        setToast({ severity: 'error', message: reasonLabel });
      }
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setResending(false);
    }
  }, [entityId, tenantId, userId]);

  // Two restart scenarios this button covers:
  //
  //  1. Legacy-payroll restart — worker IS in Everee, but their
  //     `entity_employments` row is stuck with `payrollStatus: 'complete'`
  //     from a prior payroll system (TempWorks pre-Everee migration today).
  //     That flag silences the Everee payroll step in the My Employment hub
  //     AND tells `processWorkerOnboardingReminders` to skip them. Restart
  //     wipes the flag, anchors the cadence at "now", and fires R1 inline.
  //
  //  2. Pre-Everee migration restart (May 2026 +) — worker started
  //     onboarding on this entity *before* it was wired to Everee, so no
  //     shell exists yet (`evereeWorkerIds[evereeTenantId]` missing). The
  //     backend now provisions the shell inline (same idempotent helper as
  //     the Sync button) and continues with the cadence reset. The result
  //     carries `evereeShellProvisioned: true` so we can show a richer
  //     toast — "Provisioned Everee + restarted onboarding". Replaces the
  //     prior two-click flow ("Sync" then "Restart").
  //
  // Both paths are idempotent. `restartEvereeOnboardingCallable` is the
  // single-call entry point regardless of shell state.
  const handleRestartOnboarding = useCallback(async () => {
    if (!entityId) {
      setError('This entity is not yet linked to an Everee tenant.');
      return;
    }
    setRestarting(true);
    setError(null);
    try {
      const result = await restartEvereeOnboardingCallable({
        tenantId,
        userId,
        entityId,
      });
      const data = result.data;
      if (data.ok) {
        const variantLabel =
          data.variant === 'events' ? 'direct Everee payroll link' : 'My Employment link';
        const prefix = data.evereeShellProvisioned
          ? 'Provisioned Everee shell + restarted onboarding'
          : 'Everee onboarding restarted';
        setToast({
          severity: 'success',
          message: `${prefix} — R1 SMS sent (${variantLabel}). R2 in 24h.`,
        });
      } else {
        const reasonLabel = (() => {
          switch (data.reason) {
            case 'entity_not_everee':
              return 'This entity is not Everee-enabled.';
            case 'employment_not_found':
              return 'No active employment record for this worker on this entity.';
            case 'user_not_found':
              return 'User document not found.';
            case 'everee_provision_failed':
              return `Could not create the Everee worker shell${
                data.twilioError ? `: ${data.twilioError}` : ''
              }. Check Everee config + retry.`;
            case 'missing_phone':
              return 'Cadence reset, but no phone on file — copy the link and share manually.';
            case 'invalid_e164':
              return 'Cadence reset, but phone number is not valid for SMS.';
            case 'missing_link':
              return "Cadence reset, but couldn't build a payroll link.";
            case 'sms_failed':
              return `Cadence reset, but R1 SMS failed${
                data.twilioError ? `: ${data.twilioError}` : ''
              }. Scheduler will retry.`;
            default:
              return data.reason || 'Unknown error.';
          }
        })();
        // partial-success: data was reset even though SMS didn't go out.
        // Use a warning-flavored error toast so the recruiter knows the
        // backend state changed and they don't double-click.
        const partialSuccess =
          data.reason === 'missing_phone' ||
          data.reason === 'invalid_e164' ||
          data.reason === 'missing_link' ||
          data.reason === 'sms_failed';
        setToast({
          severity: partialSuccess ? 'success' : 'error',
          message: reasonLabel,
        });
      }
      onSynced?.(evereeWorkerId ?? '');
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) || (err instanceof Error ? err.message : String(err));
      setError(msg);
      setToast({ severity: 'error', message: msg });
    } finally {
      setRestarting(false);
    }
  }, [entityId, evereeWorkerId, onSynced, tenantId, userId]);

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
  const resendTooltip = disabledReason
    ? disabledReason
    : 'Sends the worker an SMS with a direct link to finish their payroll setup. Does not affect the automated reminder cadence.';
  // Restart tooltip: same surface for both branches (shell exists vs. doesn't).
  // The backend handles the missing-shell case inline (provisions Everee +
  // resets cadence in a single call) so the recruiter doesn't have to do two
  // clicks anymore. Tooltip copy adapts so it's clear what each click does.
  const restartTooltip = disabledReason
    ? disabledReason
    : !evereeWorkerId
      ? 'Pre-Everee migration restart: provisions the Everee worker shell, resets payroll status, schedules a fresh R1–R3 (or R1–R5 for events) cadence, and sends R1 immediately. Use this for workers who started onboarding before this entity was Everee-enabled.'
      : 'Resets payroll status, schedules a fresh R1–R3 (or R1–R5 for events) cadence anchored at right now, and sends R1 immediately. Use this when a worker was onboarded with a prior payroll system (e.g. TempWorks) and never finished payroll setup in Everee.';

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
        {/*
          "Restart Everee Onboarding" — the heaviest of the three manual
          actions. Wipes `payrollStatus` (so the My Employment hub stops
          treating payroll as done), resets the cadence anchor to "now",
          re-schedules R1–R{N}, and fires R1 inline. Built specifically
          for the legacy-payroll → Everee migration scenario where a
          worker is stuck because a prior system marked payroll complete.
          Does NOT create the Everee shell — backend rejects with
          `needs_sync` when `evereeWorkerIds[evereeTenantId]` is missing,
          and the disabled-state below mirrors that gate so a recruiter
          gets a tooltip instead of a wasted callable round-trip.
        */}
        {/* "Push address to Everee" — pairs with the chip on the User
            Details header. evereeEnsureWorker is a no-op for already-
            linked workers (returns the existing id), so a recruiter
            who just fixed an address has no first-class way to push
            it. This button calls evereeUpdateWorkerAddress directly.
            Disabled (with explanatory tooltip) when the worker isn't
            yet linked — provision via the main Sync button first. */}
        <Tooltip
          title={
            evereeWorkerId
              ? "Push this worker's current HRX home address to Everee. Use after fixing a stale profile address."
              : 'Worker is not yet linked to Everee. Use the Sync button first.'
          }
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                pushingAddress ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />
              }
              onClick={handlePushAddress}
              disabled={
                !evereeWorkerId ||
                pushingAddress ||
                syncing ||
                recovering ||
                resending ||
                restarting ||
                Boolean(disabledReason)
              }
            >
              Push address to Everee
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={restartTooltip}>
          <span>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={
                restarting ? <CircularProgress size={14} color="inherit" /> : <RestartAltIcon />
              }
              onClick={handleRestartOnboarding}
              disabled={
                restarting ||
                syncing ||
                recovering ||
                resending ||
                pushingAddress ||
                Boolean(disabledReason)
              }
            >
              Restart onboarding
            </Button>
          </span>
        </Tooltip>
        {/*
          "Resend payroll link" — manual escape hatch for workers stuck in
          onboarding (e.g. lost the previous SMS, the auto-reminder cadence
          hasn't reached the next rung yet, or the recruiter is on a call
          and wants the worker to finish in real time). Fires the same
          payload the scheduler would send for this entity. Safe to click
          repeatedly — the backend doesn't track per-row send counts here,
          but the audit collection records every call with `reminderNumber: 0`.
        */}
        <Tooltip title={resendTooltip}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={resending ? <CircularProgress size={14} color="inherit" /> : <SmsIcon />}
              onClick={handleResendPayrollLink}
              disabled={resending || syncing || recovering || restarting || pushingAddress || Boolean(disabledReason)}
            >
              Resend payroll link
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={buttonTooltip}>
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
              onClick={handleClick}
              disabled={syncing || recovering || resending || restarting || pushingAddress || Boolean(disabledReason)}
            >
              {buttonLabel}
            </Button>
          </span>
        </Tooltip>
        {/*
          "Open in Everee" — deep-link to the worker's record in the
          Everee admin console. Only meaningful once we have a workerId;
          rendered conditionally so we don't show a useless button
          before the first sync. `noopener,noreferrer` on the popup
          guards against window.opener leaks even though Everee is a
          trusted origin.
        */}
        {evereeWorkerId ? (
          <Tooltip title="Open this worker in Everee (new tab)">
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() => {
                window.open(
                  `https://app.everee.com/workers/details/${evereeWorkerId}`,
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
            >
              Open in Everee
            </Button>
          </Tooltip>
        ) : null}
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
