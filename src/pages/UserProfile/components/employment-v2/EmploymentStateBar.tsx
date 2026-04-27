import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material/Chip';

export interface EmploymentStateBarProps {
  label: string;
  color: ChipProps['color'];
  description: string;
  nextStep: string | null;
}

const EmploymentStateBar: React.FC<EmploymentStateBarProps> = ({ label, color, description, nextStep }) => {
  return (
    <Box sx={{ mb: 2 }}>
      <Chip label={label} color={color} variant="filled" size="small" sx={{ fontWeight: 500 }} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.5 }}>
        {description}
      </Typography>
      {nextStep ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', lineHeight: 1.4 }}>
          Next step: {nextStep}
        </Typography>
      ) : null}
    </Box>
  );
};

export default EmploymentStateBar;
