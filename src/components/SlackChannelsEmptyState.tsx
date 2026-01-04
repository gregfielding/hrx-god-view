/**
 * Slack Channels Empty State Component
 * 
 * Displayed when no channels are found, with context-aware messaging.
 */

import React from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { SlackChannelsFilter } from '../types/slackChannels';

interface SlackChannelsEmptyStateProps {
  filter?: SlackChannelsFilter;
  onBrowseChannels?: () => void;
}

const SlackChannelsEmptyState: React.FC<SlackChannelsEmptyStateProps> = ({ filter, onBrowseChannels }) => {
  const isWatchedFilter = filter?.watchFilter === 'watched';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        p: 4,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          p: 4,
          textAlign: 'center',
          maxWidth: 500,
        }}
      >
        <ChatBubbleOutlineIcon
          sx={{
            fontSize: 64,
            color: 'text.secondary',
            mb: 2,
          }}
        />
        {isWatchedFilter ? (
          <>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              You aren't watching any channels yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Watching a channel helps you keep track of important conversations.
            </Typography>
            {onBrowseChannels && (
              <Button
                variant="outlined"
                onClick={onBrowseChannels}
              >
                Browse channels
              </Button>
            )}
          </>
        ) : (
          <>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              No Slack channels yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Channels will appear automatically once your HRX workspace is connected to Slack.
            </Typography>
            {/* Future: Add "Learn more" link */}
          </>
        )}
      </Paper>
    </Box>
  );
};

export default SlackChannelsEmptyState;
