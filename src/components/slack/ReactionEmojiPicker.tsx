/**
 * ReactionEmojiPicker Component
 * 
 * Inline emoji picker for selecting reactions.
 */

import React from 'react';
import {
  Box,
  IconButton,
} from '@mui/material';
import { mapEmojiNameToGlyph } from '../../utils/emojiMap';

interface Props {
  onSelect: (emoji: string) => void; // emoji name: 'white_check_mark', 'eyes', etc.
}

const DEFAULT_EMOJIS = [
  'white_check_mark',
  'eyes',
  'raised_hands',
  'heart',
  'thumbsup',
  'fire',
];

export const ReactionEmojiPicker: React.FC<Props> = ({
  onSelect,
}) => {
  const handleSelect = (emoji: string) => {
    onSelect(emoji);
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        ml: 0.5,
        p: 0.5,
        bgcolor: 'grey.50',
        borderRadius: 1,
      }}
    >
      {DEFAULT_EMOJIS.map((emoji) => (
        <IconButton
          key={emoji}
          size="small"
          onClick={() => handleSelect(emoji)}
          sx={{
            borderRadius: 1,
            width: 28,
            height: 28,
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          <span style={{ fontSize: 16 }}>{mapEmojiNameToGlyph(emoji)}</span>
        </IconButton>
      ))}
    </Box>
  );
};

