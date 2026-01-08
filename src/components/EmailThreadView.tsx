/**
 * Email Thread View Component
 * 
 * Displays an email conversation thread (like Gmail conversation view).
 * Shows all messages in the thread and allows replying.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Avatar,
  Divider,
  Paper,
  Chip,
  Tooltip,
  Collapse,
  Slide,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ReplyIcon from '@mui/icons-material/Reply';
import ForwardIcon from '@mui/icons-material/Forward';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DeleteIcon from '@mui/icons-material/Delete';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import EmailIcon from '@mui/icons-material/Email';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import { isImageAttachment, isPdfAttachment, formatFileSize, getFileIcon, downloadAllAttachments } from '../utils/emailAttachments';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useAuth } from '../contexts/AuthContext';
import MessageDrawer, { MessageRecipient } from './MessageDrawer';
import ContactHoverCard, { ParticipantContact } from './ContactHoverCard';
import { fetchEmailThreadCached, peekEmailThread } from '../utils/emailThreadCache';
import EmailBodyRenderer from './common/EmailBodyRenderer';
import { useThreadMessagesRealtime } from '../hooks/useEmailRealtime';

interface EmailThreadViewProps {
  open: boolean;
  onClose: () => void;
  threadId: string;
  tenantId: string;
  onThreadUpdated?: (threadId: string, unreadCount: number) => void;
  autoOpenReply?: boolean; // If true, automatically open reply drawer when thread loads
  // Thread navigation props
  allThreadIds?: string[]; // List of all thread IDs for navigation
  onNavigateToThread?: (threadId: string) => void; // Callback to navigate to a different thread
}

interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadUrl?: string;
}

interface EmailMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  fromUserId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml?: string;
  bodyPlain?: string;
  bodySnippet?: string;
  attachments?: EmailAttachment[];
  status: string;
  read: boolean;
  createdAt: any;
}

interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  participantContacts?: ParticipantContact[];
  lastMessageAt: any;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'deleted';
  starred?: boolean;
  messages: EmailMessage[];
}

const EmailThreadView: React.FC<EmailThreadViewProps> = ({
  open,
  onClose,
  threadId,
  tenantId,
  onThreadUpdated,
  autoOpenReply = false,
  allThreadIds = [],
  onNavigateToThread,
}) => {
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [replyDrawerOpen, setReplyDrawerOpen] = useState(false);
  const [forwardDrawerOpen, setForwardDrawerOpen] = useState(false);
  const [starred, setStarred] = useState(false);
  const [threadWasMarkedAsRead, setThreadWasMarkedAsRead] = useState(false);
  const [hoveredContact, setHoveredContact] = useState<ParticipantContact | null>(null);
  const [contactAnchorEl, setContactAnchorEl] = useState<HTMLElement | null>(null);
  const loadingRef = useRef<string | null>(null); // Track which threadId is currently loading
  const [optimisticMessages, setOptimisticMessages] = useState<Map<string, EmailMessage>>(new Map());
  const [showAllRecipients, setShowAllRecipients] = useState(false);

  const threadAttachments = useMemo(() => {
    if (!thread?.messages || thread.messages.length === 0) return [];
    const seen = new Set<string>();
    const all: EmailAttachment[] = [];
    for (const msg of thread.messages) {
      for (const att of msg.attachments || []) {
        const key = att.id || att.storagePath || `${att.name}:${att.size}:${att.contentType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(att);
      }
    }
    return all;
  }, [thread?.messages]);
  
  // Real-time messages for the thread
  const { messages: realtimeMessages, loading: messagesLoading } = useThreadMessagesRealtime(
    tenantId,
    threadId,
    open && !!threadId
  );
  
  // Note: Email thread caching is handled centrally in `src/utils/emailThreadCache.ts`

  // Reset flag when drawer opens
  useEffect(() => {
    if (open) {
      setThreadWasMarkedAsRead(false);
      setShowAllRecipients(false);
    }
  }, [open]);

  // Handle drawer close - refresh thread list if thread was marked as read
  const handleClose = useCallback(() => {
    if (threadWasMarkedAsRead && onThreadUpdated && threadId) {
      onThreadUpdated(threadId, 0); // Pass threadId and unreadCount (0 = read)
    }
    onClose();
  }, [threadWasMarkedAsRead, onThreadUpdated, threadId, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes drawer
      if (e.key === 'Escape') {
        handleClose();
        return;
      }

      // Only handle shortcuts when drawer is open and not typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Ctrl+Enter to send reply
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          // This will be handled by the reply component
          return;
        }
        return;
      }

      // r opens reply
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setReplyDrawerOpen(true);
        return;
      }

      // f opens forward
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setForwardDrawerOpen(true);
        return;
      }

      // # deletes thread (Gmail-style)
      if (e.key === '#') {
        e.preventDefault();
        void deleteThread();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleClose, setReplyDrawerOpen, setForwardDrawerOpen]);

  const loadThread = useCallback(async (forceRefresh = false) => {
    if (!threadId || !tenantId) return;

    // Best-effort immediate paint from session cache (instant open)
    if (!forceRefresh) {
      const peek = peekEmailThread(tenantId, threadId, 50);
      if (peek?.success && peek.thread) {
        const threadWithMessages = {
          ...(peek.thread as any),
          messages: (peek.messages || []) as any[],
        } as EmailThread;
        setThread(threadWithMessages);
        setStarred(threadWithMessages.starred || false);
        // Mark as read in background (non-blocking)
        if ((threadWithMessages.unreadCount || 0) > 0 && !threadWasMarkedAsRead) {
          markThreadRead();
        }
      }
    }
    
    // Prevent duplicate API calls for the same threadId
    if (loadingRef.current === threadId) {
      return;
    }
    
    loadingRef.current = threadId;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchEmailThreadCached({
        tenantId,
        threadId,
        limit: 50,
        force: forceRefresh,
      });
      
      if (data.success) {
        // Ensure messages are attached so the drawer renders content
        const threadWithMessages = {
          ...data.thread,
          messages: data.messages || [],
        };
        
        setThread(threadWithMessages);
        setStarred(data.thread.starred || false);
        
        // Remove optimistic messages that are now in the real thread
        // (real messages will have different IDs, so we check by content/timestamp)
        setOptimisticMessages(prev => {
          const next = new Map(prev);
          // Remove optimistic messages older than 30 seconds (they should be in real thread by now)
          const thirtySecondsAgo = Date.now() - 30000;
          next.forEach((msg, id) => {
            const msgTime = msg.createdAt instanceof Date ? msg.createdAt.getTime() : new Date(msg.createdAt).getTime();
            if (msgTime < thirtySecondsAgo) {
              next.delete(id);
            }
          });
          return next;
        });
        
        // Mark thread as read in background (non-blocking) - don't await
        if (data.thread.unreadCount > 0) {
          markThreadRead().then(() => {
            // Set flag to refresh when drawer closes (avoid immediate reload)
            setThreadWasMarkedAsRead(true);
          }).catch((err) => {
            console.error('EmailThreadView: Failed to mark thread as read', err);
          });
        }
      } else {
        console.error('EmailThreadView: API returned success=false', data);
        setError(data.error || 'Failed to load email thread');
      }
    } catch (err: any) {
      console.error('EmailThreadView: Error loading thread', err);
      setError(err.message || 'Failed to load email thread');
    } finally {
      setLoading(false);
      loadingRef.current = null;
    }
  }, [threadId, tenantId]);

  useEffect(() => {
    if (open && threadId) {
      loadThread();
    }
  }, [open, threadId, loadThread]);

  // Update thread with real-time messages when they arrive
  useEffect(() => {
    if (thread && realtimeMessages.length > 0) {
      // Merge real-time messages with thread
      setThread(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: realtimeMessages,
        };
      });
    }
  }, [realtimeMessages, thread?.id]);

  // Auto-open reply drawer if requested
  useEffect(() => {
    if (autoOpenReply && thread && !loading && !replyDrawerOpen) {
      setReplyDrawerOpen(true);
    }
  }, [autoOpenReply, thread, loading, replyDrawerOpen]);

  const markThreadRead = async () => {
    // Fire and forget - don't block UI
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            userId: user?.uid,
            read: true,
          }),
        }
      );
    } catch (err) {
      console.error('Failed to mark thread as read:', err);
      // Non-critical error, don't show to user
    }
  };

  const toggleReadStatus = async () => {
    if (!threadId || !tenantId || !user?.uid) return;
    const shouldMarkRead = (thread?.unreadCount || 0) > 0;
    try {
      const API_BASE_URL =
        process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            userId: user.uid,
            read: shouldMarkRead,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update read status');
      }

      // Update local UI immediately
      setThread((prev) =>
        prev
          ? {
              ...prev,
              unreadCount: shouldMarkRead ? 0 : Math.max(prev.unreadCount || 0, 1),
            }
          : prev
      );
      if (shouldMarkRead) {
        setThreadWasMarkedAsRead(true);
      }
    } catch (err) {
      console.error('Failed to toggle read status:', err);
    }
  };

  const toggleStar = async () => {
    const newStarred = !starred;
    setStarred(newStarred);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            userId: user?.uid,
            starred: newStarred,
          }),
        }
      );
    } catch (err) {
      console.error('Failed to toggle star:', err);
      setStarred(!newStarred); // Revert on error
    }
  };

  const deleteThread = async () => {
    if (!threadId || !tenantId || !user?.uid) return;
    try {
      const API_BASE_URL =
        process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            userId: user.uid,
            status: 'deleted',
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete thread');
      }

      handleClose();
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  };

  const handleReply = () => {
    setReplyDrawerOpen(true);
  };

  const addOptimisticMessage = useCallback((message: EmailMessage) => {
    setOptimisticMessages(prev => {
      const next = new Map(prev);
      next.set(message.id, message);
      return next;
    });
  }, []);

  const removeOptimisticMessage = useCallback((messageId: string) => {
    setOptimisticMessages(prev => {
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  const handleReplySent = (optimisticMessageId?: string) => {
    setReplyDrawerOpen(false);
    
    // Remove optimistic message if provided
    if (optimisticMessageId) {
      removeOptimisticMessage(optimisticMessageId);
    }
    
    // Force refresh to get new message (bypass cache)
    loadThread(true);
    // When reply is sent, update thread to refresh message count (unreadCount stays the same)
    if (onThreadUpdated && threadId && thread) {
      onThreadUpdated(threadId, thread.unreadCount || 0);
    }
  };

  const handleForward = () => {
    setForwardDrawerOpen(true);
  };

  const handleForwardSent = () => {
    setForwardDrawerOpen(false);
    // Forward doesn't update the thread, just closes the drawer
  };

  // Get the latest message for forwarding
  const getLatestMessage = () => {
    if (!thread || !thread.messages || thread.messages.length === 0) return null;
    // Get the most recent message (messages should be sorted by date)
    return thread.messages[thread.messages.length - 1];
  };

  const escapeHtml = (input: string): string =>
    String(input || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const sanitizeForwardHtml = (html: string): string => {
    if (!html) return '';
    let sanitized = html;
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    sanitized = sanitized.replace(/on\w+="[^"]*"/gi, '');
    sanitized = sanitized.replace(/on\w+='[^']*'/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    return sanitized;
  };

  // Format forwarded email body including the entire thread history beneath it
  const getForwardedBody = (): string => {
    if (!thread || !thread.messages || thread.messages.length === 0) return '';

    // Newest first so "the email being forwarded" is on top, and the rest is below it
    const messages = [...thread.messages].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() || a.createdAt?.getTime?.() || new Date(a.createdAt).getTime() || 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() || b.createdAt?.getTime?.() || new Date(b.createdAt).getTime() || 0;
      return bTime - aTime;
    });

    const blocks = messages.map((m) => {
      const subject = m.subject || thread.subject || '';
      const bodyHtml = m.bodyHtml ? sanitizeForwardHtml(m.bodyHtml) : '';
      const bodyPlain = m.bodyPlain || m.bodySnippet || '';
      const body = bodyHtml
        ? bodyHtml
        : `<pre style="white-space:pre-wrap;word-break:break-word;margin:0;">${escapeHtml(bodyPlain)}</pre>`;

      return `
<div style="border-left:3px solid #C7CDD6;padding-left:12px;margin:16px 0;color:#5B6472;">
  <div style="font-size:12px;margin-bottom:8px;color:#6B7280;">
    ---------- Forwarded message ----------
  </div>
  <div style="font-size:12px;line-height:1.45;margin-bottom:10px;">
    <strong>From:</strong> ${escapeHtml(m.from)}<br/>
    <strong>Date:</strong> ${escapeHtml(formatDate(m.createdAt))}<br/>
    <strong>Subject:</strong> ${escapeHtml(subject)}<br/>
    ${m.to && m.to.length > 0 ? `<strong>To:</strong> ${escapeHtml(m.to.join(', '))}<br/>` : ''}
    ${m.cc && m.cc.length > 0 ? `<strong>Cc:</strong> ${escapeHtml(m.cc.join(', '))}<br/>` : ''}
  </div>
  <div style="border-top:1px solid #E5E7EB;padding-top:10px;margin-top:10px;color:#111827;">
    ${body}
  </div>
</div>
      `.trim();
    });

    return blocks.join('\n\n');
  };

  const formatDate = (date: any): string => {
    if (!date) return 'N/A';
    try {
      const d = date.toDate ? date.toDate() : new Date(date);
      return d.toLocaleString();
    } catch {
      return 'N/A';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getRecipients = (): MessageRecipient[] => {
    if (!thread) return [];
    
    // Get other participants (not the current user)
    const otherParticipants = thread.participants
      .filter(p => p.toLowerCase() !== user?.email?.toLowerCase())
      .map(email => ({
        userId: email, // Use email as userId for external recipients
        name: email.split('@')[0],
        email,
      }));

    return otherParticipants;
  };

  if (loading && !thread) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={handleClose}
        variant="temporary"
        transitionDuration={{ enter: 225, exit: 195 }}
        SlideProps={{
          direction: 'left',
        }}
        ModalProps={{
          keepMounted: true,
          disableEnforceFocus: true,
          disableRestoreFocus: true,
          disableAutoFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          sx: { 
            width: { xs: '100%', sm: '90%', md: '40%' },
            minWidth: { md: '600px' },
            maxWidth: { md: '800px' },
            height: '100vh',
            zIndex: 1300,
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
            // Prevent any width changes on hover
            '&:hover': {
              width: { xs: '100%', sm: '90%', md: '40%' },
            },
            // Prevent pointer events from interfering with hover
            pointerEvents: 'auto',
          },
        }}
        hideBackdrop={isMobile}
        sx={{
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1299,
            ...(isMobile && {
              display: 'none',
              pointerEvents: 'none',
            }),
          },
        }}
      >
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            p: 4,
            height: '100%',
            // Prevent hover interactions during loading
            pointerEvents: 'none',
          }}
        >
          <CircularProgress />
        </Box>
      </Drawer>
    );
  }

  if (error && !thread) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={handleClose}
        variant="temporary"
        transitionDuration={{ enter: 225, exit: 195 }}
        SlideProps={{
          direction: 'left',
        }}
        ModalProps={{
          keepMounted: true,
          disableEnforceFocus: true,
          disableRestoreFocus: true,
          disableAutoFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          sx: { 
            width: { xs: '100%', sm: '90%', md: '40%' },
            minWidth: { md: '600px' },
            maxWidth: { md: '800px' },
            height: '100vh',
            zIndex: 1300,
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
            '&:hover': {
              width: { xs: '100%', sm: '90%', md: '40%' },
            },
          },
        }}
        hideBackdrop={isMobile}
        sx={{
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1299,
            ...(isMobile && {
              display: 'none',
              pointerEvents: 'none',
            }),
          },
        }}
      >
        <Box sx={{ p: 3 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Drawer>
    );
  }

  if (!thread) return null;

  const recipients = (thread.participants || []).filter(Boolean);
  const collapsedRecipients = recipients.slice(0, 2);
  const remainingCount = Math.max(recipients.length - collapsedRecipients.length, 0);
  const collapsedRecipientsText =
    collapsedRecipients.join(', ') + (remainingCount > 0 ? `, +${remainingCount}` : '');

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={handleClose}
        variant="temporary"
        hideBackdrop={isMobile}
        transitionDuration={{ enter: 225, exit: 195 }}
        SlideProps={{
          direction: 'left',
        }}
        ModalProps={{
          keepMounted: true,
          disableEnforceFocus: true,
          disableRestoreFocus: true,
          disableAutoFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          sx: { 
            width: { xs: '100%', sm: '90%', md: '40%' },
            minWidth: { md: '600px' },
            maxWidth: { md: '800px' },
            height: '100vh',
            zIndex: 1300,
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
            // Prevent any width changes
            '&:hover': {
              width: { xs: '100%', sm: '90%', md: '40%' },
            },
          },
        }}
        sx={{
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1299,
            ...(isMobile && {
              display: 'none',
              pointerEvents: 'none',
            }),
          },
        }}
      >
        <Box 
          sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%',
            position: 'relative',
            zIndex: 1301,
          }}
        >
          {/* Header */}
          <Box
            sx={{
              p: 2,
              borderBottom: 1,
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              zIndex: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                  <IconButton size="small" onClick={toggleStar}>
                    {starred ? <StarIcon color="warning" /> : <StarBorderIcon />}
                  </IconButton>
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                      minWidth: 0,
                      flex: 1,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      lineHeight: 1.2,
                    }}
                  >
                    {thread.subject || '(no subject)'}
                  </Typography>
                </Stack>

                {/* Recipients (collapsed by default, expandable) */}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      minWidth: 0,
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={recipients.join(', ')}
                  >
                    {showAllRecipients ? recipients.join(', ') : collapsedRecipientsText}
                  </Typography>
                  {recipients.length > 2 && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowAllRecipients((v) => !v)}
                      sx={{ textTransform: 'none', px: 1, minWidth: 0 }}
                    >
                      {showAllRecipients ? 'Hide' : 'Show'}
                    </Button>
                  )}
                </Stack>

                <Collapse in={showAllRecipients && recipients.length > 2} timeout={150}>
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                      {recipients.join(', ')}
                    </Typography>
                  </Box>
                </Collapse>
                
                {/* Contact Pills */}
                {thread.participantContacts && thread.participantContacts.length > 0 && (
                  <Box
                    sx={{
                      mt: 1,
                      overflowX: 'auto',
                      overflowY: 'hidden',
                      whiteSpace: 'nowrap',
                      pb: 0.25,
                      '&::-webkit-scrollbar': { height: 6 },
                      '&::-webkit-scrollbar-track': { background: 'rgba(0,0,0,0.04)' },
                      '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.18)', borderRadius: 4 },
                      scrollbarWidth: 'thin',
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ width: 'max-content' }}>
                    {thread.participantContacts
                      .filter(contact => contact.contactId || contact.userId) // Only show linked contacts
                      .map((contact, index) => {
                        const displayName = contact.contactName || contact.userName || contact.email.split('@')[0];
                        const isLinked = !!(contact.contactId || contact.userId);
                        
                        return (
                          <Chip
                            key={`${contact.email}-${index}`}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 500, color: isLinked && contact.contactId ? 'white' : 'inherit' }}>
                                  {displayName}
                                </Typography>
                                {contact.companyName && (
                                  <Typography variant="caption" sx={{ color: isLinked && contact.contactId ? 'rgba(255, 255, 255, 0.8)' : 'text.secondary' }}>
                                    • {contact.companyName}
                                  </Typography>
                                )}
                              </Box>
                            }
                            size="small"
                            color={contact.contactId ? 'primary' : 'default'}
                            variant={isLinked ? 'filled' : 'outlined'}
                            onMouseEnter={(e) => {
                              setHoveredContact(contact);
                              setContactAnchorEl(e.currentTarget);
                            }}
                            onMouseLeave={() => {
                              setHoveredContact(null);
                              setContactAnchorEl(null);
                            }}
                            sx={{
                              cursor: isLinked ? 'pointer' : 'default',
                              color: isLinked && contact.contactId ? 'white' : 'inherit',
                              '& .MuiChip-label': {
                                color: isLinked && contact.contactId ? 'white' : 'inherit',
                              },
                              height: 28,
                              '&:hover': {
                                bgcolor: isLinked ? 'primary.dark' : 'action.hover',
                              },
                            }}
                            onClick={() => {
                              if (contact.contactId) {
                                window.open(`/contacts/${contact.contactId}`, '_blank');
                              } else if (contact.userId) {
                                window.open(`/users/${contact.userId}`, '_blank');
                              }
                            }}
                          />
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Tooltip title={(thread.unreadCount || 0) > 0 ? 'Mark as read (M)' : 'Mark as unread (M)'}>
                  <IconButton size="small" onClick={toggleReadStatus}>
                    <MarkEmailReadIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Forward (F)">
                  <IconButton size="small" onClick={() => setForwardDrawerOpen(true)}>
                    <ForwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete (#)">
                  <IconButton size="small" onClick={() => void deleteThread()}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <IconButton onClick={handleClose} size="small">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </Box>

          {/* Messages */}
          <Box sx={{ 
            flex: 1, 
            overflow: 'auto', 
            p: 2,
            // Thin, light scrollbar styling per spec - override default black scrollbar
            '&::-webkit-scrollbar': {
              width: '8px !important',
              height: '8px !important',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 0, 0, 0.02) !important',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 0, 0, 0.15) !important',
              borderRadius: '4px',
              '&:hover': {
                background: 'rgba(0, 0, 0, 0.25) !important',
              },
            },
            // Firefox scrollbar styling
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}>
            {(loading || messagesLoading) && (!thread || !thread.messages || thread.messages.length === 0) && realtimeMessages.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : (
              <Stack spacing={2}>
                {(() => {
                  // Use real-time messages if available, otherwise fall back to thread.messages
                  const baseMessages = realtimeMessages.length > 0 ? realtimeMessages : (thread.messages || []);
                  
                  // Merge real messages with optimistic messages
                  const allMessages = [...baseMessages];
                  optimisticMessages.forEach((msg) => {
                    // Add optimistic messages at the end (most recent)
                    allMessages.push(msg);
                  });
                  
                  // Deduplicate by message ID
                  const messageMap = new Map<string, EmailMessage>();
                  allMessages.forEach(msg => {
                    if (msg.id && !messageMap.has(msg.id)) {
                      messageMap.set(msg.id, msg);
                    }
                  });
                  const deduplicatedMessages = Array.from(messageMap.values());
                  
                  // Sort by createdAt (oldest first for conversation view)
                  deduplicatedMessages.sort((a, b) => {
                    const aTime = a.createdAt?.toDate?.()?.getTime() || a.createdAt?.getTime?.() || new Date(a.createdAt).getTime() || 0;
                    const bTime = b.createdAt?.toDate?.()?.getTime() || b.createdAt?.getTime?.() || new Date(b.createdAt).getTime() || 0;
                    return aTime - bTime; // Oldest first for conversation view
                  });
                  
                  return deduplicatedMessages.length > 0 ? (
                    deduplicatedMessages.map((message, index) => {
                    const isOptimistic = optimisticMessages.has(message.id);
                    return (
                      <Paper 
                        key={message.id} 
                        variant="outlined" 
                        sx={{ 
                          p: 2,
                          opacity: isOptimistic ? 0.7 : 1,
                          border: isOptimistic ? '1px dashed' : undefined,
                          borderColor: isOptimistic ? 'primary.main' : undefined,
                        }}
                      >
                        {isOptimistic && (
                          <Chip 
                            label="Sending..." 
                            size="small" 
                            color="primary" 
                            sx={{ mb: 1 }}
                          />
                        )}
                        <Stack spacing={1}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Avatar sx={{ width: 32, height: 32 }}>
                            {message.from.charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {message.from}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(message.createdAt)}
                            </Typography>
                          </Box>
                        </Stack>
                        <Chip
                          label={message.direction}
                          size="small"
                          color={message.direction === 'inbound' ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </Stack>
                      {message.to && message.to.length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          To: {message.to.join(', ')}
                        </Typography>
                      )}
                      {message.cc && message.cc.length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          Cc: {message.cc.join(', ')}
                        </Typography>
                      )}
                      <Divider />
                      <Box
                        sx={{
                          p: 2,
                          bgcolor: 'background.paper',
                          // Remove maxHeight to prevent clipping - let content flow naturally
                          // Single scrollbar container with thin, light scrollbar per spec
                          overflowY: 'auto',
                          overflowX: 'hidden',
                          // Thin, light scrollbar styling per spec - ensure it overrides any parent styles
                          '&::-webkit-scrollbar': {
                            width: '8px !important',
                            height: '8px !important',
                          },
                          '&::-webkit-scrollbar-track': {
                            background: 'rgba(0, 0, 0, 0.02) !important',
                            borderRadius: '4px',
                          },
                          '&::-webkit-scrollbar-thumb': {
                            background: 'rgba(0, 0, 0, 0.15) !important',
                            borderRadius: '4px',
                            '&:hover': {
                              background: 'rgba(0, 0, 0, 0.25) !important',
                            },
                          },
                          // Firefox scrollbar styling
                          scrollbarWidth: 'thin',
                          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
                        }}
                      >
                        <EmailBodyRenderer
                          html={message.bodyHtml || ''}
                          plainText={message.bodyPlain || message.bodySnippet || ''}
                        />
                      </Box>
                      {message.attachments && message.attachments.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                            <Typography variant="subtitle2">
                              Attachments ({message.attachments.length})
                            </Typography>
                            {message.attachments.length > 1 && (
                              <Button
                                size="small"
                                startIcon={<DownloadIcon />}
                                onClick={async () => {
                                  try {
                                    await downloadAllAttachments(message.attachments);
                                  } catch (err) {
                                    console.error('Error downloading all attachments:', err);
                                  }
                                }}
                                sx={{ textTransform: 'none' }}
                              >
                                Download All
                              </Button>
                            )}
                          </Stack>
                          <Stack spacing={1}>
                            {message.attachments.map((attachment) => {
                              const isImage = isImageAttachment(attachment);
                              const isPdf = isPdfAttachment(attachment);
                              const fileIcon = getFileIcon(attachment.contentType);
                              
                              return (
                                <Paper
                                  key={attachment.id}
                                  variant="outlined"
                                  sx={{
                                    p: 1.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    '&:hover': { bgcolor: 'action.hover' },
                                  }}
                                >
                                  {isImage && attachment.downloadUrl ? (
                                    <Box
                                      component="img"
                                      src={attachment.downloadUrl}
                                      alt={attachment.name}
                                      sx={{
                                        width: 48,
                                        height: 48,
                                        objectFit: 'cover',
                                        borderRadius: 1,
                                        cursor: 'pointer',
                                      }}
                                      onClick={() => window.open(attachment.downloadUrl, '_blank')}
                                    />
                                  ) : (
                                    <Box
                                      sx={{
                                        width: 48,
                                        height: 48,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        bgcolor: 'action.hover',
                                        borderRadius: 1,
                                      }}
                                    >
                                      {isPdf ? (
                                        <PictureAsPdfIcon fontSize="small" color="error" />
                                      ) : isImage ? (
                                        <ImageIcon fontSize="small" color="primary" />
                                      ) : (
                                        <AttachFileIcon fontSize="small" color="action" />
                                      )}
                                    </Box>
                                  )}
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="body2" noWrap>
                                      {attachment.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {formatFileSize(attachment.size)} • {attachment.contentType}
                                    </Typography>
                                  </Box>
                                  <IconButton
                                    size="small"
                                    onClick={() => {
                                      if (attachment.downloadUrl) {
                                        window.open(attachment.downloadUrl, '_blank');
                                      } else if (attachment.storagePath) {
                                        // Generate download URL from storage path if downloadUrl not available
                                        const encodedPath = encodeURIComponent(attachment.storagePath);
                                        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
                                        window.open(downloadUrl, '_blank');
                                      }
                                    }}
                                    title="Download"
                                  >
                                    <DownloadIcon fontSize="small" />
                                  </IconButton>
                                </Paper>
                              );
                            })}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </Paper>
                    );
                  })
                ) : (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4, minHeight: '200px' }}>
                    <Typography variant="body2" color="text.secondary" align="center">
                      No messages found in this thread
                    </Typography>
                  </Box>
                );
              })()}
              </Stack>
            )}
          </Box>

          {/* Attachment tray (thread-level) */}
          {threadAttachments.length > 0 && (
            <Box
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                px: 2,
                py: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flexShrink: 0,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                <AttachFileIcon fontSize="small" color="action" />
                <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
                  Attachments ({threadAttachments.length})
                </Typography>

                <Box
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    whiteSpace: 'nowrap',
                    pb: 0.25,
                    '&::-webkit-scrollbar': { height: 6 },
                    '&::-webkit-scrollbar-track': { background: 'rgba(0,0,0,0.04)' },
                    '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.18)', borderRadius: 4 },
                    scrollbarWidth: 'thin',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ width: 'max-content' }}>
                    {threadAttachments.map((attachment) => {
                      const isImage = isImageAttachment(attachment);
                      const isPdf = isPdfAttachment(attachment);
                      const icon = isPdf ? (
                        <PictureAsPdfIcon fontSize="small" color="error" />
                      ) : isImage ? (
                        <ImageIcon fontSize="small" color="primary" />
                      ) : (
                        getFileIcon(attachment.contentType)
                      );

                      return (
                        <Paper
                          key={attachment.id || attachment.storagePath || attachment.name}
                          variant="outlined"
                          onClick={() => {
                            if (attachment.downloadUrl) {
                              window.open(attachment.downloadUrl, '_blank');
                              return;
                            }
                            if (attachment.storagePath) {
                              const encodedPath = encodeURIComponent(attachment.storagePath);
                              const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
                              window.open(downloadUrl, '_blank');
                            }
                          }}
                          sx={{
                            px: 1,
                            py: 0.75,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            cursor: 'pointer',
                            borderRadius: 999,
                            maxWidth: 260,
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                          title={attachment.name}
                        >
                          {icon}
                          <Typography variant="body2" noWrap sx={{ maxWidth: 160 }}>
                            {attachment.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {formatFileSize(attachment.size)}
                          </Typography>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Box>
              </Stack>

              {threadAttachments.length > 1 && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon fontSize="small" />}
                  onClick={async () => {
                    try {
                      await downloadAllAttachments(threadAttachments);
                    } catch (err) {
                      console.error('Error downloading all attachments:', err);
                    }
                  }}
                  sx={{ textTransform: 'none', flexShrink: 0 }}
                >
                  Download all
                </Button>
              )}
            </Box>
          )}

          {/* Footer */}
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<ReplyIcon />}
                onClick={handleReply}
                sx={{ flex: 1 }}
              >
                Reply
              </Button>
              <Button
                variant="outlined"
                startIcon={<ForwardIcon />}
                onClick={handleForward}
                sx={{ flex: 1 }}
              >
                Forward
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Reply Drawer */}
      {thread && (
        <MessageDrawer
          open={replyDrawerOpen}
          onClose={() => setReplyDrawerOpen(false)}
          recipients={getRecipients()}
          defaultChannels={['email']}
          defaultSubject={`Re: ${thread.subject}`}
          threadId={threadId}
          onMessageSent={(optimisticMessageId) => handleReplySent(optimisticMessageId)}
          onOptimisticMessage={addOptimisticMessage}
        />
      )}

      {/* Forward Drawer */}
      {thread && (
        <MessageDrawer
          open={forwardDrawerOpen}
          onClose={() => setForwardDrawerOpen(false)}
          recipients={[]} // No pre-filled recipients for forward
          defaultChannels={['email']}
          defaultSubject={`Fwd: ${thread.subject}`}
          defaultBody={getForwardedBody()}
          // Don't pass threadId for forward - we want to create a new email, not reply
          onMessageSent={handleForwardSent}
        />
      )}
      
      {/* Contact Hover Card */}
      {hoveredContact && (
        <ContactHoverCard
          open={!!hoveredContact}
          anchorEl={contactAnchorEl}
          onClose={() => {
            setHoveredContact(null);
            setContactAnchorEl(null);
          }}
          contact={hoveredContact}
          tenantId={tenantId}
        />
      )}
    </>
  );
};

export default EmailThreadView;

