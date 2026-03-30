import React from 'react';
import { Card, CardContent, Typography, Alert } from '@mui/material';
import type { EmploymentEntityKey } from './employmentV2Types';
import { entityLabelForKey } from '../../../../utils/employmentEntityPresentation';

export interface EmploymentEmptyStateCardProps {
  entityKey: EmploymentEntityKey;
}

const EmploymentEmptyStateCard: React.FC<EmploymentEmptyStateCardProps> = ({ entityKey }) => {
  const label = entityLabelForKey(entityKey);
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Alert severity="info" sx={{ mb: 0 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            No employment record yet for {label}
          </Typography>
          <Typography variant="body2">
            An employment record and onboarding pipeline are usually created when the worker is confirmed for a job tied
            to this entity, or when onboarding is started manually from recruiting tools.
          </Typography>
        </Alert>
      </CardContent>
    </Card>
  );
};

export default EmploymentEmptyStateCard;
