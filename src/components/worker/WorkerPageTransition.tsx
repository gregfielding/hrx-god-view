/**
 * Page transition wrapper for worker routes (140ms fade/slide).
 * Only runs when pathname changes; query params and hash do not trigger transition
 * so tab/query-only changes do not animate excessively. See docs/WORKER_INTERACTION_SYSTEM.md §7.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';

const DURATION_MS = 140;
const MOTION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const WorkerPageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const transitionKey = location.pathname;

  return (
    <Box
      key={transitionKey}
      sx={{
        animation: `workerPageIn ${DURATION_MS}ms ${MOTION_EASING} forwards`,
        '@keyframes workerPageIn': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      {children}
    </Box>
  );
};

export default WorkerPageTransition;
