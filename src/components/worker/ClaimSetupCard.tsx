/**
 * "Finish setup to claim shifts" (step 5, 2026-09-11) — pinned on the jobs board
 * for a signed-in worker who can't claim C1 Events shifts yet. Flutter twin:
 * the jobs board setup card in c1_app.
 */
import React from 'react';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { t } from '../../i18n';

interface ClaimSetupCardProps {
  photoReady: boolean;
  payrollReady: boolean;
  busy?: boolean;
  onFinishSetup: () => void;
}

const ClaimSetupCard: React.FC<ClaimSetupCardProps> = ({ photoReady, payrollReady, busy = false, onFinishSetup }) => {
  const steps = [
    { key: 'photo', label: t('jobs.claimSetupStepPhoto'), done: photoReady },
    { key: 'payroll', label: t('jobs.claimSetupStepPayroll'), done: payrollReady },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'success.light' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            {t('jobs.claimSetupCardTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('jobs.claimSetupCardBody')}
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 1.25 }}>
            {steps.map((s) => (
              <Stack key={s.key} direction="row" spacing={1} alignItems="center">
                {s.done ? (
                  <CheckCircleIcon fontSize="small" color="success" />
                ) : (
                  <RadioButtonUncheckedIcon fontSize="small" color="disabled" />
                )}
                <Typography variant="body2" color={s.done ? 'text.primary' : 'text.secondary'}>
                  {s.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            {t('jobs.claimSetupProgress', { done: String(done), total: String(steps.length) })}
          </Typography>
        </Box>
        <Button variant="contained" color="success" disabled={busy} onClick={onFinishSetup} sx={{ fontWeight: 700, flexShrink: 0 }}>
          {busy ? t('jobs.claimPreparing') : t('jobs.claimFinishSetup')}
        </Button>
      </Stack>
    </Card>
  );
};

export default ClaimSetupCard;
