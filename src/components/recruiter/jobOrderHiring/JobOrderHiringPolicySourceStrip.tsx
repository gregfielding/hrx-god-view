import React from 'react';
import { Chip, Stack, Typography } from '@mui/material';
import type { JobOrderHiringPolicySourceKind } from '../../../utils/jobOrderEffectiveHiringPolicy';

const SOURCE_META: Record<
  JobOrderHiringPolicySourceKind,
  { label: string; color: 'default' | 'primary' | 'secondary' | 'success' }
> = {
  tenant_defaults: {
    label: 'Policy source: tenant defaults',
    color: 'default',
  },
  partial_override: {
    label: 'Policy source: partially overridden on this job order',
    color: 'primary',
  },
  full_custom: {
    label: 'Policy source: heavily customized on this job order',
    color: 'secondary',
  },
};

export type JobOrderHiringPolicySourceStripProps = {
  kind: JobOrderHiringPolicySourceKind;
};

/**
 * Zone 1 — short operational strip: where effective hiring policy values come from.
 */
const JobOrderHiringPolicySourceStrip: React.FC<JobOrderHiringPolicySourceStripProps> = ({ kind }) => {
  const meta = SOURCE_META[kind];
  return (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip size="small" variant="outlined" color={meta.color} label={meta.label} />
      <Typography variant="caption" color="text.secondary">
        Tenant defaults apply unless this job order sets overrides on <code>aiHiring</code> or{' '}
        <code>hiringConfig.interview</code>.
      </Typography>
    </Stack>
  );
};

export default JobOrderHiringPolicySourceStrip;
