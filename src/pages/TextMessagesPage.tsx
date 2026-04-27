/**
 * Messages Page (admin)
 *
 * Canonical conversation-based inbox. Lists SMS conversations and messages from
 * tenants/{tenantId}/conversations and .../messages. Send flow uses
 * sendConversationMessage + sendSmsFromConversation.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  CircularProgress,
  Alert,
  Chip,
  IconButton,
  Drawer,
  TextField,
  Avatar,
  Tooltip,
  useTheme,
  useMediaQuery,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
} from '@mui/material';
import SmsIcon from '@mui/icons-material/Sms';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useSmsConversationsForTenant, type SmsConversation } from '../hooks/useSmsConversationsForTenant';
import { useConversationMessages } from '../hooks/useConversationMessages';
import {
  sendConversationMessageCallable,
  sendSmsFromConversationCallable,
} from '../api/conversationsApi';
import { formatDistanceToNow, format } from 'date-fns';
import type { MessageDelivery } from '../types/conversations';

function parseDeliveryDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
  const ms = typeof value === 'object' && value !== null && 'seconds' in value
    ? (value as { seconds: number }).seconds * 1000
    : typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function formatDeliveryTooltip(delivery: MessageDelivery): string {
  const lines: string[] = [];
  const sentAt = parseDeliveryDate(delivery.sentAt);
  if (sentAt) lines.push(`Sent: ${format(sentAt, 'MMM d, yyyy h:mm a')}`);
  const failedAt = parseDeliveryDate(delivery.failedAt);
  if (failedAt) lines.push(`Failed: ${format(failedAt, 'MMM d, yyyy h:mm a')}`);
  const deliveredAt = parseDeliveryDate(delivery.deliveredAt);
  if (deliveredAt) lines.push(`Delivered: ${format(deliveredAt, 'MMM d, yyyy h:mm a')}`);
  if (delivery.errorMessage) lines.push(`Error: ${delivery.errorMessage}`);
  if (delivery.errorCode) lines.push(`Code: ${delivery.errorCode}`);
  return lines.length ? lines.join('\n') : delivery.status;
}

function DeliveryStatusChip({ delivery }: { delivery: MessageDelivery }) {
  const label = delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1);
  const color =
    delivery.status === 'queued'
      ? 'warning'
      : delivery.status === 'sent' || delivery.status === 'delivered'
        ? 'success'
        : 'error';
  const isQueued = delivery.status === 'queued';
  const chip = (
    <Chip
      icon={isQueued ? <CircularProgress size={12} color="inherit" sx={{ marginLeft: 0.5, marginRight: -0.5 }} /> : undefined}
      label={label}
      size="small"
      color={color as 'warning' | 'success' | 'error'}
      sx={{ height: 20, mb: 0.5, mr: 0.5 }}
    />
  );
  const tooltipText = formatDeliveryTooltip(delivery);
  return (
    <Tooltip title={isQueued ? 'Sending…' + (tooltipText ? `\n${tooltipText}` : '') : tooltipText} placement="top" arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}

const TextMessagesPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const effectiveTenantId = activeTenant?.id || '';
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean | null>(null);
  const [availableTwilioNumbers, setAvailableTwilioNumbers] = useState<Array<{ phoneNumber: string; sid: string; friendlyName: string }>>([]);
  const [showNumberSelection, setShowNumberSelection] = useState(false);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { conversations, loading, error: conversationsError } = useSmsConversationsForTenant(effectiveTenantId);
  const displayError = error || (conversationsError ? String(conversationsError) : null);
  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  const { messages, loading: loadingMessages } = useConversationMessages(
    effectiveTenantId,
    selectedConversationId
  );

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const formatDate = (date: any): string => {
    if (!date) return 'Unknown';
    const d = date?.toDate?.() || (date instanceof Date ? date : new Date(date));
    return formatDistanceToNow(d, { addSuffix: true });
  };

  const formatFullDate = (date: any): string => {
    if (!date) return '';
    const d = date?.toDate?.() || (date instanceof Date ? date : new Date(date));
    return format(d, 'MMM d, yyyy h:mm a');
  };

  const getConversationDisplayName = (c: SmsConversation): string =>
    c.topic?.label ?? c.channelEndpoints?.sms?.workerPhoneE164 ?? 'Unknown';

  const getConversationPhone = (c: SmsConversation): string =>
    c.channelEndpoints?.sms?.workerPhoneE164 ?? '';

  // Check Twilio number assignment
  useEffect(() => {
    const checkTwilioNumber = async () => {
      if (!user?.uid || !effectiveTenantId) {
        setHasTwilioNumber(null);
        return;
      }

      try {
        const recruiterNumberDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'recruiterNumbers', user.uid));
        const hasNumber = recruiterNumberDoc.exists() && (recruiterNumberDoc.data()?.twilioNumber || recruiterNumberDoc.data()?.useMainNumber);
        setHasTwilioNumber(hasNumber);
        
        if (!hasNumber) {
          // Load available numbers
          setLoadingTwilioNumbers(true);
          try {
            const getAvailableTwilioNumbers = httpsCallable(functions, 'getAvailableTwilioNumbers');
            const result = await getAvailableTwilioNumbers({});
            const data = result.data as { success: boolean; available?: Array<{ phoneNumber: string; sid: string; friendlyName: string }> };
            if (data.success && data.available) {
              setAvailableTwilioNumbers(data.available);
              setShowNumberSelection(true);
            }
          } catch (err) {
            console.error('Error loading available Twilio numbers:', err);
          } finally {
            setLoadingTwilioNumbers(false);
          }
        }
      } catch (err) {
        console.error('Error checking Twilio number:', err);
        setHasTwilioNumber(false);
      }
    };

    checkTwilioNumber();
  }, [user?.uid, effectiveTenantId]);

  const handleSendReply = async () => {
    if (!replyMessage.trim() || !selectedConversationId || !effectiveTenantId) return;

    if (replyMessage.length > 1600) {
      setError('Message is too long (max 1600 characters)');
      return;
    }

    setSendingReply(true);
    setError(null);

    try {
      const { data: sendData } = await sendConversationMessageCallable({
        tenantId: effectiveTenantId,
        conversationId: selectedConversationId,
        text: replyMessage.trim(),
      });
      const messageId = sendData?.messageId;

      await sendSmsFromConversationCallable({
        tenantId: effectiveTenantId,
        conversationId: selectedConversationId,
        text: replyMessage.trim(),
        ...(messageId && { conversationMessageId: messageId }),
      });

      setReplyMessage('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      setError(message);
    } finally {
      setSendingReply(false);
    }
  };

  const handleAssignTwilioNumber = async (twilioNumberSid: string) => {
    if (!user?.uid || !effectiveTenantId) return;

    try {
      const assignRecruiterNumber = httpsCallable(functions, 'assignRecruiterNumber');
      const result = await assignRecruiterNumber({
        tenantId: effectiveTenantId,
        recruiterId: user.uid,
        twilioNumberSid,
      });

      const data = result.data as { success: boolean; message?: string };
      if (data.success) {
        setShowNumberSelection(false);
        setHasTwilioNumber(true);
      } else {
        setError(data.message || 'Failed to assign Twilio number');
      }
    } catch (err: any) {
      console.error('Error assigning Twilio number:', err);
      setError(err.message || 'Failed to assign Twilio number');
    }
  };

  if (loading && conversations.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {displayError && (
        <Alert
          severity="error"
          sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 1300 }}
          onClose={() => setError(null)}
        >
          {displayError}
        </Alert>
      )}

      {/* Thread List Sidebar */}
      <Box
        sx={{
          width: isMobile ? '100%' : 350,
          borderRight: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6" fontWeight={600}>
            Messages
          </Typography>
        </Box>

        {/* Number Selection */}
        {showNumberSelection && hasTwilioNumber === false && (
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Assign a Twilio Number
            </Typography>
            {loadingTwilioNumbers ? (
              <CircularProgress size={20} />
            ) : availableTwilioNumbers.length > 0 ? (
              <Stack spacing={1}>
                {availableTwilioNumbers.map((number) => (
                  <Button
                    key={number.sid}
                    variant="outlined"
                    fullWidth
                    size="small"
                    onClick={() => handleAssignTwilioNumber(number.sid)}
                  >
                    {number.phoneNumber}
                  </Button>
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                No available numbers
              </Typography>
            )}
          </Box>
        )}

        {/* Conversation List */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {conversations.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No conversations yet
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {conversations.map((conv) => (
                <ListItem
                  key={conv.id}
                  disablePadding
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: selectedConversationId === conv.id ? 'action.selected' : 'transparent',
                  }}
                >
                  <ListItemButton
                    onClick={() => setSelectedConversationId(conv.id)}
                    selected={selectedConversationId === conv.id}
                  >
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: 'primary.main' }}>
                        <SmsIcon />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle2" fontWeight={600}>
                            {getConversationDisplayName(conv)}
                          </Typography>
                          {conv.status === 'open' && (
                            <Chip label="Open" size="small" color="success" sx={{ height: 20 }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {conv.lastMessagePreview || 'No messages'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(conv.lastMessageAt)}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Box>

      {/* Message View */}
      {selectedConversation && !isMobile ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Message Header */}
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" fontWeight={600}>
              {getConversationDisplayName(selectedConversation)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {getConversationPhone(selectedConversation)}
            </Typography>
          </Box>

          {/* Messages */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
            {loadingMessages ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : messages.length === 0 ? (
              <Box sx={{ textAlign: 'center', p: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  No messages in this conversation
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {messages.map((msg) => {
                  const isOutbound = msg.direction === 'outbound';
                  const text = typeof msg.body === 'string' ? msg.body : msg.body?.text ?? '';
                  return (
                    <Box
                      key={msg.id}
                      sx={{
                        display: 'flex',
                        justifyContent: isOutbound ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Paper
                        elevation={1}
                        sx={{
                          p: 2,
                          maxWidth: '70%',
                          bgcolor: isOutbound ? 'primary.main' : 'background.paper',
                          color: isOutbound ? 'primary.contrastText' : 'text.primary',
                        }}
                      >
                        {msg.channel && (
                          <Chip label={msg.channel} size="small" sx={{ mb: 0.5, mr: 0.5, height: 20 }} />
                        )}
                        {isOutbound && msg.delivery && (
                          <DeliveryStatusChip delivery={msg.delivery} />
                        )}
                        <Typography variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                          {text}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            opacity: 0.7,
                            display: 'block',
                            textAlign: isOutbound ? 'right' : 'left',
                          }}
                        >
                          {formatFullDate(msg.createdAt)}
                          {msg.sender?.role === 'worker' ? ' • Worker' : msg.sender?.role ? ` • ${msg.sender.role}` : ''}
                        </Typography>
                      </Paper>
                    </Box>
                  );
                })}
                <div ref={messagesEndRef} />
              </Stack>
            )}
          </Box>

          {/* Reply Input */}
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Stack spacing={2}>
              <TextField
                label="Reply"
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                fullWidth
                multiline
                rows={3}
                placeholder="Type your reply..."
                helperText={`${replyMessage.length}/1600 characters`}
                disabled={sendingReply}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSendReply();
                  }
                }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  onClick={handleSendReply}
                  disabled={sendingReply || !replyMessage.trim()}
                  startIcon={sendingReply ? <CircularProgress size={20} /> : <SendIcon />}
                >
                  {sendingReply ? 'Sending...' : 'Send'}
                </Button>
              </Box>
            </Stack>
          </Box>
        </Box>
      ) : selectedConversation && isMobile ? (
        <Drawer
          anchor="right"
          open={!!selectedConversation}
          onClose={() => setSelectedConversationId(null)}
          PaperProps={{
            sx: { width: '100%' },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="h6" fontWeight={600}>
                  {getConversationDisplayName(selectedConversation)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getConversationPhone(selectedConversation)}
                </Typography>
              </Box>
              <IconButton onClick={() => setSelectedConversationId(null)}>
                <CloseIcon />
              </IconButton>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
              {loadingMessages ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress />
                </Box>
              ) : messages.length === 0 ? (
                <Box sx={{ textAlign: 'center', p: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No messages in this conversation
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {messages.map((msg) => {
                    const isOutbound = msg.direction === 'outbound';
                    const text = typeof msg.body === 'string' ? msg.body : msg.body?.text ?? '';
                    return (
                      <Box
                        key={msg.id}
                        sx={{
                          display: 'flex',
                          justifyContent: isOutbound ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <Paper
                          elevation={1}
                          sx={{
                            p: 2,
                            maxWidth: '70%',
                            bgcolor: isOutbound ? 'primary.main' : 'background.paper',
                            color: isOutbound ? 'primary.contrastText' : 'text.primary',
                          }}
                        >
                          {isOutbound && msg.delivery && (
                            <DeliveryStatusChip delivery={msg.delivery} />
                          )}
                          <Typography variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                            {text}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              opacity: 0.7,
                              display: 'block',
                              textAlign: isOutbound ? 'right' : 'left',
                            }}
                          >
                            {formatFullDate(msg.createdAt)}
                          </Typography>
                        </Paper>
                      </Box>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </Stack>
              )}
            </Box>
            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
              <Stack spacing={2}>
                <TextField
                  label="Reply"
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                  placeholder="Type your reply..."
                  helperText={`${replyMessage.length}/1600 characters`}
                  disabled={sendingReply}
                />
                <Button
                  variant="contained"
                  onClick={handleSendReply}
                  disabled={sendingReply || !replyMessage.trim()}
                  startIcon={sendingReply ? <CircularProgress size={20} /> : <SendIcon />}
                  fullWidth
                >
                  {sendingReply ? 'Sending...' : 'Send'}
                </Button>
              </Stack>
            </Box>
          </Box>
        </Drawer>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Select a conversation to view messages
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default TextMessagesPage;
