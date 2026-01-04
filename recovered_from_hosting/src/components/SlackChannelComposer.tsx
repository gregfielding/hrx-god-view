/**
 * Slack Channel Composer Component
 * 
 * Text input and send button for posting messages to Slack channels.
 */

import React, { useState, KeyboardEvent } from 'react';
import { Box, TextField, Button, CircularProgress, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

interface SlackChannelComposerProps {
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  channelName?: string;
}

const SlackChannelComposer: React.FC<SlackChannelComposerProps> = ({
  sending,
  onSend,
  channelName,
}) => {
  const [text, setText] = useState('');

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) {
      return;
    }

    try {
      await onSend(trimmed);
      setText(''); // Clear on success
    } catch (err) {
      // Error handling is done in the parent
      // Keep text in the box on error
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Cmd+Enter or Ctrl+Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder={channelName ? `Message #${channelName} in Slack...` : 'Message channel in Slack...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          size="small"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            },
          }}
        />
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          sx={{
            textTransform: 'none',
            borderRadius: '8px',
            px: 2,
            py: 1,
            minWidth: 'auto',
            bgcolor: '#0057B8',
            '&:hover': {
              bgcolor: '#004a9f',
            },
            '&:disabled': {
              bgcolor: 'rgba(0, 0, 0, 0.12)',
            },
          }}
        >
          {sending ? 'Sending...' : 'Submit'}
        </Button>
      </Box>
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Press Cmd+Enter or Ctrl+Enter to send
        </Typography>
      </Box>
    </Box>
  );
};

export default SlackChannelComposer;

