import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  NotificationsOff as NotificationsOffIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Schedule as ScheduleIcon,
  Event as EventIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface CalendarWebhookStatus {
  active: boolean;
  watchId?: string;
  expiration?: string;
  lastSync?: string;
  eventsProcessed?: number;
  contactsMatched?: number;
  error?: string;
}

interface CalendarWebhookManagerProps {
  tenantId: string;
}

const CalendarWebhookManager: React.FC<CalendarWebhookManagerProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  const [status, setStatus] = useState<CalendarWebhookStatus>({ active: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Firebase Functions
  const getWebhookStatusFn = httpsCallable(functions, 'getCalendarWebhookStatus');
  const setupWebhookFn = httpsCallable(functions, 'setupCalendarWatch');
  const stopWebhookFn = httpsCallable(functions, 'stopCalendarWatch');
  const refreshWebhookFn = httpsCallable(functions, 'refreshCalendarWatch');

  // Load webhook status
  const loadWebhookStatus = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      const result = await getWebhookStatusFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.success) {
        setStatus(data.status);
      } else {
        setStatus({ active: false });
      }
    } catch (error: any) {
      console.error('Error loading webhook status:', error);
      setError('Failed to load webhook status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWebhookStatus();
  }, [user?.uid, tenantId]);

  // Set up calendar webhook
  const setupWebhook = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const result = await setupWebhookFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess('Calendar webhook set up successfully! You will now receive notifications when prospects schedule meetings.');
        setStatus({
          active: true,
          watchId: data.watchId,
          expiration: data.expiration
        });
      } else {
        setError(data.error || 'Failed to set up calendar webhook');
      }
    } catch (error: any) {
      console.error('Error setting up webhook:', error);
      setError('Failed to set up calendar webhook');
    } finally {
      setLoading(false);
    }
  };

  // Stop calendar webhook
  const stopWebhook = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const result = await stopWebhookFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess('Calendar webhook stopped successfully');
        setStatus({ active: false });
      } else {
        setError(data.error || 'Failed to stop calendar webhook');
      }
    } catch (error: any) {
      console.error('Error stopping webhook:', error);
      setError('Failed to stop calendar webhook');
    } finally {
      setLoading(false);
    }
  };

  // Refresh calendar webhook
  const refreshWebhook = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const result = await refreshWebhookFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess('Calendar webhook refreshed successfully');
        setStatus({
          active: true,
          watchId: data.watchId,
          expiration: data.expiration
        });
      } else {
        setError(data.error || 'Failed to refresh calendar webhook');
      }
    } catch (error: any) {
      console.error('Error refreshing webhook:', error);
      setError('Failed to refresh calendar webhook');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (status.active) {
      return <CheckCircleIcon color="success" />;
    } else if (status.error) {
      return <ErrorIcon color="error" />;
    } else {
      return <WarningIcon color="warning" />;
    }
  };

  const getStatusColor = () => {
    if (status.active) return 'success';
    if (status.error) return 'error';
    return 'warning';
  };

  const formatExpiration = (expiration: string) => {
    if (!expiration) return 'Unknown';
    const date = new Date(expiration);
    return date.toLocaleString();
  };

  const isExpiringSoon = (expiration: string) => {
    if (!expiration) return false;
    const expirationDate = new Date(expiration);
    const now = new Date();
    const hoursUntilExpiration = (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilExpiration < 24; // Less than 24 hours
  };

  return (
    <Card>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NotificationsIcon color="primary" />
            <Typography variant="h6">Calendar Webhooks</Typography>
          </Box>
        }
        subheader="Receive real-time notifications when prospects schedule meetings"
      />
      <CardContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {/* Status Overview */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            {getStatusIcon()}
            <Typography variant="h6">
              Status: {status.active ? 'Active' : 'Inactive'}
            </Typography>
            <Chip 
              label={status.active ? 'Monitoring' : 'Not Monitoring'} 
              color={getStatusColor() as any}
              size="small"
            />
          </Box>

          {status.active && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {status.watchId && (
                <Typography variant="body2" color="text.secondary">
                  Watch ID: {status.watchId}
                </Typography>
              )}
              {status.expiration && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Expires: {formatExpiration(status.expiration)}
                  </Typography>
                  {isExpiringSoon(status.expiration) && (
                    <Chip 
                      label="Expiring Soon" 
                      color="warning" 
                      size="small"
                      icon={<WarningIcon />}
                    />
                  )}
                </Box>
              )}
              {status.lastSync && (
                <Typography variant="body2" color="text.secondary">
                  Last Sync: {new Date(status.lastSync).toLocaleString()}
                </Typography>
              )}
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Controls */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          {!status.active ? (
            <Button
              variant="contained"
              startIcon={<NotificationsIcon />}
              onClick={setupWebhook}
              disabled={loading}
            >
              {loading ? <CircularProgress size={20} /> : 'Enable Webhooks'}
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                startIcon={<NotificationsOffIcon />}
                onClick={stopWebhook}
                disabled={loading}
                color="error"
              >
                {loading ? <CircularProgress size={20} /> : 'Disable Webhooks'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={refreshWebhook}
                disabled={loading}
              >
                {loading ? <CircularProgress size={20} /> : 'Refresh'}
              </Button>
            </>
          )}
        </Box>

        {/* Features List */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
            What happens when webhooks are enabled:
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon>
                <EventIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary="Real-time meeting notifications"
                secondary="Get notified instantly when prospects schedule meetings"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon>
                <InfoIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary="Automatic contact matching"
                secondary="Automatically link meeting attendees to your CRM contacts"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon>
                <ScheduleIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary="CRM activity creation"
                secondary="Create CRM activities from external calendar events"
              />
            </ListItem>
          </List>
        </Box>

        {/* Statistics */}
        {status.active && (status.eventsProcessed || status.contactsMatched) && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              Statistics:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              {status.eventsProcessed !== undefined && (
                <Chip 
                  label={`${status.eventsProcessed} events processed`}
                  variant="outlined"
                  size="small"
                />
              )}
              {status.contactsMatched !== undefined && (
                <Chip 
                  label={`${status.contactsMatched} contacts matched`}
                  variant="outlined"
                  size="small"
                />
              )}
            </Box>
          </Box>
        )}

        {/* Error Display */}
        {status.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            <Typography variant="body2">
              Error: {status.error}
            </Typography>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default CalendarWebhookManager;
