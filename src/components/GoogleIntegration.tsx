import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  CircularProgress,
} from '@mui/material';
import {
  Event as EventIcon,
  Sync as SyncIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Google as GoogleIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getUserTimezone } from '../utils/dateUtils';

import { useAuth } from '../contexts/AuthContext';

interface GoogleIntegrationProps {
  tenantId: string;
}

interface GoogleStatus {
  gmail: {
    connected: boolean;
    email?: string;
    lastSync?: Date;
    syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
  };
  calendar: {
    connected: boolean;
    email?: string;
    lastSync?: Date;
    syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
  };
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

const GoogleIntegration: React.FC<GoogleIntegrationProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  const SHOW_EVENTS = false; // Keep this layout focused on connection management only
  
  // State for Google services status
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    gmail: { connected: false, syncStatus: 'not_synced' },
    calendar: { connected: false, syncStatus: 'not_synced' }
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
  const getGmailStatusFn = httpsCallable(functions, 'getGmailStatus');
  const getCalendarStatusFn = httpsCallable(functions, 'getCalendarStatus');
  const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
  const disconnectGmailFn = httpsCallable(functions, 'disconnectGmail');
  const disconnectCalendarFn = httpsCallable(functions, 'disconnectCalendar');
  const listCalendarEventsFn = httpsCallable(functions, 'listCalendarEvents');
  const createCalendarEventFn = httpsCallable(functions, 'createCalendarEvent');
  
  // Sync functions
  const syncGmailAndCreateTasksFn = httpsCallable(functions, 'syncGmailAndCreateTasks');
  const syncGmailCalendarAsTasksFn = httpsCallable(functions, 'syncGmailCalendarAsTasks');
  const syncCalendarEventsToCRMFn = httpsCallable(functions, 'syncCalendarEventsToCRM');
  
  // Gmail email capture functions
  const monitorGmailForContactEmailsFn = httpsCallable(functions, 'monitorGmailForContactEmails');
  const testGmailEmailCaptureFn = httpsCallable(functions, 'testGmailEmailCapture');

  // Load Google services status
  const loadGoogleStatus = async () => {
    if (!user?.uid) {
      console.log('No user UID available');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      console.log('Loading Google status for user:', user.uid);
      
      // Call each function separately to catch individual errors
      console.log('Calling getGmailStatus...');
      const gmailResult = await getGmailStatusFn({ userId: user.uid });
      console.log('Gmail status response:', gmailResult.data);
      
      console.log('Calling getCalendarStatus...');
      const calendarResult = await getCalendarStatusFn({ userId: user.uid });
      console.log('Calendar status response:', calendarResult.data);
      
      // Debug: Check if calendar tokens exist
      const calendarData = calendarResult.data as any;
      if (calendarData && calendarData.connected) {
        console.log('✅ Calendar is connected!');
        console.log('Calendar email:', calendarData.email);
        console.log('Last sync:', calendarData.lastSync);
        console.log('Sync status:', calendarData.syncStatus);
      } else {
        console.log('❌ Calendar is NOT connected');
        console.log('Calendar status:', calendarData);
      }
      
      const gmailStatus = gmailResult.data as any;
      const calendarStatus = calendarResult.data as any;
      
      const newStatus = {
        gmail: {
          connected: gmailStatus.connected || false,
          email: gmailStatus.email,
          lastSync: gmailStatus.lastSync,
          syncStatus: gmailStatus.syncStatus || 'not_synced'
        },
        calendar: {
          connected: calendarStatus.connected || false,
          email: calendarStatus.email,
          lastSync: calendarStatus.lastSync,
          syncStatus: calendarStatus.syncStatus || 'not_synced'
        }
      };
      
      console.log('Setting new Google status:', newStatus);
      setGoogleStatus(newStatus);
    } catch (error: any) {
      console.error('Error loading Google status:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details
      });
      setError(`Failed to load Google services status: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load calendar events
  const loadCalendarEvents = async () => {
    if (!user?.uid || !googleStatus.calendar.connected) return;
    
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
      console.error('Calendar events error details:', error?.details);
      const detailMessage = error?.details?.message || error?.message || 'Unknown error';
      setError(`Failed to load calendar events: ${detailMessage}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoogleStatus();
  }, [user?.uid]);

  useEffect(() => {
    if (SHOW_EVENTS && googleStatus.calendar.connected) {
      loadCalendarEvents();
    }
  }, [googleStatus.calendar.connected]);

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

