/**
 * EventModal Component
 * 
 * Shared modal component for creating and editing calendar events.
 * Used by both the Dashboard calendar widget and the full-screen /calendar page.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
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
  FormControlLabel,
  Switch,
  Box,
  Typography,
  Alert,
  Snackbar,
  Chip,
  Autocomplete,
  Stack,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { CalendarEvent, CalendarEventInput, CalendarSummary } from '../../types/calendar';
import { useCalendarList } from '../../hooks/useCalendarList';
import { useCalendarEventMutations } from '../../hooks/useCalendarEventMutations';
import { useAuth } from '../../contexts/AuthContext';

export type EventModalMode = 'create' | 'edit';

interface EventModalProps {
  open: boolean;
  mode: EventModalMode;
  userId: string;
  initialEvent?: CalendarEvent | null; // When editing
  defaultStart?: Date; // When creating from a click/drag
  defaultCalendarId?: string;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void; // Bubble up changes
}

const EventModal: React.FC<EventModalProps> = ({
  open,
  mode,
  userId,
  initialEvent,
  defaultStart,
  defaultCalendarId,
  onClose,
  onSaved,
}) => {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const { calendars, loading: calendarsLoading } = useCalendarList({ userId, enabled: open });
  const { createEvent, updateEvent, deleteEvent, rsvpToEvent, creating, updating, deleting, rsvping, error: mutationError } = useCalendarEventMutations(userId);

  // Form state
  const [title, setTitle] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [guests, setGuests] = useState<string[]>([]); // Array of email strings
  const [guestInput, setGuestInput] = useState('');
  const [videoConferencing, setVideoConferencing] = useState<'none' | 'google-meet'>('none');
  const [reminder, setReminder] = useState<string>(''); // '10m' | '30m' | '1h' | '1d' | 'default' | ''
  const [validationError, setValidationError] = useState<string | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [snackbarError, setSnackbarError] = useState<string | null>(null);

  // Initialize form from initialEvent (edit mode) or defaultStart (create mode)
  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && initialEvent) {
      setTitle(initialEvent.summary || '');
      // Avoid MUI Select out-of-range warnings when calendars haven't loaded yet.
      // We'll re-hydrate the real calendarId once calendars are available.
      const nextCalendarId =
        calendars.length > 0 && initialEvent.calendarId
          ? (calendars.some((c) => c.id === initialEvent.calendarId) ? initialEvent.calendarId : '')
          : '';
      setSelectedCalendarId(nextCalendarId);
      setAllDay(initialEvent.isAllDay);
      setLocation(initialEvent.location || '');
      setDescription(initialEvent.description || '');
      setGuests(initialEvent.attendees?.map((a) => a.email) || []);
      setVideoConferencing(initialEvent.hangoutLink ? 'google-meet' : 'none');

      if (initialEvent.start.date) {
        // All-day event
        setStartDate(initialEvent.start.date);
        // Google Calendar all-day events use an exclusive end date. Convert to inclusive for the UI.
        if (initialEvent.end?.date) {
          const inclusive = format(subDays(parseISO(initialEvent.end.date), 1), 'yyyy-MM-dd');
          setEndDate(inclusive);
        } else {
          setEndDate(initialEvent.start.date);
        }
        setStartTime('09:00');
        setEndTime('10:00');
      } else if (initialEvent.start.dateTime) {
        // Timed event
        const start = parseISO(initialEvent.start.dateTime);
        setStartDate(format(start, 'yyyy-MM-dd'));
        setStartTime(format(start, 'HH:mm'));
        const end = initialEvent.end.dateTime ? parseISO(initialEvent.end.dateTime) : start;
        setEndDate(format(end, 'yyyy-MM-dd'));
        setEndTime(format(end, 'HH:mm'));
      }

      setReminder('default'); // TODO: Map from event.reminders
    } else {
      // Create mode - reset form
      setTitle('');
      setSelectedCalendarId(defaultCalendarId || calendars.find((c) => c.isPrimary)?.id || calendars[0]?.id || '');
      setAllDay(false);
      setLocation('');
      setDescription('');
      setGuests([]);
      setGuestInput('');
      setVideoConferencing('none');
      setReminder('');
      setValidationError(null);

      if (defaultStart) {
        setStartDate(format(defaultStart, 'yyyy-MM-dd'));
        setStartTime(format(defaultStart, 'HH:mm'));
        const end = new Date(defaultStart);
        end.setHours(end.getHours() + 1);
        setEndDate(format(end, 'yyyy-MM-dd'));
        setEndTime(format(end, 'HH:mm'));
      } else {
        const now = new Date();
        setStartDate(format(now, 'yyyy-MM-dd'));
        setEndDate(format(now, 'yyyy-MM-dd'));
        setStartTime('09:00');
        setEndTime('10:00');
      }
    }
  }, [open, mode, initialEvent, defaultStart, defaultCalendarId, calendars]);

  // Set default calendar when calendars load
  useEffect(() => {
    if (calendars.length > 0 && !selectedCalendarId) {
      const primary = calendars.find((c) => c.isPrimary) || calendars[0];
      setSelectedCalendarId(primary.id);
    }
  }, [calendars, selectedCalendarId]);

  const writableCalendars = useMemo(() => {
    return calendars.filter((c) => c.accessRole !== 'reader' && c.accessRole !== 'freeBusyReader');
  }, [calendars]);

  const handleClose = () => {
    if (creating || updating || deleting) return;
    setValidationError(null);
    setSnackbarMessage(null);
    setSnackbarError(null);
    onClose();
  };

  const handleAddGuest = () => {
    const email = guestInput.trim().toLowerCase();
    if (email && !guests.includes(email) && email.includes('@')) {
      setGuests([...guests, email]);
      setGuestInput('');
    }
  };

  const handleRemoveGuest = (emailToRemove: string) => {
    setGuests(guests.filter((email) => email !== emailToRemove));
  };

  const handleSubmit = async () => {
    setValidationError(null);
    setSnackbarError(null);

    // Validation
    if (!title.trim()) {
      setValidationError('Title is required');
      return;
    }

    if (!selectedCalendarId) {
      setValidationError('Please select a calendar');
      return;
    }

    if (!allDay) {
      if (!startTime || !endTime) {
        setValidationError('Start and end time are required (or choose All-day)');
        return;
      }
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Build start/end based on all-day toggle
    let start: { dateTime?: string; date?: string; timeZone?: string };
    let end: { dateTime?: string; date?: string; timeZone?: string };

    if (allDay) {
      if (!startDate || !endDate) {
        setValidationError('Start date and end date are required');
        return;
      }
      if (endDate < startDate) {
        setValidationError('End date must be on or after start date');
        return;
      }

      // Google Calendar expects all-day end.date to be exclusive (day AFTER the final day)
      const endExclusive = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd');
      start = { date: startDate, timeZone };
      end = { date: endExclusive, timeZone };
    } else {
      if (!startDate || !endDate) {
        setValidationError('Start date and end date are required');
        return;
      }
      const startDateTime = new Date(`${startDate}T${startTime}`);
      const endDateTime = new Date(`${endDate}T${endTime}`);

      if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
        setValidationError('Please enter valid start and end date/time');
        return;
      }
      if (endDateTime.getTime() <= startDateTime.getTime()) {
        setValidationError('End must be after start');
        return;
      }

      start = { dateTime: startDateTime.toISOString(), timeZone };
      end = { dateTime: endDateTime.toISOString(), timeZone };
    }

    const payload: CalendarEventInput = {
      summary: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start,
      end,
      attendees: guests.length > 0 ? guests.map((email) => ({ email })) : undefined,
      conferenceData:
        videoConferencing === 'google-meet'
          ? {
              createRequest: {
                requestId: `meet-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            }
          : undefined,
      reminders: reminder
        ? {
            useDefault: reminder === 'default',
            overrides:
              reminder !== 'default'
                ? [
                    {
                      method: 'popup',
                      minutes: reminder === '10m' ? 10 : reminder === '30m' ? 30 : reminder === '1h' ? 60 : 1440,
                    },
                  ]
                : undefined,
          }
        : undefined,
    };

    try {
      let savedEvent: CalendarEvent;

      if (mode === 'create') {
        savedEvent = await createEvent(selectedCalendarId, payload);
        setSnackbarMessage('Event created successfully');
      } else {
        if (!initialEvent) {
          throw new Error('Initial event is required for edit mode');
        }
        savedEvent = await updateEvent(selectedCalendarId, initialEvent.id, payload);
        setSnackbarMessage('Event updated successfully');
      }

      onSaved(savedEvent);
      setTimeout(() => {
        handleClose();
      }, 500); // Small delay to show success message
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to save event';
      setSnackbarError(errorMessage);
    }
  };

  const handleDelete = async () => {
    if (!initialEvent || mode !== 'edit') return;
    if (!confirm('Are you sure you want to delete this event?')) return;

    try {
      await deleteEvent(initialEvent.calendarId, initialEvent.id);
      setSnackbarMessage('Event deleted successfully');
      setTimeout(() => {
        onSaved(initialEvent); // Pass deleted event to parent (parent can handle cleanup)
        handleClose();
      }, 500);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to delete event';
      setSnackbarError(errorMessage);
    }
  };

  // Determine if user is an attendee (not the owner/organizer)
  const isUserAttendee = useMemo(() => {
    if (!initialEvent || !userEmail || mode !== 'edit') return false;
    
    const organizerEmail = initialEvent.organizer?.email?.toLowerCase();
    const creatorEmail = initialEvent.creator?.email?.toLowerCase();
    const userEmailLower = userEmail.toLowerCase();
    
    // User is not the owner/organizer
    if (organizerEmail === userEmailLower || creatorEmail === userEmailLower) {
      return false;
    }
    
    // Check if user is in attendees list
    return initialEvent.attendees?.some(
      (a) => a.email?.toLowerCase() === userEmailLower
    ) || false;
  }, [initialEvent, userEmail, mode]);

  // Get current user's RSVP status
  const currentRSVPStatus = useMemo(() => {
    if (!initialEvent || !userEmail || !isUserAttendee) return null;
    const userAttendee = initialEvent.attendees?.find(
      (a) => a.email?.toLowerCase() === userEmail.toLowerCase()
    );
    return userAttendee?.responseStatus || null;
  }, [initialEvent, userEmail, isUserAttendee]);

  const handleRSVP = async (responseStatus: 'accepted' | 'declined' | 'tentative') => {
    if (!initialEvent || !userEmail) return;

    try {
      const updatedEvent = await rsvpToEvent(
        initialEvent.calendarId,
        initialEvent.id,
        responseStatus,
        userEmail
      );
      setSnackbarMessage(`RSVP updated: ${responseStatus === 'accepted' ? 'Accepted' : responseStatus === 'declined' ? 'Declined' : 'Maybe'}`);
      onSaved(updatedEvent);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to update RSVP';
      setSnackbarError(errorMessage);
    }
  };

  const isLoading = creating || updating || deleting || rsvping;

  // Helper function to render HTML descriptions (similar to CalendarWidget)
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
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {mode === 'create' ? 'Create Event' : 'Edit Event'}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Title */}
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
              fullWidth
              disabled={isLoading}
            />

            {/* Calendar */}
            <FormControl fullWidth disabled={calendarsLoading || isLoading}>
              <InputLabel>Calendar</InputLabel>
              <Select value={selectedCalendarId} onChange={(e) => setSelectedCalendarId(e.target.value)} label="Calendar">
                {writableCalendars.length === 0 && (
                  <MenuItem value="" disabled>
                    {calendarsLoading ? 'Loading calendars…' : 'No writable calendars available'}
                  </MenuItem>
                )}
                {writableCalendars.map((cal) => (
                  <MenuItem key={cal.id} value={cal.id}>
                    {cal.summary}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Dates & All-day toggle */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                label="Start date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  // Keep end date >= start date by default
                  if (endDate < v) setEndDate(v);
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: 1, minWidth: 180 }}
                disabled={isLoading}
                required
              />
              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: 1, minWidth: 180 }}
                disabled={isLoading}
                required
              />
              <FormControlLabel
                control={<Switch checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={isLoading} />}
                label="All-day"
              />
            </Box>

            {/* Start & End time (if not all-day) */}
            {!allDay && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="Start time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1, minWidth: 180 }}
                  disabled={isLoading}
                  required
                />
                <TextField
                  label="End time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1, minWidth: 180 }}
                  disabled={isLoading}
                  required
                />
              </Box>
            )}

            {/* Location */}
            <TextField
              label="Location (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              fullWidth
              disabled={isLoading}
            />

            {/* Guests */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Guests (optional)
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {guests.map((email) => (
                  <Chip
                    key={email}
                    label={email}
                    onDelete={() => handleRemoveGuest(email)}
                    size="small"
                    disabled={isLoading}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Enter email address"
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddGuest();
                    }
                  }}
                  disabled={isLoading}
                  sx={{ flex: 1 }}
                />
                <Button size="small" onClick={handleAddGuest} disabled={isLoading || !guestInput.trim()}>
                  Add
                </Button>
              </Box>
            </Box>

            {/* Video conferencing */}
            <FormControl fullWidth disabled={isLoading}>
              <InputLabel>Video conferencing</InputLabel>
              <Select
                value={videoConferencing}
                onChange={(e) => setVideoConferencing(e.target.value as 'none' | 'google-meet')}
                label="Video conferencing"
              >
                <MenuItem value="none">None</MenuItem>
                <MenuItem value="google-meet">Google Meet</MenuItem>
              </Select>
            </FormControl>

            {/* Reminders */}
            <FormControl fullWidth disabled={isLoading}>
              <InputLabel>Reminder</InputLabel>
              <Select value={reminder} onChange={(e) => setReminder(e.target.value)} label="Reminder">
                <MenuItem value="">No reminder</MenuItem>
                <MenuItem value="default">Use calendar defaults</MenuItem>
                <MenuItem value="10m">10 minutes before</MenuItem>
                <MenuItem value="30m">30 minutes before</MenuItem>
                <MenuItem value="1h">1 hour before</MenuItem>
                <MenuItem value="1d">1 day before</MenuItem>
              </Select>
            </FormControl>

            {/* Description */}
            {mode === 'edit' && initialEvent?.description ? (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  Description / Notes
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'grey.50',
                    color: 'text.secondary',
                    maxHeight: 300,
                    overflow: 'auto',
                    '& p': { margin: '0 0 0.5em 0' },
                    '& ul, & ol': { margin: '0.5em 0', paddingLeft: '1.5em' },
                    '& a': { color: 'primary.main', textDecoration: 'underline' },
                    '& h1, & h2, & h3, & h4, & h5, & h6': { margin: '0.5em 0', fontWeight: 600 },
                    '& strong, & b': { fontWeight: 600 },
                  }}
                  dangerouslySetInnerHTML={{ __html: linkifyDescription(initialEvent.description) }}
                />
              </Box>
            ) : (
              <TextField
                label="Description / Notes (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                disabled={isLoading}
              />
            )}

            {/* Validation error */}
            {validationError && (
              <Alert severity="error" onClose={() => setValidationError(null)}>
                {validationError}
              </Alert>
            )}

            {/* Mutation error */}
            {mutationError && (
              <Alert severity="error" onClose={() => setSnackbarError(null)}>
                {mutationError.message}
              </Alert>
            )}

            {/* Join Meeting Button - Show when event has Google Meet link */}
            {mode === 'edit' && initialEvent?.hangoutLink && (
              <Box sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider', pb: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<VideocamIcon />}
                  onClick={() => {
                    if (initialEvent?.hangoutLink) {
                      window.open(initialEvent.hangoutLink, '_blank');
                    }
                  }}
                  fullWidth
                  sx={{
                    bgcolor: '#4285f4',
                    color: 'white',
                    textTransform: 'none',
                    '&:hover': {
                      bgcolor: '#3367d6',
                    },
                  }}
                >
                  Join Google Meet
                </Button>
              </Box>
            )}

            {/* RSVP Section - Show when user is an attendee (not owner) */}
            {mode === 'edit' && isUserAttendee && (
              <Box sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
                  Your RSVP
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant={currentRSVPStatus === 'accepted' ? 'contained' : 'outlined'}
                    color={currentRSVPStatus === 'accepted' ? 'success' : 'primary'}
                    onClick={() => handleRSVP('accepted')}
                    disabled={isLoading}
                    sx={{ textTransform: 'none', flex: 1 }}
                  >
                    {rsvping && currentRSVPStatus !== 'accepted' ? 'Updating…' : 'Yes'}
                  </Button>
                  <Button
                    variant={currentRSVPStatus === 'tentative' ? 'contained' : 'outlined'}
                    color={currentRSVPStatus === 'tentative' ? 'warning' : 'primary'}
                    onClick={() => handleRSVP('tentative')}
                    disabled={isLoading}
                    sx={{ textTransform: 'none', flex: 1 }}
                  >
                    {rsvping && currentRSVPStatus !== 'tentative' ? 'Updating…' : 'Maybe'}
                  </Button>
                  <Button
                    variant={currentRSVPStatus === 'declined' ? 'contained' : 'outlined'}
                    color={currentRSVPStatus === 'declined' ? 'error' : 'primary'}
                    onClick={() => handleRSVP('declined')}
                    disabled={isLoading}
                    sx={{ textTransform: 'none', flex: 1 }}
                  >
                    {rsvping && currentRSVPStatus !== 'declined' ? 'Updating…' : 'No'}
                  </Button>
                </Stack>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {mode === 'edit' && !isUserAttendee && (
            <Button onClick={handleDelete} color="error" disabled={isLoading} sx={{ textTransform: 'none', mr: 'auto' }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button onClick={handleClose} disabled={isLoading} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          {mode === 'create' || !isUserAttendee ? (
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={isLoading || !title.trim()}
              sx={{ textTransform: 'none' }}
            >
              {creating || updating ? 'Saving…' : mode === 'create' ? 'Create Event' : 'Save Changes'}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbars */}
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarMessage(null)} severity="success" sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
      <Snackbar
        open={!!snackbarError}
        autoHideDuration={6000}
        onClose={() => setSnackbarError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarError(null)} severity="error" sx={{ width: '100%' }}>
          {snackbarError}
        </Alert>
      </Snackbar>
    </>
  );
};

export default EventModal;

