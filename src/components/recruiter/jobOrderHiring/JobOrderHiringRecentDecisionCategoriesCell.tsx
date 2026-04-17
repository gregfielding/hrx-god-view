import React from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { RecentHiringDecisionRow } from '../../../hooks/useJobOrderHiringControlPanelData';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import { RecruiterCategoryScoresInlineChip } from '../RecruiterCategoryScoresReadOnly';

export type JobOrderHiringRecentDecisionCategoriesCellProps = {
  row: RecentHiringDecisionRow;
  /** Parsed `categoryScoresCurrent` for `row.candidateUserId`, from parent batch fetch */
  currentCategoryScores: PrescreenCategoryScoresV1 | null;
  currentScoresLoading: boolean;
};

/**
 * Current profile scores vs orchestrator-era application snapshot for one recent decision row.
 * Presentational only (parent owns batch fetch).
 */
export const JobOrderHiringRecentDecisionCategoriesCell: React.FC<JobOrderHiringRecentDecisionCategoriesCellProps> = ({
  row,
  currentCategoryScores,
  currentScoresLoading,
}) => {
  const uid = row.candidateUserId?.trim() || '';

  return (
    <Stack spacing={0.75} alignItems="flex-start">
      <Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
          Current (profile)
        </Typography>
        {!uid ? (
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
        ) : currentScoresLoading ? (
          <CircularProgress size={14} sx={{ mt: 0.5 }} />
        ) : currentCategoryScores ? (
          <RecruiterCategoryScoresInlineChip
            scores={currentCategoryScores}
            evidence={null}
            scoreContext="profile_current"
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            Not set
          </Typography>
        )}
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
          Snapshot (application)
        </Typography>
        {row.categoryScores ? (
          <RecruiterCategoryScoresInlineChip
            scores={row.categoryScores}
            evidence={row.categoryEvidence ?? null}
            scoreContext="interview_snapshot"
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
        )}
      </Box>
    </Stack>
  );
};
