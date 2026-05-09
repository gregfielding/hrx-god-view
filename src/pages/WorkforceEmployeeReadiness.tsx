/**
 * RD.1 — Onboarding Specialist daily action-list home (formerly the
 * per-worker readiness queue, formerly known as the CSA queue).
 *
 * **Why this changed:** the role formerly known as CSA narrowed
 * (see `docs/RECRUITING_ROLE_MODEL.md` §2.1) and was renamed
 * "Onboarding Specialist". They are no longer doing universal
 * readiness triage — that's moving to a Recruiter / HRX-admin
 * surface. Their two remaining responsibilities are:
 *   1. The human voice of C1 for new workers (welcome calls, first-shift
 *      follow-up).
 *   2. Busy-work (I-9 employer portion + E-Verify processing) — handled
 *      on a separate forthcoming page.
 *
 * This page is now (1): three stacked tables that surface "do this today"
 * work for the active Onboarding Specialist. The previous queue (chip filters + matrix +
 * worker × entity grouping) is intentionally retired here, but its
 * supporting components (`WorkerReadinessRow`, `MatrixView`,
 * `WorkforceStatusChips`, `WorkforceEntityFilter`, `useEmployeeReadinessItems`)
 * are preserved for the future Recruiter / HRX-admin surface.
 *
 * **Header lives in `Workforce.tsx`** (the outlet wrapper). It already
 * provides the search input on the right and the tab strip across the
 * top — both intentionally untouched.
 *
 * **My / All scope** comes from the outlet context (`scope: 'mine' | 'all'`).
 * We render a fresh "My Users / All Users" toggle inline so the labels
 * are clearer than the existing generic "My / All" component (which is
 * still used by Job Readiness with different semantics). The state lives
 * in the outlet context so cross-tab persistence keeps working.
 *
 * **Section 3 (onboarding calls)** consumes the existing task system at
 * `tenants/{tid}/tasks` and reuses `TaskDetailsDialog` for the
 * complete-with-notes flow — see `PendingOnboardingCallsSection` for the
 * predicate / fallback rationale.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import useMyWorkerUids from '../hooks/useMyWorkerUids';
import UpcomingFirstShiftsSection from '../components/workforce/csa/UpcomingFirstShiftsSection';
import RecentlyCompletedFirstShiftsSection from '../components/workforce/csa/RecentlyCompletedFirstShiftsSection';
import PendingOnboardingCallsSection from '../components/workforce/csa/PendingOnboardingCallsSection';
import type { WorkforceOutletContext } from './Workforce';

const WorkforceEmployeeReadiness: React.FC = () => {
  const { user, activeTenant, currentClaimsRole, isHRX } = useAuth();
  const tenantId = activeTenant?.id ?? null;
  const currentUserUid = user?.uid ?? null;

  const ctx = useOutletContext<WorkforceOutletContext>();
  const { scope, setScope } = ctx;

  // Role-based default scope: Onboarding Specialists land on My Users;
  // HRX admins land on All Users. Apply ONLY when the persisted scope
  // matches the global default ('all') AND the role would naturally
  // prefer a different default — this prevents stomping an Onboarding
  // Specialist who deliberately switched to "All" mid-session. We rely
  // on the persistence layer to remember the user's last explicit
  // pick; this effect just nudges first-time users.
  const hasAppliedRoleDefault = useRef(false);
  useEffect(() => {
    if (hasAppliedRoleDefault.current || !currentUserUid) return;
    hasAppliedRoleDefault.current = true;
    // HRX admins keep 'all'; everyone else (Recruiter / Manager / Admin /
    // Onboarding Specialist — `currentClaimsRole` doesn't have an
    // Onboarding-Specialist-specific value yet since the role model
    // migration is in flight) defaults to 'mine' when they haven't
    // explicitly chosen otherwise.
    if (!isHRX && scope === 'all' && currentClaimsRole !== 'HRX') {
      setScope('mine');
    }
  }, [currentUserUid, isHRX, currentClaimsRole, scope, setScope]);

  const { myWorkerUids, error: scopeError } = useMyWorkerUids({
    currentUserUid,
    scope,
  });

  // -------- Section 3: task-completion feedback --------
  // `TaskDetailsDialog` runs its own write + close lifecycle, so the only
  // signal we need at the page level is a confirmation snackbar. The row
  // disappears via the live listener; no other state to manage.
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    severity: 'success' | 'error';
    message: string;
  }>({ open: false, severity: 'success', message: '' });

  const handleTaskUpdated = useCallback((_taskId: string) => {
    // We use a generic "Task completed" message because the dialog also
    // surfaces a Save action (without completing) that would route through
    // the same callback. The user saw their explicit click outcome in the
    // dialog itself; this is the persistent low-signal acknowledgement.
    setSnackbar({ open: true, severity: 'success', message: 'Task completed.' });
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        px: { xs: 2, md: 3 },
        pt: 1.5,
        pb: 4,
      }}
    >
      {/* Page-level toolbar: My Users / All Users toggle on the left, */}
      {/* counts/status text on the right. The search input lives in the */}
      {/* outlet wrapper (`Workforce.tsx`) — intentionally not duplicated. */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <ToggleButtonGroup
          value={scope}
          exclusive
          size="small"
          onChange={(_e, next: 'mine' | 'all' | null) => {
            // MUI emits null when clicking the already-selected option;
            // we always need a selection so we ignore that case.
            if (next != null) setScope(next);
          }}
          sx={{
            '& .MuiToggleButton-root': {
              textTransform: 'none',
              borderRadius: '999px',
              fontSize: '13px',
              px: 1.5,
              py: 0.5,
              minHeight: 30,
              border: '1px solid rgba(0, 0, 0, 0.12)',
            },
            '& .MuiToggleButton-root.Mui-selected': {
              bgcolor: '#0057B8',
              color: 'white',
              fontWeight: 600,
              '&:hover': { bgcolor: '#004a9f' },
            },
            gap: 0.5,
          }}
        >
          <Tooltip title="Workers I'm the Onboarding Specialist for">
            <ToggleButton value="mine" aria-label="My users">
              My Users
            </ToggleButton>
          </Tooltip>
          <Tooltip title="All workers in this tenant">
            <ToggleButton value="all" aria-label="All users">
              All Users
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>

        <Box sx={{ flex: 1 }} />

        {scope === 'mine' && (
          <Typography variant="caption" color="text.secondary">
            Showing workers where you&apos;re the Onboarding Specialist.
          </Typography>
        )}
      </Stack>

      {scopeError && <Alert severity="error">{scopeError}</Alert>}

      <UpcomingFirstShiftsSection tenantId={tenantId} myWorkerUids={myWorkerUids} />
      <RecentlyCompletedFirstShiftsSection tenantId={tenantId} myWorkerUids={myWorkerUids} />
      <PendingOnboardingCallsSection
        tenantId={tenantId}
        csaUid={currentUserUid}
        scope={scope}
        onTaskUpdated={handleTaskUpdated}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default WorkforceEmployeeReadiness;
