/**
 * Worker Inbox — /c1/workers/inbox and /c1/workers/inbox/:conversationId
 * Uses tenant-scoped conversations (tenants/{tenantId}/conversations).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Button,
  CircularProgress,
  Alert,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useAuth } from '../../../contexts/AuthContext';
import { useConversationsForUser } from '../../../hooks/useConversationsForUser';
import { useConversationMessages } from '../../../hooks/useConversationMessages';
import { markConversationReadCallable, sendConversationMessageCallable } from '../../../api/conversationsApi';

type TimestampLike = { toDate?: () => Date; seconds?: number } | null | undefined;

function toDate(ts: TimestampLike): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

function formatTime(ts: { toDate?: () => Date } | null): string {
  const d = toDate(ts);
  if (!d) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const C1WorkerInbox: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { user, activeTenant } = useAuth();
  const uid = user?.uid ?? null;
  const tenantId = activeTenant?.id ?? null;
  // Normalize C1 tenant ID typo (0 vs O) so list, messages, and callables use canonical path
  const resolvedTenantId =
    tenantId === 'BCiP2bQ9CgV0CTfV6MhD' ? 'BCiP2bQ9CgVOCTfV6MhD' : tenantId;

  const { conversations, loading: conversationsLoading, error: conversationsError } = useConversationsForUser(tenantId, uid);
  const { messages, loading: messagesLoading } = useConversationMessages(resolvedTenantId, conversationId ?? null);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const selectedConversation = conversationId ? conversations.find((c) => c.id === conversationId) : null;
  const unreadTotal = useMemo(() => (uid ? conversations.reduce((sum, c) => sum + (c.unreadByUid?.[uid] ?? 0), 0) : 0), [conversations, uid]);

  useEffect(() => {
    if (!conversationId || !selectedConversation || !uid || !resolvedTenantId) return;
    const unread = selectedConversation.unreadByUid?.[uid] ?? 0;
    if (unread > 0) {
      markConversationReadCallable({ tenantId: resolvedTenantId, conversationId }).catch(() => {});
    }
  }, [conversationId, selectedConversation, uid, resolvedTenantId]);

  const getConversationTitle = (c: (typeof conversations)[number]) =>
    c.topic?.label || (c.type === 'support' ? 'Support' : c.type === 'system' ? 'System updates' : 'Recruiting');
  const getConversationSenderLabel = (c: (typeof conversations)[number]) =>
    c.type === 'system' ? 'System' : c.type === 'support' ? 'Support' : 'Recruiter';

  if (!tenantId) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4, px: 2 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Inbox
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Please select your organization to view your inbox.
        </Typography>
      </Box>
    );
  }

  const handleSelectConversation = (id: string) => {
    navigate(`/c1/workers/inbox/${id}`);
    const c = conversations.find((x) => x.id === id);
    if (c && uid && (c.unreadByUid?.[uid] ?? 0) > 0 && resolvedTenantId) {
      markConversationReadCallable({ tenantId: resolvedTenantId, conversationId: id }).catch(() => {});
    }
  };

  const handleSend = async () => {
    const text = reply.trim();
    if (!text || !conversationId || !resolvedTenantId) return;
    setSending(true);
    try {
      await sendConversationMessageCallable({ tenantId: resolvedTenantId, conversationId, text });
      setReply('');
    } finally {
      setSending(false);
    }
  };

  if (conversationsLoading && !conversationId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const conversationList = (
    <List disablePadding sx={{ borderRight: isDesktop ? 1 : 0, borderColor: 'divider', minWidth: 280 }}>
      {conversations.length === 0 ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" display="block">
            No conversations yet.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            If you need help, contact Support.
          </Typography>
        </Box>
      ) : (
        conversations.map((c) => {
          const unread = uid ? (c.unreadByUid?.[uid] ?? 0) : 0;
          const preview = c.lastMessagePreview || 'No messages yet';
          return (
            <ListItemButton
              key={c.id}
              selected={c.id === conversationId}
              onClick={() => (c.id ? handleSelectConversation(c.id) : undefined)}
              sx={{ alignItems: 'flex-start', py: 1.25 }}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ fontWeight: unread > 0 ? 700 : 600 }} noWrap>
                      {getConversationTitle(c)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                      {formatTime(c.lastMessageAt)}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box sx={{ mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                      {getConversationSenderLabel(c)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {preview}
                    </Typography>
                    {unread > 0 && (
                      <Typography component="span" variant="caption" color="primary" fontWeight={700}>
                        {unread}
                      </Typography>
                    )}
                  </Box>
                }
                primaryTypographyProps={{ noWrap: true }}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItemButton>
          );
        })
      )}
    </List>
  );

  const messageView = conversationId ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        {!isDesktop && (
          <Button size="small" onClick={() => navigate('/c1/workers/inbox')}>
            ← Back
          </Button>
        )}
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          {selectedConversation ? getConversationTitle(selectedConversation) : 'Conversation'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {selectedConversation ? getConversationSenderLabel(selectedConversation) : ''}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {messagesLoading ? (
          <CircularProgress size={24} />
        ) : messages.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No messages yet.
          </Typography>
        ) : (
          messages.map((m) => {
            const isMe = m.sender?.uid === uid;
            const bodyText = typeof m.body === 'string' ? m.body : (m.body?.text ?? '');
            return (
              <Box
                key={m.id}
                sx={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  mb: 1,
                }}
              >
                <Box
                  sx={{
                    maxWidth: '80%',
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: isMe ? 'primary.main' : 'action.hover',
                    color: isMe ? 'primary.contrastText' : 'text.primary',
                  }}
                >
                  <Typography variant="caption" display="block" color={isMe ? 'inherit' : 'text.secondary'}>
                    {isMe ? 'You' : 'Staff'} · {formatTime(m.createdAt)}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {bodyText}
                  </Typography>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Type a message..."
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          multiline
          maxRows={3}
        />
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={!reply.trim() || sending || selectedConversation?.status === 'closed'}
          endIcon={<SendIcon />}
        >
          Send
        </Button>
      </Box>
    </Box>
  ) : (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
      <Typography variant="body2" color="text.secondary">
        Select a conversation
      </Typography>
    </Box>
  );

  return (
    <>
      {conversationsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Inbox error: {String((conversationsError as any)?.code || '')} {String((conversationsError as any)?.message || conversationsError)}
        </Alert>
      )}
      <Typography variant="h5" sx={{ mb: 2 }}>
        Inbox
        {unreadTotal > 0 ? (
          <Typography component="span" variant="caption" color="primary" sx={{ ml: 1 }}>
            ({unreadTotal} unread)
          </Typography>
        ) : null}
      </Typography>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 400, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {isDesktop ? (
          <>
            {conversationList}
            {messageView}
          </>
        ) : (
          conversationId ? (
            messageView
          ) : (
            conversationList
          )
        )}
      </Box>
    </>
  );
};

export default C1WorkerInbox;
