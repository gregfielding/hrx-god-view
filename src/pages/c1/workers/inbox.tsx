/**
 * Worker Inbox — /c1/workers/inbox and /c1/workers/inbox/:threadId
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md §7.2
 */

import React, { useState } from 'react';
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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerThreads, useWorkerThreadMessages } from '../../../hooks/useWorkerThreads';
import { markThreadReadCallable, sendWorkerThreadMessageCallable } from '../../../api/workerNotificationsApi';

function formatTime(ts: { toDate?: () => Date } | null): string {
  if (!ts) return '';
  const d = typeof (ts as any).toDate === 'function' ? (ts as any).toDate() : new Date((ts as any).seconds * 1000);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const C1WorkerInbox: React.FC = () => {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { user, activeTenant } = useAuth();
  const uid = user?.uid ?? undefined;
  const tenantId = activeTenant?.id ?? (user?.uid ? 'c1' : '');

  const { threads, totalUnread, loading: threadsLoading } = useWorkerThreads(uid);
  const { messages, loading: messagesLoading } = useWorkerThreadMessages(threadId ?? undefined);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const selectedThread = threadId ? threads.find((t) => t.id === threadId) : null;

  const handleSelectThread = (id: string) => {
    navigate(`/c1/workers/inbox/${id}`);
    const t = threads.find((x) => x.id === id);
    if (t && uid && (t.unreadCountByUid?.[uid] ?? 0) > 0) {
      markThreadReadCallable(uid, id).catch(() => {});
    }
  };

  const handleSend = async () => {
    const body = reply.trim();
    if (!body || !threadId || !uid || !tenantId) return;
    setSending(true);
    try {
      await sendWorkerThreadMessageCallable({ threadId, senderUid: uid, body, tenantId });
      setReply('');
    } finally {
      setSending(false);
    }
  };

  if (threadsLoading && !threadId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const threadList = (
    <List disablePadding sx={{ borderRight: isDesktop ? 1 : 0, borderColor: 'divider', minWidth: 280 }}>
      {threads.length === 0 ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" display="block">
            No conversations yet.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            If you need help, contact Support.
          </Typography>
        </Box>
      ) : (
        threads.map((t) => {
          const unread = uid ? (t.unreadCountByUid?.[uid] ?? 0) : 0;
          return (
            <ListItemButton
              key={t.id}
              selected={t.id === threadId}
              onClick={() => handleSelectThread(t.id)}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {t.subject || t.topic}
                    {unread > 0 && (
                      <Typography component="span" variant="caption" color="primary" fontWeight={600}>
                        {unread}
                      </Typography>
                    )}
                  </Box>
                }
                secondary={t.lastMessagePreview || formatTime(t.lastMessageAt)}
                primaryTypographyProps={{ noWrap: true }}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItemButton>
          );
        })
      )}
    </List>
  );

  const messageView = threadId ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        {!isDesktop && (
          <Button size="small" onClick={() => navigate('/c1/workers/inbox')}>
            ← Back
          </Button>
        )}
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          {selectedThread?.subject || selectedThread?.topic || 'Conversation'}
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
            const isMe = m.senderUid === uid;
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
                    {m.senderDisplayName || (isMe ? 'You' : 'Staff')} · {formatTime(m.createdAt)}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {m.body}
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
        <Button variant="contained" onClick={handleSend} disabled={!reply.trim() || sending} endIcon={<SendIcon />}>
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
      <Typography variant="h5" sx={{ mb: 2 }}>
        Inbox
      </Typography>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 400, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {isDesktop ? (
          <>
            {threadList}
            {messageView}
          </>
        ) : (
          threadId ? (
            messageView
          ) : (
            threadList
          )
        )}
      </Box>
    </>
  );
};

export default C1WorkerInbox;
