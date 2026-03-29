import React from 'react';
import { Box, Stack, Typography, Chip } from '@mui/material';
import { auth } from '../../../firebase';
import { useT } from '../../../i18n';
import { buildCanonicalWorkerProfileWritePatch } from '../../../utils/workerReadinessWriteModel';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';

type Props = {
  value: string;
  onChange: (comfort: string) => void;
  /** Wording for /c1/apply (no job posting) vs job-specific apply */
  variant?: 'generic' | 'job';
};

/**
 * Standalone E-Verify willingness step for generic apply (/c1/apply) — same question as RequirementsAcknowledgementStep.
 */
const EVerifyComfortStep: React.FC<Props> = ({ value, onChange, variant = 'job' }) => {
  const t = useT();
  const options = ['Yes', 'No', 'Maybe'] as const;
  const labels: Record<string, string> = { Yes: t('apply.yes'), No: t('apply.no'), Maybe: t('apply.maybe') };

  const writeUser = (val: string) => {
    if (!auth.currentUser?.uid) return;
    const normalized = buildCanonicalWorkerProfileWritePatch({ comfortableEVerify: val });
    Object.keys(normalized).forEach((key) => queueProfileUpdate(key, (normalized as any)[key]));
  };

  const getColor = (option: string, selected: boolean) => {
    if (!selected) return 'default';
    if (option === 'Yes') return 'success';
    if (option === 'No') return 'error';
    if (option === 'Maybe') return 'warning';
    return 'default';
  };

  return (
    <Box sx={{ pb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t('apply.eVerify')}
        </Typography>
        <Box component="img" src="/img/everify.png" alt={t('apply.eVerify')} sx={{ height: 28, width: 'auto' }} />
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        {variant === 'generic' ? t('apply.eVerifyDescriptionGeneric') : t('apply.eVerifyDescription')}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
        {options.map((option) => {
          const isSelected = value === option;
          return (
            <Chip
              key={option}
              label={labels[option]}
              onClick={() => {
                const next = isSelected ? '' : option;
                onChange(next);
                if (next) writeUser(next);
              }}
              color={getColor(option, isSelected) as any}
              variant={isSelected ? 'filled' : 'outlined'}
              sx={{
                minWidth: 80,
                height: 40,
                fontSize: '0.95rem',
                fontWeight: isSelected ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'scale(1.05)',
                  boxShadow: 2,
                },
              }}
            />
          );
        })}
      </Stack>
    </Box>
  );
};

export default EVerifyComfortStep;
