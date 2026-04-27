import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import type { WorkerReadinessBannerModel } from '../../../../utils/workerReadinessBannerModel';
import { scrollToEmploymentV2Anchor } from '../../../../utils/workerReadinessBannerModel';
import type { EmploymentEntityKey } from './employmentV2Types';

export interface WorkerReadinessBannerProps {
  model: WorkerReadinessBannerModel;
  /** Select entity tab when needed, then scroll (parent handles tab switch + deferred scroll). */
  onNavigateToFix?: (args: { entityKey: EmploymentEntityKey | null; scrollElementId: string }) => void;
}

const WorkerReadinessBanner: React.FC<WorkerReadinessBannerProps> = ({ model, onNavigateToFix }) => {
  const {
    headline,
    stateLine,
    severity,
    blockingLines,
    moreBlockingCount,
    fixScrollElementId,
    fixEntityKey,
    showBlockingList,
  } = model;

  const go = () => {
    if (onNavigateToFix) {
      onNavigateToFix({ entityKey: fixEntityKey, scrollElementId: fixScrollElementId });
    } else {
      scrollToEmploymentV2Anchor(fixScrollElementId);
    }
  };

  return (
    <Alert
      severity={severity}
      variant="outlined"
      sx={{ mb: 2, py: 1.25, '& .MuiAlert-message': { width: '100%' } }}
      id="employment-v2-worker-readiness-banner"
    >
      <Stack spacing={1}>
        <Box>
          <Typography variant="subtitle1" fontWeight={800} component="div" sx={{ lineHeight: 1.25 }}>
            {headline}
          </Typography>
          {stateLine.trim() ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.15, lineHeight: 1.35 }}>
              {stateLine}
            </Typography>
          ) : null}
        </Box>

        {showBlockingList ? (
          <Box component="div">
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.35, display: 'block' }}>
              Blocking
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, mb: moreBlockingCount > 0 ? 0.25 : 0 }}>
              {blockingLines.map((line, i) => (
                <Typography
                  key={`${i}:${line}`}
                  component="li"
                  variant="body2"
                  sx={{ lineHeight: 1.35, fontSize: '0.8125rem' }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
            {moreBlockingCount > 0 ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 0.25 }}>
                +{moreBlockingCount} more (switch tabs to see all)
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Stack direction="row" flexWrap="wrap" gap={1}>
          {showBlockingList ? (
            <Button
              size="small"
              variant="contained"
              color={severity === 'error' ? 'error' : 'primary'}
              onClick={go}
            >
              Fix now
            </Button>
          ) : null}
          <Button size="small" variant="outlined" onClick={go} sx={{ textTransform: 'none' }}>
            View details
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
};

export default WorkerReadinessBanner;
