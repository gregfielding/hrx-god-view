/**
 * Message Bubble Component
 * 
 * Displays a single message in a conversation
 */

import React, { useState } from 'react';
import { Box, Avatar, Typography, Chip, Popover, IconButton, Tooltip, CircularProgress } from '@mui/material';
import { formatDistanceToNow } from 'date-fns';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import SendIcon from '@mui/icons-material/Send';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Reaction {
  emoji: string;
  userId: string;
}

interface InternalMessage {
  id: string;
  content: string;
  fromUserId: string;
  fromUserName: string;
  fromUserAvatar?: string;
  createdAt: any;
  reactions?: Reaction[];
  conversationId?: string;
  conversationType?: 'dm' | 'channel';
  tenantId?: string;
  // Phase 4/5: Slack metadata
  source?: 'hrx' | 'slack' | 'email' | 'sms';
  mirroredToSlack?: boolean;
  mirroredFromSlack?: boolean;
  inSlackThread?: boolean;
}

interface MessageBubbleProps {
  message: InternalMessage;
  showAvatar: boolean;
  isOwnMessage: boolean;
  canSendToSlack?: boolean;
  conversationSlackLink?: any;
}

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙌', '🔥', '🎉'];

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  showAvatar,
  isOwnMessage,
  canSendToSlack = false,
  conversationSlackLink,
}) => {
  const { user } = useAuth();
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [sendingToSlack, setSendingToSlack] = useState(false);
  const reactions = message.reactions || [];

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const handleReactionClick = async (emoji: string) => {
    if (!message.id || !message.tenantId || !user?.uid) return;

    try {
      const addReaction = httpsCallable(functions, 'addReactionToMessageApi');
      await addReaction({
        tenantId: message.tenantId,
        messageId: message.id,
        emoji,
      });
      // Real-time listener will update the message automatically
    } catch (err) {
      console.error('Error adding reaction:', err);
    }

    setEmojiAnchor(null);
  };

  // Group reactions by emoji
  const reactionsByEmoji = reactions.reduce((acc, reaction) => {
    if (!acc[reaction.emoji]) {
      acc[reaction.emoji] = [];
    }
    acc[reaction.emoji].push(reaction.userId);
    return acc;
  }, {} as { [emoji: string]: string[] });

  const hasUserReacted = (emoji: string) => {
    return reactionsByEmoji[emoji]?.includes(user?.uid || '') || false;
  };

  const handleSendToSlack = async () => {
    if (!message.id || !message.tenantId || !message.conversationId || !message.conversationType) {
      return;
    }

    setSendingToSlack(true);
    try {
      const sendToSlack = httpsCallable(functions, 'sendMessageToSlackApi');
      await sendToSlack({
        tenantId: message.tenantId,
        internalConversationId: message.conversationId,
        internalMessageId: message.id,
        conversationType: message.conversationType,
      });
      // Real-time listener will update the message automatically
    } catch (err: any) {
      console.error('Error sending message to Slack:', err);
      alert(err.message || 'Failed to send message to Slack');
    } finally {
      setSendingToSlack(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isOwnMessage ? 'row-reverse' : 'row',
        mb: 1,
        gap: 1,
        alignItems: 'flex-end',
      }}
    >
      {showAvatar && !isOwnMessage && (
        <Avatar
          src={message.fromUserAvatar}
          sx={{ width: 32, height: 32 }}
        >
          {!message.fromUserAvatar && getInitials(message.fromUserName)}
        </Avatar>
      )}
      {showAvatar && isOwnMessage && <Box sx={{ width: 32 }} />}

      <Box
        sx={{
          maxWidth: '70%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOwnMessage ? 'flex-end' : 'flex-start',
        }}
      >
        {showAvatar && (
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, px: 1 }}>
            {message.fromUserName}
          </Typography>
        )}
        <Box
          sx={{
            px: 2,
            py: 1,
            borderRadius: 2,
            bgcolor: isOwnMessage ? 'primary.main' : 'action.hover',
            color: isOwnMessage ? 'primary.contrastText' : 'text.primary',
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
          </Typography>

          {/* Phase 5: Slack Indicators */}
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {message.source === 'slack' && (
              <Chip
                label="Slack"
                size="small"
                color="primary"
                sx={{ height: 20, fontSize: '0.7rem' }}
                title="This message originated in Slack"
              />
            )}
            {message.mirroredToSlack && message.source !== 'slack' && (
              <Chip
                label="Mirrored to Slack"
                size="small"
                color="default"
                sx={{ height: 20, fontSize: '0.7rem' }}
                title="Sent to Slack channel"
              />
            )}
            {message.inSlackThread && (
              <Chip
                label="Thread"
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
                title="Part of Slack thread"
              />
            )}
          </Box>
        </Box>
        
        {/* Reactions */}
        {Object.keys(reactionsByEmoji).length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            {Object.entries(reactionsByEmoji).map(([emoji, userIds]) => (
              <Chip
                key={emoji}
                label={`${emoji} ${userIds.length}`}
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReactionClick(emoji);
                }}
                sx={{
                  height: 24,
                  fontSize: '0.75rem',
                  bgcolor: hasUserReacted(emoji) ? 'primary.light' : 'action.hover',
                  '&:hover': {
                    bgcolor: 'action.selected',
                  },
                }}
              />
            ))}
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setEmojiAnchor(e.currentTarget);
              }}
              sx={{
                width: 24,
                height: 24,
                p: 0,
                opacity: 0.6,
                '&:hover': { opacity: 1 },
              }}
            >
              <EmojiEmotionsIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        )}

        {/* Add reaction button (if no reactions yet) */}
        {Object.keys(reactionsByEmoji).length === 0 && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEmojiAnchor(e.currentTarget);
            }}
            sx={{
              width: 24,
              height: 24,
              p: 0,
              opacity: 0,
              mt: 0.5,
              '&:hover': { opacity: 0.6 },
            }}
          >
            <EmojiEmotionsIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}

        {/* Message actions row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, px: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {formatTime(message.createdAt)}
          </Typography>
          
          {/* Send to Slack button (Phase 4) */}
          {canSendToSlack && !message.mirroredFromSlack && (
            <Tooltip title={message.mirroredToSlack ? 'Already sent to Slack' : 'Send to Slack'}>
              <IconButton
                size="small"
                onClick={handleSendToSlack}
                disabled={sendingToSlack || message.mirroredToSlack}
                sx={{
                  width: 20,
                  height: 20,
                  p: 0,
                  opacity: message.mirroredToSlack ? 0.5 : 0.6,
                  '&:hover': { opacity: 1 },
                  color: message.mirroredToSlack ? 'success.main' : 'text.secondary',
                }}
              >
                {sendingToSlack ? (
                  <CircularProgress size={12} />
                ) : message.mirroredToSlack ? (
                  <SendIcon sx={{ fontSize: 14 }} />
                ) : (
                  <SendIcon sx={{ fontSize: 14 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
          
          {/* Slack badge if already mirrored */}
          {message.mirroredToSlack && (
            <Chip
              label="Slack"
              size="small"
              sx={{
                height: 16,
                fontSize: '0.65rem',
                bgcolor: 'success.light',
                color: 'success.contrastText',
              }}
            />
          )}
        </Box>

        {/* Emoji Picker Popover */}
        <Popover
          open={Boolean(emojiAnchor)}
          anchorEl={emojiAnchor}
          onClose={() => setEmojiAnchor(null)}
          anchorOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
        >
          <Box sx={{ p: 1, display: 'flex', gap: 0.5 }}>
            {EMOJI_OPTIONS.map((emoji) => (
              <IconButton
                key={emoji}
                size="small"
                onClick={() => handleReactionClick(emoji)}
                sx={{
                  fontSize: '1.5rem',
                  width: 36,
                  height: 36,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {emoji}
              </IconButton>
            ))}
          </Box>
        </Popover>
      </Box>
    </Box>
  );
};

export default MessageBubble;

