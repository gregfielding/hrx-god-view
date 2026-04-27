/**
 * Message Input Component
 * 
 * Input field for sending messages with typing indicators
 */

import React, { useState, KeyboardEvent, useEffect, useRef } from 'react';
import { Box, TextField, IconButton, IconButtonProps } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  conversationId?: string;
  conversationType?: 'dm' | 'channel';
  tenantId?: string;
  userId?: string;
  onTypingChange?: (isTyping: boolean) => void;
}

const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  disabled = false,
  conversationId,
  conversationType,
  tenantId,
  userId,
  onTypingChange,
}) => {
  const [content, setContent] = useState('');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (isTypingRef.current && onTypingChange) {
        onTypingChange(false);
      }
    };
  }, [onTypingChange]);

  const handleTyping = () => {
    if (!onTypingChange || !conversationId || !tenantId || !userId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTypingChange(true);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to stop typing indicator after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTypingChange(false);
    }, 3000);
  };

  const handleSend = () => {
    if (content.trim() && !disabled) {
      onSend(content);
      setContent('');
      
      // Stop typing indicator
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current && onTypingChange) {
        isTypingRef.current = false;
        onTypingChange(false);
      }
    }
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleChange = (value: string) => {
    setContent(value);
    if (value.trim()) {
      handleTyping();
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
      <TextField
        fullWidth
        multiline
        maxRows={4}
        placeholder="Type a message..."
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        onKeyPress={handleKeyPress}
        disabled={disabled}
        variant="outlined"
        size="small"
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
          },
        }}
      />
      <IconButton
        color="primary"
        onClick={handleSend}
        disabled={!content.trim() || disabled}
        sx={{
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          '&:hover': {
            bgcolor: 'primary.dark',
          },
          '&.Mui-disabled': {
            bgcolor: 'action.disabledBackground',
            color: 'action.disabled',
          },
        }}
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
};

export default MessageInput;

