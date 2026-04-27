# HRX Dashboard Master Feed — Phases 2–5 Spec

**Context:**  
This document extends the existing dashboard feed + UI work. Phase 1 defined the basic **unified feed** that merges:
- Inbox (Gmail emails)
- Direct messages (Slack DMs)
- Slack channel messages (for joined & unmuted channels)

This spec lays out **Phases 2–5** as a roadmap Cursor can implement progressively. Each phase must preserve all prior behavior unless explicitly changed.

---

## Global Principles (All Phases)

1. **Non‑destructive refactors only**
   - Do *not* change business logic outside the feed, calendar, or to‑dos unless explicitly stated.
   - Do *not* modify Gmail/Slack integration contracts (only read; no destructive ops).

2. **Single Source of Truth**
   - Existing per‑source collections (emails, slack messages, etc.) stay authoritative.
   - The dashboard feed is a *projection* built from them — via queries, Cloud Functions, or a materialized `dashboardFeed` collection.

3. **Extensibility First**
   - Everything should anticipate more “channels” later (Job Orders, Applications, Tasks, System Alerts).
   - Avoid hard‑coding “email / DM / Slack” in the UI or backend; instead use an enum like `FeedSourceType` with a generic pattern.

4. **Performance + Cost Awareness**
   - Prefer incremental updates (listen to deltas; onSnapshot over massive re‑queries).
   - Use index‑friendly fields (`sourceType`, `ownerUserId`, `createdAt`, `isRead`, `isMuted`).

5. **Scoped by User**
   - All feed views are **user‑specific** (e.g. `ownerUserId === currentUser.uid`).
   - Do not show global or other users’ feed items unless explicitly requested (e.g. admin view).

---

## Phase 2 — Feed UX Enhancements & Interaction Rules

### Goals

- Make the **Dashboard feed table** feel like a real “command center”.
- Add smart filters, hover states, and row click behavior that opens the **Universal Drawer** with the correct context.
- Define consistent behaviors for **read / unread**, **pinning**, and **muting** across feed items.

### 2.1 Row Structure (Frontend)

Each feed row already has:
- Source icon (Email / DM / Slack Channel)
- Title
- Snippet
- From
- Status (Unknown, Open, Closed, etc. — depends on source)
- Time

Enhance with:
- `unreadDot` + bold title when `isRead === false`.
- Optional `pinned` indicator (star icon or pin icon on left side).

**Rule:** Clicking anywhere on the row (except explicit action buttons) should:
- Mark item as **read** (if unread).
- Open Universal Drawer scoped to the item’s source:
  - Email → Inbox drawer with that **thread** in focus.
  - DM → Slack DM drawer for that **user/channel**.
  - Slack Channel → Channel drawer, scrolled to the message if possible.

### 2.2 Feed Filters (Frontend)

Add a **filter bar** above the table (under the Dashboard header buttons):

1. **Quick Filters (chips)**
   - `All`, `Unread`, `Pinned`, `Today`, `Last 7 days`
   - State lives in URL query or local state; do not persist in Firestore for now.

2. **Source Filter (dropdown or multi-select)**
   - Options: `All Sources`, `Email`, `DMs`, `Slack Channels`
   - Future‑ready: add `Job Orders`, `Applications`, `Tasks`, etc.

3. **Search Input**
   - Reuse existing search pattern: string that matches `title`, `snippet`, or `fromDisplay` fields.
   - For Phase 2, search can be **client‑side** on the current page.
   - In later phases we may move to Firestore text search fields.

### 2.3 Read / Unread Logic

**Feed Item Model (extension):**

Add / confirm these fields on `FeedItem` documents (or equivalent projection):

- `isRead: boolean` — per user.
- `readAt?: Timestamp` — nullable.
- `pinned?: boolean` — default `false`.

**Rules:**

