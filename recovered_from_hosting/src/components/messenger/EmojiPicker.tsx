/**
 * Emoji Picker Component
 * 
 * Full emoji picker modal using emoji-mart.
 * Supports categories, search, and recently used.
 */

import React, { useEffect, useRef } from 'react';
import { Box, Dialog, useTheme, useMediaQuery } from '@mui/material';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  anchorEl?: HTMLElement | null;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({
  open,
  onClose,
  onEmojiSelect,
  anchorEl,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pickerRef = useRef<HTMLDivElement>(null);

  // Handle emoji selection
  const handleEmojiSelect = (emoji: any) => {
    // emoji-mart returns an object with native property containing the emoji
    const emojiString = emoji.native || emoji;
    onEmojiSelect(emojiString);
    onClose();
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  if (isMobile) {
    // Full-screen overlay for mobile
    return (
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box
          ref={pickerRef}
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Emoji picker */}
          <Box sx={{ flex: 1, overflow: 'auto', '& em-emoji-picker': { width: '100%', height: '100%' } }}>
            <Picker
              data={data}
              onEmojiSelect={handleEmojiSelect}
              theme="light"
              previewPosition="none"
            />
          </Box>
        </Box>
      </Dialog>
    );
  }

  // Popover-style for desktop
  if (!open) return null;

  return (
    <Box
      ref={pickerRef}
      sx={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        mb: 1,
        bgcolor: 'background.paper',
        borderRadius: 2,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        border: '1px solid rgba(0,0,0,0.1)',
        zIndex: 1300,
        width: 352,
        maxHeight: '400px',
        overflow: 'hidden',
        '& em-emoji-picker': { width: '100%', height: '400px' },
      }}
    >
      <Picker
        data={data}
        onEmojiSelect={handleEmojiSelect}
        theme="light"
        previewPosition="none"
      />
    </Box>
  );
};

export default EmojiPicker;

