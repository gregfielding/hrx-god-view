/**
 * Binary `All / My` scope toggle. Shared between Employee Readiness and Job
 * Readiness tabs (spec §3 + §4 — same toggle on both).
 *
 * Pill-button style mirrors the tab pills in `Workforce.tsx` (and the prior
 * `Shifts.tsx` / `RecruiterDashboard.tsx`) so the filter UI feels native.
 */

import React from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';

import type { WorkforceScope } from '../../utils/workforceLayoutPersistence';

interface WorkforceScopeToggleProps {
  value: WorkforceScope;
  onChange: (next: WorkforceScope) => void;
  /** Optional override label for the My option (Job Readiness uses "Mine"). */
  myLabel?: string;
}

const WorkforceScopeToggle: React.FC<WorkforceScopeToggleProps> = ({
  value,
  onChange,
  myLabel = 'My',
}) => {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      onChange={(_e, next: WorkforceScope | null) => {
        // MUI sends `null` when the user clicks the already-selected option.
        // Workforce always needs SOMETHING selected, so ignore that case.
        if (next != null) onChange(next);
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
        // Keep the gap consistent with adjacent pill clusters so toggles
        // don't visually merge into the next chip.
        gap: 0.5,
      }}
    >
      <Tooltip title="Items I personally own (primary recruiter)">
        <ToggleButton value="mine" aria-label="My items">
          <Box>{myLabel}</Box>
        </ToggleButton>
      </Tooltip>
      <Tooltip title="All items in the tenant — including teammates' items and unassigned pool">
        <ToggleButton value="all" aria-label="All items">
          <Box>All</Box>
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  );
};

export default WorkforceScopeToggle;