1. When the feed row is opened (row click → drawer):
   - If `isRead === false`, update to `true` and set `readAt = now`.
   - This update is **per user**. If using per‑user documents, keep them separate from any shared message docs.

2. Optional: Add a **context menu** or inline icon to toggle `Mark as unread`. (Implementation can be deferred if complex.)

3. The unread **badge counts** on sidebar icons (Inbox, Messages, etc.) should eventually reuse these same per‑user read flags for consistency (Phase 4).

### 2.4 Pinning Items

Pinning will be used later for “important” items, but we should design the field now:

- `pinned: boolean` (default `false`).
- Presenter:
  - Add a pin icon on each row (far left or in an actions column).
  - Clicking toggles pinned state via Firestore update.
- Filter:
  - `Pinned` chip shows all pinned items, sorted by `createdAt desc`.

You can implement pinning now or leave UI hooks with TODO comments, but the data model must anticipate it.

### 2.5 Keyboard & Accessibility (Optional but Recommended)

- Add `tabIndex` to rows and ensure pressing **Enter** triggers the same as a click.
- Use `aria-label` on source icons like “Email from Tabitha about payroll” when possible.

---

## Phase 3 — Backend Feed Projection & Real‑Time Updates

### Goals

- Move from ad‑hoc “front‑end joins” to a clean **FeedItem projection** model.
- Ensure the Dashboard feed updates **in real time** when:
  - New email arrives.
  - New DM arrives.
  - New Slack channel message appears in a joined, unmuted channel.

### 3.1 FeedItem Schema

Create a central collection, e.g. `dashboardFeed` or `userFeed`:

```ts
// Example Firestore schema (per document)
{
  id: string;              // doc id
  ownerUserId: string;     // who sees this item in their feed
  sourceType: 'email' | 'slack_dm' | 'slack_channel'; // future: 'job_order', 'application', etc.
  sourceId: string;        // e.g. gmail threadId, slack channelId, slack dm id
  secondaryId?: string;    // e.g. message id within thread/channel
  title: string;
  snippet: string;
  fromDisplay?: string;    // e.g. "Tabitha @ C1"
  status?: string;         // optional (Unknown / Open / Resolved / etc.)
  createdAt: Timestamp;    // when this feed item was created
  updatedAt: Timestamp;    // when last updated
  isRead: boolean;
  readAt?: Timestamp | null;
  pinned?: boolean;
  // source metadata for routing the drawer
  metadata?: {
    gmailMessageId?: string;
    gmailThreadId?: string;
    slackTeamId?: string;
    slackChannelId?: string;
    slackTs?: string;      // message timestamp
    // future fields: jobOrderId, applicationId, taskId, etc.
  };
}
```

> **Important:** This is a *projection* document. It should only contain what the dashboard needs to render + route to the real source.

### 3.2 Feed Builders — Source‑Specific Logic

Implement **Cloud Functions** (or backend jobs) that create/update feed items whenever new events arrive.

#### 3.2.1 Email → FeedItem

- Trigger: Existing Gmail sync job (`scheduledGmailMonitoring` or equivalent) finishes polling.
- For each new or updated email thread:
  - Determine the **ownerUserId** (user who owns that mailbox).
  - Create/update a `FeedItem` whose `sourceType = 'email'` and `sourceId = gmailThreadId`.
  - `createdAt` = timestamp of latest message in that thread.
  - `title` = subject.
  - `snippet` = sanitized body preview.
  - `fromDisplay` = sender’s display name or email.
  - If the corresponding email is unread → `isRead = false`, otherwise `true`.

#### 3.2.2 Slack DM → FeedItem

- Trigger: Slack event ingestion (however you currently mirror DMs into Firestore).
- When a new DM arrives for user X:
  - For each recipient that should see it, create/update a `FeedItem`:
    - `sourceType = 'slack_dm'`
    - `sourceId = dmChannelId`
    - `secondaryId = slack message ts`
  - `title` = “DM with {displayName}”
  - `snippet` = truncated message text.
  - `createdAt` = slack message timestamp.

