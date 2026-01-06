# Calendar Phase 2 – Full /calendar Page + Dashboard Feed Channel

Owner: Greg / HRX  
Target: `hrx-god-view` (admin app)  
Status: Draft – ready for Cursor implementation  
Prereqs:  
- Calendar Cloud Functions live (`listCalendars`, `listEvents`, `createEvent`, `updateEvent`, `deleteEvent`)  
- Frontend API client + hooks already wired (`useCalendarList`, `useCalendarEvents`, `useCalendarEventMutations`)  
- Shared `EventModal` implemented and used by Dashboard `CalendarWidget`

---

## 1. Goals

1. Turn `/calendar` into a **full-screen scheduling hub** that feels close to Google Calendar:
   - Month / Week / Day views
   - Sidebar with calendar toggles
   - Click-to-create / click-to-edit events using the shared `EventModal`
2. Add **Calendar** as a first-class **Dashboard Feed channel**:
   - Shows upcoming + recent calendar events in the master feed
   - Clicking a row opens the event in calendar context (navigate to `/calendar` with the event highlighted)
3. Keep v2 focused on **read/write** and a clean UI.  
   Push notifications (Google Calendar watch channels) come later as Phase 3.

---

## 2. Data & Types (Recap)

Already in place (do *not* rename without deliberate migration):

- `src/types/calendar.ts`
  - `CalendarEvent`
  - `CalendarSummary`
  - `CalendarFeedItem` (new for this phase, see below)
- Hooks:
  - `useCalendarList()`
  - `useCalendarEvents({ calendarIds, rangeStart, rangeEnd })`
  - `useCalendarEventMutations()` → `{ createEvent, updateEvent, deleteEvent }`
- API client wraps Firebase callable functions:
  - `listCalendars`
  - `listEvents`
  - `createEvent`
  - `updateEvent`
  - `deleteEvent`

### 2.1 New Feed Types

Add to `src/types/calendar.ts` (or `src/types/feed.ts` if you prefer, but keep this shape):

```ts
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
```

Integrate this with the existing master feed type union, e.g.:

```ts
export type FeedSource = 'email' | 'slack' | 'sms' | 'internal' | 'calendar';

export type MasterFeedItem =
  | EmailFeedItem
  | SlackFeedItem
  | SmsFeedItem
  | InternalFeedItem
  | CalendarFeedItem;
```

---

## 3. /calendar Page – Layout & UX

**Route:** `/calendar`  
**Page component:** `src/pages/CalendarPage.tsx` (create if not present)

### 3.1 Layout (Desktop ≥ 1024px)

Use a **three-zone layout**:

1. **Top Header (full width)**  
   - Left: `Calendar` (H1-style text)  
   - Center: navigation + view controls  
   - Right: primary actions  

   **Controls:**
   - `Today` button
   - `<` and `>` chevrons (navigate previous/next period based on current view)
   - View switch:
     - Segmented control with `Day | Week | Month`
   - On the far right:
     - `+ New event` button → opens `EventModal` in create mode (default start = now or current view range start)

2. **Left Sidebar (fixed width ~260–280px)**  
   Containing:
   - **"My Calendars"** section:
     - For each `CalendarSummary` from `useCalendarList`, show:
       - Checkbox to toggle visibility
       - Colored bullet or small swatch (optional, can be random color per calendar)
       - Name (truncate with tooltip on hover)
   - **"Other Calendars"** section (if any shared calendars different from primary).
   - **"Upcoming"** mini list:
     - Next 5–10 events sorted by start time.
     - Row: `● color` + `title` + small time label (e.g., `Today 3:00p`, `Tue 10:30a`).
     - Clicking an item jumps the main view to that date and opens `EventModal` for that event.

3. **Main Calendar View (flex-grow)**  
   Fills remaining width with the selected view.

### 3.2 Views & Navigation

Use a `view` state: `'day' | 'week' | 'month'`.  
Use a `currentDate` state (Date or dayjs).

#### 3.2.1 Date Range Calculations

Create a helper `getCalendarRange(view, currentDate)` returning `{ start, end }` in ISO for `useCalendarEvents`.

- **Day view:** start = beginning of day, end = end of day.
- **Week view:** start = Monday 00:00, end = Sunday 23:59 (or respect locale).
- **Month view:** start = first visible cell (start of week containing the 1st), end = last visible cell.

`useCalendarEvents` should be called with:

```ts
const { start, end } = getCalendarRange(view, currentDate);
const { events, isLoading } = useCalendarEvents({
  calendarIds: visibleCalendarIdsFromSidebar,
  rangeStart: start,
  rangeEnd: end,
});
```

#### 3.2.2 Day View UI

- Vertical timeline from e.g. `6:00` to `22:00` (configurable).
- Left column: hour labels.
- Right column: event blocks.
- Event block:
  - Positioned and sized by start/end times (standard calendar layout).
  - Show title, time range in the block.
  - Click opens `EventModal` in edit mode.

#### 3.2.3 Week View UI

- 7 columns (Sun–Sat or Mon–Sun).
- Each column similar to Day view but compressed.
- Show an all-day row at the top for all-day events.
- Events that overlap should stack with a slight width split.

#### 3.2.4 Month View UI

- 7 columns × 5–6 rows.
- Each cell:
  - Top: day number.
  - Below: list of event chips for that day (limit 2–3, with `+N more` link).
- Clicking the cell background:
  - Open `EventModal` in create mode with start = cell date.
- Clicking an event chip:
  - Open `EventModal` in edit mode.
- Clicking `+N more`:
  - Might open a small modal or side panel listing all events for that day, but v1 can just navigate to Day view for that date.

### 3.3 EventModal Integration

Use the already built shared `EventModal`:

```tsx
const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
const [modalOpen, setModalOpen] = useState(false);

const openCreateModal = (date: Date) => {
  setModalMode('create');
  setSelectedEvent(null);
  setModalOpen(true);
};

const openEditModal = (event: CalendarEvent) => {
  setModalMode('edit');
  setSelectedEvent(event);
  setModalOpen(true);
};
```

EventModal props (adapt to actual implementation):

```tsx
<EventModal
  open={modalOpen}
  mode={modalMode}
  initialEvent={modalMode === 'edit' ? selectedEvent : undefined}
  defaultStart={modalMode === 'create' ? selectedDate : undefined}
  onClose={() => setModalOpen(false)}
  onSaved={() => {
    setModalOpen(false);
    refetchEvents(); // trigger useCalendarEvents refetch
  }}
/>
```

Ensure both `/calendar` and the Dashboard `CalendarWidget` use the **same** `EventModal` component and share as much styling as possible.

### 3.4 Mobile & Small Screens

Breakpoints:

- **≥ 1024px:** Full layout as described.
- **< 1024px:** Simplify.

Rules:

1. Collapse sidebar into a drawer:
   - Add an icon in the top-left of the header (`☰ Calendars`).
   - Tapping opens a slide-in drawer showing the calendars list and upcoming events.
2. Default view to `Day` or `Week`:
   - Month view can be accessible but should be more compact; events may be shown as a list rather than full grid.
3. EventModal:
   - Full-screen dialog on mobile.
   - Big close button and primary CTA at bottom.

---

## 4. Calendar as a Master Feed Channel

We already use the concept of **channels** in the Dashboard feed (email, Slack, etc.).  
Now we add **Calendar**, including push-style presence in the feed.

### 4.1 Source & Icon

- Add `'calendar'` to `FeedSource` enum.
- In the feed UI:
  - Source icon: calendar glyph.
  - Icon color: match the main calendar accent color (blue/indigo).
- Row background: same neutral as other feed items.

### 4.2 Feed Data Source (v2 – no push yet)

For now, we **derive** calendar feed items client-side when the user opens the Dashboard:

1. When Dashboard loads:
   - Call `useCalendarEvents` with a range like:
     - `now - 1 day` to `now + 7 days` (configurable).
   - Use all visible calendars (or at least primary).
2. Map events to `CalendarFeedItem` (see type above).
3. Merge into the main feed list, sorted by timestamp (start time).

Later, Phase 3 will replace this with push-driven updates via webhooks.

### 4.3 Feed Row Design

Each **calendar feed row** shows:

- **Left:** Calendar icon with colored badge.
- **Primary text (bold):** Event `title`.
- **Secondary line:**
  - Time range (formatted, local timezone):
    - Examples:
      - `Today · 3:00–3:30 PM`
      - `Tomorrow · All day`
      - `Mon Jan 12 · 9:00–10:00 AM`
  - If there are multiple attendees:
    - Show `+N guests` or `with Irene, Donna +2`.
- **Meta chips (right side):**
  - Calendar name (small pill).
  - Status (if not confirmed): e.g., `Tentative`, `Cancelled`.

**Interactions:**

- **Click row:**
  - Navigate to `/calendar`:
    - Pass query params, e.g., `/calendar?date=2026-01-05&eventId=abc123`.
    - On `/calendar` mount, if `eventId` present:
      - Jump to that date and scroll/select the event.
      - Optionally auto-open `EventModal` in edit mode.

Start with this navigation behavior; Drawer integration can come later.

### 4.4 Feed Filters & Badges

- Add a `Calendar` filter chip in the master feed filter bar.
- When `Calendar` is selected:
  - Show only items where `source === 'calendar'`.
- When `All` is selected:
  - Calendar items are included alongside email, Slack, etc., sorted by time.

---

## 5. Implementation Order

### Step 1 – /calendar Page (front-end only, hooks already wired)

1. Create / refactor `CalendarPage.tsx`:
   - Implement header, sidebar, main view scaffolding.
   - Use `useCalendarList` + `useCalendarEvents` with the range helpers.
   - Render Month view first (simplest).
2. Connect `EventModal` in create + edit mode.
3. Add Day and Week views.
4. Add mobile responsive behavior (drawer sidebar, full-screen EventModal).

### Step 2 – Integrate Calendar Feed (Dashboard)

1. Extend types for `FeedSource` and `MasterFeedItem`.
2. In the Dashboard feed data hook:
   - Call `useCalendarEvents` with (now - 1 day, now + 7 days).
   - Map to `CalendarFeedItem` and merge into the main list.
3. Implement row renderer for `source === 'calendar'`.
4. Implement row click navigation to `/calendar?date=...&eventId=...`.
5. Add `Calendar` filter chip.

### Step 3 – Polish & QA

- Confirm events created/edited/deleted in `/calendar`:
  - Appear correctly in:
    - Google Calendar web UI.
    - Dashboard feed (after refresh / data reload).
- Confirm that:
  - Time zones are correct.
  - All-day events render in both calendar and feed correctly.
  - Cancellations still show in feed (maybe ghosted or with `Cancelled` label).

---

## 6. Notes & Constraints

- Do **not** add server-side push/watching yet.  
  That will be a separate Phase 3 spec using Calendar `watch` channels.
- Try to reuse existing components (buttons, segmented controls, modals) for visual consistency.
- All new strings should be prepared for i18n later (avoid hard-coded text deep in logic).
- Keep visual styling close to Google Calendar but within our HRX design tokens (paddings, radius, font sizes).

---

**End of Spec – Calendar Phase 2**  
Use this as the single source of truth for upgrading `/calendar` and integrating Calendar into the Dashboard feed.
