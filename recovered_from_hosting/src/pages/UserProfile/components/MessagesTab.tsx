/**
 * Messages Tab Component
 * 
 * Displays message history for a user, including:
 * - All message logs (SMS, Email, Push)
 * - SMS threads (conversations)
 * - Ability to reply to SMS threads
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  Stack,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TablePagination,
  Avatar,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import NotificationsIcon from '@mui/icons-material/Notifications';
import ReplyIcon from '@mui/icons-material/Reply';
import { collection, query, where, orderBy, limit, getDocs, Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import ReplyDrawer from '../../../components/ReplyDrawer';
import EmailThreadView from '../../../components/EmailThreadView';

interface MessageLog {
  id: string;
  tenantId: string;
  userId: string;
  threadId?: string;
  messageTypeId: string;
  channel: 'email' | 'sms' | 'push';
  direction: 'inbound' | 'outbound';
  fromIdentity: 'system' | 'recruiter' | 'candidate' | 'ai';
  fromUserId?: string;
  contentSent: string;
  contentOriginal?: string; // Original message content before processing
  language: 'en' | 'es' | null;
  status: string;
  failureReason?: string;
  providerMessageId?: string;
  createdAt: Timestamp | Date;
}

interface SmsThread {
  id: string;
  tenantId: string;
  candidateUserId: string;
  candidatePhone: string;
  primaryRecruiterUserId: string | null;
  twilioNumber: string;
  status: 'open' | 'closed';
  lastMessageAt: Timestamp | Date;
  lastMessageSnippet?: string;
  unreadCountForRecruiter?: number;
}

interface MessagesTabProps {
  uid: string;
  tenantId?: string;
}

interface EmailThread {
  id: string;
  tenantId: string;
  subject: string;
  participants: string[];
  lastMessageAt: any;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'deleted';
  starred?: boolean;
  labels?: string[];
}

const MessagesTab: React.FC<MessagesTabProps> = ({ uid, tenantId }) => {
  const { user, activeTenant } = useAuth();
  const [activeTab, setActiveTab] = useState<'email' | 'sms' | 'push' | 'threads' | 'emailThreads'>('email');
  const [allMessageLogs, setAllMessageLogs] = useState<MessageLog[]>([]);
  const [smsThreads, setSmsThreads] = useState<SmsThread[]>([]);
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyDrawerOpen, setReplyDrawerOpen] = useState(false);
  const [selectedThread, setSelectedThread] = useState<SmsThread | null>(null);
  const [selectedEmailThread, setSelectedEmailThread] = useState<EmailThread | null>(null);
  const [emailThreadDrawerOpen, setEmailThreadDrawerOpen] = useState(false);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<MessageLog | null>(null);
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [emailThreadPage, setEmailThreadPage] = useState(0);
  const [emailThreadRowsPerPage, setEmailThreadRowsPerPage] = useState(25);

  const effectiveTenantId = tenantId || activeTenant?.id;

  useEffect(() => {
    if (!uid || !effectiveTenantId) return;
    
    if (activeTab === 'threads') {
      loadSmsThreads();
    } else if (activeTab === 'emailThreads') {
      loadEmailThreads();
    } else {
      loadMessageHistory();
    }
  }, [uid, effectiveTenantId, activeTab]);
  
  // Reset pagination when tab changes
  useEffect(() => {
    setPage(0);
  }, [activeTab]);

  const loadMessageHistory = async () => {
    if (!uid || !effectiveTenantId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL || 
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';
      
      const response = await fetch(
        `${API_BASE_URL}/getUserMessageHistory?tenantId=${encodeURIComponent(effectiveTenantId)}&userId=${encodeURIComponent(uid)}&limit=100`
      );
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || 'Failed to load message history';
        
        // Check if it's an index building error (either by code or message content)
        if (errorData.code === 'INDEX_BUILDING' || 
            errorMessage.includes('currently building') || 
            errorMessage.includes('index is currently building')) {
          setError('Database index is building. Please try again in a few minutes.');
        } else if (errorMessage.includes('requires an index') || errorMessage.includes('FAILED_PRECONDITION')) {
          setError('Database index is being set up. Please try again in a few minutes.');
        } else {
          setError(errorMessage);
        }
        return;
      }
      
      const data = await response.json();
      setAllMessageLogs(data.messages || []);
    } catch (err: any) {
      console.error('Error loading message history:', err);
      setError(err.message || 'Failed to load message history');
    } finally {
      setLoading(false);
    }
  };

  const loadSmsThreads = async () => {
    if (!uid || !effectiveTenantId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Query SMS threads where this user is the candidate
      const threadsQuery = query(
        collection(db, 'tenants', effectiveTenantId, 'smsThreads'),
        where('candidateUserId', '==', uid),
        orderBy('lastMessageAt', 'desc'),
        limit(50)
      );
      
      const snapshot = await getDocs(threadsQuery);
      const threads = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as SmsThread[];
      
      setSmsThreads(threads);
    } catch (err: any) {
      console.error('Error loading SMS threads:', err);
      setError(err.message || 'Failed to load SMS threads');
    } finally {
      setLoading(false);
    }
  };

  const loadEmailThreads = async () => {
    if (!uid || !effectiveTenantId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Get user email from user document
      const userDoc = await getDoc(doc(db, 'users', uid));
      const userData = userDoc.data();
      const userEmail = userData?.email?.toLowerCase();
      
      if (!userEmail) {
        setError('User email not found');
        setLoading(false);
        return;
      }

      const threadsRef = collection(db, 'tenants', effectiveTenantId, 'emailThreads');
      const allThreads: EmailThread[] = [];

      // Query by participantUserIds if available
      try {
        const userIdQuery = query(
          threadsRef,
          where('participantUserIds', 'array-contains', uid),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc'),
          limit(200)
        );
        const userIdSnapshot = await getDocs(userIdQuery);
        const userIdThreads = userIdSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as EmailThread[];
        allThreads.push(...userIdThreads);
      } catch (err) {
        console.warn('Could not query by participantUserIds:', err);
      }

      // Also query by email address (fallback)
      try {
        const emailQuery = query(
          threadsRef,
          where('participants', 'array-contains', userEmail),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc'),
          limit(200)
        );
        const emailSnapshot = await getDocs(emailQuery);
        const emailThreads = emailSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as EmailThread[];
        
        // Merge and deduplicate
        const existingIds = new Set(allThreads.map(t => t.id));
        emailThreads.forEach(thread => {
          if (!existingIds.has(thread.id)) {
            allThreads.push(thread);
          }
        });
      } catch (err) {
        console.warn('Could not query by email:', err);
      }

      // Sort by lastMessageAt and normalize timestamps
      const normalizedThreads = allThreads
        .map(thread => ({
          ...thread,
          lastMessageAt: thread.lastMessageAt?.toDate?.() || thread.lastMessageAt || new Date(),
        }))
        .sort((a, b) => {
          const aTime = a.lastMessageAt instanceof Date ? a.lastMessageAt.getTime() : 0;
          const bTime = b.lastMessageAt instanceof Date ? b.lastMessageAt.getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 200);

      setEmailThreads(normalizedThreads);
    } catch (err: any) {
      console.error('Error loading email threads:', err);
      setError(err.message || 'Failed to load email threads');
    } finally {
      setLoading(false);
    }
  };

  const handleReply = (thread: SmsThread) => {
    setSelectedThread(thread);
    setReplyDrawerOpen(true);
  };

  const handleMessageClick = (message: MessageLog) => {
    setSelectedMessage(message);
    setMessageModalOpen(true);
  };

  const extractSubject = (content: string): string | null => {
    if (!content) return null;
    // Try to extract subject from HTML email (look for <title> or first <h1> or first line)
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].trim();
    
    const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) return h1Match[1].trim();
    
    // Strip HTML and get first line
    const textContent = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const firstLine = textContent.split('\n')[0]?.trim();
    if (firstLine && firstLine.length < 100) return firstLine;
    
    return null;
  };

  const getMessageContent = (message: MessageLog): string => {
    // Prefer contentOriginal if available (original message before processing)
    // Otherwise use contentSent (what was actually sent)
    const content = message.contentOriginal || message.contentSent || '';
    
    // If content is just "Message: {messageTypeId}", it's likely a placeholder
    // Try to get the actual content from the message
    if (content.startsWith('Message: ') && content === `Message: ${message.messageTypeId}`) {
      // This is a placeholder, return empty or try to find actual content
      return '';
    }
    
    return content;
  };

  const formatDate = (date: Timestamp | Date | string): string => {
    if (!date) return '';
    const d = date instanceof Timestamp ? date.toDate() : typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return <EmailIcon fontSize="small" />;
      case 'sms':
        return <SmsIcon fontSize="small" />;
      case 'push':
        return <NotificationsIcon fontSize="small" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string): 'default' | 'success' | 'error' | 'warning' => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return 'success';
      case 'failed':
      case 'bounced':
        return 'error';
      case 'queued':
        return 'warning';
      default:
        return 'default';
    }
  };

  // Filter messages by channel based on active tab
  const filteredMessages = allMessageLogs.filter(log => {
    if (activeTab === 'email') return log.channel === 'email';
    if (activeTab === 'sms') return log.channel === 'sms';
    if (activeTab === 'push') return log.channel === 'push';
    return false;
  });
  
  // Paginate filtered messages
  const paginatedMessages = filteredMessages.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );
  
  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };
  
  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };
  
  if (loading && allMessageLogs.length === 0 && smsThreads.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 3, py: 4 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Messages
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
        View message history and SMS conversations
      </Typography>

      <Tabs
        value={activeTab}
        onChange={(_, newValue) => setActiveTab(newValue)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Email" value="email" icon={<EmailIcon fontSize="small" />} iconPosition="start" />
        <Tab label="Email Threads" value="emailThreads" icon={<EmailIcon fontSize="small" />} iconPosition="start" />
        <Tab label="SMS" value="sms" icon={<SmsIcon fontSize="small" />} iconPosition="start" />
        <Tab label="Push" value="push" icon={<NotificationsIcon fontSize="small" />} iconPosition="start" />
        <Tab label="SMS Threads" value="threads" icon={<SmsIcon fontSize="small" />} iconPosition="start" />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {(activeTab === 'email' || activeTab === 'sms' || activeTab === 'push') && (
        <>
          <TableContainer 
            component={Paper} 
            variant="outlined"
            sx={{ overflowX: 'auto' }}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Direction</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Content</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedMessages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No {activeTab.toUpperCase()} messages found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMessages.map((log) => (
                    <TableRow 
                      key={log.id} 
                      hover 
                      onClick={() => handleMessageClick(log)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{formatDate(log.createdAt)}</TableCell>
                      <TableCell>
                        <Chip
                          label={log.direction}
                          size="small"
                          color={log.direction === 'inbound' ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={log.status}
                          size="small"
                          color={getStatusColor(log.status)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            maxWidth: 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {log.contentSent?.replace(/<[^>]*>/g, '').substring(0, 100) || 'N/A'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={filteredMessages.length}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </>
      )}

      {activeTab === 'emailThreads' && (
        <>
          {emailThreads.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <EmailIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                No email threads yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Email threads will appear here
              </Typography>
            </Paper>
          ) : (
            <>
              <TableContainer 
                component={Paper} 
                variant="outlined" 
                sx={{ borderRadius: 0, overflowX: 'auto' }}
              >
                <Table size="medium">
                  <TableHead>
                    <TableRow>
                      <TableCell width="56px" sx={{ py: 1.5, px: 0 }}></TableCell>
                      <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', width: '200px' }}>
                        From
                      </TableCell>
                      <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', width: '400px' }}>
                        Subject
                      </TableCell>
                      <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary' }}>
                        Preview
                      </TableCell>
                      <TableCell width="140px" sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', textAlign: 'right' }}>
                        Date
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {emailThreads
                      .slice(emailThreadPage * emailThreadRowsPerPage, emailThreadPage * emailThreadRowsPerPage + emailThreadRowsPerPage)
                      .map((thread) => {
                        const getDisplayName = (t: EmailThread): string => {
                          const userEmail = user?.email?.toLowerCase();
                          const otherParticipants = t.participants.filter(p => p.toLowerCase() !== userEmail);
                          if (otherParticipants.length > 0) {
                            const email = otherParticipants[0];
                            return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                          }
                          return t.participants[0] || 'Unknown';
                        };
                        const getInitials = (name: string): string => {
                          const parts = name.split(' ');
                          if (parts.length >= 2) {
                            return (parts[0][0] + parts[1][0]).toUpperCase();
                          }
                          return name.substring(0, 2).toUpperCase();
                        };
                        const getAvatarColor = (name: string): string => {
                          const colors = [
                            '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b',
                            '#0288d1', '#00796b', '#fbc02d', '#5e35b1', '#d32f2f',
                          ];
                          const index = name.charCodeAt(0) % colors.length;
                          return colors[index];
                        };
                        const formatDate = (date: Date | any): string => {
                          if (!date) return '';
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
                          if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
                          if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
                          return `${Math.floor(diffDays / 365)}y ago`;
                        };
                        const displayName = getDisplayName(thread);
                        return (
                          <TableRow
                            key={thread.id}
                            onClick={() => {
                              setSelectedEmailThread(thread);
                              setEmailThreadDrawerOpen(true);
                            }}
                            sx={{
                              cursor: 'pointer',
                              height: '56px',
                              bgcolor: thread.unreadCount > 0 ? '#F6F8FB' : 'transparent',
                              borderBottom: '1px solid',
                              borderColor: 'rgba(0, 0, 0, 0.06)',
                              borderLeft: thread.unreadCount > 0 ? '3px solid' : '3px solid transparent',
                              borderLeftColor: thread.unreadCount > 0 ? 'primary.main' : 'transparent',
                              '&:hover': {
                                bgcolor: thread.unreadCount > 0 ? '#E8EDF5' : 'rgba(0, 0, 0, 0.02)',
                              },
                            }}
                          >
                            <TableCell sx={{ py: 1.5, px: 0, width: '56px' }}>
                              <Avatar
                                sx={{
                                  width: 36,
                                  height: 36,
                                  fontSize: '13px',
                                  bgcolor: getAvatarColor(displayName),
                                  color: '#fff',
                                  fontWeight: 600,
                                }}
                              >
                                {getInitials(displayName)}
                              </Avatar>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, px: 1.5, width: '200px' }}>
                              <Stack spacing={0.25}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontSize: '14px',
                                    fontWeight: thread.unreadCount > 0 ? 600 : 500,
                                    color: 'text.primary',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {displayName}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    fontSize: '12px',
                                    color: 'text.secondary',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {thread.participants.find(p => p.toLowerCase() !== user?.email?.toLowerCase()) || ''}
                                </Typography>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, px: 1.5, width: '400px' }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontSize: '14px',
                                  fontWeight: thread.unreadCount > 0 ? 600 : 400,
                                  color: 'text.primary',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {thread.subject || '(no subject)'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, px: 1.5 }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontSize: '13px',
                                  color: 'text.secondary',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {thread.lastMessageSnippet || ''}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, px: 1.5, textAlign: 'right' }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: '12px',
                                  color: 'text.secondary',
                                }}
                              >
                                {formatDate(thread.lastMessageAt)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={emailThreads.length}
                page={emailThreadPage}
                onPageChange={(_, newPage) => setEmailThreadPage(newPage)}
                rowsPerPage={emailThreadRowsPerPage}
                onRowsPerPageChange={(e) => {
                  setEmailThreadRowsPerPage(parseInt(e.target.value, 10));
                  setEmailThreadPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </>
          )}
        </>
      )}

      {activeTab === 'threads' && (
        <Box>
          {smsThreads.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No SMS threads found
              </Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {smsThreads.map((thread) => (
                <Paper key={thread.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <SmsIcon fontSize="small" color="primary" />
                        <Typography variant="subtitle2" fontWeight={600}>
                          Thread {thread.id.substring(0, 8)}
                        </Typography>
                        <Chip
                          label={thread.status}
                          size="small"
                          color={thread.status === 'open' ? 'success' : 'default'}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        From: {thread.twilioNumber}
                      </Typography>
                      {thread.lastMessageSnippet && (
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          {thread.lastMessageSnippet}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Last message: {formatDate(thread.lastMessageAt)}
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<ReplyIcon />}
                      onClick={() => handleReply(thread)}
                    >
                      Reply
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {selectedThread && (
        <ReplyDrawer
          open={replyDrawerOpen}
          onClose={() => {
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
          threadId={selectedThread.id}
          tenantId={effectiveTenantId || ''}
          candidateUserId={uid}
          onReplySent={() => {
            loadSmsThreads();
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
        />
      )}

      {/* Email Thread Drawer */}
      {selectedEmailThread && effectiveTenantId && (
        <EmailThreadView
          open={emailThreadDrawerOpen}
          threadId={selectedEmailThread.id}
          tenantId={effectiveTenantId}
          onClose={() => {
            setEmailThreadDrawerOpen(false);
            setSelectedEmailThread(null);
          }}
          onThreadUpdated={(threadId: string, unreadCount: number) => {
            setEmailThreads(prev => prev.map(t => 
              t.id === threadId ? { ...t, unreadCount } : t
            ));
          }}
        />
      )}

      {/* Message Detail Modal */}
      <Dialog
        open={messageModalOpen}
        onClose={() => {
          setMessageModalOpen(false);
          setSelectedMessage(null);
        }}
        maxWidth="md"
        fullWidth
      >
        {selectedMessage && (
          <>
            <DialogTitle>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Chip
                  icon={getChannelIcon(selectedMessage.channel)}
                  label={selectedMessage.channel.toUpperCase()}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={selectedMessage.direction}
                  size="small"
                  color={selectedMessage.direction === 'inbound' ? 'primary' : 'default'}
                  variant="outlined"
                />
                <Chip
                  label={selectedMessage.status}
                  size="small"
                  color={getStatusColor(selectedMessage.status)}
                />
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {formatDate(selectedMessage.createdAt)}
                </Typography>
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={3}>
                {/* Message Type */}
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    Message Type
                  </Typography>
                  <Typography variant="body2">{selectedMessage.messageTypeId}</Typography>
                </Box>

                {/* Subject/Title (for email and push) */}
                {(selectedMessage.channel === 'email' || selectedMessage.channel === 'push') && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      {selectedMessage.channel === 'email' ? 'Subject' : 'Title'}
                    </Typography>
                    <Typography variant="body1" fontWeight={500}>
                      {extractSubject(getMessageContent(selectedMessage)) || 'No subject/title'}
                    </Typography>
                  </Box>
                )}

                {/* Message Body */}
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    Message Content
                  </Typography>
                  {(() => {
                    const messageContent = getMessageContent(selectedMessage);
                    const hasHtml = /<[^>]+>/.test(messageContent);
                    
                    if (!messageContent || messageContent.trim() === '') {
                      return (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 2,
                            bgcolor: 'background.paper',
                            fontStyle: 'italic',
                          }}
                        >
                          No message content available
                        </Typography>
                      );
                    }
                    
                    if (selectedMessage.channel === 'email' && hasHtml) {
                      return (
                        <Box
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 2,
                            bgcolor: 'background.paper',
                            maxHeight: '500px',
                            overflow: 'auto',
                            '& img': { maxWidth: '100%' },
                            '& a': { color: 'primary.main' },
                          }}
                          dangerouslySetInnerHTML={{ __html: messageContent }}
                        />
                      );
                    } else {
                      // Plain text or strip HTML for display
                      const plainText = messageContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
                      return (
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 2,
                            bgcolor: 'background.paper',
                            maxHeight: '500px',
                            overflow: 'auto',
                          }}
                        >
                          {plainText || 'No content'}
                        </Typography>
                      );
                    }
                  })()}
                </Box>

                {/* Additional Details */}
                <Divider />
                <Stack spacing={1}>
                  {selectedMessage.providerMessageId && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Provider Message ID
                      </Typography>
                      <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">
                        {selectedMessage.providerMessageId}
                      </Typography>
                    </Box>
                  )}
                  {selectedMessage.failureReason && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Failure Reason
                      </Typography>
                      <Typography variant="body2" color="error">
                        {selectedMessage.failureReason}
                      </Typography>
                    </Box>
                  )}
                  {selectedMessage.language && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Language
                      </Typography>
                      <Typography variant="body2">{selectedMessage.language.toUpperCase()}</Typography>
                    </Box>
                  )}
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => {
                setMessageModalOpen(false);
                setSelectedMessage(null);
              }}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default MessagesTab;

