import React from 'react';
import { ToggleButton, ToggleButtonGroup, Box, Stack } from '@mui/material';
import type { EmploymentEntityKey } from './employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, entityLabelForKey } from '../../../../utils/employmentEntityPresentation';

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
        {EMPLOYMENT_ENTITY_KEYS.map((k) => (
          <ToggleButton key={k} value={k} sx={{ textTransform: 'none', px: 2 }}>
            {entityLabelForKey(k)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {trailingAction ? <Box sx={{ flexShrink: 0, ml: 'auto' }}>{trailingAction}</Box> : null}
    </Stack>
  );
};

export default EmploymentEntityTabs;