#### 3.2.3 Slack Channels → FeedItem

- Trigger: new messages ingested from channels.
- For each message:
  - Determine which users should see it:
    - User is **member** of the channel AND
    - Channel is **not muted** for that user.
  - For each user, create a `FeedItem`:
    - `sourceType = 'slack_channel'`
    - `sourceId = channelId`, `secondaryId = slack ts`.
    - `title` = channel name (e.g. `#dev`, `#payroll`).
    - `snippet` = first 120 chars of message.
    - `createdAt` = message timestamp.

> If cost becomes an issue, you can batch channel messages into one feed item per channel with a `latestMessageSnippet`, but the preferred long‑term approach is 1 item per relevant message for simplicity.

### 3.3 Querying the Feed

On the Dashboard page, load the feed like this (semi‑pseudocode):

```ts
const feedRef = collection(db, 'dashboardFeed');
const q = query(
  feedRef,
  where('ownerUserId', '==', currentUser.uid),
  where('sourceType', 'in', activeSourceFilterArray), // or omit if All Sources
  orderBy('createdAt', 'desc'),
  limit(pageSize) // e.g., 20
);

onSnapshot(q, (snap) => {
  // map docs to UI FeedItem type
});
```

- Ensure that composite indexes exist for:  
  - `(ownerUserId, sourceType, createdAt desc)`  
  - `(ownerUserId, createdAt desc)`

### 3.4 Pagination Strategy

- For now, use **cursor‑based pagination**:
  - Keep `lastVisibleDoc` from the previous page, pass to `startAfter()` for the next query.
- UI: at the bottom of the table, keep current `Rows per page` selector and pagination controls.
- Future: consider infinite scroll for the main dashboard feed.

### 3.5 Real‑Time Updates

- Because `onSnapshot` is used, any newly created/updated `FeedItem` documents immediately appear in the table.
- When `isRead` is toggled:
  - Optimistically update local state.
  - Fire a `updateDoc` call to persist the change.
- Keep updates small: do not rewrite large `metadata` blobs unless necessary.

---

## Phase 4 — Cross‑Widget Sync (Feed, Calendar, To‑Dos)

### Goals

- Tighten the relationship between **Feed**, **Calendar**, and **To‑Dos** within the Dashboard.
- Make sure actions in one widget are reflected in others, where appropriate.

### 4.1 Calendar ↔ Feed

1. **Feed → Calendar**
   - When a user opens a feed item that corresponds to a meeting invite (email with calendar event, or DM about a meeting), allow the user to create a **Follow‑up task** tied to a specific date.
   - Example: button in drawer “Add follow‑up to Calendar/To‑Dos”.
   - Implementation: create a task with `dueDate`, which will appear in the To‑Dos list and be visible for that date.

2. **Calendar → Feed**
   - Optional future: When a new CRM meeting or interview is scheduled, create a `FeedItem` with `sourceType = 'calendar'` so the user sees upcoming important events in the feed.

### 4.2 To‑Dos ↔ Feed

- When a To‑Do is created from a feed item, link them via `sourceFeedItemId`:
  ```ts
  task.sourceFeedItemId?: string;
  ```
- Visual treatment in the feed:
  - Show a small task icon in the row if `sourceFeedItemId` exists.
  - Hover tooltip: “Has follow‑up task due {date}.”
- When the task is marked complete:
  - Optionally set `status` on `FeedItem` to `"Handled"` or `"Actioned"` (non‑blocking).

### 4.3 Sidebar Badge Counts

- Use the same per‑user `isRead` logic for sidebar badges:
  - Inbox icon → count of unread email feed items.
  - Messages icon → count of unread `slack_dm` feed items.
  - Slack icon (or Channels) → count of unread `slack_channel` feed items.
