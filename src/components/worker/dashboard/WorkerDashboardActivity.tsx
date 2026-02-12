/**
 * Worker Dashboard Recent Activity — v1 placeholder.
 * Spec: HRX Worker Dashboard Layout Spec — Section 5
 */

import React from 'react';
import { Card, CardContent, Typography, List, ListItem, ListItemText } from '@mui/material';

// v1: static placeholder. v2: wire to real events (application status, assignment accepted, document approved).
const PLACEHOLDER_ITEMS = [
  { primary: 'Profile updated', secondary: '2 days ago' },
  { primary: 'Application submitted', secondary: '1 week ago' },
  { primary: 'Document uploaded', secondary: '1 week ago' },
];

const WorkerDashboardActivity: React.FC = () => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Recent activity
        </Typography>
        <List dense disablePadding>
          {PLACEHOLDER_ITEMS.map((item, i) => (
            <ListItem key={i} disableGutters>
              <ListItemText primary={item.primary} secondary={item.secondary} primaryTypographyProps={{ variant: 'body2' }} secondaryTypographyProps={{ variant: 'caption' }} />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardActivity;
