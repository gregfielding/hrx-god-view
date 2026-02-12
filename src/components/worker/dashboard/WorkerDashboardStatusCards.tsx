/**
 * Worker Dashboard Status Cards — 4 glanceable cards with CTAs.
 * Spec: HRX Worker Dashboard Layout Spec — Section 3
 */

import React from 'react';
import { Grid, Card, CardActionArea, CardContent, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import StarIcon from '@mui/icons-material/Star';
import DescriptionIcon from '@mui/icons-material/Description';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ChatIcon from '@mui/icons-material/Chat';

export interface StatusCardItem {
  label: string;
  metric: string;
  subtext: string;
  to: string;
  icon?: React.ReactNode;
}

export interface WorkerDashboardStatusCardsProps {
  /** Job Readiness percent (e.g. "72") */
  readinessPercent: string;
  /** Documents: "All set" or "1 missing" */
  documentsStatus: string;
  documentsSubtext: string;
  /** Active applications count or placeholder */
  applicationsCount: string;
  /** Unread messages/updates count or placeholder */
  messagesUnread: string;
  messagesSubtext: string;
}

const WorkerDashboardStatusCards: React.FC<WorkerDashboardStatusCardsProps> = ({
  readinessPercent,
  documentsStatus,
  documentsSubtext,
  applicationsCount,
  messagesUnread,
  messagesSubtext,
}) => {
  const navigate = useNavigate();

  const cards: StatusCardItem[] = [
    {
      label: 'Job Readiness',
      metric: `${readinessPercent}%`,
      subtext: 'Unlock more shifts',
      to: '/c1/workers/profile',
      icon: <StarIcon fontSize="small" />,
    },
    {
      label: 'Documents',
      metric: documentsStatus,
      subtext: documentsSubtext,
      to: '/c1/workers/documents',
      icon: <DescriptionIcon fontSize="small" />,
    },
    {
      label: 'Applications',
      metric: applicationsCount,
      subtext: 'View your applications',
      to: '/c1/applications',
      icon: <ListAltIcon fontSize="small" />,
    },
    {
      label: 'Messages / Updates',
      metric: messagesUnread,
      subtext: messagesSubtext,
      to: '/c1/workers/support',
      icon: <ChatIcon fontSize="small" />,
    },
  ];

  return (
    <Grid container spacing={2}>
      {cards.map((c) => (
        <Grid item xs={6} md={3} key={c.label}>
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardActionArea onClick={() => navigate(c.to)} sx={{ display: 'block' }}>
              <CardContent sx={{ py: 2, px: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {c.label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, mt: 0.5 }}>
                  {c.metric}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {c.subtext}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default WorkerDashboardStatusCards;
