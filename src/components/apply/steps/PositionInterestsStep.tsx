/**
 * Position interests — wizard step 13 (Greg approved 2026-08-25, from the
 * jobs-platform comparison review). Generic signups only (job applications
 * skip it — the worker already told us the position by applying). Multi-select
 * category chips; the selection routes recruiters' outreach and future job
 * matching. Persisted canonically at workerProfile.preferences.positionInterests.
 */
import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useT } from '../../../i18n';

/** Stable keys — labels are i18n; keys are what we store and match on. */
export const POSITION_INTEREST_KEYS = [
  'janitorial',
  'food_service',
  'events',
  'warehouse',
  'hospitality',
  'general_labor',
  'customer_service',
  'skilled_trades',
] as const;

interface PositionInterestsStepProps {
  value: string[];
  onChange: (next: string[]) => void;
}

const PositionInterestsStep: React.FC<PositionInterestsStepProps> = ({ value, onChange }) => {
  const t = useT();
  const selected = Array.isArray(value) ? value : [];

  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    onChange(next);
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('apply.positionInterestsTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('apply.positionInterestsSubtitle')}
      </Typography>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
        {POSITION_INTEREST_KEYS.map((key) => {
          const isSelected = selected.includes(key);
          return (
            <Chip
              key={key}
              label={t(`apply.positionInterest_${key}`)}
              onClick={() => toggle(key)}
              color={isSelected ? 'secondary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              sx={{ height: 36, fontWeight: isSelected ? 700 : 400 }}
            />
          );
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('apply.positionInterestsHint')}
      </Typography>
    </Box>
  );
};

export default PositionInterestsStep;
