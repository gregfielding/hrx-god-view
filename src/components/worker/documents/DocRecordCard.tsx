/**
 * DocRecordCard — single onboarding/document record with status chip and CTA.
 * Provider labels hidden for v1 (no Everee branding).
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button } from '@mui/material';
import type { ChecklistItemProvider, DocRecordDisplayStatus } from '../../../types/onboarding';

export type { DocRecordDisplayStatus };

export interface DocRecordCardProps {
  label: string;
  provider: ChecklistItemProvider;
  status: DocRecordDisplayStatus;
  expiresAt?: Date | null;
  viewUrl?: string | null;
  ctaLabel: string;
  onCta: () => void;
}

const STATUS_CHIP: Record<
  DocRecordDisplayStatus,
  { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' }
> = {
  missing: { label: 'Missing', color: 'warning' },
  submitted: { label: 'Submitted', color: 'default' },
  verified: { label: 'Verified', color: 'success' },
  expiring_soon: { label: 'Expiring Soon', color: 'warning' },
  expired: { label: 'Expired', color: 'error' },
};

const DocRecordCard: React.FC<DocRecordCardProps> = ({
  label,
  status,
  expiresAt,
  viewUrl,
  ctaLabel,
  onCta,
}) => {
  const chip = STATUS_CHIP[status];
  const expiresLabel =
    expiresAt &&
    (status === 'expiring_soon' || status === 'expired' || status === 'verified')
      ? expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : null;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ pb: 0 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {label}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <Chip label={chip.label} color={chip.color} size="small" />
            </Stack>
          </Stack>
          {expiresLabel && (
            <Typography variant="caption" color="text.secondary">
              {status === 'expired' ? `Expired ${expiresLabel}` : `Expires ${expiresLabel}`}
            </Typography>
          )}
        </Stack>
      </CardContent>
      <CardActions sx={{ justifyContent: 'flex-end', px: 2, pt: 1, pb: 1.5 }}>
        <Button size="small" variant={status === 'missing' ? 'contained' : 'outlined'} onClick={onCta}>
          {ctaLabel}
        </Button>
        {viewUrl && status !== 'missing' && (
          <Button
            size="small"
            variant="text"
            onClick={() => window.open(viewUrl, '_blank')}
          >
            View
          </Button>
        )}
      </CardActions>
    </Card>
  );
};

export default DocRecordCard;
