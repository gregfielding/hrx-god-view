/**
 * Single application row for My Applications — mirrors WorkerAssignmentCard layout (list-only).
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button } from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';

export interface WorkerApplicationListCardProps {
  jobTitle: string;
  companyLine: string;
  locationLine: string;
  shiftDateLine: string;
  payLine: string;
  dateAppliedLine: string;
  statusLabel: string;
  statusChipColor: 'default' | 'primary' | 'success' | 'error' | 'warning';
  statusChipSx?: object;
  showWithdraw: boolean;
  withdrawLabel: string;
  viewJobLabel: string;
  onCardClick: () => void;
  onViewJob: (e: React.MouseEvent) => void;
  onWithdraw: (e: React.MouseEvent) => void;
}

const WorkerApplicationListCard: React.FC<WorkerApplicationListCardProps> = ({
  jobTitle,
  companyLine,
  locationLine,
  shiftDateLine,
  payLine,
  dateAppliedLine,
  statusLabel,
  statusChipColor,
  statusChipSx,
  showWithdraw,
  withdrawLabel,
  viewJobLabel,
  onCardClick,
  onViewJob,
  onWithdraw,
}) => (
  <Card
    variant="outlined"
    onClick={onCardClick}
    sx={{
      borderRadius: 2,
      borderColor: 'divider',
      boxShadow: 'none',
      cursor: 'pointer',
      '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
    }}
  >
    <CardContent sx={{ pb: 0 }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {jobTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {companyLine}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {shiftDateLine}
        </Typography>
        {locationLine ? (
          <Typography variant="body2" color="text.secondary">
            {locationLine}
          </Typography>
        ) : null}
        {payLine ? (
          <Typography variant="body1" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {payLine}
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {dateAppliedLine}
        </Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Chip
            label={statusLabel}
            color={statusChipColor}
            size="small"
            onClick={(e) => e.stopPropagation()}
            sx={statusChipSx}
          />
        </Stack>
      </Stack>
    </CardContent>
    <CardActions
      sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5, px: 2, pt: 0, pb: 1.5 }}
      onClick={(e) => e.stopPropagation()}
    >
      <Button size="small" variant="text" onClick={onViewJob}>
        {viewJobLabel} →
      </Button>
      {showWithdraw ? (
        <Button size="small" variant="text" color="error" startIcon={<CancelOutlinedIcon fontSize="small" />} onClick={onWithdraw}>
          {withdrawLabel}
        </Button>
      ) : null}
    </CardActions>
  </Card>
);

export default WorkerApplicationListCard;
