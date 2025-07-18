import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Avatar,
  IconButton,
  Alert,
  Snackbar,
  CircularProgress,
  useTheme,
  useMediaQuery,
  Paper,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  Reply as ReplyIcon,
  Close as CloseIcon,
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';

interface BroadcastNotification {
  id: string;
  broadcastId: string;
  message: string;
  status: 'unread' | 'read' | 'replied';
  createdAt: Date;
  readAt?: Date;
  repliedAt?: Date;
  aiAssistReplies: boolean;
  escalationEmail?: string;
}

interface BroadcastReply {
  id: string;
  reply: string;
  aiResponse?: string;
  escalated: boolean;
  escalationReason?: string;
  timestamp: Date;
}

interface BroadcastNotificationProps {
  workerId: string;
  tenantId: string;
  onNotificationCountChange?: (count: number) => void;
}

const BroadcastNotification: React.FC<BroadcastNotificationProps> = ({
  workerId,
  tenantId,
  onNotificationCountChange,
}) => {
  const [notifications, setNotifications] = useState<BroadcastNotification[]>([]);
  const [replies, setReplies] = useState<BroadcastReply[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showReplyDialog, setShowReplyDialog] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<BroadcastNotification | null>(
    null,
  );
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as any,
  });

  const functions = getFunctions();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    loadNotifications();
    loadReplies();
  }, [workerId, tenantId]);

  useEffect(() => {
    if (onNotificationCountChange) {
      const unreadCount = notifications.filter((n) => n.status === 'unread').length;
      onNotificationCountChange(unreadCount);
    }
  }, [notifications, onNotificationCountChange]);

  const loadNotifications = async () => {
    try {
      // Load notifications from Firestore
      // This would be implemented with a real-time listener
      setNotifications([]);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const loadReplies = async () => {
    try {
      // Load replies from Firestore
      setReplies([]);
    } catch (error) {
      console.error('Failed to load replies:', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const markRead = httpsCallable(functions, 'markBroadcastRead');
      await markRead({ notificationId, workerId });

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, status: 'read' as const, readAt: new Date() } : n,
        ),
      );
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleReply = async () => {
    if (!selectedNotification || !replyText.trim()) return;

    setIsLoading(true);
    try {
      const replyToBroadcast = httpsCallable(functions, 'replyToBroadcast');
      const result = await replyToBroadcast({
        notificationId: selectedNotification.id,
        workerId,
        reply: replyText,
        broadcastId: selectedNotification.broadcastId,
      });

      const { aiResponse, escalated, escalationReason } = result.data as any;

      // Add reply to local state
      const newReply: BroadcastReply = {
        id: Date.now().toString(),
        reply: replyText,
        aiResponse,
        escalated,
        escalationReason,
        timestamp: new Date(),
      };

      setReplies((prev) => [...prev, newReply]);

      // Update notification status
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === selectedNotification.id
            ? { ...n, status: 'replied' as const, repliedAt: new Date() }
            : n,
        ),
      );

      setShowReplyDialog(false);
      setSelectedNotification(null);
      setReplyText('');

      setSnackbar({
        open: true,
        message: escalated
          ? 'Your reply has been escalated to HR for further assistance.'
          : 'Reply sent successfully!',
        severity: escalated ? 'warning' : 'success',
      });
    } catch (error) {
      console.error('Failed to send reply:', error);
      setSnackbar({
        open: true,
        message: 'Failed to send reply. Please try again.',
        severity: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openReplyDialog = (notification: BroadcastNotification) => {
    setSelectedNotification(notification);
    setShowReplyDialog(true);
    markAsRead(notification.id);
  };

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  return (
    <>
      {/* Notification Bell */}
      <IconButton
        color="inherit"
        onClick={() => setShowNotifications(true)}
        sx={{ position: 'relative' }}
      >
        <NotificationsIcon />
        {unreadCount > 0 && (
          <Box
            sx={{
              position: 'absolute',
              top: -5,
              right: -5,
              bgcolor: 'error.main',
              color: 'white',
              borderRadius: '50%',
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Box>
        )}
      </IconButton>

      {/* Notifications Dialog */}
      <Dialog
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Company Messages ({notifications.length})</Typography>
            <IconButton onClick={() => setShowNotifications(false)}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {notifications.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <NotificationsIcon sx={{ fontSize: 64, color: 'grey.400', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No Messages
              </Typography>
              <Typography variant="body2" color="text.secondary">
                You'll see company announcements and updates here.
              </Typography>
            </Box>
          ) : (
            <List>
              {notifications.map((notification) => (
                <ListItem
                  key={notification.id}
                  divider
                  sx={{
                    bgcolor: notification.status === 'unread' ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    mb: 1,
                  }}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.main' }}>
                      <NotificationsIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ flex: 1, mr: 2 }}>
                          Company Message
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          {notification.status === 'unread' && (
                            <Chip label="New" size="small" color="primary" />
                          )}
                          {notification.status === 'replied' && (
                            <Chip label="Replied" size="small" color="success" />
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {new Date(notification.createdAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          {notification.message}
                        </Typography>
                        {notification.aiAssistReplies && (
                          <Typography variant="caption" color="text.secondary">
                            💬 AI can help with replies
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  {notification.aiAssistReplies && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ReplyIcon />}
                      onClick={() => openReplyDialog(notification)}
                    >
                      Reply
                    </Button>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>

      {/* Reply Dialog */}
      <Dialog
        open={showReplyDialog}
        onClose={() => setShowReplyDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReplyIcon />
            <Typography>Reply to Message</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedNotification && (
            <>
              <Paper sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Original Message:
                </Typography>
                <Typography variant="body2">{selectedNotification.message}</Typography>
              </Paper>

              <TextField
                fullWidth
                multiline
                rows={4}
                label="Your Reply"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply here..."
                disabled={isLoading}
              />

              {selectedNotification.aiAssistReplies && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    AI will help respond to your message. If your question is complex, it will be
                    escalated to HR.
                  </Typography>
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowReplyDialog(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleReply}
            variant="contained"
            disabled={!replyText.trim() || isLoading}
            startIcon={isLoading ? <CircularProgress size={16} /> : <SendIcon />}
          >
            Send Reply
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default BroadcastNotification;
