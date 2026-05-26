/**
 * Workforce → I-9 Signatures Needed — top-level tab on /readiness.
 *
 * Dedicated full-page surface for the Onboarding Specialist's I-9
 * Section 2 work. Promoted from a section on /readiness/employee-readiness
 * (commit def18be4) to its own tab so it can scale up later (filters,
 * deadline countdown chips, bulk-complete UX) without competing with
 * the daily-action sections.
 *
 * Single source of truth — same as the section it replaces:
 *   - `everee_workers.readinessMirror.i9SignedAt`  → worker signed
 *     Section 1 in Everee (worker portion done).
 *   - `entity_employments.i9Section2CompletedAt`   → HRX/Onboarding
 *     Specialist countersigned Section 2. When null AND Section 1 is
 *     signed, the row appears here.
 *
 * Scope: C1 Select only for v1 (matches the operational ask). Adding
 * Workforce / Events later is a one-prop change in
 * `PendingEmployerI9SelectSection`.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useOutletContext } from 'react-router-dom';

import PendingEmployerI9SelectSection from '../components/workforce/csa/PendingEmployerI9SelectSection';
import { useAuth } from '../contexts/AuthContext';
import type { WorkforceOutletContext } from './Workforce';

const WorkforceI9Signatures: React.FC = () => {
  const { user, activeTenant, currentClaimsRole, isHRX } = useAuth();
  const tenantId = activeTenant?.id ?? null;
  const currentUserUid = user?.uid ?? null;

  const ctx = useOutletContext<WorkforceOutletContext>();
  const { scope, setScope } = ctx;

  // Mirror the role-based default-scope nudge from
  // `WorkforceEmployeeReadiness.tsx` — Onboarding Specialists land on
  // "My Users" by default the first time they visit, HRX admins land
  // on "All Users". Persisted scope from a prior session still wins.
  const hasAppliedRoleDefault = useRef(false);
  useEffect(() => {
    if (hasAppliedRoleDefault.current || !currentUserUid) return;
    hasAppliedRoleDefault.current = true;
    if (!isHRX && scope === 'all' && currentClaimsRole !== 'HRX') {
      setScope('mine');
    }
  }, [currentUserUid, isHRX, currentClaimsRole, scope, setScope]);

  const handleScopeChange = useCallback(
    (_e: React.MouseEvent<HTMLElement>, next: 'mine' | 'all' | null) => {
      if (next != null) setScope(next);
    },
    [setScope],
  );

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
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <ToggleButtonGroup
          value={scope}
          exclusive
          size="small"
          onChange={handleScopeChange}
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

      <Alert severity="info" variant="outlined" sx={{ py: 0.75 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Federal deadline: 3 business days from hire
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Workers below have completed their I-9 Section 1 in Everee.
          Each row needs Section 2 (employer portion) countersigned —
          click <strong>Mark complete</strong> after physically reviewing
          the worker&apos;s identity documents.
        </Typography>
      </Alert>

      <PendingEmployerI9SelectSection
        tenantId={tenantId}
        currentUserUid={currentUserUid}
        scope={scope}
      />
    </Box>
  );
};

export default WorkforceI9Signatures;
