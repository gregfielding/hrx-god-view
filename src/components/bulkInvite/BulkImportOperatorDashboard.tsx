/**
 * BulkImportOperatorDashboard — `/users/bulk-import/imports`
 * (BI.1.P1).
 *
 * Phase 1 ships the empty-state shell:
 *   - "No imports yet" copy + brief description of what the tab will
 *     show in P3 / P5 (live progress card, historical jobs, row
 *     drilldown).
 *   - No Firestore subscription yet — the `bulk_invite_jobs`
 *     collection has zero documents until P2's parser writes the
 *     first preview job.
 *
 * P3 fills this in with a list of `BulkInviteJob` cards,
 * `onSnapshot`-driven live counters (per Appendix B Q6), and a
 * cancel affordance. P5 layers row-detail drilldown.
 *
 * The parent route has already enforced sec-7 access; this component
 * doesn't re-check.
 */

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';

const BulkImportOperatorDashboard: React.FC = () => {
  return (
    <Box
      sx={{
        border: '1px dashed rgba(0, 0, 0, 0.12)',
        borderRadius: 1.5,
        p: 4,
        maxWidth: 720,
      }}
    >
      <Stack alignItems="center" spacing={1.5} textAlign="center">
        <HistoryIcon sx={{ fontSize: 36, color: 'rgba(0, 0, 0, 0.35)' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          No imports yet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
          When you start an import from the New import tab, it&apos;ll appear
          here with live progress: how many rows have been invited, how many
          have completed Everee onboarding, and any errors that need a
          recruiter&apos;s attention. Cancel mid-run is supported.
        </Typography>
      </Stack>
    </Box>
  );
};

export default BulkImportOperatorDashboard;
