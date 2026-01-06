# Full-Screen Calendar Page & Calendar Feed Channel — Build Spec (HRX1)

Author: ChatGPT  
Consumer: Cursor (HRX1 project)  
Date: 2026-01-05

---

## 1. Goals & Scope

We want a **full-screen Calendar experience** inside HRX1 that:

1. Mirrors the core usability of Google Calendar (day/week/month views, multi-calendar, shared calendars, invitees, Meet links).
2. Integrates cleanly with our existing **Dashboard**:
   - Calendar becomes a **first-class “channel”** in the **Master Feed** (with a calendar icon).
   - Calendar-based events & changes surface as feed items (e.g., “New event,” “Event changed,” “Invitation received,” “Reminder”).
3. Reuses common patterns:
   - Same border radius / card styling as other dashboard widgets.
   - Shares a single **Event Modal** with the Dashboard mini-calendar.

This spec focuses on:

- Frontend UI/UX for the **full-screen Calendar page**.
- API contracts against our backend (which proxies Google Calendar).
- Integration with the Master Feed using push notifications (“channels” in Google Calendar API).

---

## 2. Google Calendar API Capabilities to Use

Backend will talk to Google APIs with the user’s OAuth tokens.

### 2.1. Calendars

Use:

- `calendarList.list`  
  - Fetch all calendars the authenticated user can access (primary + shared).  
  - Provides:
    - `id`
    - `summary`
    - `backgroundColor` / `foregroundColor` (via `colors.get` if needed)
    - `accessRole` (owner/writer/reader)
    - `selected` / `hidden`

### 2.2. Events

Use:

- `events.list` with:
  - `timeMin`, `timeMax` (for day/week/month ranges)
  - `timeZone`
  - `singleEvents=true` (expand recurring)
  - `orderBy=startTime`
- `events.insert` / `events.update` / `events.patch` / `events.delete` for CRUD.
- `conferenceData` for Google Meet creation (must enable conferencing on the project).
- `attendees[]` for invitees.
- Recurrence via `recurrence: ["RRULE:..."]` (simple RRULE support is sufficient).

### 2.3. Change Notifications & Sync

- **Push notifications** (Google calls these “channels”):
  - Use `events.watch` to receive webhook notifications when events change for a calendar.
  - Use `calendarList.watch` if we also need to detect calendars being added/removed.
- **Incremental sync**:
  - Use `syncToken` returned from `events.list` to fetch changes since last sync.
- Backend responsibility:
  - Convert webhook payloads into our own **Feed events** in Firestore so the Master Feed can subscribe via `onSnapshot`.

### 2.4. People / Avatars (Optional but recommended)

- Use the **People API** to resolve attendee emails into:
  - Display name
  - Photo URL (for avatars in the UI).

---

## 3. Routes & API Contracts

### 3.1. Backend HTTP Endpoints (Cloud Functions)

All routes assume the user is authenticated in HRX1 and we’ve stored a Google refresh token.

1. `GET /api/calendar/list`
   - Returns user’s `calendarList` data.
   - Response: `CalendarSummary[]`:
     ```ts
     type CalendarSummary = {
       id: string;
       summary: string;
       description?: string;
       accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
       colorId?: string;
       backgroundColor?: string;
       foregroundColor?: string;
       isPrimary?: boolean;
       hidden?: boolean;
       selected?: boolean;
     };
     ```

2. `POST /api/calendar/events`
   - Body:
     ```ts
     {
       calendarIds: string[];        // calendars to include
       timeMin: string;              // ISO
       timeMax: string;              // ISO
       timeZone?: string;
       syncToken?: string | null;    // for incremental sync
     }
     ```
   - Response:
     ```ts
     {
       events: CalendarEvent[];
       nextSyncToken?: string;
     }
     ```

   - `CalendarEvent` (normalized shape we use everywhere):
     ```ts
     type CalendarEvent = {
       id: string;
       calendarId: string;
       status: "confirmed" | "tentative" | "cancelled";
       summary: string;
       description?: string;
       location?: string;
       start: { dateTime?: string; date?: string; timeZone?: string };
       end: { dateTime?: string; date?: string; timeZone?: string };
       attendees?: {
         email: string;
         displayName?: string;
         responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
         optional?: boolean;
         avatarUrl?: string; // if enriched via People API
       }[];
       creator?: { email?: string; displayName?: string };
       organizer?: { email?: string; displayName?: string };
       recurrence?: string[];
       hangoutLink?: string;     // Google Meet
       htmlLink?: string;        // “Open in Google Calendar”
       colorId?: string;
       isAllDay: boolean;
       isRecurringInstance: boolean;
       createdAt: string;
       updatedAt: string;
     };
     ```

