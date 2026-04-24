/**
 * Calendar Types
 * 
 * Types for the full-screen Calendar feature and Calendar Feed integration.
 * Based on the full-screen-calendar-and-feed-spec.md specification.
 */

export type CalendarView = 'day' | 'week' | 'month';

export type CalendarAccessRole = 'owner' | 'writer' | 'reader' | 'freeBusyReader';

/**
 * Calendar summary from Google Calendar API (calendarList.list)
 */
export interface CalendarSummary {
  id: string;
  summary: string;
  description?: string;
  accessRole: CalendarAccessRole;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  isPrimary?: boolean;
  hidden?: boolean;
  selected?: boolean; // Google's selected field
}

/**
 * Normalized calendar event (used throughout the app)
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string; // ISO string for timed events
    date?: string; // YYYY-MM-DD for all-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: CalendarEventAttendee[];
  creator?: {
    email?: string;
    displayName?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
  recurrence?: string[]; // RRULE strings
  hangoutLink?: string; // Google Meet link
  htmlLink?: string; // "Open in Google Calendar" link
  colorId?: string;
  /**
   * HRX-specific metadata (non-Google fields) used internally for rendering and navigation.
   */
  hrx?: {
    /**
     * Gig shift identifier (Firestore shift doc id) for gig calendar events.
     * Child occurrences and the multi-day range bar share the same `gigShiftId`.
     */
    gigShiftId?: string;
    /**
     * True when this event represents a multi-day shift "range bar" (month view).
     */
    gigShiftRange?: boolean;
    /**
     * Gig job order estimated event window (multi-day range bar in month view).
     */
    gigJobOrderRange?: boolean;
    gigJobOrderId?: string;
    /**
     * Worksite / location display name for this shift — surfaced in the Account
     * Calendar tooltip so recruiters can tell shifts apart at a glance.
     */
    worksiteName?: string;
    /** "HH:mm" (24h) shift start — for tooltip rendering only. */
    shiftStartTime?: string;
    /** "HH:mm" (24h) shift end — for tooltip rendering only. */
    shiftEndTime?: string;
    /** Staff requested on the shift (from `shift.totalStaffRequested`). */
    requestedStaff?: number;
    /**
     * Distinct workers currently placed/assigned on this shift. Populated by
     * `useGigJobOrdersCalendar` via a batched query against
     * `tenants/{tid}/assignments` + `tenants/{tid}/placements` (keyed by shiftId).
     */
    assignedStaff?: number;
  };
  isAllDay: boolean;
  isRecurringInstance: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  optional?: boolean;
  avatarUrl?: string; // Enriched via People API
}

/**
 * Calendar feed item for Master Feed integration (Phase 2)
 * Simplified type for Dashboard feed integration
 */
export type CalendarFeedSource = 'calendar';

export interface CalendarFeedItem {
  id: string;                // event id
  source: CalendarFeedSource; // 'calendar'
  title: string;
  start: string;             // ISO
  end: string;               // ISO
  calendarId: string;
  calendarName: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  allDay: boolean;
  attendeesCount?: number;
  organizer?: string;
  hangoutLink?: string | null;
  location?: string | null;
  // For linking into /calendar
  dateKey: string;           // e.g., YYYY-MM-DD (start date in local time)
}

/**
 * Event creation/update payload
 */
export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    optional?: boolean;
  }>;
  recurrence?: string[];
  conferenceData?: {
    createRequest?: any; // Pass-through for Google Meet
  };
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'popup' | 'email';
      minutes: number;
    }>;
  };
  colorId?: string;
}

/**
 * API request/response types
 */
export interface ListCalendarsResponse {
  calendars: CalendarSummary[];
}

export interface ListCalendarEventsRequest {
  calendarIds: string[];
  timeMin: string; // ISO
  timeMax: string; // ISO
  timeZone?: string;
  syncToken?: string | null;
}

export interface ListCalendarEventsResponse {
  events: CalendarEvent[];
  nextSyncToken?: string;
}

export interface CreateUpdateCalendarEventRequest {
  calendarId: string;
  eventId?: string; // If present => update, else create
  payload: CalendarEventInput;
}

export interface DeleteCalendarEventRequest {
  calendarId: string;
  eventId: string;
}

