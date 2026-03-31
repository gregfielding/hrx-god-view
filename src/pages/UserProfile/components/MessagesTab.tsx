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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import NotificationsIcon from '@mui/icons-material/Notifications';
import ReplyIcon from '@mui/icons-material/Reply';
import { collection, query, where, orderBy, limit, getDocs, Timestamp, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import ReplyDrawer from '../../../components/ReplyDrawer';
import EmailThreadView from '../../../components/EmailThreadView';
import EmailBodyRenderer from '../../../components/common/EmailBodyRenderer';

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
  /** Set on newer outbound logs (orchestrator). */
  recipientPhoneE164?: string;
  recipientEmail?: string;
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

export interface ProfileUpdateReminderControls {
  sending: boolean;
  lastSentAt: Date | null;
  error: string | null;
  onSend: () => void;
}

interface MessagesTabProps {
  uid: string;
  tenantId?: string;
  /** Bumps when outbound messages should be re-fetched (e.g. after profile reminder SMS). */
  messageHistoryRefreshTrigger?: number;
  profileUpdateReminder?: ProfileUpdateReminderControls;
}

const resendPayrollOnboardingInviteCallable = httpsCallable<
  {
    tenantId: string;
    userId: string;
    entityId: string;
    assignmentId?: string | null;
    contextLabel?: string | null;
  },
  { ok: boolean; messageLogId?: string | null; correlationKey?: string }
>(functions, 'resendPayrollOnboardingInvite');

function isPayrollInviteOutbound(log: MessageLog): boolean {
  return log.direction === 'outbound' && log.messageTypeId === 'payroll_onboarding_invite_needed';
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

const MessagesTab: React.FC<MessagesTabProps> = ({
  uid,
  tenantId,
  messageHistoryRefreshTrigger = 0,
  profileUpdateReminder,
}) => {
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
  /** Fallback when older messageLogs lack recipient fields. */
  const [profileContact, setProfileContact] = useState<{
    email?: string;
    phoneE164?: string;
    phone?: string;
  }>({});

  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [emailThreadPage, setEmailThreadPage] = useState(0);
  const [emailThreadRowsPerPage, setEmailThreadRowsPerPage] = useState(25);
  const [internalHistoryRefresh, setInternalHistoryRefresh] = useState(0);
  const [employmentEntities, setEmploymentEntities] = useState<{ entityId: string; label: string }[]>([]);
  const [payrollResendDialogOpen, setPayrollResendDialogOpen] = useState(false);
  const [payrollResendPick, setPayrollResendPick] = useState('');
  const [payrollResendBusy, setPayrollResendBusy] = useState(false);

  const effectiveTenantId = tenantId || activeTenant?.id;

  useEffect(() => {
    if (!uid) {
      setProfileContact({});
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        const d = snap.data();
        if (!d) {
          setProfileContact({});
          return;
        }
        setProfileContact({
          email: typeof d.email === 'string' ? d.email : undefined,
          phoneE164: typeof d.phoneE164 === 'string' ? d.phoneE164 : undefined,
          phone: typeof d.phone === 'string' ? d.phone : undefined,
        });
      } catch {
        setProfileContact({});
      }
    })();
  }, [uid]);

  useEffect(() => {
    if (!uid || !effectiveTenantId) {
      setEmploymentEntities([]);
      return;
    }
    (async () => {
      try {
        const empQ = query(
          collection(db, 'tenants', effectiveTenantId, 'entity_employments'),
          where('userId', '==', uid)
        );
        const snap = await getDocs(empQ);
        const rows = snap.docs
          .map((d) => {
            const x = d.data();
            const entityId = String(x.entityId || '').trim();
            const label = String(x.entityName || x.entityId || 'Hiring entity').trim();
            return entityId ? { entityId, label } : null;
          })
          .filter((r): r is { entityId: string; label: string } => r !== null);
        const byId = new Map<string, string>();
        rows.forEach((r) => {
          if (!byId.has(r.entityId)) byId.set(r.entityId, r.label);
        });
        setEmploymentEntities(
          [...byId.entries()].map(([entityId, label]) => ({ entityId, label }))
        );
      } catch {
        setEmploymentEntities([]);
      }
    })();
  }, [uid, effectiveTenantId]);

  useEffect(() => {
    if (!uid || !effectiveTenantId) return;
    
    if (activeTab === 'threads') {
      loadSmsThreads();
    } else if (activeTab === 'emailThreads') {
      loadEmailThreads();
    } else {
      loadMessageHistory();
    }
  }, [uid, effectiveTenantId, activeTab, messageHistoryRefreshTrigger, internalHistoryRefresh]);
  
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

  const executePayrollResend = async (entityId: string) => {
    if (!effectiveTenantId || !uid || !entityId) return;
    setPayrollResendBusy(true);
    setError(null);
    try {
      await resendPayrollOnboardingInviteCallable({
        tenantId: effectiveTenantId,
        userId: uid,
        entityId,
        contextLabel: 'your payroll onboarding',
      });
      setPayrollResendDialogOpen(false);
      setInternalHistoryRefresh((n) => n + 1);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message || 'Could not resend payroll invite');
    } finally {
      setPayrollResendBusy(false);
    }
  };

  const beginPayrollResendFromRow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (employmentEntities.length === 0) {
      setError(
        'No employment row found for this worker in this tenant. Open Employment and start or confirm a relationship before resending.'
      );
      return;
    }
    if (employmentEntities.length === 1) {
      void executePayrollResend(employmentEntities[0].entityId);
      return;
    }
    setPayrollResendPick(employmentEntities[0]?.entityId || '');
    setPayrollResendDialogOpen(true);
  };

  const handlePayrollResendEntityChange = (ev: SelectChangeEvent<string>) => {
    setPayrollResendPick(ev.target.value);
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

  const profileReminderSection =
    profileUpdateReminder != null ? (
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={profileUpdateReminder.onSend}
          disabled={profileUpdateReminder.sending}
          sx={{
            textTransform: 'none',
            alignSelf: 'flex-start',
            borderRadius: '999px',
            fontWeight: 500,
            minWidth: 'auto',
            px: 1.5,
            py: 0.5,
            fontSize: '0.8125rem',
          }}
        >
          {profileUpdateReminder.sending ? 'Sending...' : 'Profile Update Reminder'}
        </Button>
        {profileUpdateReminder.error ? (
          <Typography sx={{ fontSize: '0.65rem', lineHeight: 1.35, color: 'error.main', maxWidth: 560 }}>
            {profileUpdateReminder.error}
          </Typography>
        ) : profileUpdateReminder.lastSentAt ? (
          <Typography sx={{ fontSize: '0.65rem', lineHeight: 1.35, color: 'text.secondary' }}>
            Sent {profileUpdateReminder.lastSentAt.toLocaleString()}
          </Typography>
        ) : null}
      </Stack>
    ) : null;
  
  if (loading && allMessageLogs.length === 0 && smsThreads.length === 0) {
    return (
      <Box sx={{ px: 3, py: 4 }}>
        {profileReminderSection}
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 3, py: 4 }}>
      {profileReminderSection}
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Messages
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
        View message history and SMS conversations. For payroll onboarding invites, use Resend on the row to repeat the
        same message type and channel rules (timeline updates appear under Employment after send).
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
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedMessages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
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
                      <TableCell
                        align="right"
                        onClick={(ev) => ev.stopPropagation()}
                        sx={{ verticalAlign: 'middle' }}
                      >
                        {isPayrollInviteOutbound(log) ? (
                          <Button
                            size="small"
                            variant="text"
                            disabled={payrollResendBusy}
                            onClick={beginPayrollResendFromRow}
                            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                          >
                            Resend invite
                          </Button>
                        ) : null}
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

      <Dialog
        open={payrollResendDialogOpen}
        onClose={() => !payrollResendBusy && setPayrollResendDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Resend payroll invite</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This worker has more than one hiring entity. Choose which entity’s payroll onboarding link and automation
            rules to use. The same message type and channels apply as the original automation.
          </Typography>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel id="payroll-resend-entity-label">Hiring entity</InputLabel>
            <Select
              labelId="payroll-resend-entity-label"
              label="Hiring entity"
              value={payrollResendPick}
              onChange={handlePayrollResendEntityChange}
            >
              {employmentEntities.map((e) => (
                <MenuItem key={e.entityId} value={e.entityId}>
                  {e.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayrollResendDialogOpen(false)} disabled={payrollResendBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={payrollResendBusy || !payrollResendPick}
            onClick={() => void executePayrollResend(payrollResendPick)}
          >
            {payrollResendBusy ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>

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

                {selectedMessage.direction === 'outbound' &&
                  (selectedMessage.channel === 'sms' || selectedMessage.channel === 'email') && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        {selectedMessage.channel === 'sms' ? 'Sent to (phone)' : 'Sent to (email)'}
                      </Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                        {selectedMessage.channel === 'sms'
                          ? selectedMessage.recipientPhoneE164 ||
                            profileContact.phoneE164 ||
                            profileContact.phone ||
                            '—'
                          : selectedMessage.recipientEmail || profileContact.email || '—'}
                      </Typography>
                      {selectedMessage.channel === 'sms' &&
                        !selectedMessage.recipientPhoneE164 &&
                        (profileContact.phoneE164 || profileContact.phone) && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            From user profile (not stored on this log entry).
                          </Typography>
                        )}
                      {selectedMessage.channel === 'email' &&
                        !selectedMessage.recipientEmail &&
                        profileContact.email && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            From user profile (not stored on this log entry).
                          </Typography>
                        )}
                    </Box>
                  )}

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
                            // Single scrollbar container with thin, light scrollbar per spec
                            maxHeight: '500px',
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            // Thin, light scrollbar styling per spec
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
                            // Firefox scrollbar styling
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
                          }}
                        >
                          <EmailBodyRenderer
                            html={messageContent}
                          />
                        </Box>
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

