import React, { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import TaskAltIcon from '@mui/icons-material/TaskAlt';

import { logger } from '../../utils/logger';

const NEXT_STEPS = [
  'Rebuild AI Moments on top of the tenant Modules standard so data is scoped + cacheable.',
  'Move scheduling logic into Cloud Tasks or durable queues instead of Firestore fan-out collections.',
  'Expose lightweight analytics that stream to system_logs only when diagnostics are explicitly enabled.',
];

const MomentsEngine: React.FC = () => {
  useEffect(() => {
    logger.info('MomentsEngine viewed while AI Moments are disabled', {
      context: 'MomentsEngine',
    });
  }, []);

  return (
    <Box px={3} py={4}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        AI Moments Automation (Temporarily Offline)
      </Typography>
      <Typography variant="subtitle2" color="text.secondary">
        The legacy AI Moments system wrote millions of diagnostic documents into the `aiMoments` and
        `scheduledMoments` collections. Those collections have been removed per the HRX1 Firestore logging
        hardening plan, so this console now runs in read-only mode while we ship the replacement workflow.
      </Typography>

      <Alert severity="info" sx={{ mt: 3 }}>
        Moments, follow-ups, and retries are paused globally. Use Cloud Logging or the Activity Log tab to review
        recent engagement until the new pipeline is live.
      </Alert>

      <Stack spacing={2} mt={4}>
        <Typography variant="subtitle2" color="text.secondary">
          What happens next
        </Typography>
        <List>
          {NEXT_STEPS.map((item) => (
            <ListItem key={item} disableGutters>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <TaskAltIcon color="primary" fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={item} />
            </ListItem>
          ))}
        </List>
        <Button
          variant="contained"
          startIcon={<PauseCircleIcon />}
          sx={{ alignSelf: 'flex-start' }}
        >
          Moments overhaul in progress
        </Button>
      </Stack>
    </Box>
  );
};

export default MomentsEngine;
