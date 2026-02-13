/**
 * Worker Dashboard Recent Activity — real data from applications, assignments, profile/certifications.
 * Spec: HRX Worker Dashboard Layout Spec — Section 5
 */

import React from 'react';
import { Card, CardContent, Typography, List, ListItem, ListItemText, CircularProgress } from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerRecentActivity } from '../../../hooks/useWorkerRecentActivity';

const WorkerDashboardActivity: React.FC = () => {
  const { user } = useAuth();
  const { items, loading } = useWorkerRecentActivity(user?.uid);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Recent activity
        </Typography>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <CircularProgress size={24} />
          </div>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No recent activity.
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.map((item) =>
              item.to ? (
                <ListItem key={item.id} disableGutters component={Link} to={item.to} sx={{ textDecoration: 'none', color: 'inherit' }}>
                  <ListItemText
                    primary={item.primary}
                    secondary={item.secondary}
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ) : (
                <ListItem key={item.id} disableGutters>
                  <ListItemText
                    primary={item.primary}
                    secondary={item.secondary}
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              )
            )}
          </List>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardActivity;
