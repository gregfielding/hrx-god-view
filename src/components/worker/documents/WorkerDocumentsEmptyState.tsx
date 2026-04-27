/**
 * Worker Documents Empty State — no certifications yet.
 * Spec: HRX / C1 Worker Documents Page Spec — Section 5 empty state
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';

export interface WorkerDocumentsEmptyStateProps {
  onAddCertification: () => void;
}

const WorkerDocumentsEmptyState: React.FC<WorkerDocumentsEmptyStateProps> = ({
  onAddCertification,
}) => {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ py: 4, px: 2 }}>
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Typography variant="body1" color="text.secondary">
            No certifications added yet.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add one to unlock more roles.
          </Typography>
          <Button variant="outlined" onClick={onAddCertification}>
            Add certification
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerDocumentsEmptyState;
