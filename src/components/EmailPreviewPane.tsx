/**
 * EmailPreviewPane Component
 * 
 * Split-view preview pane for email threads
 * Shows list on left, preview on right (desktop)
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Stack,
  Chip,
  Avatar,
  Divider,
  Button,
  Tooltip,
  useTheme,
  useMediaQuery,
  Fade,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ReplyIcon from '@mui/icons-material/Reply';
import ForwardIcon from '@mui/icons-material/Forward';
import ArchiveIcon from '@mui/icons-material/Archive';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import EmailBodyRenderer from './common/EmailBodyRenderer';
import { useAuth } from '../contexts/AuthContext';

export interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  lastMessageAt: any;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'deleted';
  starred?: boolean;
  participantContacts?: any[];
}

export interface EmailMessage {
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
  attachments?: any[];
  status: string;
  read: boolean;
  createdAt: any;
}

export interface EmailPreviewPaneProps {
  thread: EmailThread | null;
  messages: EmailMessage[];
  loading?: boolean;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
  onArchive: () => void;
  onStar: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
  autoMarkAsRead?: boolean;
  onAutoMarkAsRead?: (threadId: string) => void;
}

const EmailPreviewPane: React.FC<EmailPreviewPaneProps> = ({
  thread,
  messages,
  loading = false,
  onClose,
  onReply,
  onForward,
  onArchive,
  onStar,
  onMarkRead,
  onDelete,
  autoMarkAsRead = false,
  onAutoMarkAsRead,
}) => {
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Auto-mark as read when preview opens
  useEffect(() => {
    if (autoMarkAsRead && thread && thread.unreadCount > 0 && onAutoMarkAsRead) {
      // Small delay to ensure user sees the message
      const timer = setTimeout(() => {
        onAutoMarkAsRead(thread.id);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoMarkAsRead, thread, onAutoMarkAsRead]);

  if (!thread) {
    return (
      <Paper
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.50',
          minHeight: '400px',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Select an email to preview
        </Typography>
      </Paper>
    );
  }

  const formatDate = (date: any): string => {
    if (!date) return 'N/A';
    try {
      const d = date.toDate ? date.toDate() : new Date(date);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString();
    } catch {
      return 'N/A';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getDisplayName = (email: string): string => {
    const contact = thread.participantContacts?.find(
      (c) => c.email?.toLowerCase() === email.toLowerCase()
    );
    return contact?.contactName || contact?.userName || email.split('@')[0];
  };

  const sortedMessages = [...messages].sort((a, b) => {
    const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
    const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
    return dateA.getTime() - dateB.getTime();
  });

  return (
    <Fade in={!!thread} timeout={200}>
      <Paper
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <IconButton size="small" onClick={onStar}>
                  {thread.starred ? <StarIcon color="warning" /> : <StarBorderIcon />}
                </IconButton>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: thread.unreadCount > 0 ? 600 : 400,
                  }}
                >
                  {thread.subject || 'No Subject'}
                </Typography>
                {thread.unreadCount > 0 && (
                  <Chip
                    label={thread.unreadCount}
                    size="small"
                    color="primary"
                    sx={{ flexShrink: 0 }}
                  />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {thread.participants.join(', ')}
              </Typography>
              
              {/* Contact Pills */}
              {thread.participantContacts && thread.participantContacts.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                  {thread.participantContacts
                    .filter(contact => contact.contactId || contact.userId)
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
                          onClick={() => {
                            if (contact.contactId) {
                              window.open(`/crm/contacts/${contact.contactId}`, '_blank');
                            } else if (contact.userId) {
                              window.open(`/users/${contact.userId}`, '_blank');
                            }
                          }}
                          sx={{
                            cursor: isLinked ? 'pointer' : 'default',
                            color: isLinked && contact.contactId ? 'white' : 'inherit',
                            '& .MuiChip-label': {
                              color: isLinked && contact.contactId ? 'white' : 'inherit',
                            },
                            '&:hover': {
                              bgcolor: isLinked ? 'primary.dark' : 'action.hover',
                            },
                          }}
                        />
                      );
                    })}
                </Stack>
              )}
            </Box>
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        {/* Messages */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            p: 2,
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 0, 0, 0.02)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              '&:hover': {
                background: 'rgba(0, 0, 0, 0.25)',
              },
            },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}
        >
          {loading && messages.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : sortedMessages.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4, minHeight: '200px' }}>
              <Typography variant="body2" color="text.secondary">
                No messages found in this thread
              </Typography>
            </Box>
          ) : (
            <Stack spacing={2}>
              {sortedMessages.map((message, index) => {
                const senderName = message.from.split('<')[0].trim() || message.from;
                const senderEmail =
                  message.from.match(/<([^>]+)>/)?.[1] || message.from;
                const isCurrentUser = user?.email === senderEmail;
                const displayName = getDisplayName(senderEmail);

                return (
                  <Paper
                    key={message.id || index}
                    variant="outlined"
                    sx={{
                      p: 2,
                      bgcolor: isCurrentUser ? 'action.hover' : 'background.paper',
                      borderLeft: isCurrentUser
                        ? '3px solid #0057B8'
                        : '3px solid transparent',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          mr: 1,
                          bgcolor: isCurrentUser ? 'primary.main' : 'grey.400',
                        }}
                      >
                        {getInitials(displayName)}
                      </Avatar>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="subtitle2" fontWeight="bold">
                          {displayName} {isCurrentUser && '(You)'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(message.createdAt)}
                        </Typography>
                        {message.to && message.to.length > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            To: {message.to.join(', ')}
                          </Typography>
                        )}
                        {message.cc && message.cc.length > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Cc: {message.cc.join(', ')}
                          </Typography>
                        )}
                      </Box>
                      <Chip
                        label={message.direction}
                        size="small"
                        color={message.direction === 'inbound' ? 'primary' : 'default'}
                      />
                    </Box>
                    <Divider sx={{ my: 1 }} />
                    <Box
                      sx={{
                        p: 2,
                        bgcolor: 'background.paper',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        // Thin, light scrollbar styling per spec
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
                                  }
                                }}
                              >
                                <DownloadIcon />
                              </IconButton>
                            </Paper>
                          ))}
                        </Stack>
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Box>

        {/* Footer Actions */}
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            gap: 1,
            flexShrink: 0,
          }}
        >
          <Button
            variant="contained"
            startIcon={<ReplyIcon />}
            onClick={onReply}
            fullWidth
          >
            Reply
          </Button>
          <Button
            variant="outlined"
            startIcon={<ForwardIcon />}
            onClick={onForward}
            fullWidth
          >
            Forward
          </Button>
          <Tooltip title={thread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}>
            <IconButton onClick={onMarkRead}>
              <MarkEmailReadIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>
    </Fade>
  );
};

export default EmailPreviewPane;

