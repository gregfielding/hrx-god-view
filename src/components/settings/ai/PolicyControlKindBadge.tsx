import React from 'react';
import { Chip } from '@mui/material';

export type PolicyControlKind = 'requirement' | 'qualification' | 'automation' | 'capacity' | 'feature';

const LABELS: Record<PolicyControlKind, string> = {
  requirement: 'Requirement',
  qualification: 'Qualification rule',
  automation: 'Automation rule',
  capacity: 'Capacity / queue',
  feature: 'Feature toggle',
};

const COLORS: Record<PolicyControlKind, 'default' | 'primary' | 'secondary' | 'warning'> = {
  requirement: 'primary',
  qualification: 'secondary',
  automation: 'default',
  capacity: 'warning',
  feature: 'default',
};

/**
 * Makes it obvious what category of policy a tenant control belongs to.
 */
const PolicyControlKindBadge: React.FC<{ kind: PolicyControlKind }> = ({ kind }) => (
  <Chip
    component="span"
    size="small"
    label={LABELS[kind]}
    color={COLORS[kind]}
    variant="outlined"
    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600, verticalAlign: 'middle', ml: 0.75 }}
  />
);

export default PolicyControlKindBadge;
