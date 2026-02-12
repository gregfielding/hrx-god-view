/**
 * Worker Assignments Empty State — no upcoming shifts / no past assignments.
 * Spec: HRX / C1 Worker Assignments Page Spec — Empty states
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export type EmptyStateVariant = 'upcoming' | 'past';

export interface WorkerAssignmentsEmptyStateProps {
  variant: EmptyStateVariant;
}

const WorkerAssignmentsEmptyState: React.FC<WorkerAssignmentsEmptyStateProps> = ({ variant }) => {
  const navigate = useNavigate();

  if (variant === 'upcoming') {
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
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              No upcoming shifts
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Check the jobs board for available work.
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate('/c1/jobs-board')}
            >
              Find Work
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

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
        <Stack spacing={1} alignItems="center" textAlign="center">
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            No past assignments yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Completed and past shifts will appear here.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerAssignmentsEmptyState;
