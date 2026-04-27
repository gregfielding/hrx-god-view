/**
 * Calendar Types
 * 
 * Types for the calendar API functions.
 * These types match the frontend types in src/types/calendar.ts
 */

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
export interface ListCalendarEventsRequest {
  calendarIds: string[];
  timeMin: string; // ISO
  timeMax: string; // ISO
  timeZone?: string;
  syncToken?: string | null;
}

