/**
 * Worker Dashboard Hero — Next shift or no-shift state.
 * Spec: HRX Worker Dashboard Layout Spec — Section 1
 */

import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n';

export interface UpcomingShift {
  jobTitle: string;
  siteName?: string;
  clientName?: string;
  day: string;
  date: string;
  time: string;
  addressShort?: string;
  locationCity?: string;
  assignmentId?: string;
}

export interface WorkerDashboardHeroProps {
  firstName: string;
  /** When null/undefined, show "No shifts scheduled" (State B) */
  nextShift?: UpcomingShift | null;
}

const WorkerDashboardHero: React.FC<WorkerDashboardHeroProps> = ({ firstName, nextShift }) => {
  const navigate = useNavigate();
  const t = useT();

  const primaryLine = nextShift
    ? nextShift.siteName || nextShift.clientName
      ? `${nextShift.jobTitle} — ${nextShift.siteName || nextShift.clientName}`
      : nextShift.jobTitle
    : null;
  const secondaryLine = nextShift ? `${nextShift.day}, ${nextShift.date} at ${nextShift.time}` : null;
  const tertiaryLine = nextShift ? (nextShift.addressShort || nextShift.locationCity || '') : null;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent sx={{ py: 2.5, px: 2.5 }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            {t('dashboard.welcomeBack', { firstName })}
          </Typography>
          {nextShift ? (
            <>
              <Typography variant="subtitle2" color="text.secondary">
                {t('dashboard.nextShift')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {primaryLine}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {secondaryLine}
              </Typography>
              {tertiaryLine && (
                <Typography variant="body2" color="text.secondary">
                  {tertiaryLine}
                </Typography>
              )}
              <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  onClick={() =>
                    nextShift?.assignmentId
                      ? navigate(`/c1/workers/assignments/${nextShift.assignmentId}`)
                      : navigate('/c1/workers/assignments')
                  }
                >
                  {t('dashboard.viewDetails')}
                </Button>
                <Button variant="text" onClick={() => navigate('/c1/jobs-board')}>
                  {t('jobs.findMoreWork')}
                </Button>
              </Stack>
            </>
          ) : (
            <>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {t('empty.noShiftsScheduled')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('empty.checkJobsBoard')}
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
                <Button variant="contained" onClick={() => navigate('/c1/jobs-board')}>
                  {t('nav.findWork')}
                </Button>
                <Button variant="text" onClick={() => navigate('/c1/workers/profile')}>
                  {t('dashboard.completeProfile')}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardHero;
