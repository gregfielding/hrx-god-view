/**
 * "Finish setup to claim shifts" (step 5, 2026-09-11) — pinned on the jobs board
 * for a signed-in worker who can't claim C1 Events shifts yet: profile photo ·
 * direct deposit · 1099 tax form. Flutter twin: the jobs board setup card in
 * c1_app.
 */
import React from 'react';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { t } from '../../i18n';

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
}

/** Checklist rows + "n of m done" — shared with the payroll page's C1 Events setup card. */
export const SetupStepList: React.FC<{ steps: SetupStep[] }> = ({ steps }) => {
  const done = steps.filter((s) => s.done).length;
  return (
    <>
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
    </>
  );
};

interface ClaimSetupCardProps {
  photoReady: boolean;
  directDepositReady: boolean;
  taxFormReady: boolean;
  busy?: boolean;
  onFinishSetup: () => void;
}

const ClaimSetupCard: React.FC<ClaimSetupCardProps> = ({
  photoReady,
  directDepositReady,
  taxFormReady,
  busy = false,
  onFinishSetup,
}) => {
  const steps: SetupStep[] = [
    { key: 'photo', label: t('jobs.claimSetupStepPhoto'), done: photoReady },
    { key: 'directDeposit', label: t('jobs.setupStepDirectDeposit'), done: directDepositReady },
    { key: 'taxForm', label: t('jobs.setupStepTaxForm'), done: taxFormReady },
  ];
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
          <SetupStepList steps={steps} />
        </Box>
        <Button variant="contained" color="success" disabled={busy} onClick={onFinishSetup} sx={{ fontWeight: 700, flexShrink: 0 }}>
          {busy ? t('jobs.claimPreparing') : t('jobs.claimFinishSetup')}
        </Button>
      </Stack>
    </Card>
  );
};

export default ClaimSetupCard;
