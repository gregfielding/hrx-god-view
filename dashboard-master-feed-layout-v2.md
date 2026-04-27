# Dashboard Master Feed – Layout & UX Refinements (v2)

## 1. Goals

- Make the master Feed denser and more scannable (less horizontal scrolling, better use of vertical space).
- Standardize visual language across channels (Email, Slack, SMS, Internal, etc.).
- Clean up filters so they match how people actually work.
- Fix small visual issues (search cutoff, inconsistent paddings, icon alignment).
- Keep the component **extensible** so new sources (Job Orders, Applications, etc.) can be added as new “channels” without changing the core layout.

This spec assumes the existing v1 feed is already wired to:
- Email (Gmail)
- Slack DMs
- Slack channels (for channels user has joined and not muted)

---

## 2. Data Model (unchanged baseline)

Each feed item should already have something like:

```ts
type FeedSource = 'email' | 'slack_dm' | 'slack_channel' | 'sms' | 'internal_action';

type FeedItem = {
  id: string;
  source: FeedSource;
  sourceId: string;        // e.g. email threadId, slack channelId, sms threadId
  title: string;           // email subject, slack first line, etc.
  snippet: string;         // first line / short content
  fromName?: string;
  fromAvatarUrl?: string;
  fromInitials?: string;   // fallback to initials
  status?: 'unread' | 'read' | 'pinned'; // can expand later
  isPinned?: boolean;
  isUnread?: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  // channel-specific metadata as needed
};
```

We’ll change **how** this is rendered, and how filter chips work, but not the underlying model.

---

## 3. Column Layout – v2

### 3.1 Remove “Source” Label Text

- Keep only the **icon** for the source (email, Slack, SMS, etc.).
- Remove the literal text “Email” from each row.
- Column header stays as **Source**, but the cells show **only icons**.

#### Source Column Specs

- Width: `64px` fixed (enough for a colored icon and maybe a tiny badge).
- Content: centered icon button (non-clickable; full row click opens drawer, not the icon).
- Tooltip on hover: 
  - Email → “Email”
  - Slack DM → “Slack Direct Message”
  - Slack Channel → “Slack Channel”
  - SMS → “SMS Text Message”
  - Internal → “Internal Activity”

---

### 3.2 Combined Title + Snippet Column

Goal: Reduce horizontal columns by merging **Title** and **Snippet** into a single rich cell.

#### New Column: **Activity**

- Replace separate **Title** and **Snippet** columns with a single **Activity** column.
- Layout inside cell:

```text
[Title / Subject (bold, truncated to 1 line)]
[Snippet / First line of body (muted, truncated to 1 line)]
```

- Typography:
  - Title: `font-weight: 600`, `font-size: 14px`, truncate with ellipsis.
  - Snippet: `font-weight: 400`, `font-size: 13px`, color `text.secondary`.
- Max height: 2 lines total (1 line title + 1 line snippet). No wrapping beyond that.
- On hover: show full title + snippet in a tooltip.

This alone should significantly reduce horizontal width and make the feed feel more like Gmail/Inbox style, but with richer context.

---

### 3.3 From Column – Fix + Simplify

Current issues:
- “Unknown” with a square badge looks odd and wastes space.

New rules:

- Column header: **From**
- If we have sender info:
  - Show small circular avatar (or square if that’s standard across the app).
  - Next to avatar, show **fromName** (truncate at ~18–20 characters).
- If unknown:
  - Show icon placeholder (e.g., gray user silhouette) + label “Unknown” in muted color.
- Width: `180–220px` max, with ellipsis for long names.

Responsive behavior:
- On small screens, hide the “From” column entirely and move it into the Activity cell as a small line at the bottom:

```text
[Title…]
[Snippet…]
[From: Greg Fielding · Just now]
```

This can be controlled with CSS breakpoints + conditional rendering.

---

### 3.4 Status Column – Light Touch

