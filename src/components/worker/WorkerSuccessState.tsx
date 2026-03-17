/**
 * Consistent success/completion state for worker UI (inline).
 * Use for section-level "complete" or "saved" feedback. For transient success, use useWorkerToast().success().
 * Green success color, CheckCircle icon, optional subtext, 120ms fade-in. See docs/WORKER_INTERACTION_SYSTEM.md §9.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const SUCCESS_FADE_MS = 120;
const MOTION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface WorkerSuccessStateProps {
  /** Short label, e.g. "Saved", "Complete", "Updated" */
  label: string;
  /** Optional smaller subtext */
  subtext?: string;
}

const WorkerSuccessState: React.FC<WorkerSuccessStateProps> = ({ label, subtext }) => {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        animation: `workerSuccessIn ${SUCCESS_FADE_MS}ms ${MOTION_EASING} forwards`,
        '@keyframes workerSuccessIn': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      }}
    >
      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }}>
        {label}
      </Typography>
      {subtext && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>
          {subtext}
        </Typography>
      )}
    </Box>
  );
};

export default WorkerSuccessState;
