/**
 * SlackMessageReactionsBar Component
 * 
 * Displays reactions for a Slack message and allows adding/removing reactions.
 */

import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Chip } from '@mui/material';
import AddReactionIcon from '@mui/icons-material/AddReaction';
import { useSlackReactions } from '../../hooks/useSlackReactions';
import { SlackReactionContext } from '../../types/slackReactions';
import { mapEmojiNameToGlyph } from '../../utils/emojiMap';
import { ReactionEmojiPicker } from './ReactionEmojiPicker';

interface Props {
  ctx: SlackReactionContext;
  currentUserId: string;
  compact?: boolean;
}

export const SlackMessageReactionsBar: React.FC<Props> = ({
  ctx,
  currentUserId,
  compact = false,
}) => {
  const { reactions, toggleReaction } = useSlackReactions(ctx, currentUserId);
  const [showPicker, setShowPicker] = useState(false);

  const hasReactions = reactions.length > 0;

  const handleSelectEmoji = (emoji: string) => {
    toggleReaction(emoji);
    setShowPicker(false);
  };

  const visibleReactions = reactions.slice(0, 6);
  const overflowCount = reactions.length - visibleReactions.length;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 0.5,
        pl: compact ? 0 : 1,
        flexWrap: 'wrap',
      }}
    >
      {visibleReactions.map((r) => {
        const glyph = mapEmojiNameToGlyph(r.emoji);
        const label = `${glyph} ${r.count}`;

        const tooltipText = r.userHasReacted
          ? `You${r.count > 1 ? ` + ${r.count - 1} others` : ''}`
          : `${r.count} reacted`;

        return (
          <Tooltip key={r.emoji} title={tooltipText}>
            <Chip
              size="small"
              label={label}
              onClick={() => toggleReaction(r.emoji)}
              sx={{
                borderRadius: 2,
                px: 0.5,
                height: 24,
                bgcolor: r.userHasReacted ? 'primary.light' : 'grey.100',
                color: r.userHasReacted ? 'primary.dark' : 'text.secondary',
                fontSize: '0.75rem',
                '&:hover': {
                  bgcolor: r.userHasReacted ? 'primary.main' : 'grey.200',
                  color: r.userHasReacted ? 'white' : 'text.primary',
                },
                cursor: 'pointer',
              }}
            />
          </Tooltip>
        );
      })}

      {overflowCount > 0 && (
        <Chip
          size="small"
          label={`+${overflowCount}`}
          sx={{
            borderRadius: 2,
            px: 0.5,
            height: 24,
            bgcolor: 'grey.100',
            color: 'text.secondary',
            fontSize: '0.75rem',
          }}
        />
      )}

      <Tooltip title="Add reaction">
        <IconButton
          size="small"
          onClick={() => setShowPicker(!showPicker)}
          sx={{ borderRadius: 2, width: 24, height: 24 }}
        >
          <AddReactionIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {showPicker && (
        <ReactionEmojiPicker
          onSelect={handleSelectEmoji}
        />
      )}
    </Box>
  );
};

