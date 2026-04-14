import React from 'react';
import { Card, CardContent, Typography, Box, Stack } from '@mui/material';
import type { GroupQueuedCandidateRow } from '../../../utils/userGroupHiringPipeline';

export type UserGroupHiringQueuePreviewProps = {
  queuedCount: number;
  candidates?: GroupQueuedCandidateRow[];
  loading?: boolean;
};

const UserGroupHiringQueuePreview: React.FC<UserGroupHiringQueuePreviewProps> = ({
  queuedCount,
  candidates,
  loading,
}) => {
  const showList = candidates && candidates.length > 0;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderStyle: 'dashed', borderColor: 'warning.light' }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={800} gutterBottom>
          Queued candidates (waiting)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Waitlist when the onboarding target is full. Count reflects applications with waitlist / capacity / hold-pool
          signals (beta).
        </Typography>

        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
          Count: {loading ? '…' : queuedCount}
        </Typography>

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        ) : showList ? (
          <Stack spacing={1}>
            {candidates!.slice(0, 5).map((c) => (
              <Box
                key={c.id}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" fontWeight={600}>
                  {c.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', maxWidth: '55%' }}>
                  {c.score != null ? `Score ${c.score}` : '—'}
                  {c.holdReason ? ` · ${c.holdReason}` : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No queued rows matched yet — detail view coming soon.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default UserGroupHiringQueuePreview;
