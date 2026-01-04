/**
 * Message Bubble With Reactions Component
 * 
 * Wraps MessageBubble and handles reactions for a specific message.
 */

import React, { useState, useRef } from 'react';
import { Box } from '@mui/material';
import MessageBubble from './MessageBubble';
import EmojiPicker from './EmojiPicker';
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
      <EmojiPicker
        open={emojiPickerOpen}
        onClose={() => setEmojiPickerOpen(false)}
        onEmojiSelect={handleEmojiSelect}
        anchorEl={emojiPickerAnchorRef.current}
      />
    </Box>
  );
};

export default MessageBubbleWithReactions;

