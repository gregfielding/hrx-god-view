# Dashboard Calendar Widget – Refinement Spec (v2)

> **Context for Cursor**  
> This spec refines the **Dashboard Calendar widget** design and behavior. It should be applied *only* to the Dashboard Calendar widget and any shared styles/tokens used by dashboard widgets (for border radius + spacing). **Do not change unrelated layouts or components.**

The goal is to:
- Reduce visual bulk / padding
- Simplify controls (no CRM/Google chips, only Today + Week)
- Standardize border radius across all dashboard widgets
- Add an “Add Event” modal that feels like Google Calendar’s native “Quick Add” dialog.

Assume the existing dashboard already shows three main widgets side‑by‑side (or stacked on mobile):
- Master Feed
- Calendar
- To‑Dos

This spec is about the **Calendar widget**, with a couple of **shared style rules** for all dashboard widgets.

---

## 1. Calendar Widget – Layout & Controls

### 1.1. Remove CRM / Google Chips

**Current:**  
- Header includes “Calendar” + two chips: **CRM** (blue) and **Google** (green).

**Change:**  
- Remove the CRM and Google chips entirely from the Calendar header.
- If there is any underlying logic for switching calendar sources, keep the logic but move the control elsewhere later (do **not** delete code paths, just hide the chips from the UI).

Implementation notes:

- Remove/hide the chip components from the JSX for this widget.
- If removing them causes layout collapse, replace with simple flex gap so that the title alignment still looks intentional.

```tsx
// Pseudocode — DO NOT blindly paste
<WidgetHeader>
  <WidgetTitle>Calendar</WidgetTitle>
  {/* Chips removed for now */}
  <CalendarViewToggle /> {/* Today / Week (see below) */}
  <CalendarIconButton />  {/* if we still keep a small icon */}
</WidgetHeader>
```

---

### 1.2. View Modes – Only “Today” and “Week”

**Current:**  
- Tabs/buttons: `Today`, `Week`, `Month`.

**Change:**  
- Only support **Today** and **Week** for now.
- Remove **Month** from the UI and disable / comment out month‑view code paths if trivial; otherwise leave implementation but not exposed in UI.

**Behavior:**

- **Today view (default):** shows a **single card** for “Today — {date}” with list of events for the current day.
- **Week view:** shows a compact week strip – but per this phase, you can keep the existing week layout and just ensure spacing matches the new style rules below.

**Navigation:**

- Left/right chevron buttons should still move to **previous/next day** in Today view and **previous/next week** in Week view.
- The “Today” button (if present separately) should snap back to the real current date.

---

### 1.3. Reduce Padding / Overall Density

We need the Calendar card to feel lighter and take less vertical space while staying readable.

**General rules for this widget:**

- **Outer widget padding:** around `24px` (top/bottom) and `24–28px` (left/right). If we already use a `var(--card-padding)` token, set that token to something like `20–24px` and reuse across all dashboard widgets.
- **Header row padding:**  
  - Vertical: `12–16px`  
  - Horizontal: match widget horizontal padding.
- **Inner “Today — Jan 4” event card:**  
  - Use a single bordered card with `16–20px` padding inside.
  - Avoid giant vertical whitespace; keep line spacing tight but readable.

**Typography suggestions (non‑breaking):**

- “Calendar” title: keep as existing H5/H6 weight; no change needed apart from margins.
- “Today — Jan 4” (view title): bold, slightly larger than body, but not huge. Use same style as other widget section titles for consistency.
- Event lines: normal body size; don’t increase font size.

**Spacing details (approximate):**

- Gap between **Calendar header row** and **“Today — Jan 4” line**: `12–16px`.
- Gap between **“Today — Jan 4”** and the **event card**: `8–12px`.
- Gap between multiple events inside the card: `6–8px`.

Where possible, use tokens / theme spacing (e.g. `theme.spacing(2)` etc.) so that we can tune later.

---

## 2. Add Event Button + Modal

### 2.1. Button Placement and Style

- Keep the **“Add Event”** button on the right side of the “Today — Jan 4” bar.
- Button style should match other primary buttons in the app (outlined pill or contained – whichever we’re using in the screenshot), but use **the same size and radius** as other dashboard widget primary buttons.

Interaction:

- Clicking **Add Event** opens a modal dialog for creating a new event.

### 2.2. Add Event Modal – Behavior & Fields

**Goal:** Feel similar to Google Calendar’s quick add dialog, but simplified.

**Trigger:**

- Click **Add Event** in the Calendar widget.
- (Optional later) Double‑click on an empty space in the day view or click a plus icon on a specific time slot.

**Modal content (MVP):**

Required fields:

1. **Title** (text)
2. **Date & Time**
   - Date picker (default: selected date in the Calendar; usually today).
   - Time: start time + end time, or a toggle for “All‑day” event.
3. **Location** (optional text)
4. **Invitees** (optional)
   - Autocomplete input for people (email or name).
   - Use our existing people search/service if available.
