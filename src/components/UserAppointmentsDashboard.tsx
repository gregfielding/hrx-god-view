import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Alert,
  LinearProgress,
  Button,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Schedule as ScheduleIcon,
  Event as EventIcon,
  Sync as SyncIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import AppointmentCard from './AppointmentCard';
import TaskDetailsDialog from './TaskDetailsDialog';

interface AppointmentData {
  id: string;
  title?: string;
  description?: string;
  startTime?: string;
  scheduledDate?: string;
  dueDate?: string;
  status?: string;
  priority?: string;
  type?: string;
  category?: string;
  assignedTo?: string;
  associations?: {
    companies?: string[];
    contacts?: string[];
    deals?: string[];
    salespeople?: string[];
  };
  // Google Calendar specific fields
  googleCalendarEventId?: string;
  calendarEventLink?: string;
  meetingLink?: string;
  attendees?: any[];
  location?: string;
  [key: string]: any;
}

interface UserAppointmentsDashboardProps {
  userId: string;
  tenantId: string;
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompanies?: any[];
  preloadedDeals?: any[];
  onAddAppointment?: () => void;
}

const UserAppointmentsDashboard: React.FC<UserAppointmentsDashboardProps> = ({
  userId,
  tenantId,
  preloadedContacts = [],
  preloadedSalespeople = [],
  preloadedCompanies = [],
  preloadedDeals = [],
  onAddAppointment
}) => {
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);

  const functions = getFunctions();

  // Debounce load appointments to prevent rapid successive calls
  const [lastLoadTime, setLastLoadTime] = useState(0);
  const LOAD_DEBOUNCE_DELAY = 3000; // 3 seconds debounce

  const loadAppointments = useCallback(async () => {
    if (!userId || !tenantId) return;
    
    // Debounce rapid load calls
    const now = Date.now();
    if (now - lastLoadTime < LOAD_DEBOUNCE_DELAY) {
      console.log('Skipping appointments load - too soon since last load');
      return;
    }
    setLastLoadTime(now);
    
    setLoading(true);
    setError(null);
    try {
      let googleCalendarEvents: AppointmentData[] = [];
      let activityAppointments: AppointmentData[] = [];
      
      // First, try to get Google Calendar events
      try {
        const listCalendarEvents = httpsCallable(functions, 'listCalendarEvents');
        const calendarResult = await listCalendarEvents({
          userId,
          maxResults: 50,
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
        });
        
        const calendarData = calendarResult.data as any;
        
        if (calendarData.success && calendarData.events) {
          googleCalendarEvents = calendarData.events.map((event: any) => ({
            id: event.id,
            title: event.summary || 'Untitled Event',
            description: event.description || '',
            startTime: event.start?.dateTime || event.start?.date,
            scheduledDate: event.start?.dateTime || event.start?.date,
            status: 'scheduled',
            priority: 'medium',
            type: 'scheduled_meeting_virtual',
            googleCalendarEventId: event.id,
            calendarEventLink: event.htmlLink,
            meetingLink: event.hangoutLink,
            attendees: event.attendees || [],
            location: event.location,
            associations: {
              contacts: event.attendees?.map((a: any) => a.email).filter(Boolean) || []
            }
          }));
        }
      } catch (calendarError: any) {
        console.warn('Google Calendar not accessible:', {
          code: calendarError?.code,
          message: calendarError?.message,
          details: calendarError?.details
        });

        // Normalize known callable error codes
        const code: string | undefined = calendarError?.code;
        const message: string = calendarError?.message || '';

        if (
          code === 'functions/failed-precondition' ||
          message.includes('Calendar not connected') ||
          code === 'functions/not-found' ||
          message.includes('User not found') ||
          code === 'unauthenticated'
        ) {
          // Expected if calendar isn't connected yet
          console.log('User not connected to Google Calendar - this is normal');
          // Do NOT set a blocking error here; let the dashboard show local appointments
        } else if (
          message.includes('Google Calendar API has not been used') ||
          message.includes('API has not been used') ||
          message.includes('accessNotConfigured')
        ) {
          setError('Google Calendar API not enabled. Please contact your administrator to enable Google Calendar integration.');
        } else {
          console.error('Unexpected Google Calendar error:', calendarError);
          setError(`Google Calendar error: ${message}`);
        }
      }

      // Also get calendar events that were synced into CRM activities
      try {
        const activitiesQ = query(
          collection(db, 'tenants', tenantId, 'activities'),
          where('type', '==', 'calendar_event'),
          where('createdBy', '==', userId),
          orderBy('date', 'asc')
        );
        const activitiesSnap = await getDocs(activitiesQ);
        activityAppointments = activitiesSnap.docs.map(doc => {
          const d: any = doc.data();
          const startDate: Date = d?.date?.toDate ? d.date.toDate() : (d?.date ? new Date(d.date) : new Date());
          return {
            id: d?.calendarEventId || doc.id,
            title: d?.title || 'Calendar Event',
            description: d?.description || '',
            startTime: startDate.toISOString(),
            scheduledDate: startDate.toISOString(),
            status: 'scheduled',
            priority: 'medium',
            type: 'scheduled_meeting_virtual',
            googleCalendarEventId: d?.calendarEventId,
            calendarEventLink: d?.calendarEventLink,
            meetingLink: d?.meetingLink || undefined,
            attendees: d?.attendees || [],
            location: d?.location || undefined,
            associations: {
              contacts: d?.associations?.contacts || []
            }
          } as AppointmentData;
        });
        console.log(`✅ Loaded ${activityAppointments.length} calendar activities from CRM`);
      } catch (e: any) {
        // Gracefully handle permission errors for activities collection
        if (e.code === 'permission-denied' || e.message?.includes('permission')) {
          console.log('ℹ️ Activities collection not accessible, skipping calendar activities');
        } else {
          console.warn('Failed to load calendar activities from CRM:', e);
        }
        activityAppointments = [];
      }

      // Also get local CRM appointments (tasks)
      const appointmentsQuery = query(
        collection(db, 'tenants', tenantId, 'tasks'),
        where('classification', '==', 'appointment'),
        where('assignedTo', '==', userId),
        orderBy('startTime', 'asc')
      );
      
      const appointmentsSnapshot = await getDocs(appointmentsQuery);
      const localAppointments = appointmentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AppointmentData[];
      
      // Combine and deduplicate appointments
      const allAppointments = [...googleCalendarEvents, ...activityAppointments, ...localAppointments];
      const uniqueAppointments = allAppointments.filter((appointment, index, self) => 
        index === self.findIndex(a => a.id === appointment.id)
      );
      
      // Filter to show today's and upcoming appointments
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      const filteredAppointments = uniqueAppointments.filter(appointment => {
        const appointmentDate = appointment.startTime ? new Date(appointment.startTime) : 
                               appointment.scheduledDate ? new Date(appointment.scheduledDate) : 
                               appointment.dueDate ? new Date(appointment.dueDate) : null;
        
        if (!appointmentDate) return false;
        
        // Show appointments from today onwards (including today)
        return appointmentDate >= todayStart;
      });
      
      // Sort by date/time
      filteredAppointments.sort((a, b) => {
        const dateA = a.startTime ? new Date(a.startTime) : 
                     a.scheduledDate ? new Date(a.scheduledDate) : 
                     a.dueDate ? new Date(a.dueDate) : new Date(0);
        const dateB = b.startTime ? new Date(b.startTime) : 
                     b.scheduledDate ? new Date(b.scheduledDate) : 
                     b.dueDate ? new Date(b.dueDate) : new Date(0);
        return dateA.getTime() - dateB.getTime();
      });
      
      setAppointments(filteredAppointments);
    } catch (err) {
      console.error('Error loading appointments:', err);
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [userId, tenantId, functions]);

  // Debounce sync to prevent rapid successive calls
  const [lastSyncTime, setLastSyncTime] = useState(0);
  const SYNC_DEBOUNCE_DELAY = 5000; // 5 seconds debounce

  const syncWithGoogleCalendar = useCallback(async () => {
    if (!userId || !tenantId) {
      console.log('❌ Missing userId or tenantId for sync:', { userId, tenantId });
      return;
    }
    
    // Debounce rapid sync calls
    const now = Date.now();
    if (now - lastSyncTime < SYNC_DEBOUNCE_DELAY) {
      console.log('Skipping calendar sync - too soon since last sync');
      return;
    }
    setLastSyncTime(now);
    
    console.log('🔄 Starting Google Calendar sync...', { userId, tenantId });
    setSyncing(true);
    setError(null);
    try {
      // First check if user is connected to Google Calendar
      console.log('🔍 Checking calendar status...');
      const getCalendarStatus = httpsCallable(functions, 'getCalendarStatus');
      const statusResult = await getCalendarStatus({ userId });
      const statusData = statusResult.data as any;
      
      console.log('📊 Calendar status result:', statusData);
      
      if (!statusData.connected) {
        console.log('❌ Calendar not connected according to status check');
        setError('Google Calendar not connected. Please connect your Google Calendar first.');
        return;
      }
      
      console.log('✅ Calendar is connected, proceeding with sync...');
      
      // Sync Google Calendar events to CRM
      const syncCalendarEventsToCRM = httpsCallable(functions, 'syncCalendarEventsToCRM');
      console.log('📤 Calling syncCalendarEventsToCRM with params:', { userId, tenantId });
      
      const result = await syncCalendarEventsToCRM({
        userId,
        tenantId
      });
      
      console.log('📥 Sync result received:', result.data);
      
      const data = result.data as any;
      if (data.success) {
        console.log('✅ Sync successful, reloading appointments...');
        // Reload appointments after sync
        await loadAppointments();
      } else {
        console.log('❌ Sync failed:', data.message);
        setError(data.message || 'Failed to sync with Google Calendar');
      }
    } catch (err: any) {
      console.error('❌ Error syncing with Google Calendar:', err);
      console.error('❌ Error details:', {
        message: err.message,
        code: err.code,
        details: err.details
      });
      
      // Handle specific error types
      if (err.message?.includes('not connected') || err.message?.includes('not authenticated')) {
        setError('Google Calendar not connected. Please connect your Google Calendar first.');
      } else if (err.message?.includes('access has expired') || err.message?.includes('invalid_grant')) {
        setError('Google Calendar access has expired. Please reconnect your Google account using the "Test & Fix Tokens" button in the Google Connection settings.');
      } else if (err.message?.includes('Google Calendar API has not been used') ||
                 err.message?.includes('API has not been used') ||
                 err.message?.includes('accessNotConfigured')) {
        setError('Google Calendar API not enabled. Please contact your administrator to enable Google Calendar integration.');
      } else if (err.message?.includes('CORS') || err.code === 'functions/unavailable') {
        setError('Google Calendar sync is temporarily unavailable. Please try again later or contact support.');
      } else {
        setError(`Failed to sync with Google Calendar: ${err.message}`);
      }
    } finally {
      console.log('🏁 Sync process completed');
      setSyncing(false);
    }
  }, [userId, tenantId, functions, loadAppointments]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Handle appointment click
  const handleAppointmentClick = useCallback((appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setShowDetailsDialog(true);
  }, []);

  // Handle appointment editing
  const handleEditAppointment = useCallback((appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setShowDetailsDialog(true);
  }, []);

  // Get associated data for an appointment
  const getAssociatedData = useCallback((appointment: AppointmentData) => {
    const associatedContacts = appointment.associations?.contacts || [];
    const associatedDeals = appointment.associations?.deals || [];
    const associatedCompanies = appointment.associations?.companies || [];
    
    // Find the primary company
    const primaryCompanyId = associatedCompanies[0];
    const primaryCompany = preloadedCompanies.find(c => c.id === primaryCompanyId);
    
    // Find the primary deal
    const primaryDealId = associatedDeals[0];
    const primaryDeal = preloadedDeals.find(d => d.id === primaryDealId);
    
    // Find associated contacts
    const appointmentContacts = preloadedContacts.filter(c => 
      associatedContacts.includes(c.id)
    );
    
    return {
      company: primaryCompany,
      deal: primaryDeal,
      contacts: appointmentContacts
    };
  }, [preloadedCompanies, preloadedDeals, preloadedContacts]);

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading appointments...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Sync Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Tooltip title="Sync with Google Calendar">
          <IconButton
            size="small"
            onClick={syncWithGoogleCalendar}
            disabled={syncing}
            sx={{ color: 'primary.main' }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {appointments.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No upcoming appointments
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Connect your Google Calendar to see your calendar events here, or create local appointments
          </Typography>
          <Button 
            variant="contained" 
            startIcon={<EventIcon />}
            size="small"
            onClick={onAddAppointment}
          >
            Schedule Meeting
          </Button>
        </Box>
      ) : (
        appointments.map((appointment) => {
          const associatedData = getAssociatedData(appointment);
          
          return (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              onAppointmentClick={handleAppointmentClick}
              onEditAppointment={handleEditAppointment}
              showCompany={true}
              showDeal={true}
              showContacts={true}
              company={associatedData.company}
              deal={associatedData.deal}
              contacts={associatedData.contacts}
              salespeople={preloadedSalespeople}
              variant="default"
            />
          );
        })
      )}

      {/* Appointment Details Dialog */}
      {selectedAppointment && (
        <TaskDetailsDialog
          open={showDetailsDialog}
          onClose={() => setShowDetailsDialog(false)}
          task={selectedAppointment}
          salespersonId={selectedAppointment.assignedTo || userId}
          tenantId={tenantId}
          contacts={preloadedContacts}
          salespeople={preloadedSalespeople}
          companies={preloadedCompanies}
          deals={preloadedDeals}
          onTaskUpdated={async (taskId: string) => {
            // Refresh appointments after update
            await loadAppointments();
            setShowDetailsDialog(false);
            setSelectedAppointment(null);
          }}
        />
      )}
    </Box>
  );
};

export default UserAppointmentsDashboard;
