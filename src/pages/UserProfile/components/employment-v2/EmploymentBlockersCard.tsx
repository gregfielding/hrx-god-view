import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Stack,
  Chip,
  Button,
  Badge,
  Box,
} from '@mui/material';
import type { EmploymentBlockerItem } from './employmentV2Types';

const OWNER_LABEL: Record<EmploymentBlockerItem['owner'], string> = {
  worker: 'Worker',
  recruiter: 'Recruiter',
  system: 'System',
  vendor: 'Vendor',
};

const STATUS_COLOR: Record<EmploymentBlockerItem['status'], 'default' | 'warning' | 'error' | 'info'> = {
  pending: 'default',
  blocked: 'error',
  action_needed: 'warning',
  error: 'error',
};

export interface EmploymentBlockersCardProps {
  blockers: EmploymentBlockerItem[];
}

const EmploymentBlockersCard: React.FC<EmploymentBlockersCardProps> = ({ blockers }) => {
  const title =
    blockers.some((b) => b.status === 'blocked' || b.status === 'error') ? 'Blockers' : 'Action needed';

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        title={
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" fontWeight={700}>
              {title}
            </Typography>
            <Badge badgeContent={blockers.length} color="error" invisible={blockers.length === 0} />
          </Stack>
        }
      />
      <CardContent sx={{ pt: 0 }}>
        {blockers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No required items are blocking this worker for this entity.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {blockers.map((b) => (
              <Box
                key={b.id}
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                  <Box>
                    <Typography fontWeight={600}>{b.title}</Typography>
                    {b.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {b.description}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={OWNER_LABEL[b.owner]} variant="outlined" />
                    <Chip size="small" label={b.status.replace(/_/g, ' ')} color={STATUS_COLOR[b.status]} />
                  </Stack>
                </Stack>
                {b.actionLabel && (
                  <Button size="small" sx={{ mt: 1 }} disabled>
                    {b.actionLabel}
                  </Button>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentBlockersCard;
