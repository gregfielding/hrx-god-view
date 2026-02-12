import React from 'react';
import { Card, CardContent, Typography } from '@mui/material';

const NextShiftCard: React.FC = () => {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary">Next shift</Typography>
        <Typography variant="body2">No upcoming shift.</Typography>
      </CardContent>
    </Card>
  );
};

export default NextShiftCard;
