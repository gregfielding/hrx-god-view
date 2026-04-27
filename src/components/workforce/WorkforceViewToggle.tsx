/**
 * **R.8** — `WorkforceViewToggle` — `List / Matrix` switch surfaced next
 * to `WorkforceScopeToggle` on the Employee Readiness page.
 *
 * Style mirrors `WorkforceScopeToggle` (pill button group, same blue
 * selected state) so the cluster reads as one toolbar. The `Matrix`
 * option carries a tooltip that names what's behind it — workers with
 * R.8's tooltip + chip popover is enough; this top-level tooltip is
 * just to explain the toggle to first-time users.
 */

import React from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridOnIcon from '@mui/icons-material/GridOn';

export type WorkforceReadinessView = 'list' | 'matrix';

interface WorkforceViewToggleProps {
  value: WorkforceReadinessView;
  onChange: (next: WorkforceReadinessView) => void;
}

const WorkforceViewToggle: React.FC<WorkforceViewToggleProps> = ({
  value,
  onChange,
}) => {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      onChange={(_e, next: WorkforceReadinessView | null) => {
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
        gap: 0.5,
      }}
    >
      <Tooltip title="One row per worker — triage queue layout">
        <ToggleButton value="list" aria-label="List view">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ViewListIcon fontSize="small" />
            List
          </Box>
        </ToggleButton>
      </Tooltip>
      <Tooltip title="Worker × requirement category grid — bulk-action surface">
        <ToggleButton value="matrix" aria-label="Matrix view">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <GridOnIcon fontSize="small" />
            Matrix
          </Box>
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  );
};

export default WorkforceViewToggle;
