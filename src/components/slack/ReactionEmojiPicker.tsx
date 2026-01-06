/**
 * ReactionEmojiPicker Component
 * 
 * Popover for selecting emoji reactions.
 */

import React from 'react';
import {
  Popover,
  Box,
  Typography,
  IconButton,
  TextField,
} from '@mui/material';
import { mapEmojiNameToGlyph } from '../../utils/emojiMap';

interface Props {
  anchorEl: HTMLElement | null;
  onClose: () => void;
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
  anchorEl,
  onClose,
  onSelect,
}) => {
  const open = Boolean(anchorEl);
  const id = open ? 'reaction-emoji-picker' : undefined;

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
  };

  return (
    <Popover
      id={id}
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
    >
      <Box sx={{ p: 1.5, minWidth: 220 }}>
        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
          Add a reaction
        </Typography>

        {/* Optional filter/search – can be wired later */}
        <TextField
          size="small"
          fullWidth
          placeholder="Search emoji…"
          sx={{ mb: 1 }}
          disabled // Disabled for now - can be implemented later
        />

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
          }}
        >
          {DEFAULT_EMOJIS.map((emoji) => (
            <IconButton
              key={emoji}
              size="small"
              onClick={() => handleSelect(emoji)}
              sx={{ borderRadius: 2 }}
            >
              <span style={{ fontSize: 18 }}>{mapEmojiNameToGlyph(emoji)}</span>
            </IconButton>
          ))}
        </Box>
      </Box>
    </Popover>
  );
};

