/**
 * Message List Component
 * 
 * Displays a list of messages with date grouping and auto-scroll.
 */

import React, { useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress, Divider } from '@mui/material';
import { DMMessageView } from '../../types/directMessenger';
import MessageBubble from './MessageBubble';
import MessageBubbleWithReactions from './MessageBubbleWithReactions';

interface MessageListProps {
  messages: DMMessageView[];
  loading: boolean;
  otherUserAvatarUrl?: string;
  otherUserDisplayName?: string;
  tenantId: string;
  threadId: string;
  currentUserId: string;
  onEmojiPickerOpen?: (messageId: string) => void;
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  loading,
  otherUserAvatarUrl,
  otherUserDisplayName,
  tenantId,
  threadId,
  currentUserId,
  onEmojiPickerOpen,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive (if user was near bottom)
  useEffect(() => {
    if (scrollRef.current && wasAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track if user is near bottom of scroll
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      wasAtBottomRef.current = distanceFromBottom < 100; // Within 100px of bottom
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      wasAtBottomRef.current = true;
    }
  }, [loading]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (messages.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No messages yet. Start the conversation!
        </Typography>
      </Box>
    );
  }

  // Group messages by sender to determine when to show avatar/name
  const shouldShowAvatar = (index: number): boolean => {
    if (index === 0) return true; // Always show for first message
    const current = messages[index];
    const previous = messages[index - 1];
    
    // Show avatar if sender changed or if more than 5 minutes passed
    if (current.senderId !== previous.senderId) return true;
    
    const timeDiff = current.createdAt.getTime() - previous.createdAt.getTime();
    const fiveMinutes = 5 * 60 * 1000;
    return timeDiff > fiveMinutes;
  };

  const shouldShowDisplayName = (index: number): boolean => {
    if (index === 0) return true; // Always show for first message
    const current = messages[index];
    const previous = messages[index - 1];
    
    // Show name if sender changed
    return current.senderId !== previous.senderId;
  };

  return (
    <Box
      ref={scrollRef}
      sx={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        py: 2,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: '4px',
        },
      }}
    >
      {messages.map((message, index) => {
        const showAvatar = !message.isOwn && shouldShowAvatar(index);
        const showDisplayName = !message.isOwn && shouldShowDisplayName(index);
        const showDateSeparator = message.dateLabel && (
          index === 0 || messages[index - 1].dateLabel !== message.dateLabel
        );

        return (
          <React.Fragment key={message.id}>
            {/* Date separator */}
            {showDateSeparator && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  my: 2,
                  px: 2,
                }}
                role="separator"
                aria-label={`Messages from ${message.dateLabel}`}
              >
                <Divider sx={{ flex: 1 }} />
                <Typography
                  variant="caption"
                  sx={{
                    px: 2,
                    color: 'text.secondary',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {message.dateLabel}
                </Typography>
                <Divider sx={{ flex: 1 }} />
              </Box>
            )}

            {/* Message bubble with reactions */}
            {message.isPending ? (
              // For pending messages, don't load reactions (they don't exist yet)
              <MessageBubble
                message={message}
                showAvatar={showAvatar}
                showDisplayName={showDisplayName}
                otherUserAvatarUrl={otherUserAvatarUrl}
                otherUserDisplayName={otherUserDisplayName}
              />
            ) : (
              <MessageBubbleWithReactions
                message={message}
                showAvatar={showAvatar}
                showDisplayName={showDisplayName}
                otherUserAvatarUrl={otherUserAvatarUrl}
                otherUserDisplayName={otherUserDisplayName}
                tenantId={tenantId}
                threadId={threadId}
                currentUserId={currentUserId}
                onEmojiPickerOpen={onEmojiPickerOpen}
              />
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
};

export default MessageList;

