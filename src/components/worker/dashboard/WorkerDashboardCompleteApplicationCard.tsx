/**
 * Worker Dashboard — "Complete your application" card.
 * Lists submitted applications that still have missing requirements, with links to the job post.
 * Link pattern: https://hrxone.com/c1/jobs-board/{jobId} (or current origin in app).
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, Typography, List, ListItemButton, ListItemText, CircularProgress, Box } from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { UserApplicationsService } from '../../../services/userApplicationsService';
import type { UserApplication } from '../../../services/userApplicationsService';

const JOBS_BOARD_PATH = '/c1/jobs-board';

export interface WorkerDashboardCompleteApplicationCardProps {
  userId: string | undefined;
}

const WorkerDashboardCompleteApplicationCard: React.FC<WorkerDashboardCompleteApplicationCardProps> = ({ userId }) => {
  const [items, setItems] = useState<UserApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const service = UserApplicationsService.getInstance();
    service
      .getUserApplications(userId)
      .then((applications) => {
        if (cancelled) return;
        const withMissing = applications.filter(
          (a) => a.status === 'submitted' && a.hasMissingRequirements === true
        );
        setItems(withMissing);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <Card variant="outlined" sx={{ overflow: 'visible' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AssignmentIcon color="action" />
            <Typography variant="subtitle1" fontWeight={600}>
              Complete your application
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://hrxone.com';

  return (
    <Card variant="outlined" sx={{ overflow: 'visible' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AssignmentIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            Complete your application
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You have a few requirements left for these jobs. Finish them to improve your chances.
        </Typography>
        <List dense disablePadding>
          {items.map((app) => {
            const href = `${baseUrl}${JOBS_BOARD_PATH}/${app.jobId}`;
            const title = app.jobTitle || app.postTitle || 'Job';
            return (
              <ListItemButton
                key={app.applicationId}
                component="a"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ borderRadius: 1 }}
              >
                <ListItemText primary={title} secondary={app.companyName || undefined} />
              </ListItemButton>
            );
          })}
        </List>
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardCompleteApplicationCard;
