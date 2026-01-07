/**
 * Email Thread View Component
 * 
 * Displays an email conversation thread (like Gmail conversation view).
 * Shows all messages in the thread and allows replying.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Slide,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ReplyIcon from '@mui/icons-material/Reply';
import ForwardIcon from '@mui/icons-material/Forward';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import EmailIcon from '@mui/icons-material/Email';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import { useAuth } from '../contexts/AuthContext';
import MessageDrawer, { MessageRecipient } from './MessageDrawer';
import ContactHoverCard, { ParticipantContact } from './ContactHoverCard';
import { fetchEmailThreadCached, peekEmailThread } from '../utils/emailThreadCache';
import EmailBodyRenderer from './common/EmailBodyRenderer';

interface EmailThreadViewProps {
  open: boolean;
  onClose: () => void;
  threadId: string;
  tenantId: string;
  onThreadUpdated?: (threadId: string, unreadCount: number) => void;
  autoOpenReply?: boolean; // If true, automatically open reply drawer when thread loads
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
  
  // Note: Email thread caching is handled centrally in `src/utils/emailThreadCache.ts`

  // Reset flag when drawer opens
  useEffect(() => {
    if (open) {
      setThreadWasMarkedAsRead(false);
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

      // e archives thread
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        // Archive functionality would go here
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

  // Format forwarded email body with original headers
  const getForwardedBody = (): string => {
    const message = getLatestMessage();
    if (!message) return '';

    const forwardedContent = `
<div style="border-left: 3px solid #ccc; padding-left: 10px; margin: 20px 0; color: #666;">
  <div style="margin-bottom: 10px;">
    <strong>From:</strong> ${message.from}<br/>
    <strong>Date:</strong> ${formatDate(message.createdAt)}<br/>
    <strong>Subject:</strong> ${message.subject || thread?.subject || ''}<br/>
    ${message.to && message.to.length > 0 ? `<strong>To:</strong> ${message.to.join(', ')}<br/>` : ''}
    ${message.cc && message.cc.length > 0 ? `<strong>Cc:</strong> ${message.cc.join(', ')}<br/>` : ''}
  </div>
  <div style="border-top: 1px solid #ddd; padding-top: 10px; margin-top: 10px;">
    ${message.bodyHtml || message.bodyPlain || message.bodySnippet || ''}
  </div>
</div>
    `.trim();

    return forwardedContent;
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
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <IconButton size="small" onClick={toggleStar}>
                    {starred ? <StarIcon color="warning" /> : <StarBorderIcon />}
                  </IconButton>
                  <Typography variant="h6" fontWeight={600}>
                    {thread.subject}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {thread.participants.join(', ')}
                </Typography>
                
                {/* Contact Pills */}
                {thread.participantContacts && thread.participantContacts.length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
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
                                <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                  {displayName}
                                </Typography>
                                {contact.companyName && (
                                  <Typography variant="caption" color="text.secondary">
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
                              '&:hover': {
                                bgcolor: isLinked ? 'primary.dark' : 'action.hover',
                              },
                            }}
                            onClick={() => {
                              if (contact.contactId) {
                                window.open(`/crm/contacts/${contact.contactId}`, '_blank');
                              } else if (contact.userId) {
                                window.open(`/users/${contact.userId}`, '_blank');
                              }
                            }}
                          />
                        );
                      })}
                  </Stack>
                )}
              </Box>
              <IconButton onClick={handleClose}>
                <CloseIcon />
              </IconButton>
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
            <Stack spacing={2}>
              {(() => {
                // Merge real messages with optimistic messages
                const allMessages = [...(thread.messages || [])];
                optimisticMessages.forEach((msg) => {
                  // Add optimistic messages at the end (most recent)
                  allMessages.push(msg);
                });
                // Sort by createdAt (most recent first)
                allMessages.sort((a, b) => {
                  const aTime = a.createdAt?.toDate?.()?.getTime() || a.createdAt?.getTime?.() || new Date(a.createdAt).getTime() || 0;
                  const bTime = b.createdAt?.toDate?.()?.getTime() || b.createdAt?.getTime?.() || new Date(b.createdAt).getTime() || 0;
                  return bTime - aTime;
                });
                
                return allMessages.length > 0 ? (
                  allMessages.map((message, index) => {
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
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Attachments ({message.attachments.length})
                          </Typography>
                          <Stack spacing={1}>
                            {message.attachments.map((attachment) => (
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
                                <AttachFileIcon fontSize="small" color="action" />
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
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </Paper>
                    );
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                    No messages in this thread
                  </Typography>
                );
              })()}
            </Stack>
          </Box>

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