3. `POST /api/calendar/event`
   - Create or update event.
   - Body:
     ```ts
     {
       calendarId: string;
       eventId?: string; // if present => update, else create
       payload: {
         summary: string;
         description?: string;
         location?: string;
         start: { dateTime?: string; date?: string; timeZone?: string };
         end: { dateTime?: string; date?: string; timeZone?: string };
         attendees?: { email: string; displayName?: string; optional?: boolean }[];
         recurrence?: string[];
         conferenceData?: { createRequest?: any }; // pass-through
         reminders?: { useDefault: boolean; overrides?: { method: "popup" | "email"; minutes: number }[] };
         colorId?: string;
       };
     }
     ```
   - Response: normalized `CalendarEvent`.

4. `DELETE /api/calendar/event`
   - Body:
     ```ts
     { calendarId: string; eventId: string; }
     ```

5. `POST /api/calendar/watch`
   - Sets up Google “channels” for push notifications per calendar.
   - Should be called when a user first connects Google or when enabling Calendar channel in settings.

6. `POST /api/calendar/webhook`
   - Google calls this when events change.
   - Backend:
     - Uses `syncToken` to fetch changed events.
     - Writes **Feed entries** into Firestore (see §6).

---

## 4. Frontend – Full-Screen Calendar Page

Route: `/calendar`

### 4.1. Global Page Layout

**Desktop (≥ 1024px width)**

- **Top header bar** (sticky):
  - Left:
    - Page title: **Calendar**
    - View switch segmented control: `Today | Week | Month`
  - Center:
    - Current range label:
      - Today: `Today — Jan 5, 2026`
      - Week: `Jan 5 – Jan 11, 2026`
      - Month: `January 2026`
  - Right:
    - `‹` and `›` navigation buttons (advance range by 1 day / week / month)
    - `+ New Event` primary button → opens Event Modal.

- **Body: 2 columns**:
  - Left: main calendar (`70–75%`).
  - Right: sidebar (`25–30%`): calendar list, upcoming events.

**Mobile (< 1024px)**

- Single column:
  - Header remains sticky.
  - Main calendar below.
  - Sidebar content becomes collapsible sections or goes into a slide-out drawer (e.g., “Calendars” button in header to toggle).

Common styling:

- Use **same card radius and shadow** tokens as Dashboard widgets.
- Background: neutral light (`#F7F8FA` type) with white cards for content.

---

### 4.2. Main Calendar Modes

#### 4.2.1. Month View

- 7 columns (Sun–Sat), 5–6 rows.
- Each cell:
  - Date number top-left.
  - Up to `3` visible events as pills:
    - Pill shows event color stripe, title (truncated).
  - `+N more` link if overflow:
    - Clicking opens a **Day Events** modal or side drawer listing all events for that date.
- Clicking empty area in a day cell:
  - Opens **Event Modal** with date preselected, default 30–60 minute block.

#### 4.2.2. Week View

- Column headers: Sun–Sat with date.
- Leftmost column: time-of-day grid (6am–10pm; extend as needed).
- All-day events row at top.
- Timed events rendered as blocks positioned in grid.
- Interactions (v1):
  - Click on time slot → open Event Modal with start/end filled.
  - Hover shows tooltip (title, time, location).
- Interactions (v2+):
  - Drag-to-create (click-drag to create new block).
  - Drag-to-move and resize events.

#### 4.2.3. Today View

- Same layout as Week view but single day.
- Large hour grid; show **“now” line** (horizontal rule at current time).

---

### 4.3. Event Rendering

**Event block / pill properties:**

