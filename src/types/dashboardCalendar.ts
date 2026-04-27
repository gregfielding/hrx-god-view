export type DashboardCalendarEventInput = {
  source: 'crm' | 'google' | 'hrx';
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay?: boolean;
  location?: string;
  invitees?: { email: string; name?: string }[];
  addMeetLink?: boolean;
  description?: string;
};


