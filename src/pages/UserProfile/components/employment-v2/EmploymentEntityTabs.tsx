import React from 'react';
import { ToggleButton, ToggleButtonGroup, Box } from '@mui/material';
import type { EmploymentEntityKey } from './employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, entityLabelForKey } from '../../../../utils/employmentEntityPresentation';

export interface EmploymentEntityTabsProps {
  value: EmploymentEntityKey;
  onChange: (key: EmploymentEntityKey) => void;
}

const EmploymentEntityTabs: React.FC<EmploymentEntityTabsProps> = ({ value, onChange }) => {
  return (
    <Box sx={{ mb: 2 }}>
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
    </Box>
  );
};

export default EmploymentEntityTabs;