- Background color based on **calendar color** (lighter tone), with a darker stripe/border or left accent.
- Text:
  - Title (truncated, 1 line).
  - Time range (e.g., `9:00–10:00 AM`) or “All-day”.
- Icons:
  - Camera icon if event has `hangoutLink` (Google Meet).
- Attendees:
  - Show 2–3 stacked avatars or initials (use People API where available).

**On click:**

- Open **Event Details drawer** (right side) or center modal:
  - Title, date/time.
  - Location + clickable Meet link.
  - Calendar name + color.
  - Attendees with RSVP chips (“Accepted / Tentative / Declined / No response”).
  - Description.
  - Buttons:
    - “Edit event” → open Event Modal in edit mode.
    - “Open in Google Calendar” → `htmlLink` in new tab.
    - “Delete” (if user has write access).

---

### 4.4. Sidebar

#### 4.4.1. Calendar List

Two sections:

1. **My Calendars**
2. **Other Calendars** (shared & domain-level calendars)

Each row:

- Checkbox: show/hide calendar in the main view.
- Color dot / swatch:
  - Clicking opens a color picker mapped to Google’s `colorId` options.
- Label: calendar name.

Internals:

- `selectedCalendarIds` is persisted in Firestore per user, separate from Google’s own “selected” field so we can control the UI.

#### 4.4.2. Upcoming Events (“Agenda”)

- Vertical list of next N upcoming events across selected calendars.
- Each list item:
  - Time + title + calendar color icon.
  - Optionally show location or a Meet icon.
- Click item:
  - Scroll/center corresponding event in main calendar (if visible in current view) and open Event Details drawer.

---

## 5. Event Modal (Shared With Dashboard)

Component: `<EventModal />`

Used by:

- Full-screen calendar (`/calendar`)
- Dashboard mini-calendar (“Add Event” button)
- Clicking empty slot in any view
- Possibly quick-add from Master Feed in future

### 5.1. Fields

- **Title** (required)
- **Date & Time**:
  - Start & end pickers
  - Timezone dropdown (default to user’s TZ)
  - “All-day” toggle
- **Calendar**:
  - Dropdown of calendars user can write to (`accessRole !== "reader"`).
- **Guests**:
  - Email chips with autocomplete (People API + internal contact data).
- **Location**
- **Video conferencing**:
  - Toggle: “Add Google Meet” → sets `conferenceData.createRequest`.
- **Description** (rich text optional; plain text is fine v1).
- **Reminders**:
  - “Use calendar defaults” toggle.
  - Optional overrides chip-style (“10 min before”, “1 hour before”, “1 day before”).

### 5.2. Actions

- Primary: **Save**
  - Calls `POST /api/calendar/event`.
- Secondary:
  - Cancel (close modal).
  - Delete (only if editing existing event and user has appropriate permissions).

---

## 6. Calendar as a Master Feed Channel

We will treat **Calendar** as a first-class **Feed Channel**, alongside:

- Email
- Slack DMs / Channels
- SMS / Messenger
- Internal actions

### 6.1. Channel Definition

- **Channel key**: `"calendar"`
- **Icon**: calendar glyph (matching existing iconography).
- **Default color**: use a distinct neutral or blue-tinted accent (e.g., `#4F8EF7`) to differentiate from email blue; we can finalize palette later.
- **Filter**:
  - Master Feed filter dropdown should include **“Calendar”** as a source option.
  - Feed row’s left source column should show the calendar icon with channel color.

### 6.2. Calendar Feed Event Types

We will create feed entries in Firestore when Calendar webhooks fire.

Suggested types:

1. `calendar.eventCreated`
   - E.g., “New event: *C1 Weekly Sales Call* on Tue, Jan 6, 9–10am”
2. `calendar.eventUpdated`
   - E.g., “Event updated: *C1 Weekly Sales Call* (time changed to 10–11am)”
3. `calendar.eventCancelled`
   - E.g., “Event cancelled: *C1 Weekly Sales Call*”
4. `calendar.invitationReceived`
   - When user is added as an attendee to a new or existing event.
