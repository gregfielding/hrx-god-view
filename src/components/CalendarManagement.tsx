import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Alert,
  Grid,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Event as EventIcon,
  Sync as SyncIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';

interface CalendarManagementProps {
  tenantId: string;
}

interface CalendarStatus {
  connected: boolean;
  email?: string;
  lastSync?: Date;
  syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  status?: string;
}

const CalendarManagement: React.FC<CalendarManagementProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  // State for Calendar status
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>({
    connected: false,
    syncStatus: 'not_synced'
  });
  
  // State for calendar events
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreateEventDialog, setShowCreateEventDialog] = useState(false);
  const [newEvent, setNewEvent] = useState({
    summary: '',
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    location: ''
  });

  // Firebase Functions
  const getCalendarStatusFn = httpsCallable(functions, 'getCalendarStatusOptimized');
  const getCalendarAuthUrlFn = httpsCallable(functions, 'getCalendarAuthUrl');
  const disconnectCalendarFn = httpsCallable(functions, 'disconnectCalendar');
  const listCalendarEventsFn = httpsCallable(functions, 'listCalendarEventsOptimized');
  const createCalendarEventFn = httpsCallable(functions, 'createCalendarEvent');

  // Load Calendar status (manual or after actions)
  const loadCalendarStatus = async () => {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const result = await getCalendarStatusFn({ userId: user.uid });
      const status = result.data as CalendarStatus;
      setCalendarStatus(status);
    } catch (error: any) {
      console.error('Error loading Calendar status:', error);
      setError(`Failed to load Calendar status: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load calendar events (manual or after status shows connected)
  const loadCalendarEvents = async () => {
    if (!user?.uid || !calendarStatus.connected) return;

    setLoading(true);
    try {
      const result = await listCalendarEventsFn({ 
        userId: user.uid,
        maxResults: 20
      });
      const data = result.data as any;

      if (data.success) {
        setEvents(data.events || []);
      }
    } catch (error: any) {
      console.error('Error loading calendar events:', error);
      setError(`Failed to load calendar events: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Remove automatic status polling; only fetch on explicit actions and initial mount
  useEffect(() => {
    if (user?.uid) {
      // Initial load ok
      loadCalendarStatus();
    }
  }, [user?.uid]);

  // When explicitly refreshed status indicates connection, fetch events once
  useEffect(() => {
    if (calendarStatus.connected) {
      loadCalendarEvents();
    }
  }, [calendarStatus.connected]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'synced':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'syncing':
        return <CircularProgress size={20} />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const handleCalendarAuth = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getCalendarAuthUrlFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to get Calendar auth URL');
        return;
      }
      
      const { authUrl } = data;
      
      if (!authUrl) {
        setError('No authentication URL received from server');
        return;
      }
      
      // Open Calendar OAuth URL in new window
      window.open(authUrl, '_blank', 'width=600,height=600');
      
      setSuccess('Google Calendar authentication initiated. Please complete the OAuth flow in the popup window.');
      
      // Refresh status after a delay to check if auth was completed
      setTimeout(() => {
        loadCalendarStatus();
      }, 5000);
      
    } catch (error: any) {
      console.error('Error getting Calendar auth URL:', error);
      setError(`Failed to initiate Calendar authentication: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await disconnectCalendarFn({ userId: user.uid });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to disconnect Calendar');
        return;
      }
      
      setSuccess('Google Calendar disconnected successfully');
      
      // Refresh status
      loadCalendarStatus();
      
    } catch (error: any) {
      console.error('Error disconnecting Calendar:', error);
      setError(`Failed to disconnect Calendar: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const startDateTime = new Date(`${newEvent.startDate}T${newEvent.startTime}`);
      const endDateTime = new Date(`${newEvent.endDate}T${newEvent.endTime}`);
      
      const eventData = {
        summary: newEvent.summary,
        description: newEvent.description,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        location: newEvent.location
      };

      const result = await createCalendarEventFn({ 
        userId: user.uid,
        eventData 
      });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess('Calendar event created successfully');
        setShowCreateEventDialog(false);
        setNewEvent({
          summary: '',
          description: '',
          startDate: '',
          startTime: '',
          endDate: '',
          endTime: '',
          location: ''
        });
        
        // Refresh events
        loadCalendarEvents();
      }
      
    } catch (error: any) {
      console.error('Error creating calendar event:', error);
      setError(`Failed to create calendar event: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const formatEventTime = (event: CalendarEvent) => {
    const start = event.start.dateTime || event.start.date;
    const end = event.end.dateTime || event.end.date;
    
    if (!start) return 'No time specified';
    
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    
    const startStr = startDate.toLocaleDateString() + ' ' + startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (endDate) {
      const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${startStr} - ${endStr}`;
    }
    
    return startStr;
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Google Calendar Integration
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Connect Google Calendar to sync events and manage your schedule within the CRM.
      </Typography>

      {/* Error/Success Messages */}
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

      {/* Calendar Connection Status */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Calendar Connection Status
          </Typography>
          
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Box display="flex" alignItems="center" gap={1}>
                {getStatusIcon(calendarStatus.syncStatus)}
                <Chip 
                  label={calendarStatus.connected ? 'Connected' : 'Disconnected'} 
                  color={calendarStatus.connected ? 'success' : 'default'}
                  size="small"
                />
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Box display="flex" justifyContent="flex-end" gap={1}>
                {calendarStatus.connected ? (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => setShowCreateEventDialog(true)}
                      disabled={loading}
                    >
                      Create Event
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleDisconnectCalendar}
                      disabled={loading}
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="contained"
                    startIcon={<EventIcon />}
                    onClick={handleCalendarAuth}
                    disabled={loading}
                  >
                    Connect Calendar
                  </Button>
                )}
                <Button
                  variant="outlined"
                  startIcon={<SyncIcon />}
                  onClick={loadCalendarStatus}
                  disabled={loading}
                >
                  Refresh Status
                </Button>
              </Box>
            </Grid>
          </Grid>

          {calendarStatus.connected && (
            <Box mt={2}>
              <Typography variant="body2" color="text.secondary">
                <strong>Connected Account:</strong> {calendarStatus.email || 'Unknown'}
              </Typography>
              {calendarStatus.lastSync && (
                <Typography variant="body2" color="text.secondary">
                  <strong>Last Sync:</strong> {new Date(calendarStatus.lastSync).toLocaleString()}
                </Typography>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Calendar Events */}
      {calendarStatus.connected && (
        <Card>
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                Recent Calendar Events
              </Typography>
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={loadCalendarEvents}
                disabled={loading}
              >
                Refresh
              </Button>
            </Box>
            
            {loading ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress />
              </Box>
            ) : events.length > 0 ? (
              <List>
                {events.map((event) => (
                  <ListItem key={event.id} divider>
                    <ListItemIcon>
                      <EventIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary={event.summary}
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {formatEventTime(event)}
                          </Typography>
                          {event.location && (
                            <Typography variant="body2" color="text.secondary">
                              📍 {event.location}
                            </Typography>
                          )}
                          {event.description && (
                            <Typography variant="body2" color="text.secondary">
                              {event.description}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Chip 
                        label={event.status || 'confirmed'} 
                        size="small"
                        color={event.status === 'confirmed' ? 'success' : 'default'}
                      />
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Box textAlign="center" py={3}>
                <EventIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body2" color="text.secondary">
                  No calendar events found
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Event Dialog */}
      <Dialog 
        open={showCreateEventDialog} 
        onClose={() => setShowCreateEventDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Calendar Event</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Event Title"
                value={newEvent.summary}
                onChange={(e) => setNewEvent(prev => ({ ...prev, summary: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={3}
                value={newEvent.description}
                onChange={(e) => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={newEvent.startDate}
                onChange={(e) => setNewEvent(prev => ({ ...prev, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Start Time"
                type="time"
                value={newEvent.startTime}
                onChange={(e) => setNewEvent(prev => ({ ...prev, startTime: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={newEvent.endDate}
                onChange={(e) => setNewEvent(prev => ({ ...prev, endDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="End Time"
                type="time"
                value={newEvent.endTime}
                onChange={(e) => setNewEvent(prev => ({ ...prev, endTime: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Location"
                value={newEvent.location}
                onChange={(e) => setNewEvent(prev => ({ ...prev, location: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreateEventDialog(false)}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleCreateEvent}
            disabled={loading || !newEvent.summary || !newEvent.startDate || !newEvent.startTime}
          >
            Create Event
          </Button>
        </DialogActions>
      </Dialog>

      {/* Loading Overlay */}
      {loading && (
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bgcolor="rgba(0,0,0,0.3)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          zIndex={9999}
        >
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

export default CalendarManagement;
