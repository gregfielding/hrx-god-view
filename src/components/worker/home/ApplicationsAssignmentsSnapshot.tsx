import React from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';

interface ApplicationsAssignmentsSnapshotProps {
  needsApplicationAttention: boolean;
  upcomingAssignmentLabel: string | null;
  onOpenApplications: () => void;
  onOpenAssignments: () => void;
}

const ApplicationsAssignmentsSnapshot: React.FC<ApplicationsAssignmentsSnapshotProps> = ({
  needsApplicationAttention,
  upcomingAssignmentLabel,
  onOpenApplications,
  onOpenAssignments,
}) => (
  <Card variant="outlined">
    <CardContent>
      <Stack spacing={1.25}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Applications & assignments
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {needsApplicationAttention
            ? 'You have at least one application that needs attention.'
            : 'No application actions needed right now.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {upcomingAssignmentLabel
            ? `Upcoming assignment: ${upcomingAssignmentLabel}`
            : 'No upcoming assignment yet.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" onClick={onOpenApplications}>
            Open applications
          </Button>
          <Button variant="outlined" onClick={onOpenAssignments}>
            Open assignments
          </Button>
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);

export default ApplicationsAssignmentsSnapshot;
