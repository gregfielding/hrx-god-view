/**
 * Message Bubble With Reactions Component
 * 
 * Wraps MessageBubble and handles reactions for a specific message.
 */

import React, { useState, useRef } from 'react';
import { Box, IconButton } from '@mui/material';
import MessageBubble from './MessageBubble';
import { useDMReactions } from '../../hooks/useDMReactions';
import { DMMessageView } from '../../types/directMessenger';

interface MessageBubbleWithReactionsProps {
  message: DMMessageView;
  showAvatar: boolean;
  showDisplayName: boolean;
  otherUserAvatarUrl?: string;
  otherUserDisplayName?: string;
  tenantId: string;
  threadId: string;
  currentUserId: string;
  onEmojiPickerOpen?: (messageId: string) => void;
}

const MessageBubbleWithReactions: React.FC<MessageBubbleWithReactionsProps> = ({
  message,
  showAvatar,
  showDisplayName,
  otherUserAvatarUrl,
  otherUserDisplayName,
  tenantId,
  threadId,
  currentUserId,
  onEmojiPickerOpen,
}) => {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerAnchorRef = useRef<HTMLDivElement>(null);

  // Only load reactions for non-pending messages
  const { reactions, toggleReaction } = useDMReactions({
    tenantId,
    threadId,
    messageId: message.id,
    currentUserId,
  });

  const handleReactionClick = async (emoji: string) => {
    try {
      await toggleReaction(emoji);
    } catch (err) {
      console.error('Error toggling reaction:', err);
    }
  };

  const handleEmojiPickerOpen = () => {
    setEmojiPickerOpen(true);
  };

  const handleEmojiSelect = (emoji: string) => {
    handleReactionClick(emoji);
    setEmojiPickerOpen(false);
  };

  return (
    <Box ref={emojiPickerAnchorRef} sx={{ position: 'relative' }}>
      <MessageBubble
        message={message}
        showAvatar={showAvatar}
        showDisplayName={showDisplayName}
        otherUserAvatarUrl={otherUserAvatarUrl}
        otherUserDisplayName={otherUserDisplayName}
        reactions={reactions}
        onReactionClick={handleReactionClick}
        onEmojiPickerOpen={handleEmojiPickerOpen}
      />
      {emojiPickerOpen && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            ml: 0.5,
            mt: 0.5,
            p: 0.5,
            bgcolor: 'grey.50',
            borderRadius: 1,
            position: 'absolute',
            bottom: '100%',
            left: 0,
            zIndex: 1000,
          }}
          onMouseLeave={() => {
            // Small delay to allow moving cursor to picker
            setTimeout(() => setEmojiPickerOpen(false), 200);
          }}
        >
          {['👍', '❤️', '😂', '😮', '😢', '🙌'].map((emoji) => (
            <IconButton
              key={emoji}
              size="small"
              onClick={() => {
                handleEmojiSelect(emoji);
              }}
              sx={{
                borderRadius: 1,
                width: 28,
                height: 28,
                fontSize: '1.2rem',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              {emoji}
            </IconButton>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default MessageBubbleWithReactions;

