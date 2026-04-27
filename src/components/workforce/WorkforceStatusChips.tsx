/**
 * Multi-select status chip cluster for the Workforce queue (spec §3).
 *
 * Default selection (empty list) is treated as "everything in the universe"
 * by the hook — but that's semantically different from "no filter" in the
 * UI, so the parent should always pass a non-empty default
 * (`DEFAULT_WORKFORCE_STATUS_FILTERS`) on first paint.
 *
 * The "Show complete" toggle is intentionally separate from the chip cluster
 * because passed/N-A items are visually noisy in the action queue and we want
 * an explicit opt-in (spec: "off by default").
 */

import React from 'react';
import { Box, Chip, FormControlLabel, Stack, Switch } from '@mui/material';

import {
  WORKFORCE_STATUS_FILTER_LABELS,
  type WorkforceStatusFilterId,
} from '../../utils/readinessQueue';

const FILTER_ORDER: ReadonlyArray<WorkforceStatusFilterId> = [
  'needs_review',
  'incomplete',
  'expired',
  'failed',
];

interface WorkforceStatusChipsProps {
  selected: ReadonlyArray<WorkforceStatusFilterId>;
  onChange: (next: WorkforceStatusFilterId[]) => void;
  showComplete: boolean;
  onShowCompleteChange: (next: boolean) => void;
}

const WorkforceStatusChips: React.FC<WorkforceStatusChipsProps> = ({
  selected,
  onChange,
  showComplete,
  onShowCompleteChange,
}) => {
  const selectedSet = new Set(selected);

  const toggle = (id: WorkforceStatusFilterId) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Don't allow de-selecting EVERYTHING — that's confusing because the
    // table renders empty with no obvious way to recover. Re-add the most
    // urgent (`needs_review`) when the user empties the cluster.
    if (next.size === 0) next.add('needs_review');
    onChange(Array.from(next));
  };

  return (
    <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap">
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {FILTER_ORDER.map((id) => {
          const active = selectedSet.has(id);
          return (
            <Chip
              key={id}
              label={WORKFORCE_STATUS_FILTER_LABELS[id]}
              size="small"
              clickable
              onClick={() => toggle(id)}
              variant={active ? 'filled' : 'outlined'}
              color={active ? 'primary' : 'default'}
              sx={{ fontWeight: active ? 600 : 400 }}
            />
          );
        })}
      </Box>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={showComplete}
            onChange={(e) => onShowCompleteChange(e.target.checked)}
          />
        }
        label="Show complete"
        sx={{ ml: 0.5, '& .MuiTypography-root': { fontSize: 13 } }}
      />
    </Stack>
  );
};

export default WorkforceStatusChips;
