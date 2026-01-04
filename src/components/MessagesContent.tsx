/**
 * Messages Content Component
 * 
 * Displays message thread and input for a conversation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Avatar,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import SlackModeSelector from './SlackModeSelector';
import { formatDistanceToNow } from 'date-fns';
import { canUserAccessSlack } from '../utils/security';

interface SlackMessageMeta {
  teamId: string;
  channelId: string;
  ts: string;
  threadTs?: string;
}

interface InternalMessage {
  id: string;
  conversationType: 'dm' | 'channel';
  conversationId: string;
  content: string;
  contentType?: 'text' | 'file' | 'link';
  fromUserId: string;
  fromUserName: string;
  fromUserAvatar?: string;
  createdAt: any;
  updatedAt?: any;
  reactions?: Array<{ emoji: string; userId: string }>;
  tenantId?: string;
  // Phase 4: Slack metadata
  source?: 'hrx' | 'slack' | 'email' | 'sms';
  mirroredToSlack?: boolean;
  mirroredFromSlack?: boolean;
  slackMessageMeta?: SlackMessageMeta | null;
}

interface MessagesContentProps {
  conversationType: 'dm' | 'channel';
  conversationId: string;
  tenantId: string;
  userId: string;
  onMessageSent: () => void;
}

const MessagesContent: React.FC<MessagesContentProps> = ({
  conversationType,
  conversationId,
  tenantId,
  userId,
  onMessageSent,
}) => {
  const { user, activeTenant, securityLevel, currentClaimsSecurityLevel } = useAuth();
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversationName, setConversationName] = useState<string>('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [conversationSlackLink, setConversationSlackLink] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation name and Slack link
  useEffect(() => {
    const loadConversationName = async () => {
      if (conversationType === 'channel') {
        try {
          const channelDoc = await getDoc(doc(db, 'tenants', tenantId, 'internalChannels', conversationId));
          if (channelDoc.exists()) {
            const data = channelDoc.data();
            setConversationName(`#${data.name || conversationId}`);
            // Phase 4: Check for Slack link
            if (data.slackLink) {
              setConversationSlackLink(data.slackLink);
            }
          } else {
            setConversationName(`#${conversationId}`);
          }
        } catch (err) {
          console.error('Error loading channel name:', err);
          setConversationName(`#${conversationId}`);
        }
      } else {
        try {
          const dmDoc = await getDoc(doc(db, 'tenants', tenantId, 'internalDMs', conversationId));
          if (dmDoc.exists()) {
            const data = dmDoc.data();
            // Find other participant's name
            const otherParticipantIndex = data.participants?.findIndex((p: string) => p !== userId);
            if (otherParticipantIndex >= 0 && data.participantNames?.[otherParticipantIndex]) {
              setConversationName(data.participantNames[otherParticipantIndex]);
            } else {
              setConversationName('Direct Message');
            }
            // Phase 4: Check for Slack link
            if (data.slackLink) {
              setConversationSlackLink(data.slackLink);
            }
          } else {
            setConversationName('Direct Message');
          }
        } catch (err) {
          console.error('Error loading DM name:', err);
          setConversationName('Direct Message');
        }
      }
    };

    if (conversationId && tenantId) {
      loadConversationName();
    }
  }, [conversationType, conversationId, tenantId, userId]);

  // Real-time listener for messages
  useEffect(() => {
    if (!conversationId || !tenantId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Messages are stored in subcollections: internalDMs/{conversationId}/internalMessages or internalChannels/{conversationId}/internalMessages
    const messagesRef = conversationType === 'dm'
      ? collection(db, 'tenants', tenantId, 'internalDMs', conversationId, 'internalMessages')
      : collection(db, 'tenants', tenantId, 'internalChannels', conversationId, 'internalMessages');
    
    const messagesQuery = query(
      messagesRef,
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const messagesList: InternalMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Filter out deleted messages
          if (!data.deletedAt) {
            messagesList.push({
              id: doc.id,
              ...data,
            } as InternalMessage);
          }
        });
        setMessages(messagesList);
        setLoading(false);

        // Mark messages as read when viewing
        if (messagesList.length > 0) {
          const markRead = httpsCallable(functions, 'markInternalMessagesReadApi');
          markRead({
            tenantId,
            conversationType,
            conversationId,
            userId,
          }).catch((err) => {
            console.warn('Failed to mark messages as read:', err);
          });
        }
      },
      (err) => {
        console.error('Error listening to messages:', err);
        setError('Failed to load messages');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [conversationId, tenantId, conversationType, userId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    try {
      const sendMessage = httpsCallable(functions, 'sendInternalMessageApi');
      const result = await sendMessage({
        tenantId,
        conversationType,
        conversationId,
        content: content.trim(),
      });

      const data = result.data as { success: boolean; message?: InternalMessage; error?: string };
      if (data.success && data.message) {
        // Add message optimistically
        setMessages(prev => [...prev, data.message!]);
        onMessageSent();
      } else {
        setError(data.error || 'Failed to send message');
      }
    } catch (err: any) {
      console.error('Error sending message:', err);
      setError(err.message || 'Failed to send message');
    }
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <Box
            sx={{
              px: 3,
              py: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {conversationName}
            </Typography>
            {/* Phase 5: Slack Mode Selector */}
            {conversationSlackLink && (
              <Box sx={{ mt: 1 }}>
                <SlackModeSelector
                  tenantId={tenantId}
                  conversationId={conversationId}
                  conversationType={conversationType}
                />
              </Box>
            )}
          </Box>

      {/* Messages List */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 2,
          py: 2,
          bgcolor: 'background.default',
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {messages.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No messages yet. Start the conversation!
            </Typography>
          </Box>
        ) : (
          <>
            {messages.map((message, index) => {
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const showAvatar = !prevMessage || prevMessage.fromUserId !== message.fromUserId;
              const isOwnMessage = message.fromUserId === userId;

              // Check if user can send to Slack (securityLevel >= 5)
              const canSendToSlack = canUserAccessSlack({
                uid: user?.uid || '',
                activeTenantId: activeTenant?.id,
                securityLevel: currentClaimsSecurityLevel || securityLevel,
                tenantIds: (user as any)?.tenantIds ? { [activeTenant?.id || '']: { securityLevel: currentClaimsSecurityLevel || securityLevel } } : undefined,
              });

              return (
                <MessageBubble
                  key={message.id}
                  message={{
                    ...message,
                    tenantId,
                    conversationId,
                    conversationType,
                  }}
                  showAvatar={showAvatar}
                  isOwnMessage={isOwnMessage}
                  canSendToSlack={canSendToSlack && !!conversationSlackLink?.enabled}
                  conversationSlackLink={conversationSlackLink}
                />
              );
            })}
            {typingUsers.size > 0 && (
              <Box sx={{ mb: 1 }}>
                {Array.from(typingUsers).map((userId) => (
                  <TypingIndicator key={userId} userName="Someone" />
                ))}
              </Box>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      {/* Input */}
      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          p: 2,
        }}
      >
        <MessageInput
          onSend={handleSendMessage}
          conversationId={conversationId}
          conversationType={conversationType}
          tenantId={tenantId}
          userId={userId}
          onTypingChange={(isTyping) => {
            // TODO: Implement typing indicator updates via Firestore
            // For now, this is a placeholder
          }}
        />
      </Box>
    </Box>
  );
};

export default MessagesContent;

