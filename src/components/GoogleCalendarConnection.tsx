import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  CalendarToday as CalendarIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';

interface GoogleCalendarConnectionProps {
  tenantId: string;
  onConnectionChange?: (isConnected: boolean) => void;
}

const GoogleCalendarConnection: React.FC<GoogleCalendarConnectionProps> = ({
  tenantId,
  onConnectionChange
}) => {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const functions = getFunctions();
  const getCalendarStatus = httpsCallable(functions, 'getCalendarStatus');
  const getCalendarAuthUrl = httpsCallable(functions, 'getCalendarAuthUrl');
  const disconnectCalendar = httpsCallable(functions, 'disconnectCalendar');

  useEffect(() => {
    checkConnectionStatus();
  }, [user]);

  const checkConnectionStatus = async () => {
    if (!user?.uid) return;

    try {
      setLoading(true);
      setError(null);

      const result = await getCalendarStatus({ userId: user.uid });
      const data = result.data as any;
      const connected = Boolean((data && (data.connected ?? data.isConnected)));
      setIsConnected(connected);
      onConnectionChange?.(connected);
    } catch (err) {
      console.error('Error checking calendar status:', err);
      setError('Failed to check calendar connection status');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!user?.uid) return;

    try {
      setConnecting(true);
      setError(null);

      const result = await getCalendarAuthUrl({ 
        userId: user.uid, 
        tenantId 
      });
      const data = result.data as any;
      
      setAuthUrl(data.authUrl);
      setShowAuthDialog(true);
    } catch (err) {
      console.error('Error getting auth URL:', err);
      setError('Failed to get authentication URL');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user?.uid) return;

    try {
      setConnecting(true);
      setError(null);

      await disconnectCalendar({ userId: user.uid });
      
      setIsConnected(false);
      onConnectionChange?.(false);
    } catch (err) {
      console.error('Error disconnecting calendar:', err);
      setError('Failed to disconnect calendar');
    } finally {
      setConnecting(false);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthDialog(false);
    setAuthUrl(null);
    checkConnectionStatus();
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" gap={2}>
            <CircularProgress size={20} />
            <Typography>Checking calendar connection...</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={2}>
              <CalendarIcon color="primary" />
              <Box>
                <Typography variant="h6" gutterBottom>
                  Google Calendar Integration
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {isConnected 
                    ? 'Connected to Google Calendar. Appointments will automatically sync.'
                    : 'Connect your Google Calendar to sync appointments automatically.'
                  }
                </Typography>
              </Box>
            </Box>

            <Box display="flex" alignItems="center" gap={1}>
              {isConnected ? (
                <>
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Connected"
                    color="success"
                    size="small"
                  />
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={handleDisconnect}
                    disabled={connecting}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  startIcon={<CalendarIcon />}
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting...' : 'Connect Calendar'}
                </Button>
              )}
            </Box>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Auth Dialog */}
      <Dialog 
        open={showAuthDialog} 
        onClose={() => setShowAuthDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Connect Google Calendar
        </DialogTitle>
        <DialogContent>
          <Typography paragraph>
            To sync your appointments with Google Calendar, you need to authorize access to your Google account.
          </Typography>
          
          {authUrl && (
            <Box textAlign="center" py={2}>
              <Button
                variant="contained"
                color="primary"
                size="large"
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<CalendarIcon />}
              >
                Authorize Google Calendar Access
              </Button>
            </Box>
          )}

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              After authorizing, you'll be redirected back to the application. 
              The connection will be established automatically.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAuthDialog(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleAuthSuccess}
            variant="contained"
          >
            I've Authorized
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GoogleCalendarConnection;
