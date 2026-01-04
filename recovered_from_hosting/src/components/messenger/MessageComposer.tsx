/**
 * Message Composer Component
 * 
 * Input field and send button for composing messages.
 */

import React, { useState, KeyboardEvent, useEffect, useRef } from 'react';
import { Box, TextField, IconButton, CircularProgress, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import GifIcon from '@mui/icons-material/Gif';
import { useAuth } from '../../contexts/AuthContext';
import { useMyDMTyping } from '../../hooks/useDMTyping';
import { useTenantGIFSettings } from '../../hooks/useTenantGIFSettings';
import EmojiPicker from './EmojiPicker';
import GIFPicker from './GIFPicker';

interface MessageComposerProps {
  threadId: string;
  onSend: (text: string, gifData?: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' | 'tenor' }) => Promise<void>;
  disabled?: boolean;
}

const MessageComposer: React.FC<MessageComposerProps> = ({
  threadId,
  onSend,
  disabled = false,
}) => {
  const { user, activeTenant } = useAuth();
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tenantId = activeTenant?.id || '';
  const currentUserId = user?.uid || '';
  const { allowGIFs } = useTenantGIFSettings(tenantId);

  // Typing indicator hook
  const { setIsTyping } = useMyDMTyping(tenantId, threadId, currentUserId);

  // Update typing state when message text changes
  useEffect(() => {
    if (messageText.trim().length > 0 && !sending) {
      setIsTyping(true);
    } else {
      setIsTyping(false);
    }
  }, [messageText, sending, setIsTyping]);

  const handleSend = async (gifData?: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' | 'tenor' }) => {
    const trimmed = messageText.trim();
    // Allow sending if there's text OR a GIF
    if ((!trimmed && !gifData) || sending || disabled) return;

    // Clear input immediately for optimistic UI
    const textToSend = trimmed;
    setMessageText('');
    setSending(true);
    setError(null);

    try {
      setIsTyping(false); // Stop typing when sending
      await onSend(textToSend, gifData);
      // Input already cleared, no need to clear again
    } catch (err: any) {
      console.error('Error sending message:', err);
      setError(err.message || 'Failed to send message');
      // Restore message text on error so user can retry
      setMessageText(textToSend);
    } finally {
      setSending(false);
    }
  };

  const handleGIFSelect = (gif: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' | 'tenor' }) => {
    handleSend(gif);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter sends, Shift+Enter creates new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    if (!inputRef.current) return;
    
    const input = inputRef.current;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const textBefore = messageText.substring(0, start);
    const textAfter = messageText.substring(end);
    
    setMessageText(textBefore + emoji + textAfter);
    
    // Restore cursor position after emoji
    setTimeout(() => {
      const newPosition = start + emoji.length;
      input.setSelectionRange(newPosition, newPosition);
      input.focus();
    }, 0);
  };

  return (
    <Box
      sx={{
        borderTop: '1px solid rgba(15, 23, 42, 0.06)',
        backgroundColor: '#FFFFFF',
        p: 2,
        flexShrink: 0,
      }}
    >
      {error && (
        <Typography
          variant="caption"
          sx={{
            color: 'error.main',
            display: 'block',
            mb: 1,
            px: 1,
          }}
        >
          {error}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', position: 'relative' }}>
        {/* Emoji button */}
        <IconButton
          ref={emojiButtonRef}
          onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
          disabled={disabled || sending}
          sx={{
            color: 'text.secondary',
            width: 40,
            height: 40,
            flexShrink: 0,
            '&:hover': {
              bgcolor: 'rgba(0,0,0,0.04)',
            },
          }}
        >
          <EmojiEmotionsIcon fontSize="small" />
        </IconButton>

        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          maxRows={3}
          placeholder="Type a message..."
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '24px',
              backgroundColor: '#F9FAFB',
              fontSize: '0.9375rem',
              '& fieldset': {
                borderColor: 'rgba(0,0,0,0.12)',
              },
              '&:hover fieldset': {
                borderColor: 'rgba(0,0,0,0.2)',
              },
              '&.Mui-focused fieldset': {
                borderColor: '#0057B8',
              },
            },
          }}
        />
        {/* GIF button (only if allowed) */}
        {allowGIFs && (
          <IconButton
            onClick={() => setGifPickerOpen(true)}
            disabled={disabled || sending}
            sx={{
              color: 'text.secondary',
              width: 40,
              height: 40,
              flexShrink: 0,
              '&:hover': {
                bgcolor: 'rgba(0,0,0,0.04)',
              },
            }}
          >
            <GifIcon fontSize="small" />
          </IconButton>
        )}

        <IconButton
          onClick={() => handleSend()}
          disabled={!messageText.trim() || sending || disabled}
          sx={{
            bgcolor: '#0057B8',
            color: '#FFFFFF',
            width: 40,
            height: 40,
            flexShrink: 0,
            '&:hover': {
              bgcolor: '#004a9f',
            },
            '&:disabled': {
              bgcolor: 'rgba(0,0,0,0.12)',
              color: 'rgba(0,0,0,0.26)',
            },
          }}
        >
          {sending ? (
            <CircularProgress size={20} sx={{ color: '#FFFFFF' }} />
          ) : (
            <SendIcon fontSize="small" />
          )}
        </IconButton>

        {/* Emoji Picker */}
        <EmojiPicker
          open={emojiPickerOpen}
          onClose={() => setEmojiPickerOpen(false)}
          onEmojiSelect={handleEmojiSelect}
          anchorEl={emojiButtonRef.current}
        />

        {/* GIF Picker */}
        <GIFPicker
          open={gifPickerOpen}
          onClose={() => setGifPickerOpen(false)}
          onGIFSelect={handleGIFSelect}
        />
      </Box>
    </Box>
  );
};

export default MessageComposer;

