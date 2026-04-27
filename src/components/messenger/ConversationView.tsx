/**
 * Conversation View Component
 * 
 * Main conversation container showing messages and composer.
 */

import React, { useEffect } from 'react';
import { Box, Typography, Avatar, IconButton, useTheme, useMediaQuery } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useDirectMessenger } from '../../contexts/DirectMessengerContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDMMessages } from '../../hooks/useDMMessages';
import { useDMTyping } from '../../hooks/useDMTyping';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import TypingIndicator from './TypingIndicator';

interface ConversationViewProps {
  threadId: string | null;
}

const ConversationView: React.FC<ConversationViewProps> = ({ threadId }) => {
  const { user, activeTenant } = useAuth();
  const { activeThreadOtherUser, setMode, setActiveThreadId } = useDirectMessenger();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const tenantId = activeTenant?.id || '';
  const currentUserId = user?.uid || '';

  // Get other user ID from thread or context
  const otherUserId = activeThreadOtherUser?.uid || null;

  // Load messages for this thread
  const { messages, loading, error, sendMessage, markAsRead } = useDMMessages({
    tenantId,
    threadId: threadId || '',
    currentUserId,
    otherUserId: otherUserId || undefined,
    otherUserData: activeThreadOtherUser ? {
      displayName: activeThreadOtherUser.displayName,
      email: activeThreadOtherUser.email,
      avatarUrl: activeThreadOtherUser.avatarUrl,
    } : undefined,
    maxMessages: 100,
  });

  // Typing indicator
  const { isOtherTyping } = useDMTyping(tenantId, threadId || '', currentUserId);

  // Mark thread as read when conversation is opened (only if thread exists and has messages)
  // Skip if thread doesn't exist yet (will be created on first message)
  useEffect(() => {
    if (threadId && !loading && messages.length > 0 && !error) {
      markAsRead();
    }
  }, [threadId, loading, messages.length, error, markAsRead]);

  // Handle back button (mobile only)
  const handleBack = () => {
    setActiveThreadId(null);
    setMode('list');
  };

  // Empty state
  if (!threadId) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
          Select a conversation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Choose a chat from the list or start a new one from the People tab.
        </Typography>
      </Box>
    );
  }

  // Error state - only show if we have a real error (not just thread doesn't exist yet)
  if (error && error.message && !error.message.includes('permission') && !error.message.includes('not-found')) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="error">
          Error loading conversation: {error.message}
        </Typography>
      </Box>
    );
  }

  const otherUser = activeThreadOtherUser;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#FFFFFF',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
          flexShrink: 0,
        }}
      >
        {/* Back button (mobile only) */}
        {isMobile && (
          <IconButton
            onClick={handleBack}
            size="small"
            sx={{ mr: -1 }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}

        {/* Avatar */}
        {otherUser && (
          <Avatar
            src={otherUser.avatarUrl}
            sx={{
              width: 40,
              height: 40,
              bgcolor: 'primary.main',
            }}
          >
            {otherUser.displayName.charAt(0).toUpperCase()}
          </Avatar>
        )}

        {/* Name and status */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {otherUser && (
            <>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {otherUser.displayName}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                }}
              >
                {/* TODO: Add presence status */}
                Active
              </Typography>
            </>
          )}
        </Box>
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <MessageList
          messages={messages}
          loading={loading}
          otherUserAvatarUrl={otherUser?.avatarUrl}
          otherUserDisplayName={otherUser?.displayName}
          tenantId={tenantId}
          threadId={threadId || ''}
          currentUserId={currentUserId}
        />
      </Box>

      {/* Typing Indicator */}
      {isOtherTyping && otherUser && (
        <TypingIndicator userName={otherUser.displayName} />
      )}

      {/* Composer */}
      <MessageComposer
        threadId={threadId}
        onSend={sendMessage}
        disabled={loading}
      />
    </Box>
  );
};

export default ConversationView;

