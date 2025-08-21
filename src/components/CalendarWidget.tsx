import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardHeader,
  CardContent,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Avatar,
  Tooltip,
  Badge,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Add as AddIcon,
  Event as EventIcon,
  Schedule as ScheduleIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  ViewModule as ViewModuleIcon,
  ViewDay as ViewDayIcon,
} from '@mui/icons-material';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isToday, parseISO } from 'date-fns';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'crm_appointment' | 'google_calendar';
  description?: string;
  location?: string;
  attendees?: string[];
  color?: string;
  relatedTo?: {
    type: string;
    id: string;
    name: string;
  };
}

interface CalendarWidgetProps {
  userId: string;
  tenantId: string;
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompanies?: any[];
  preloadedDeals?: any[];
}

const CalendarWidget: React.FC<CalendarWidgetProps> = ({
  userId,
  tenantId,
  preloadedContacts = [],
  preloadedSalespeople = [],
  preloadedCompanies = [],
  preloadedDeals = [],
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'day'>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('calendar_view') : null;
    return (saved === 'day' || saved === 'month') ? (saved as any) : 'month';
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  // Helper function to safely convert dates
  const safeDateConversion = (dateValue: any): Date => {
    if (!dateValue) return new Date();
    
    // If it's already a Date object
    if (dateValue instanceof Date) return dateValue;
    
    // If it's a Firestore timestamp
    if (dateValue && typeof dateValue.toDate === 'function') {
      return dateValue.toDate();
    }
    
    // If it's a string or number, try to create a Date
    try {
      return new Date(dateValue);
    } catch (error) {
      console.warn('Failed to convert date value:', dateValue, error);
      return new Date();
    }
  };

  // Calendar navigation
  const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  // Day view navigation
  const goToPreviousDay = () => {
    const prevDay = new Date(selectedDate);
    prevDay.setDate(prevDay.getDate() - 1);
    setSelectedDate(prevDay);
    if (view === 'month') {
      setCurrentDate(prevDay);
    }
  };

  const goToNextDay = () => {
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    setSelectedDate(nextDay);
    if (view === 'month') {
      setCurrentDate(nextDay);
    }
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setView('day');
  };

  const handleViewChange = (newView: 'month' | 'day') => {
    setView(newView);
    try { window.localStorage.setItem('calendar_view', newView); } catch {}
  };

  // Keyboard navigation for month view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showEventDialog) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCloseEventDialog();
        }
        return;
      }
      if (view !== 'month') return;
      let handled = true;
      if (e.key === 'ArrowLeft') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1));
      else if (e.key === 'ArrowRight') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
      else if (e.key === 'ArrowUp') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7));
      else if (e.key === 'ArrowDown') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7));
      else if (e.key === 'Enter') { handleDayClick(selectedDate); }
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, showEventDialog, selectedDate]);

  // Get calendar days for the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate]);

  // Load events from multiple sources
  useEffect(() => {
    if (!userId || !tenantId) return;

    const unsubscribeFunctions: (() => void)[] = [];

    // Load CRM appointments (from tasks collection)
    const loadCRMAppointments = () => {
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const appointmentsQuery = query(
        tasksRef,
        where('classification', '==', 'appointment'),
        where('assignedTo', '==', userId)
      );

      const unsubscribe = onSnapshot(appointmentsQuery, (snapshot) => {
        console.log(`📅 Loaded ${snapshot.docs.length} CRM appointments for user ${userId}`);
        const crmEvents: CalendarEvent[] = snapshot.docs.map(doc => {
          const data = doc.data();
          console.log('Appointment data:', data);
          
          // Handle different date field names
          const startTime = data.startTime || data.scheduledDate || data.dueDate;
          const endTime = data.endTime || data.scheduledDate || data.dueDate;
          
          return {
            id: doc.id,
            title: data.title || data.name || 'Untitled Appointment',
            start: safeDateConversion(startTime),
            end: safeDateConversion(endTime),
            type: 'crm_appointment',
            description: data.description || data.notes,
            location: data.location,
            attendees: data.attendees || [],
            color: '#1976d2', // Blue for CRM appointments
            relatedTo: data.relatedTo,
          };
        });
        
        setEvents(prev => {
          const filtered = prev.filter(e => e.type !== 'crm_appointment');
          return [...filtered, ...crmEvents];
        });
      });

      unsubscribeFunctions.push(unsubscribe);
    };

    // Load Google Calendar events (from activities collection and direct API)
    const loadGoogleCalendarEvents = async () => {
      try {
        // First try to get Google Calendar events via API (like appointments widget does)
        const functions = getFunctions();
        const listCalendarEvents = httpsCallable(functions, 'listCalendarEvents');
        
        const calendarResult = await listCalendarEvents({
          userId,
          maxResults: 50,
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
        });
        
        const calendarData = calendarResult.data as any;
        
        if (calendarData.success && calendarData.events) {
          console.log(`📅 Loaded ${calendarData.events.length} Google Calendar events via API for user ${userId}`);
          const googleEvents: CalendarEvent[] = calendarData.events.map((event: any) => ({
            id: event.id,
            title: event.summary || 'Untitled Event',
            start: safeDateConversion(event.start?.dateTime || event.start?.date),
            end: safeDateConversion(event.end?.dateTime || event.end?.date),
            type: 'google_calendar',
            description: event.description,
            location: event.location,
            attendees: event.attendees || [],
            color: '#4caf50', // Green for Google Calendar events
            relatedTo: event.relatedTo,
          }));
          
          setEvents(prev => {
            const filtered = prev.filter(e => e.type !== 'google_calendar');
            return [...filtered, ...googleEvents];
          });
        }
      } catch (calendarError: any) {
        console.warn('Google Calendar API not accessible:', calendarError);
        // Fall back to synced events from activities collection
      }

      // Also load calendar events that were synced into CRM activities
      const activitiesRef = collection(db, 'tenants', tenantId, 'activities');
      const activitiesQuery = query(
        activitiesRef,
        where('type', '==', 'calendar_event'),
        where('createdBy', '==', userId)
      );

      const unsubscribe = onSnapshot(activitiesQuery, (snapshot) => {
        console.log(`📅 Loaded ${snapshot.docs.length} synced calendar events from activities for user ${userId}`);
        const syncedEvents: CalendarEvent[] = snapshot.docs.map(doc => {
          const data = doc.data();
          const startDate = safeDateConversion(data.date);
          return {
            id: data.calendarEventId || doc.id,
            title: data.title || 'Calendar Event',
            start: startDate,
            end: startDate, // Use same time for synced events
            type: 'google_calendar',
            description: data.description,
            location: data.location,
            attendees: data.attendees || [],
            color: '#4caf50', // Green for Google Calendar events
            relatedTo: data.relatedTo,
          };
        });
        
        setEvents(prev => {
          const filtered = prev.filter(e => e.type !== 'google_calendar');
          return [...filtered, ...syncedEvents];
        });
      });

      unsubscribeFunctions.push(unsubscribe);
    };

    // Load all event types
    loadCRMAppointments();
    loadGoogleCalendarEvents().catch(error => {
      console.error('Error loading Google Calendar events:', error);
    });

    setLoading(false);

    // Cleanup function
    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }, [userId, tenantId]);

  // Get events for a specific day
  const getEventsForDay = (date: Date) => {
    return events.filter(event => isSameDay(event.start, date));
  };

  // Get events for a specific day sorted by time
  const getEventsForDaySorted = (date: Date) => {
    const dayEvents = getEventsForDay(date);
    return dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  };

  // Generate time slots for day view (6 AM to 10 PM)
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 6; hour <= 22; hour++) {
      slots.push(hour);
    }
    return slots;
  }, []);

  // Get related entity name
  const getRelatedEntityName = (relatedTo?: { type: string; id: string; name: string }) => {
    if (!relatedTo) return null;

    switch (relatedTo.type) {
      case 'contact': {
        const contact = preloadedContacts.find(c => c.id === relatedTo.id);
        return contact?.fullName || contact?.name || relatedTo.name;
      }
      case 'company': {
        const company = preloadedCompanies.find(c => c.id === relatedTo.id);
        return company?.companyName || company?.name || relatedTo.name;
      }
      case 'deal': {
        const deal = preloadedDeals.find(d => d.id === relatedTo.id);
        return deal?.name || relatedTo.name;
      }
      default:
        return relatedTo.name;
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowEventDialog(true);
  };

  const handleCloseEventDialog = () => {
    setShowEventDialog(false);
    setSelectedEvent(null);
  };

  const handleEditAppointment = () => {
    if (!selectedEvent || selectedEvent.type !== 'crm_appointment') return;
    try {
      // Notify Tasks UI to open edit dialog; also navigate to tasks tab
      const evt = new CustomEvent('openTaskEditDialog', { detail: { taskId: selectedEvent.id, tenantId } });
      window.dispatchEvent(evt);
      // Best-effort navigate to tasks tab
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'tasks');
      url.searchParams.set('editTaskId', selectedEvent.id);
      window.history.pushState({}, '', url.toString());
    } catch {}
    handleCloseEventDialog();
  };

  const handleDeleteAppointment = async () => {
    if (!selectedEvent || selectedEvent.type !== 'crm_appointment') return;
    try {
      const confirm = window.confirm('Delete this appointment? This cannot be undone.');
      if (!confirm) return;
      const functions = getFunctions();
      const deleteTask = httpsCallable(functions, 'deleteTask');
      await deleteTask({ tenantId, taskId: selectedEvent.id });
      handleCloseEventDialog();
    } catch (e) {
      console.error('Failed to delete appointment', e);
      alert('Failed to delete appointment.');
    }
  };

  // Helpers for event details rendering
  const getAttendeeLabel = (attendee: any): string => {
    if (!attendee) return '';
    if (typeof attendee === 'string') return attendee;
    return attendee.email || attendee.displayName || attendee.name || '';
  };

  const linkifyDescription = (desc?: string): string => {
    if (!desc) return '';
    // If it already looks like HTML, render as is
    const looksLikeHtml = /<[^>]+>/.test(desc);
    if (looksLikeHtml) return desc;
    // Escape HTML entities first
    let html = desc
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Convert <https://...> style links
    html = html.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // Convert bare URLs
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // Convert newlines
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  return (
    <Card>
      <CardHeader
        title="Calendar"
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip 
              label="CRM" 
              size="small" 
              sx={{ backgroundColor: '#1976d2', color: 'white' }}
            />
            <Chip 
              label="Google" 
              size="small" 
              sx={{ backgroundColor: '#4caf50', color: 'white' }}
            />
            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={(e, newView) => newView && handleViewChange(newView)}
              size="small"
            >
              <ToggleButton value="month" aria-label="month view">
                <ViewModuleIcon />
              </ToggleButton>
              <ToggleButton value="day" aria-label="day view">
                <ViewDayIcon />
              </ToggleButton>
            </ToggleButtonGroup>
            <IconButton size="small" onClick={goToToday}>
              <TodayIcon />
            </IconButton>
          </Box>
        }
        titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
      />
      <CardContent>
        {/* Calendar Navigation */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <IconButton 
            onClick={view === 'month' ? goToPreviousMonth : goToPreviousDay} 
            size="small"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            {view === 'month' 
              ? format(currentDate, 'MMMM yyyy')
              : format(selectedDate, 'EEEE, MMMM d, yyyy')
            }
          </Typography>
          <IconButton 
            onClick={view === 'month' ? goToNextMonth : goToNextDay} 
            size="small"
          >
            <ChevronRightIcon />
          </IconButton>
        </Box>

        {/* Calendar Content */}
        {view === 'month' ? (
          /* Month View */
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(7, 1fr)', 
            gap: 0,
            width: '100%',
            minWidth: 0,
            '& > *': {
              minWidth: 0,
              width: '100%'
            }
          }}>
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <Box
              key={day}
              sx={{
                p: 1,
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '0.875rem',
                color: 'text.secondary',
                backgroundColor: '#f5f5f5',
                borderRadius: 0,
                border: '1px solid #e0e0e0',
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {day}
            </Box>
          ))}

          {/* Calendar days */}
          {calendarDays.map((day, index) => {
            const dayEvents = getEventsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isTodayDate = isToday(day);

            return (
              <Box
                key={index}
                onClick={() => handleDayClick(day)}
                sx={{
                  minHeight: 80,
                  p: 0.5,
                  border: '1px solid #e0e0e0',
                  borderRadius: 0,
                  backgroundColor: isTodayDate ? '#e3f2fd' : 'white',
                  cursor: 'pointer',
                  width: '100%',
                  minWidth: 0,
                  overflow: 'hidden',
                  '&:hover': {
                    backgroundColor: '#f5f5f5',
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: isSameDay(day, selectedDate) ? 'bold' : 'medium',
                    color: isCurrentMonth ? 'text.primary' : 'text.disabled',
                    mb: 0.5,
                  }}
                >
                  <Box component="span" sx={{
                    px: 0.5,
                    borderRadius: 0.5,
                    backgroundColor: isTodayDate ? '#e8f0fe' : 'transparent'
                  }}>
                    {format(day, 'd')}
                  </Box>
                </Typography>

                {/* Events for this day */}
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 0.5,
                  width: '100%',
                  minWidth: 0,
                  overflow: 'hidden'
                }}>
                  {dayEvents.slice(0, 2).map((event) => (
                    <Tooltip title={event.title} placement="top" key={event.id}>
                    <Box
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEventClick(event);
                      }}
                      tabIndex={0}
                      aria-label={`${format(event.start,'h:mm a')} — ${event.title}`}
                      sx={{
                        p: 0.5,
                        backgroundColor: event.color,
                        color: 'white',
                        borderRadius: 1,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:hover': {
                          opacity: 0.8,
                        },
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'white', opacity: 0.9, mr: 0.75 }} />
                      <span>{event.title}</span>
                    </Box>
                    </Tooltip>
                  ))}
                  {dayEvents.length > 2 && (
                    <Typography 
                      variant="caption" 
                      color="text.secondary"
                      sx={{ textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={(e)=>{ e.stopPropagation(); handleDayClick(day); }}
                    >
                      +{dayEvents.length - 2} more
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
        ) : (
          /* Day View */
          <Box sx={{ 
            display: 'flex',
            flexDirection: 'column',
            height: 600,
            overflow: 'auto',
            border: '1px solid #e0e0e0',
            borderRadius: 1,
          }}>
            {/* Time slots */}
            {timeSlots.map((hour) => {
              const hourEvents = getEventsForDaySorted(selectedDate).filter(event => {
                const eventHour = event.start.getHours();
                return eventHour === hour;
              });

              return (
                <Box
                  key={hour}
                  sx={{
                    display: 'flex',
                    minHeight: 60,
                    borderBottom: '1px solid #f0f0f0',
                    position: 'relative',
                  }}
                >
                  {/* Time label */}
                  <Box
                    sx={{
                      width: 80,
                      p: 1,
                      borderRight: '1px solid #e0e0e0',
                      backgroundColor: '#f9f9f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.875rem',
                      color: 'text.secondary',
                      fontWeight: 'bold',
                    }}
                  >
                    {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
                  </Box>

                  {/* Events for this hour */}
                  <Box
                    sx={{
                      flex: 1,
                      p: 1,
                      position: 'relative',
                    }}
                  >
                    {hourEvents.map((event) => (
                      <Box
                        key={event.id}
                        onClick={() => handleEventClick(event)}
                        sx={{
                          p: 1,
                          backgroundColor: event.color,
                          color: 'white',
                          borderRadius: 1,
                          marginBottom: 0.5,
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          '&:hover': {
                            opacity: 0.8,
                          },
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {format(event.start, 'h:mm a')} - {format(event.end, 'h:mm a')}
                        </Typography>
                        <Typography variant="body2">
                          {event.title}
                        </Typography>
                        {event.location && (
                          <Typography variant="caption" sx={{ opacity: 0.9 }}>
                            📍 {event.location}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Event Details Dialog */}
        <Dialog open={showEventDialog} onClose={handleCloseEventDialog} maxWidth="sm" fullWidth>
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <EventIcon color="primary" />
              {selectedEvent?.title}
            </Box>
          </DialogTitle>
          <DialogContent>
            {selectedEvent && (
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  {selectedEvent.description && (
                    <Box sx={{ color: 'text.secondary' }}
                      dangerouslySetInnerHTML={{ __html: linkifyDescription(selectedEvent.description) }} />
                  )}
                </Grid>
                
                <Grid item xs={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <Typography variant="body2">
                      {format(selectedEvent.start, 'MMM d, yyyy h:mm a')}
                    </Typography>
                  </Box>
                </Grid>
                
                <Grid item xs={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <Typography variant="body2">
                      {format(selectedEvent.end, 'MMM d, yyyy h:mm a')}
                    </Typography>
                  </Box>
                </Grid>

                {selectedEvent.location && (
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LocationIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {selectedEvent.location}
                      </Typography>
                    </Box>
                  </Grid>
                )}

                {selectedEvent.relatedTo && (
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {selectedEvent.relatedTo.type === 'contact' && <PersonIcon fontSize="small" color="action" />}
                      {selectedEvent.relatedTo.type === 'company' && <BusinessIcon fontSize="small" color="action" />}
                      <Typography variant="body2">
                        Related to: {getRelatedEntityName(selectedEvent.relatedTo)}
                      </Typography>
                    </Box>
                  </Grid>
                )}

                {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                      Attendees: {selectedEvent.attendees.map(getAttendeeLabel).filter(Boolean).join(', ')}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            )}
          </DialogContent>
          <DialogActions>
            {selectedEvent?.type === 'crm_appointment' && (
              <>
                <Button onClick={handleEditAppointment} variant="outlined">Edit</Button>
                <Button onClick={handleDeleteAppointment} color="error" variant="outlined">Delete</Button>
              </>
            )}
            <Button onClick={handleCloseEventDialog}>Close</Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default CalendarWidget;
