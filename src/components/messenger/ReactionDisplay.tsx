/**
 * Reaction Display Component
 * 
 * Displays reactions below a message.
 * Shows emoji with count, and allows clicking to toggle reaction.
 */

import React from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { DMReactionView } from '../../types/directMessenger';

interface ReactionDisplayProps {
  reactions: DMReactionView[];
  onReactionClick: (emoji: string) => void;
  currentUserDisplayName?: string;
}

const ReactionDisplay: React.FC<ReactionDisplayProps> = ({
  reactions,
  onReactionClick,
  currentUserDisplayName,
}) => {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.5, // 4px gap between pills
        mt: 0.5,
        ml: 0.5,
      }}
    >
      {reactions.map((reaction) => {
        // Build tooltip text showing who reacted
        const tooltipText =
          reaction.userIds.length > 0
            ? `${reaction.emoji} ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`
            : `${reaction.emoji} ${reaction.count}`;

        return (
          <Tooltip key={reaction.emoji} title={tooltipText} arrow>
            <Chip
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography
                    component="span"
                    sx={{
                      fontSize: '1.2rem', // 1.2× text size for reaction emoji
                      lineHeight: 1,
                    }}
                  >
                    {reaction.emoji}
                  </Typography>
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: 'inherit',
                    }}
                  >
                    {reaction.count}
                  </Typography>
                </Box>
              }
              onClick={() => onReactionClick(reaction.emoji)}
              size="small"
              sx={{
                height: 24,
                borderRadius: '12px',
                bgcolor: reaction.userReacted
                  ? 'rgba(0, 87, 184, 0.1)'
                  : 'rgba(0, 0, 0, 0.04)',
                border: reaction.userReacted
                  ? '1px solid rgba(0, 87, 184, 0.3)'
                  : '1px solid rgba(0, 0, 0, 0.08)',
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: reaction.userReacted
                    ? 'rgba(0, 87, 184, 0.15)'
                    : 'rgba(0, 0, 0, 0.08)',
                },
                '& .MuiChip-label': {
                  px: 0.75, // 6px horizontal padding
                  py: 0,
                },
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default ReactionDisplay;


