/**
 * Text Messages Page
 * 
 * Dedicated SMS thread-based messenger interface.
 * Per decoupling spec: SMS-only, separate from inbox.
 */

import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import SmsIcon from '@mui/icons-material/Sms';
import ReplyIcon from '@mui/icons-material/Reply';
import CloseIcon from '@mui/icons-material/Close';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, doc, getDoc } from 'firebase/firestore';
import ReplyDrawer from '../components/ReplyDrawer';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface SmsThread {
  id: string;
  tenantId: string;
  candidateId: string;
  candidateName: string;
  candidatePhoneMasked: string;
  twilioNumber: string;
  status: string;
  lastMessageAt: any;
  lastMessageSnippet?: string;
}

const TextMessagesPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || '';
  const [smsThreads, setSmsThreads] = useState<SmsThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<SmsThread | null>(null);
  const [replyDrawerOpen, setReplyDrawerOpen] = useState(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean | null>(null);
  const [availableTwilioNumbers, setAvailableTwilioNumbers] = useState<Array<{ phoneNumber: string; sid: string; friendlyName: string }>>([]);
  const [showNumberSelection, setShowNumberSelection] = useState(false);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);

  const formatDate = (date: any): string => {
    if (!date) return 'Unknown';
    const d = date?.toDate?.() || (date instanceof Date ? date : new Date(date));
    return d.toLocaleString();
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

  // Load SMS threads
  const loadSmsThreads = async () => {
    if (!user?.uid || !effectiveTenantId) return;

    setLoading(true);
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';
      
      const params = new URLSearchParams({
        tenantId: effectiveTenantId,
        candidateId: user.uid,
        limit: '50',
      });

      const response = await fetch(
        `${API_BASE_URL}/listThreadsApi?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 503 && errorData.error?.code === 'INDEX_BUILDING') {
          setError('Database index is building. Please try again in a few minutes.');
        } else {
          throw new Error(errorData.error?.message || 'Failed to load SMS threads');
        }
        return;
      }

      const data = await response.json();
      if (data.success) {
        setSmsThreads(data.threads || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load SMS threads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSmsThreads();
  }, [user?.uid, effectiveTenantId]);

  const handleReply = (thread: SmsThread) => {
    setSelectedThread(thread);
    setReplyDrawerOpen(true);
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
        loadSmsThreads();
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
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2, mx: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
        {/* Show number selection panel if no Twilio number is assigned */}
        {showNumberSelection && hasTwilioNumber === false && (
          <Paper variant="outlined" sx={{ p: 4, mb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <SmsIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                Assign a Twilio Number
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400 }}>
                You need a Twilio number to send and receive SMS messages. Please select an available number below.
              </Typography>
              
              {loadingTwilioNumbers ? (
                <CircularProgress />
              ) : availableTwilioNumbers.length > 0 ? (
                <Box sx={{ width: '100%', maxWidth: 500 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    Available Numbers:
                  </Typography>
                  <Stack spacing={1}>
                    {availableTwilioNumbers.map((number) => (
                      <Button
                        key={number.sid}
                        variant="outlined"
                        fullWidth
                        onClick={() => handleAssignTwilioNumber(number.sid)}
                        sx={{ 
                          textTransform: 'none',
                          justifyContent: 'space-between',
                          py: 1.5
                        }}
                      >
                        <Box sx={{ textAlign: 'left' }}>
                          <Typography variant="body1" sx={{ fontWeight: 500 }}>
                            {number.phoneNumber}
                          </Typography>
                          {number.friendlyName !== number.phoneNumber && (
                            <Typography variant="caption" color="text.secondary">
                              {number.friendlyName}
                            </Typography>
                          )}
                        </Box>
                      </Button>
                    ))}
                  </Stack>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No available Twilio numbers found. Please contact your administrator.
                </Typography>
              )}
            </Box>
          </Paper>
        )}
        
        {hasTwilioNumber && (
          <>
            {smsThreads.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No SMS threads found
                </Typography>
              </Paper>
            ) : (
              <Stack spacing={2}>
                {smsThreads.map((thread) => (
                  <Paper 
                    key={thread.id} 
                    variant="outlined" 
                    sx={{ 
                      p: 2,
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                    }}
                    onClick={() => handleReply(thread)}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                          <SmsIcon fontSize="small" color="primary" />
                          <Typography variant="subtitle2" fontWeight={600}>
                            {thread.candidateName || 'Unknown'}
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
                        startIcon={<ReplyIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReply(thread);
                        }}
                      >
                        Reply
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </>
        )}
      </Box>

      {selectedThread && (
        <ReplyDrawer
          open={replyDrawerOpen}
          onClose={() => {
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
          threadId={selectedThread.id}
          tenantId={effectiveTenantId || ''}
          candidateUserId={user?.uid || ''}
          onReplySent={() => {
            loadSmsThreads();
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
        />
      )}
    </Box>
  );
};

export default TextMessagesPage;


