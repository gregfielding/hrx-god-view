/**
 * Reply Drawer Component
 * 
 * Drawer for replying to SMS threads.
 * Similar to MessageDrawer but specifically for threaded conversations.
 */

import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Avatar,
  Divider,
  Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import SmsIcon from '@mui/icons-material/Sms';
import { useAuth } from '../contexts/AuthContext';

interface ReplyDrawerProps {
  open: boolean;
  onClose: () => void;
  threadId: string;
  tenantId: string;
  candidateUserId: string;
  onReplySent?: () => void;
}

interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  fromType: 'candidate' | 'recruiter' | 'system';
  fromUserId?: string;
  body: string;
  status: string;
  createdAt: string;
}

interface ThreadDetails {
  id: string;
  candidateId: string;
  candidateName: string;
  candidatePhoneMasked: string;
  twilioNumber: string;
  status: string;
  messages: ThreadMessage[];
}

const ReplyDrawer: React.FC<ReplyDrawerProps> = ({
  open,
  onClose,
  threadId,
  tenantId,
  candidateUserId,
  onReplySent,
}) => {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [threadDetails, setThreadDetails] = useState<ThreadDetails | null>(null);

  useEffect(() => {
    if (open && threadId) {
      loadThreadDetails();
      setMessage('');
      setError(null);
      setSuccess(false);
    }
  }, [open, threadId]);

  const loadThreadDetails = async () => {
    setLoadingThread(true);
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL || 
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';
      
      const response = await fetch(
        `${API_BASE_URL}/getThreadApi?threadId=${encodeURIComponent(threadId)}&limit=50`
      );
      
      if (!response.ok) {
        throw new Error('Failed to load thread');
      }
      
      const data = await response.json();
      if (data.success) {
        setThreadDetails({
          id: data.thread.id,
          candidateId: data.thread.candidateId,
          candidateName: data.thread.candidateName,
          candidatePhoneMasked: data.thread.candidatePhoneMasked,
          twilioNumber: data.thread.twilioNumber,
          status: data.thread.status,
          messages: data.messages || [],
        });
      }
    } catch (err: any) {
      console.error('Error loading thread:', err);
      setError(err.message || 'Failed to load thread');
    } finally {
      setLoadingThread(false);
    }
  };

  const handleSend = async () => {
    if (!message.trim()) {
      setError('Message cannot be empty');
      return;
    }

    if (message.length > 1600) {
      setError('Message is too long (max 1600 characters)');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL || 
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';
      
      const response = await fetch(
        `${API_BASE_URL}/sendThreadMessageApi?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: message,
            recruiterId: user?.uid,
            fromUserId: user?.uid,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'Failed to send message' } }));
        throw new Error(errorData.error?.message || 'Failed to send message');
      }

      const result = await response.json();
      
      if (result.success) {
        setSuccess(true);
        setMessage('');
        // Reload thread to show new message
        await loadThreadDetails();
        if (onReplySent) {
          onReplySent();
        }
        // Auto-close after 2 seconds
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(result.warning || 'Failed to send message');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '600px', lg: '700px' },
          maxWidth: { xs: '100%', sm: '100%', md: '600px', lg: '700px' },
          minWidth: { xs: '100%', sm: '100%', md: '600px', lg: '700px' },
          boxSizing: 'border-box',
        },
      }}
      ModalProps={{
        keepMounted: false,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Box sx={{ p: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SmsIcon color="primary" />
              <Typography variant="h6" component="h2">
                SMS Conversation
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          {threadDetails && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {threadDetails.candidateName} • {threadDetails.candidatePhoneMasked}
            </Typography>
          )}
        </Box>

        {/* Messages */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 3, bgcolor: 'grey.50' }}>
          {loadingThread ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : threadDetails && threadDetails.messages.length > 0 ? (
            <Stack spacing={2}>
              {threadDetails.messages
                .slice()
                .reverse()
                .map((msg) => (
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
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
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
                        {formatDate(msg.createdAt)}
                        {msg.status && ` • ${msg.status}`}
                      </Typography>
                    </Paper>
                  </Box>
                ))}
            </Stack>
          ) : (
            <Box sx={{ textAlign: 'center', p: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No messages in this thread
              </Typography>
            </Box>
          )}
        </Box>

        <Divider />

        {/* Reply Input */}
        <Box sx={{ p: 3, borderTop: 1, borderColor: 'divider' }}>
          <Stack spacing={2}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success">Message sent successfully</Alert>
            )}
            
            <TextField
              label="Reply"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder="Type your reply..."
              helperText={`${message.length}/1600 characters`}
              disabled={loading}
            />
            
            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleSend}
                disabled={loading || !message.trim()}
                startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
              >
                {loading ? 'Sending...' : 'Send Reply'}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
};

export default ReplyDrawer;

