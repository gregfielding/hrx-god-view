import React, { useMemo } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { RecruiterCategoryScoresInlineChip } from './RecruiterCategoryScoresReadOnly';
import type { PrescreenCategoryScoresV1 } from '../../types/prescreenCategoryScores';
import { parsePrescreenCategoryScoresFromFirestore } from '../../utils/parseRecruiterCategoryScores';

export type RecruiterApplicantCategoryScoresRowProps = {
  userId: string;
  applicationData?: Record<string, unknown> | null;
  /** From parent batch fetch of `users/{uid}.categoryScoresCurrent` */
  currentCategoryScores: PrescreenCategoryScoresV1 | null;
  currentScoresLoading: boolean;
};

/**
 * Read-only: worker profile current category scores vs application interview snapshot (aiAutomation).
 * Presentational: parent supplies `currentCategoryScores` (no Firestore subscription in this component).
 */
export const RecruiterApplicantCategoryScoresRow: React.FC<RecruiterApplicantCategoryScoresRowProps> = ({
  userId,
  applicationData,
  currentCategoryScores,
  currentScoresLoading,
}) => {
  const snapshot = useMemo(
    () => parsePrescreenCategoryScoresFromFirestore(applicationData?.aiAutomation),
    [applicationData],
  );

  const uid = String(userId || '').trim();

  return (
    <Stack spacing={0.75} alignItems="flex-start">
      <Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
          Current (worker profile)
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
          Interview snapshot (application)
        </Typography>
        {snapshot.scores ? (
          <RecruiterCategoryScoresInlineChip
            scores={snapshot.scores}
            evidence={snapshot.evidence}
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