- Column header: **Status**
- Content:
  - Chip-style status label, e.g.:
    - “Unread” (filled subtle chip)
    - “Pinned” (outlined chip)
    - empty / “Read” → show dash `—` or nothing.
- Keep width narrow (~120px).

Optional v2 enhancement:
- Combine **Status** + small channel icon, e.g. unread dot next to source icon instead of separate chip. Cursor can decide which is cleaner once in code.

---

### 3.5 Time Column – Clean & Compact

- Column header: **Time**
- Right-align contents.
- Use smart formatting:
  - “Just now” (0–2 min)
  - “5 min ago”
  - “3:45 PM” (same day)
  - “Yesterday”
  - “Jan 4” (past week)
  - “Jan 4, 2025” (older)
- Hover tooltip: full timestamp (ISO or “Jan 4, 2026 3:45 PM PST”).

This keeps the column narrow but readable.

---

### 3.6 Actions (Per Row)

Right now you have reply / snooze / check / open icons. For v2:

- For the **Dashboard Feed specifically**, simplify actions to:
  - **Quick Reply / Open**: icon that opens the drawer and focuses the appropriate reply composer.
  - **Pin / Unpin**: star or pin icon.
- Snooze and Complete can be handled *inside* the drawer for now, or added back later.

Behavior:
- Show actions on **hover** only on desktop to reduce visual noise.
- On mobile, actions go inside the row’s detail slide-out or long-press menu.

---

## 4. Filter Bar – Simplify & Fix

### 4.1 Filter Chips (Row 1)

Current: `All | Unread | Pinned | Snoozed | Completed | Today | Last 7 Days | Source`

New chip set:

- **All**
- **Unread**
- **Pinned**

That’s it for status filters.

Behavior:
- Single-select for now (only one can be active), with default = **All**.
- In future we can allow multi-select (All is a special case and becomes deselected if others are on).

### 4.2 Time Filters – Move to Dropdown

Because the feed is scrollable, we don’t need **Today** and **Last 7 days** as big primary chips.

- Add a small dropdown labeled **Date** or **Time range** to the right of the chips.
- Options:
  - All time (default)
  - Today
  - Last 7 days
  - Last 30 days
- This keeps the top row clean while still allowing “tightening” the feed when needed.

### 4.3 Source Filter – Fix Edge Cutoff

- Keep **Source** dropdown, but ensure:
  - Container has extra padding-right to avoid clipping into the widget’s border radius.
  - Or, place the filters in a flex container with `gap: 8–12px` and `padding-inline: 16px`, while the search bar sits **below** or wraps on a second line for smaller widths.

---

## 5. Color Coding by Channel

Introduce a consistent color system for source icons only (not full rows):

- Email → **Blue** icon
- Slack (DM + channels) → **Violet / Indigo** icon
- SMS / Text → **Green** icon
- Internal actions (e.g. job updates) → **Orange** icon

Implementation notes:

- Use theme tokens, e.g.:

```ts
const channelColorBySource: Record<FeedSource, PaletteColorKey> = {
  email: 'primary',
  slack_dm: 'secondary',      // or custom `slack`
  slack_channel: 'secondary',
  sms: 'success',
  internal_action: 'warning',
};
```

- Icons should be:
  - 32x32
  - background = very light tint of the color
  - icon glyph = solid color
  - border-radius = 12px (or whatever your global “chip / avatar” radius is).

This makes scanning the source column extremely fast.

---

## 6. Row Density & Spacing

To improve usability and reduce “wonkiness”:

