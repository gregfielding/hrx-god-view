import React from 'react';
import { ToggleButton, ToggleButtonGroup, Box, Stack } from '@mui/material';
import type { EmploymentEntityKey } from './employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, entityLabelForKey } from '../../../../utils/employmentEntityPresentation';

// Temporarily hidden from the picker (entity not yet live). Underlying
// EMPLOYMENT_ENTITY_KEYS / type unions / resolvers stay intact so any
// pre-existing 'workforce' employment records still render correctly when
// programmatically selected. Remove from this set to re-enable the toggle.
const HIDDEN_ENTITY_KEYS = new Set<EmploymentEntityKey>(['workforce']);

export interface EmploymentEntityTabsProps {
  value: EmploymentEntityKey;
  onChange: (key: EmploymentEntityKey) => void;
  /** Shown on the same row, end-aligned (e.g. Refresh employment data). */
  trailingAction?: React.ReactNode;
}

const EmploymentEntityTabs: React.FC<EmploymentEntityTabsProps> = ({ value, onChange, trailingAction }) => {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      flexWrap="wrap"
      columnGap={2}
      rowGap={1}
      sx={{ mb: 2 }}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        onChange={(_, v: EmploymentEntityKey | null) => {
          if (v) onChange(v);
        }}
        aria-label="Hiring entity"
        sx={{ flexWrap: 'wrap' }}
      >
        {EMPLOYMENT_ENTITY_KEYS.filter((k) => !HIDDEN_ENTITY_KEYS.has(k)).map((k) => (
          <ToggleButton
            key={k}
            value={k}
            sx={{
              textTransform: 'none',
              px: 1.25,
              py: 0.35,
              fontSize: '0.78rem',
              lineHeight: 1.2,
            }}
          >
            {entityLabelForKey(k)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {trailingAction ? <Box sx={{ flexShrink: 0, ml: 'auto' }}>{trailingAction}</Box> : null}
    </Stack>
  );
};

export default EmploymentEntityTabs;