5. `calendar.reminderUpcoming`
   - Optional, v2: use a cron-like service or Google reminders to create feed items X minutes before an event if the user opts in.

### 6.3. Feed Payload Shape

Minimal shape for use by Dashboard:

```ts
type CalendarFeedItem = {
  id: string;
  type:
    | "calendar.eventCreated"
    | "calendar.eventUpdated"
    | "calendar.eventCancelled"
    | "calendar.invitationReceived"
    | "calendar.reminderUpcoming";
  channel: "calendar";
  createdAt: string;  // when we logged it
  eventId: string;
  calendarId: string;
  title: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  summaryLine: string;    // preformatted snippet shown in the feed row
  actor?: { email?: string; displayName?: string }; // who changed it
  htmlLink?: string;      // open in Google Calendar
};
```

### 6.4. Feed Row UI Behavior (Dashboard)

For a `CalendarFeedItem`:

- **Source column**:
  - Calendar icon with calendar channel color.
- **Snippet/Title column**:
  - Primary: event title (truncated).
  - Secondary line: relative time + simple text, e.g.:
    - `Tue, Jan 6, 9–10am • Invitation received`
    - `Starts in 10 minutes • Upcoming event`
- **Actions column**:
  - Click whole row → open **universal Drawer** in **Calendar scope**:
    - Shows Event Details (same component as `Event Details drawer` from `/calendar`).
  - Optional inline actions:
    - “Accept / Decline / Maybe” for invitation-type items.

### 6.5. Real-time

- Firestore `feedItems` collection already used by Master Feed should subscribe via `onSnapshot`.
- Calendar webhook → backend writes new `feedItems` → Master Feed updates in real time.

---

## 7. State & Data Flow (Frontend)

### 7.1. Calendar Page State

```ts
type CalendarView = "day" | "week" | "month";

type CalendarPageState = {
  baseDate: Date;                // the “anchor” date for current view
  view: CalendarView;
  range: { start: Date; end: Date };
  calendars: CalendarSummary[];
  selectedCalendarIds: string[];
  events: CalendarEvent[];       // unified list for current range
  loading: boolean;
  error?: string;
};
```

- `range` derived from `baseDate + view`.
- On:
  - View change (Today/Week/Month)
  - Navigation (prev/next)
  - Calendar selection changes  
  → fetch events for `selectedCalendarIds` + `range`.

### 7.2. Sync Strategy

- Use `syncToken` per user + per calendar set where feasible:
  - Store `syncToken` in Firestore keyed by `{userId, calendarId}`.
  - On webhook or periodic refresh, call `events.list` with `syncToken` to get incremental updates.
- Fallback: full `timeMin/timeMax` fetch for current visible range.

---

## 8. Responsive & UX Notes

- **Single design system**:
  - Same card radius for Dashboard widgets and full calendar.
  - Calendar grid should respect our spacing scale (e.g., 8px / 12px / 16px increments).
- **Hover & focus states**:
  - All event blocks, buttons, and pills should have clear hover & focus rings (for accessibility).
- **Empty state**:
  - If a day/week has no events, show a subtle “No events scheduled” message in the center of the grid.
- **Performance**:
  - Limit events fetched to visible range + small buffer (e.g., ± 1 day).
  - Debounce calendar selection changes before re-fetching events.

---

## 9. Implementation Order

1. **API layer** (backend + simple frontend hooks)
   - Implement `/api/calendar/list`, `/api/calendar/events`, `/api/calendar/event`.
2. **Event Modal** (`<EventModal />`)
   - Shared between Dashboard and Calendar page.
3. **Full-screen Calendar UI**:
   - Month view first (no drag), then Week/Day.
4. **Sidebar**:
   - Calendar list + upcoming events.
5. **Calendar Feed Integration**:
   - Implement `CalendarFeedItem` type, UI, and `Calendar` channel in Dashboard.
   - Wire webhook handler to create feed items.
6. **Push channels** (webhooks) + incremental sync.
7. **Advanced interactions** (drag & drop, resize, keyboard shortcuts).

This spec should give Cursor enough structure to implement the full /calendar feature, wire it to Google Calendar, and integrate it into the Dashboard Master Feed as a Calendar channel.