  const handleGoogleAuth = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Use Gmail auth URL for unified Google OAuth
      const result = await getGmailAuthUrlFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to get Google auth URL');
        return;
      }
      
      const { authUrl } = data;
      
      if (!authUrl) {
        setError('No authentication URL received from server');
        return;
      }
      
      // Open Google OAuth URL in new window
      window.open(authUrl, '_blank', 'width=600,height=600');
      
      setSuccess('Google authentication initiated. Please complete the OAuth flow in the popup window.');
      
      // Refresh status after a delay to check if auth was completed
      setTimeout(() => {
        loadGoogleStatus();
      }, 3000);
      
      // Also refresh immediately and then every 2 seconds for the next 10 seconds
      const refreshInterval = setInterval(() => {
        loadGoogleStatus();
      }, 2000);
      
      setTimeout(() => {
        clearInterval(refreshInterval);
      }, 10000);
      
    } catch (error: any) {
      console.error('Error getting Google auth URL:', error);
      setError(`Failed to initiate Google authentication: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectService = async (service: 'gmail' | 'calendar') => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const disconnectFn = service === 'gmail' ? disconnectGmailFn : disconnectCalendarFn;
      const result = await disconnectFn({ userId: user.uid });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || `Failed to disconnect ${service}`);
        return;
      }
      
      setSuccess(`Google ${service} disconnected successfully`);
      
      // Refresh status
      loadGoogleStatus();
      
    } catch (error: any) {
      console.error(`Error disconnecting ${service}:`, error);
      setError(`Failed to disconnect ${service}: ${error.message}`);
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

  const isAnyServiceConnected = googleStatus.gmail.connected || googleStatus.calendar.connected;

  const overallEmail = googleStatus.gmail.email || googleStatus.calendar.email || '';

  const handleDisconnectGoogle = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Use the comprehensive disconnect function
      const disconnectAllGoogleServicesFn = httpsCallable(functions, 'disconnectAllGoogleServices');
      const result = await disconnectAllGoogleServicesFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(data.message || 'All Google services disconnected successfully');
      } else {
        setError(data.message || 'Failed to disconnect Google services');
      }
      
      await loadGoogleStatus();
    } catch (err: any) {
      console.error('Error disconnecting Google:', err);
      setError(err.message || 'Failed to disconnect Google');
    } finally {
      setLoading(false);
    }
  };

  // Sync handlers
  const handleSyncGmailAndCreateTasks = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await syncGmailAndCreateTasksFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Gmail sync completed! ${data.tasksCreated || 0} tasks created from emails.`);
      } else {
        setError(data.message || 'Failed to sync Gmail');
      }
    } catch (error: any) {
      console.error('Error syncing Gmail:', error);
      setError(`Failed to sync Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncGmailCalendarAsTasks = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await syncGmailCalendarAsTasksFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Calendar sync completed! ${data.tasksCreated || 0} tasks created from calendar events.`);
      } else {
        setError(data.message || 'Failed to sync calendar');
      }
    } catch (error: any) {
      console.error('Error syncing calendar:', error);
      setError(`Failed to sync calendar: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncCalendarEventsToCRM = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await syncCalendarEventsToCRMFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Calendar events synced to CRM! ${data.eventsSynced || 0} events processed.`);
      } else {
        setError(data.message || 'Failed to sync calendar events to CRM');
      }
    } catch (error: any) {
      console.error('Error syncing calendar events to CRM:', error);
      setError(`Failed to sync calendar events to CRM: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Gmail email capture handlers
  const handleMonitorGmailForContactEmails = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await monitorGmailForContactEmailsFn({ 
        userId: user.uid,
        tenantId: tenantId,
        maxResults: 20
      });
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Gmail monitoring completed! Processed ${data.processedCount} emails, created ${data.activityLogsCreated} activity logs.`);
      } else {
        setError(data.message || 'Failed to monitor Gmail for contact emails');
      }
    } catch (error: any) {
      console.error('Error monitoring Gmail for contact emails:', error);
      setError(`Failed to monitor Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestGmailEmailCapture = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await testGmailEmailCaptureFn({ 
        userId: user.uid,
        tenantId: tenantId
      });
      const data = result.data as any;
      
      if (data.success) {
        const testResults = data.testResults || [];
        const contactsFound = testResults.reduce((sum: number, result: any) => sum + (result.contactsFound || 0), 0);
        setSuccess(`Gmail test completed! Found ${data.totalMessagesFound} sent messages, ${contactsFound} contacts identified. Check console for detailed results.`);
        console.log('Gmail Email Capture Test Results:', data);
      } else {
        setError(data.message || 'Failed to test Gmail email capture');
      }
    } catch (error: any) {
      console.error('Error testing Gmail email capture:', error);
      setError(`Failed to test Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Test function to manually sync a task to calendar
  const handleTestCalendarSync = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Create a test task that should sync to calendar
      const testTaskData = {
        title: 'Test Calendar Sync',
        description: 'This is a test appointment to verify calendar sync',
        classification: 'appointment' as any,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        duration: 60, // 1 hour
        type: 'scheduled_meeting_virtual' as any,
        priority: 'medium' as any,
        status: 'scheduled' as any,
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        category: 'general' as any,
        quotaCategory: 'business_generating' as any,
        tenantId: tenantId,
        createdBy: user.uid,
        assignedTo: user.uid,
        userTimezone: getUserTimezone()
      };

      // Import TaskService to create the task
      const { TaskService } = await import('../utils/taskService');
      const taskService = TaskService.getInstance();
      
      const taskId = await taskService.createTask(testTaskData);
      
      setSuccess(`Test task created with ID: ${taskId}. Check your Google Calendar for the event.`);
    } catch (error: any) {
      console.error('Error creating test task:', error);
      setError(`Failed to create test task: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Google Integration
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Connect your Google account to sync Gmail emails and Calendar events with your CRM.
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

      {/* Google Connection Status */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Google Account Status
          </Typography>

          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <GoogleIcon color="primary" />
            <Typography variant="subtitle1">Google</Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            {getStatusIcon(
              isAnyServiceConnected
                ? (googleStatus.gmail.syncStatus === 'error' || googleStatus.calendar.syncStatus === 'error')
                  ? 'error'
                  : 'synced'
                : 'not_synced'
            )}
            <Chip 
              label={isAnyServiceConnected ? 'Connected' : 'Disconnected'} 
              color={isAnyServiceConnected ? 'success' : 'default'}
              size="small"
            />
          </Box>
          {isAnyServiceConnected && (
            <Typography variant="body2" color="text.secondary">
              {overallEmail}
            </Typography>
          )}

          <Box mt={3} display="flex" justifyContent="center" gap={2}>
            {!isAnyServiceConnected ? (
              <Button
                variant="contained"
                startIcon={<GoogleIcon />}
                onClick={handleGoogleAuth}
                disabled={loading}
                size="large"
              >
                Connect Google Account
              </Button>
            ) : (
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={handleDisconnectGoogle}
                disabled={loading}
                size="large"
                sx={{
                  bgcolor: '#2e7d32',
                  color: 'white',
                  border: '2px solid #4caf50',
                  boxShadow: '0 2px 8px rgba(76, 175, 80, 0.3)',
                  '&:hover': {
                    bgcolor: '#1b5e20',
                    boxShadow: '0 4px 12px rgba(76, 175, 80, 0.4)',
                  }
                }}
              >
                Connected ✓
              </Button>
            )}

            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={loadGoogleStatus}
              disabled={loading}
            >
              Refresh Status
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Sync Options - Only show when connected */}
      {isAnyServiceConnected && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Sync Options
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Sync your Google data with your CRM to create tasks and track activities.
            </Typography>

                        <Box display="flex" flexDirection="column" gap={2}>
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={handleSyncGmailAndCreateTasks}
                disabled={loading}
                fullWidth
              >
                Sync Gmail & Create Tasks
              </Button>
              
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={handleSyncGmailCalendarAsTasks}
                disabled={loading}
                fullWidth
              >
                Sync Calendar Events as Tasks
              </Button>
              
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={handleSyncCalendarEventsToCRM}
                disabled={loading}
                fullWidth
              >
                Sync Calendar Events to CRM
              </Button>

              <Button
                variant="contained"
                color="primary"
                startIcon={<SyncIcon />}
                onClick={handleTestCalendarSync}
                disabled={loading}
                fullWidth
              >
                Test Calendar Sync
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Gmail Email Capture - Only show when Gmail is connected */}
      {googleStatus.gmail.connected && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              📧 Gmail Email Capture
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Automatically capture emails sent to your CRM contacts and log them as activities.
            </Typography>

            <Box display="flex" flexDirection="column" gap={2}>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<SyncIcon />}
                onClick={handleMonitorGmailForContactEmails}
                disabled={loading}
                fullWidth
              >
                Monitor Gmail for Contact Emails
              </Button>
              
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={handleTestGmailEmailCapture}
                disabled={loading}
                fullWidth
              >
                Test Gmail Email Capture
              </Button>
            </Box>
            
            <Box mt={2} p={2} bgcolor="grey.50" borderRadius={1}>
              <Typography variant="body2" color="text.secondary">
                <strong>How it works:</strong> This feature monitors your Gmail for emails sent to contacts in your CRM. 
                When an email is sent to a contact, it automatically creates an activity log on their contact record.
                <br /><br />
                <strong>Note:</strong> This only captures emails you send TO your contacts, not emails you receive FROM them.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Calendar Events hidden on this layout */}
      {SHOW_EVENTS && googleStatus.calendar.connected && (
        <Card>
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                Recent Calendar Events
              </Typography>
              <Box display="flex" gap={1}>
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
                  startIcon={<SyncIcon />}
                  onClick={loadCalendarEvents}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </Box>
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

      {/* Create Event Dialog intentionally removed on this layout */}

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

export default GoogleIntegration;
