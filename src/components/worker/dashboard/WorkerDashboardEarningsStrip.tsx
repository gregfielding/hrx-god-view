/**
 * Home-screen money strip (2026-08-29, "best gig software" pass): the two
 * numbers a worker actually opens the app for — the last thing that hit
 * their bank and when the next one lands. One tap into the Payroll hub.
 * Renders nothing while loading or for workers with no pay history yet
 * (Home stays clean pre-payroll).
 */
import React from 'react';
import { Card, CardActionArea, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getLanguage, t } from '../../../i18n';
import { useAuth } from '../../../contexts/AuthContext';
import { USD, useWorkerEmployerLinkages, useWorkerPayHistory } from '../../../hooks/useWorkerPayHistory';
import { nextPayday } from '../../../utils/nextPayday';

const WorkerDashboardEarningsStrip: React.FC = () => {
  const navigate = useNavigate();
  const { user, tenantId, tenantIds } = useAuth();
  const scopeTenantId = tenantId || tenantIds[0];
  const { linkages } = useWorkerEmployerLinkages(scopeTenantId, user?.uid ?? undefined);
  const { rows } = useWorkerPayHistory(scopeTenantId, linkages, 1);

  const last = rows[0];
  if (!last) return null;

  const lang = getLanguage() === 'es' ? 'es-US' : 'en-US';
  const { date, isToday } = nextPayday();
  const paydayText = isToday
    ? t('earnings.paydayTodayLabel')
    : `${t('earnings.nextPaydayLabel')}: ${new Intl.DateTimeFormat(lang, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(date)}`;
  const amount = last.net ?? last.gross;

  return (
    <Card variant="outlined">
      <CardActionArea onClick={() => navigate('/c1/workers/earnings')} sx={{ px: 2, py: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              {t('dashboard.lastPayLabel')}
            </Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
              {amount != null ? USD.format(amount) : '—'}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {paydayText}
          </Typography>
        </Stack>
      </CardActionArea>
    </Card>
  );
};

export default WorkerDashboardEarningsStrip;
