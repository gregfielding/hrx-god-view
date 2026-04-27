/**
 * Reaction Bar Component
 * 
 * Quick reaction bar that appears on message hover.
 * Shows default emojis for quick reactions.
 */

import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { QUICK_REACTION_EMOJIS } from '../../types/directMessenger';

interface ReactionBarProps {
  onReactionClick: (emoji: string) => void;
  onEmojiPickerOpen?: () => void;
}

const ReactionBar: React.FC<ReactionBarProps> = ({
  onReactionClick,
  onEmojiPickerOpen,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5, // 4px gap between pills
        bgcolor: 'background.paper',
        borderRadius: '20px',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        px: 0.5, // 4px padding
        py: 0.25,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      }}
    >
      {QUICK_REACTION_EMOJIS.map((emoji) => (
        <Tooltip key={emoji} title={`React with ${emoji}`}>
          <IconButton
            size="small"
            onClick={() => onReactionClick(emoji)}
            sx={{
              fontSize: '1.2rem', // 1.2× text size for reaction emoji
              width: 28,
              height: 28,
              padding: 0,
              '&:hover': {
                bgcolor: 'rgba(0, 0, 0, 0.04)',
              },
            }}
          >
            {emoji}
          </IconButton>
        </Tooltip>
      ))}
      {onEmojiPickerOpen && (
        <Tooltip title="More emojis">
          <IconButton
            size="small"
            onClick={onEmojiPickerOpen}
            sx={{
              fontSize: '0.875rem',
              width: 28,
              height: 28,
              padding: 0,
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'rgba(0, 0, 0, 0.04)',
              },
            }}
          >
            😊
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

export default ReactionBar;


