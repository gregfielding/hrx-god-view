import React from 'react';
import { Stack, Card, CardContent, Typography } from '@mui/material';

const WorkerStatusCards: React.FC = () => {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Card variant="outlined" sx={{ minWidth: 160 }}>
        <CardContent>
          <Typography variant="caption" color="text.secondary">Status</Typography>
          <Typography variant="body2">—</Typography>
        </CardContent>
      </Card>
    </Stack>
  );
};

export default WorkerStatusCards;