5. **Video / Meet Link**
   - A toggle/checkbox: “Add Google Meet link”.  
   - For now, if hooking into real Google Meet is non‑trivial, allow a placeholder link generation function (e.g., stubbed or using a test URL). The UI should be ready for real integration later.
6. **Description / Notes** (multiline text area).

Actions:

- **Primary CTA:** “Save Event”
- **Secondary:** “Cancel” or close icon.
- Disable “Save” until required fields are valid.

Validation (MVP):

- Title is non‑empty.
- If start and end time provided, ensure end > start.

### 2.3. Integration Notes

Do **not** implement complex Google Calendar write logic yet if it’s not already in place. Instead:

- Wire the modal so that submitting triggers a handler like `handleCreateCalendarEvent(payload)`.
- Inside that handler:
  - Call an existing API / function if we have it, **or**
  - For now, just log the payload to console and close the modal.
- Keep the payload shape stable and documented in a central type (e.g. `DashboardCalendarEventInput`) so we can plug in real integrations later.

Suggested payload shape:

```ts
type DashboardCalendarEventInput = {
  source: 'crm' | 'google' | 'hrx';   // if we already know which calendar, else default 'hrx'
  title: string;
  date: string;                       // ISO date, e.g. '2026-01-04'
  startTime?: string;                 // 'HH:mm' (24h) or ISO timestamp
  endTime?: string;
  allDay?: boolean;
  location?: string;
  invitees?: { email: string; name?: string }[];
  addMeetLink?: boolean;
  description?: string;
};
```

---

## 3. Uniform Border Radius Across Dashboard Widgets

We want all dashboard widgets (Feed, Calendar, To‑Dos) to feel like part of the same system.

**Rules:**

- **Widget container border radius**: pick a single token, e.g. `var(--dashboard-card-radius)` and use the same value (e.g. `16px` or `20px`) for:
  - Master Feed widget
  - Calendar widget
  - To‑Dos widget
- Inner cards **inside** widgets (e.g., each feed row container, today’s event card) should use a **slightly smaller radius** (e.g. `8–12px`) but again via a shared token like `var(--dashboard-inner-radius)`.
- Make sure shadows / borders are also standardized via tokens.

Implementation sketch:

```ts
// theme (example, adapt to our setup)
export const dashboardShape = {
  outerRadius: 16,
  innerRadius: 10,
};
```

Use these in the widget components instead of hard‑coded numbers.

---

## 4. Responsive Rules (Calendar Widget)

### 4.1. Desktop (≥ 1200px)

- Calendar widget appears as a **right‑side card** alongside Feed and To‑Dos (as currently designed).
- Keep it roughly 1/3 width if three columns, or follow current layout grid.
- Ensure header controls (Today/Week + navigation + Add Event) stay on a single row without wrapping.

### 4.2. Tablet (≈ 768–1199px)

- Dashboard may move to **two columns** (Feed full width on top, Calendar + To‑Dos side by side below, or similar).
- Calendar widget:
  - Full‑width or half‑width is fine as long as content remains readable.
  - If space is tight, move “Add Event” below the date line, aligned right.

### 4.3. Mobile (≤ 767px)

- Dashboard widgets stack vertically.
- Calendar widget specifics:
  - Full‑width card with reduced padding (e.g. `16px`).
  - Header should collapse horizontally:
    - Line 1: “Calendar” on the left, maybe small calendar icon on the right.
    - Line 2: view toggle (`Today | Week`) and left/right arrows.
  - “Add Event” becomes:
    - Either a full‑width button below the date, **or**
    - A compact icon button (plus) in the top‑right of the card – choose whichever matches our existing mobile patterns best.
- Event list inside the day card should be vertically compact:
  - One event per row
  - No more than `8px` vertical gap between items
  - Consider truncating description to 1–2 lines with ellipsis.

---

## 5. Don’t Break Existing Logic

While implementing, **do not** change:

- Existing calendar data fetching logic.
- Any global date/time handling utilities.
- Any `onEventClick` or event‑select handlers (keep them wired as they are now).

You **may**:

- Small refactors inside the Calendar widget component to:
  - Introduce new subcomponents (e.g. `CalendarHeader`, `TodayCard`, `AddEventModal`)
  - Replace magic numbers with shared design tokens / theme values.

---

## 6. Acceptance Checklist

- [ ] CRM/Google chips are removed from Calendar header (UI only; underlying logic not broken).
- [ ] Header shows only **Today** and **Week** view options.
- [ ] Calendar widget uses reduced padding and feels denser but readable.
- [ ] “Add Event” button opens a modal with fields: title, date, time, all‑day toggle, location, invitees, meet toggle, description.
- [ ] Modal validates required fields and can be closed/cancelled.
- [ ] Submitting the modal passes a structured payload to `handleCreateCalendarEvent` (or equivalent) without crashing.
- [ ] All three dashboard widgets share the same **outer border radius**.
- [ ] Inner cards inside the Calendar widget use a smaller, standardized inner radius.
- [ ] Layout holds up on desktop, tablet, and mobile without overlapping or broken controls.
