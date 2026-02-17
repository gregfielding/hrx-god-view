/**
 * Text Messages Page
 * 
 * Dedicated SMS thread-based messenger interface with inbox view.
 * Shows thread list and messages with real-time updates.
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
  Divider,
  TextField,
  Avatar,
  useTheme,
  useMediaQuery,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
} from '@mui/material';
import SmsIcon from '@mui/icons-material/Sms';
import ReplyIcon from '@mui/icons-material/Reply';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, doc, getDoc, onSnapshot, query, orderBy, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useSmsThreadMessages } from '../hooks/useSmsThreadMessages';
import { formatDistanceToNow, format } from 'date-fns';

interface SmsThread {
  id: string;
  tenantId: string;
  candidateUserId?: string;
  candidatePhone?: string;
  primaryRecruiterUserId?: string | null;
  assignedToUserId?: string;
  twilioNumber: string;
  status: string;
  lastMessageAt: any;
  lastMessageSnippet?: string;
  lastInboundAt?: any;
  lastOutboundAt?: any;
  participant?: {
    id: string;
    displayName?: string;
    phoneE164?: string;
  };
}

const TextMessagesPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const effectiveTenantId = activeTenant?.id || '';
  const [smsThreads, setSmsThreads] = useState<SmsThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean | null>(null);
  const [availableTwilioNumbers, setAvailableTwilioNumbers] = useState<Array<{ phoneNumber: string; sid: string; friendlyName: string }>>([]);
  const [showNumberSelection, setShowNumberSelection] = useState(false);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedThread = smsThreads.find(t => t.id === selectedThreadId);

  // Real-time messages for selected thread
  const { messages, loading: loadingMessages } = useSmsThreadMessages({
    tenantId: effectiveTenantId,
    threadId: selectedThreadId || '',
    enabled: !!selectedThreadId && !!effectiveTenantId,
  });

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

  // Helper to get display name for a thread
  const getThreadDisplayName = (thread: SmsThread): string => {
    if (thread.participant?.displayName) {
      return thread.participant.displayName;
    }
    // Fallback: try to get from candidateUserId if participant is missing
    if (thread.candidateUserId) {
      // For now, return a placeholder - could fetch user data if needed
      return thread.candidatePhone ? `+${thread.candidatePhone.slice(-4)}` : 'Unknown';
    }
    return 'Unknown';
  };

  // Helper to get phone number for display
  const getThreadPhone = (thread: SmsThread): string => {
    return thread.participant?.phoneE164 || thread.candidatePhone || '';
  };

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

  // Real-time SMS threads listener
  useEffect(() => {
    if (!user?.uid || !effectiveTenantId) {
      setSmsThreads([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const threadsRef = collection(db, 'tenants', effectiveTenantId, 'smsThreads');
    // Query threads where this recruiter is the primary recruiter
    const threadsQuery = query(
      threadsRef,
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      threadsQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const threadsList: SmsThread[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Filter threads for this recruiter
          // Show threads where they are the primary recruiter OR assigned to them
          const isPrimaryRecruiter = data.primaryRecruiterUserId === user.uid;
          const isAssigned = data.assignedToUserId === user.uid;
          
          if (isPrimaryRecruiter || isAssigned) {
            // Ensure lastMessageAt exists (fallback to createdAt if missing)
            const threadData = {
              id: doc.id,
              ...data,
              lastMessageAt: data.lastMessageAt || data.createdAt || new Date(),
            } as SmsThread;
            threadsList.push(threadData);
          }
        });
        // Sort by lastMessageAt in case orderBy didn't work properly
        threadsList.sort((a, b) => {
          const aDate = a.lastMessageAt?.toDate?.() || (a.lastMessageAt instanceof Date ? a.lastMessageAt : new Date(a.lastMessageAt || 0));
          const bDate = b.lastMessageAt?.toDate?.() || (b.lastMessageAt instanceof Date ? b.lastMessageAt : new Date(b.lastMessageAt || 0));
          return bDate.getTime() - aDate.getTime();
        });
        setSmsThreads(threadsList);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to SMS threads:', err);
        // Check if it's an index error
        if (err.code === 'failed-precondition' || err.message?.includes('index')) {
          setError('Database index is building. Please try again in a few minutes.');
        } else {
          setError('Failed to load SMS threads');
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, effectiveTenantId]);

  /** Fetch with Firebase ID token for authenticated API calls */
  const authedFetch = async (url: string, init?: RequestInit) => {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error('Please sign in again.');
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(url, { ...init, headers });
  };

  const handleSendReply = async () => {
    if (!replyMessage.trim() || !selectedThreadId || !user?.uid) return;

    if (replyMessage.length > 1600) {
      setError('Message is too long (max 1600 characters)');
      return;
    }

    setSendingReply(true);
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL || 
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';
      
      const response = await authedFetch(
        `${API_BASE_URL}/sendThreadMessageApi?threadId=${encodeURIComponent(selectedThreadId)}`,
        {
          method: 'POST',
          body: JSON.stringify({ body: replyMessage }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'Failed to send message' } }));
        throw new Error(errorData.error?.message || 'Failed to send message');
      }

      setReplyMessage('');
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
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

  if (loading && smsThreads.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {error && (
        <Alert 
          severity="error" 
          sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 1300 }} 
          onClose={() => setError(null)}
        >
          {error}
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
            Text Messages
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

        {/* Thread List */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {smsThreads.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No SMS threads found
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {smsThreads.map((thread) => (
                <ListItem
                  key={thread.id}
                  disablePadding
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: selectedThreadId === thread.id ? 'action.selected' : 'transparent',
                  }}
                >
                  <ListItemButton
                    onClick={() => setSelectedThreadId(thread.id)}
                    selected={selectedThreadId === thread.id}
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
                            {getThreadDisplayName(thread)}
                          </Typography>
                          {thread.status === 'open' && (
                            <Chip label="Open" size="small" color="success" sx={{ height: 20 }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {thread.lastMessageSnippet || 'No messages'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(thread.lastMessageAt)}
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
      {selectedThread && !isMobile ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Message Header */}
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" fontWeight={600}>
              {getThreadDisplayName(selectedThread)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {getThreadPhone(selectedThread)}
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
                  No messages in this thread
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {messages.map((msg) => (
                  <Box
                    key={msg.id}
                    sx={{
                      display: 'flex',
                      justifyContent: msg.direction === 'outbound' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <Paper
                      elevation={1}
                      sx={{
                        p: 2,
                        maxWidth: '70%',
                        bgcolor: msg.direction === 'outbound' ? 'primary.main' : 'background.paper',
                        color: msg.direction === 'outbound' ? 'primary.contrastText' : 'text.primary',
                      }}
                    >
                      <Typography variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                        {msg.body}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          opacity: 0.7,
                          display: 'block',
                          textAlign: msg.direction === 'outbound' ? 'right' : 'left',
                        }}
                      >
                        {formatFullDate(msg.createdAt)}
                        {msg.status && ` • ${msg.status}`}
                      </Typography>
                    </Paper>
                  </Box>
                ))}
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
      ) : selectedThread && isMobile ? (
        <Drawer
          anchor="right"
          open={!!selectedThread}
          onClose={() => setSelectedThreadId(null)}
          PaperProps={{
            sx: { width: '100%' },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="h6" fontWeight={600}>
                  {getThreadDisplayName(selectedThread)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getThreadPhone(selectedThread)}
                </Typography>
              </Box>
              <IconButton onClick={() => setSelectedThreadId(null)}>
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
                    No messages in this thread
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {messages.map((msg) => (
                    <Box
                      key={msg.id}
                      sx={{
                        display: 'flex',
                        justifyContent: msg.direction === 'outbound' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Paper
                        elevation={1}
                        sx={{
                          p: 2,
                          maxWidth: '70%',
                          bgcolor: msg.direction === 'outbound' ? 'primary.main' : 'background.paper',
                          color: msg.direction === 'outbound' ? 'primary.contrastText' : 'text.primary',
                        }}
                      >
                        <Typography variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                          {msg.body}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            opacity: 0.7,
                            display: 'block',
                            textAlign: msg.direction === 'outbound' ? 'right' : 'left',
                          }}
                        >
                          {formatFullDate(msg.createdAt)}
                        </Typography>
                      </Paper>
                    </Box>
                  ))}
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
            Select a thread to view messages
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default TextMessagesPage;
