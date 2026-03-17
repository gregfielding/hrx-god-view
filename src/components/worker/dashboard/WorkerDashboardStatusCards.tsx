/**
 * Worker Dashboard Status Cards — 4 glanceable cards with CTAs.
 * Spec: HRX Worker Dashboard Layout Spec — Section 3
 */

import React from 'react';
import { Grid, Card, CardActionArea, CardContent, Typography, LinearProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import StarIcon from '@mui/icons-material/Star';
import DescriptionIcon from '@mui/icons-material/Description';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ChatIcon from '@mui/icons-material/Chat';
import { useT } from '../../../i18n';

export interface StatusCardItem {
  label: string;
  metric: string;
  subtext: string;
  to: string;
  icon?: React.ReactNode;
}

export interface WorkerDashboardStatusCardsProps {
  /** Job Readiness: number when available, else hidden (show subtext only) */
  readinessPercent: string | null;
  /** Documents: "All set" | "Incomplete" | "Not started" */
  documentsStatus: string;
  documentsSubtext: string;
  /** Active applications count (number as string) or null to show "Not available yet" */
  applicationsCount: string | null;
  /** Support card: no count; show only label + subtext when true */
  supportCardOnly?: boolean;
  supportSubtext?: string;
  /** Set false to hide the Support card (e.g. until support flow is ready) */
  showSupportCard?: boolean;
}

const WorkerDashboardStatusCards: React.FC<WorkerDashboardStatusCardsProps> = ({
  readinessPercent,
  documentsStatus,
  documentsSubtext,
  applicationsCount,
  supportCardOnly = true,
  supportSubtext,
  showSupportCard = false,
}) => {
  const navigate = useNavigate();
  const t = useT();
  const supportSubtextResolved = supportSubtext ?? t('dashboard.getHelp');

  const supportCard: (StatusCardItem & { metricHidden?: boolean }) | null = showSupportCard
    ? {
        label: t('dashboard.support'),
        metric: '',
        subtext: supportSubtextResolved,
        to: '/c1/workers/support',
        icon: <ChatIcon fontSize="small" />,
        metricHidden: supportCardOnly,
      }
    : null;

  const cards: (StatusCardItem & { metricHidden?: boolean })[] = [
    {
      label: t('dashboard.jobReadiness'),
      metric: readinessPercent != null ? `${readinessPercent}%` : t('dashboard.notAvailableYet'),
      subtext: t('dashboard.unlockMoreShifts'),
      to: '/c1/workers/profile',
      icon: <StarIcon fontSize="small" />,
      metricHidden: readinessPercent == null,
    },
    {
      label: t('dashboard.documents'),
      metric: documentsStatus,
      subtext: documentsSubtext,
      to: '/c1/workers/documents',
      icon: <DescriptionIcon fontSize="small" />,
    },
    {
      label: t('dashboard.applications'),
      metric: applicationsCount ?? t('dashboard.notAvailableYet'),
      subtext: t('dashboard.viewYourApplications'),
      to: '/c1/workers/applications',
      icon: <ListAltIcon fontSize="small" />,
      metricHidden: applicationsCount == null,
    },
    ...(supportCard ? [supportCard] : []),
  ];

  return (
    <Grid container spacing={2}>
      {cards.map((c) => {
        const hideMetric = 'metricHidden' in c && c.metricHidden;
        return (
          <Grid item xs={6} md={3} key={c.label}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardActionArea onClick={() => navigate(c.to)} sx={{ display: 'block' }}>
                <CardContent sx={{ py: 2, px: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ fontSize: 18, fontWeight: 600 }}>
                    {c.label}
                  </Typography>
                  {c.label === t('dashboard.jobReadiness') && readinessPercent != null && !hideMetric && (
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, Math.max(0, Number(readinessPercent) || 0))}
                      sx={{ mt: 1, mb: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 3 } }}
                    />
                  )}
                  {!hideMetric && (
                    <Typography variant="h6" sx={{ fontWeight: 600, mt: 0.5 }}>
                      {c.metric}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {c.subtext}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

export default WorkerDashboardStatusCards;