- Row height target: **60–64px** for default (not too tall; similar to Gmail default).
- Vertical padding per row: `10–12px`.
- Horizontal padding inside the widget: `16px` left/right.
- Use a very light alternating row background or hover effect:

  - Default row: white.
  - Hover: light gray background (#F5F7FA or theme equivalent).
  - Selected row: slightly darker outline or background.

- Ensure all dashboard widgets (Feed, Calendar, To-dos) share:
  - Same card border-radius
  - Same box-shadow / border
  - Same horizontal padding (e.g., `24px` desktop, `16px` tablet/mobile).

---

## 7. Mobile & Responsive Rules (Feed)

### 7.1 Breakpoints

- Desktop: `>= 1200px` (current layout works with minor spacing tweaks).
- Tablet: `768–1199px`
- Mobile: `< 768px`

### 7.2 Column Visibility by Breakpoint

**Desktop (>= 1200px)**  
- Show columns: Source | Activity | From | Status | Time

**Tablet (768–1199px)**  
- Show: Source | Activity | Time  
- Hide “From” and “Status” columns, but embed “From” text into the Activity cell:

```text
[Title…]
[Snippet…]
[From: Greg Fielding · Just now]
```

**Mobile (< 768px)**  
- Collapse to **card-style rows**:

```text
[icon] [Title…]      [Time]
[Snippet…]
[From: Greg Fielding]    [Status chip]
```

- Full row clickable; tap opens drawer.
- Actions appear in a small bottom row or 3-dot menu inside the card.

Implementation hint: Use a single `<FeedRow>` component that receives `layoutMode: 'desktop' | 'tablet' | 'mobile'` and renders different sub-layouts.

---

## 8. Additional UX Improvements

Here are a few extra suggestions beyond your requested changes:

### 8.1 Row Badges

- Tiny right-aligned badges for priority:
  - “Payroll” (when subject/snippet includes payroll or comes from Gusto)
  - “Calendar” (RSVPs)
- This can be computed in the backend and stored as `tags: string[]` on FeedItem.

### 8.2 Keyboard Navigation

- Up/down arrows move through feed rows.
- Enter opens the drawer on the selected row.
- `p` to pin/unpin, `u` to mark unread, etc. (Optional v2).

### 8.3 Saved Views (Future)

- Allow saving combinations of filters (Unread + Email only, Slack-only, etc.) as presets.
- These could show as additional chips after “All / Unread / Pinned.”

### 8.4 “New Since Last Visit” Divider

- On first load, insert a horizontal “New since last visit” divider based on a stored timestamp.
- Helps you quickly see what’s changed since you were last in the Dashboard.

Implementation detail:
- Store `lastFeedVisitAt` per user.
- When rendering, find first item with `createdAt > lastFeedVisitAt` and insert the divider row above it.

---

## 9. Implementation Checklist for Cursor

1. **Update Feed Layout**
   - Merge Title + Snippet into the new **Activity** column.
   - Remove per-row “Email” text; show only icons in Source column.
   - Refactor From, Status, and Time columns per specs above.

2. **Channel Color Coding**
   - Implement `channelColorBySource` map.
   - Update source icon component to use tinted background + colored glyph.

3. **Filter Bar Changes**
   - Replace top chip row with: All, Unread, Pinned.
   - Move date range filters into a compact “Date” dropdown.
   - Fix right-side alignment so search input is fully visible (no clipping into border radius).

4. **Row Density & Hover States**
   - Normalize vertical and horizontal padding.
   - Add consistent hover background + selected state.
   - Verify spacing matches Dashboard calendar + To-do widgets.

5. **Responsive Layout**
   - Implement layout modes: desktop / tablet / mobile.
   - Hide / reflow columns as described in section 7.
   - Test at common widths: 1440px, 1024px, 768px, 390px.

6. **Action Area Simplification**
   - For now, keep only: Open (drawer) and Pin/Unpin on each row.
   - Ensure actions appear on hover (desktop) and inside drawer/menu (mobile).

7. **Future Hooks**
   - Keep `FeedSource` flexible so we can add `job_update`, `application`, etc.
   - Make sure new source types only require:
     - color token
     - icon glyph
     - mapping to the drawer “scope” (e.g. open job order, application details, etc.).

Once this v2 layout is implemented, we’ll do a follow-up pass specifically for:
- Job Order & Application feed items
- Priority / severity styling (e.g. payroll-related items)
- Small performance tweaks if the unified feed becomes very large.