- Keep badge logic in a shared hook or utility so the Dashboard and sidebar stay in sync.

---

## Phase 5 — Adding New Feed Sources (Job Orders, Applications, Tasks)

### Goals

- Make it trivial to add new “channels” into the feed without massive refactors.
- Document how to add a new source type step‑by‑step.

### 5.1 New Source Pattern

To add a new feed source, follow this pattern:

1. **Define a new enum value** in shared types, e.g.:
   ```ts
   type FeedSourceType =
     | 'email'
     | 'slack_dm'
     | 'slack_channel'
     | 'job_order'
     | 'application'
     | 'task';
   ```

2. **Determine the events** that should create feed items:
   - `job_order` → when a recruiter is assigned, when status changes, or when a new note is added.
   - `application` → when a new applicant submits, when status moves (e.g., “Interview”, “Rejected”, “Offer”).
   - `task` → when a new high‑priority task is assigned to the user.

3. **Implement a builder** (Cloud Function or server logic) that:
   - Listens to changes in the relevant collection(s).
   - For each relevant event, creates or updates one or more `FeedItem` docs.
   - Decides which **ownerUserId(s)** should see it (assigned recruiter, hiring manager, etc.).

4. **Extend the UI mapping**:
   - Add icon + color mapping for the new source type in a centralized `getFeedSourceConfig(sourceType)` helper, e.g.:
     ```ts
     {
       icon: <BriefcaseIcon />,
       label: 'Job Order',
       accent: 'blue',
     }
     ```
   - Add optional filter chips (e.g. `Applications`) to the filter bar.
   - Define drawer routing for the new type:
     - Example: clicking a `job_order` item opens the **Job Order drawer** for that record.

### 5.2 Priority & Severity Framework (Optional)

For future triaging, extend `FeedItem` to include:

```ts
priority?: 'low' | 'normal' | 'high' | 'critical';
severity?: 'info' | 'warning' | 'error';
```

- Use light visual hints (e.g., subtle colored dots or text labels) next to the title.
- Priority may be driven by source:
  - Critical: payroll issues, compliance alerts, legal notices.
  - High: new application for a critical job, VIP customer email.
  - Normal/Low: everything else.

### 5.3 Configuration & Admin Controls

Create a simple admin configuration UI (future) so admins can control:

- Which **source types** appear in the Dashboard feed.
- Which **roles** see which sources (e.g., Recruiters vs. Executives).
- Per‑source defaults:
  - Default priority for new items.
  - Whether items are created as unread by default.

For now, note this as TODO with basic config stored in Firestore as:

```ts
feedSettings: {
  enabledSources: FeedSourceType[];
  roleVisibility: {
    [sourceType in FeedSourceType]?: AccessRole[];
  };
}
```

Implementation can be deferred; just ensure the data model is forward‑compatible.

---

## Implementation Notes for Cursor

1. **Respect existing code organization**
   - Keep feed logic in a dedicated module (e.g., `services/feed`, `hooks/useDashboardFeed.ts`, and `components/dashboard/DashboardFeedTable.tsx`).

2. **Type‑Safety First**
   - Define `FeedItem` and `FeedSourceType` in a shared `types` module.
   - Use zod (if already used elsewhere) to validate data in any Cloud Functions that write `FeedItem` documents.

3. **Stepwise Delivery**
   - Implement *Phase 2* first (UX + frontend changes, minimal backend tweaks).
   - Then implement *Phase 3* (backend projection + real‑time updates).
   - Use TODO comments and clear commit messages with the phase number, e.g. `feat(feed): phase-2 filters and read-state`.

4. **No Breaking Changes to Inbox / Messages**
   - Do not alter the behavior of the dedicated Inbox or Messages pages.
   - The Dashboard feed should *link* into those experiences via the Universal Drawer, not replace them.

Once these phases are implemented, we’ll be ready to layer in more channel types (job orders, applications, recruiter alerts) using the same pattern.
