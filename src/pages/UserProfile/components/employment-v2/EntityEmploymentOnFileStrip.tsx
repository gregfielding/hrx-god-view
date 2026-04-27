import React from 'react';
import { Box, Typography } from '@mui/material';
import type { EntityEmploymentRecord } from './employmentV2Types';

function fmtSection(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v).replace(/_/g, ' ');
}

function isCompleteLike(v: unknown): boolean {
  const s = String(v || '').toLowerCase();
  return s === 'complete' || s === 'completed';
}

export interface EntityEmploymentOnFileStripProps {
  entityEmployment: EntityEmploymentRecord | null | undefined;
}

/**
 * Compact recruiter-facing mirror of server-maintained `entity_employments` onboarding fields.
 * Full checklist remains in `EmploymentOnboardingPathCard`.
 */
const EntityEmploymentOnFileStrip: React.FC<EntityEmploymentOnFileStripProps> = ({ entityEmployment }) => {
  const ee = entityEmployment;
  if (!ee) return null;
  const hasAny =
    ee.onboardingComplete != null ||
    (ee.taxIdentityStatus != null && String(ee.taxIdentityStatus).trim() !== '') ||
    (ee.handbookStatus != null && String(ee.handbookStatus).trim() !== '') ||
    (ee.payrollStatus != null && String(ee.payrollStatus).trim() !== '');
  if (!hasAny) return null;

  const tax = fmtSection(ee.taxIdentityStatus);
  const hb = fmtSection(ee.handbookStatus);
  const pr = fmtSection(ee.payrollStatus);
  const taxOk = isCompleteLike(ee.taxIdentityStatus);
  const hbOk = isCompleteLike(ee.handbookStatus);
  const prOk = isCompleteLike(ee.payrollStatus);

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.45 }}>
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
          On file:{' '}
        </Box>
        Tax / ID {taxOk ? '✓' : '·'} {tax}
        <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>
          |
        </Box>
        Handbook {hbOk ? '✓' : '·'} {hb}
        <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>
          |
        </Box>
        Payroll {prOk ? '✓' : '·'} {pr}
        {ee.onboardingComplete != null ? (
          <>
            <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>
              |
            </Box>
            {ee.onboardingComplete ? 'Onboarding complete' : 'Onboarding incomplete'}
          </>
        ) : null}
      </Typography>
    </Box>
  );
};

export default EntityEmploymentOnFileStrip;
