# Dashboard Feed – Unified Activity Stream Spec (Phase 1)

Owner: Greg / HRX Dashboard  
Target: Cursor (implementation & refactor guidance)  
Scope: **Add a unified Dashboard Feed** that aggregates:
- Inbox email threads
- Direct messages (Slack DMs)
- Slack channel messages (for channels the user has joined and not muted)

This spec is **additive only** – do **not** change unrelated parts of the app.  
Keep the existing Inbox, Messages, and Slack views working as-is.

---

## 1. Overall Concept

The **Dashboard Feed** is a single, time-ordered activity stream that shows the most recent “events” across multiple sources:

- Email (Inbox)  
- Slack Direct Messages (DMs)  
- Slack Channel messages/messages in joined channels  

In the future we’ll add more “channels” (Job Order events, applications, etc.), so the design must be **extensible and source-agnostic**.

### Primary UX

- The user opens **Dashboard**.
- They see a list (table/cards) of recent events mixed together, **sorted by timestamp desc (newest first)**.
- Each item shows:
  - Source type (Email / DM / Slack Channel) – with icon & label
  - Primary subject/summary
  - Who it’s from (and optionally, “to” / “channel name”)
  - Timestamp (relative + absolute)
  - Quick badges (Unread, Muted, Mentioned, etc.)
- When the user **clicks a row**, the **Universal Drawer** opens with the correct context:
  - If Email → open the Inbox drawer scoped to that thread
  - If DM → open the Slack DM view in the drawer
  - If Slack Channel → open the Slack Channel thread in the drawer

---

## 2. Data Model – Unified Feed Item

We need a **normalized feed item** shape that all sources map into.

### 2.1 TypeScript Interface (conceptual)

```ts
type FeedSourceType = 'email' | 'slack_dm' | 'slack_channel';

interface DashboardFeedItem {
  id: string;                 // global unique ID for the feed item
  sourceType: FeedSourceType; // which subsystem
  sourceId: string;           // ID in that subsystem (e.g. email threadId, slack channelId, DM threadId)
  messageId?: string;         // optional: specific message id in that source
  title: string;              // subject line, channel name + snippet, etc.
  snippet: string;            // short text preview
  fromLabel: string;          // “From” contact name or author
  avatarUrl?: string;         // primary avatar (optional)
  isUnread: boolean;
  hasMentions?: boolean;      // for Slack – @mentions of this user
  isMuted: boolean;           // true if muted at the source level (e.g. channel muted)
  timestamp: number;          // ms since epoch – used for sorting
  // linking info for Drawer
  drawerScope: {
    scopeType: 'email' | 'slack_dm' | 'slack_channel';
    threadId?: string;
    channelId?: string;
    dmUserId?: string;
  };
}
```

### 2.2 Extensibility

Future sources (Job Orders, Applications, Tasks, etc.) should be able to plug into this by:

- Adding a new `FeedSourceType` value.
- Defining an adapter mapping that source’s events to `DashboardFeedItem`.
- Implementing a Drawer scope handler for that new type.

Do **not** hard-code logic that only works for Slack/Email; keep it **source-agnostic**.

---

## 3. Source-Specific Rules (Phase 1)

### 3.1 Inbox (Email)

We already have email ingestion for Inbox. For Dashboard Feed:

- **Event granularity**: One feed item per email **thread**, keyed by last message.
- When a new message arrives in a thread:
  - Update (or insert) a `DashboardFeedItem` for that thread.
  - `sourceType = 'email'`.
  - `sourceId = threadId`.
  - `title = email subject`.
  - `snippet = latest message snippet`.
  - `fromLabel = latest sender name`.
  - `timestamp = sentAt (latest message)`.
  - `isUnread = true` if this thread is unread for the current user.
  - `isMuted = false` (for now, unless we add an email mute feature later).

Drawer behavior:

- On click:
  - Open Universal Drawer in **Email mode**, load that thread using `threadId`.
  - Reuse existing Inbox thread component – do **not** fork a new one.

### 3.2 Slack Direct Messages (DMs)

Assumptions:

- We already have working Slack DM integration for the Messages/Inbox area.
- We can access DM message events (author, text, timestamp, DM channel id).

For each DM event relevant to the current user:

- **Event granularity**: One item per **DM thread** (or per DM channel), keyed by last message.
- Map to `DashboardFeedItem`:
  - `sourceType = 'slack_dm'`.
  - `sourceId = slackChannelId` (DM channel id).
  - `messageId = slackMessageTs` (if useful).
  - `title = name of the other participant(s)` (e.g., “Slack – DM with Donna”).
  - `snippet = latest message text (trimmed)`.
  - `fromLabel = sender display name`.
  - `timestamp = messageTs`.
  - `isUnread = true` if unread in Slack for this user, else false.
  - `isMuted = false` (for now, unless we add DM mute).

Drawer behavior:

- On click:
  - Open Universal Drawer with **Slack DM mode**.
  - Load the DM thread using `channelId = sourceId` (and `messageId` if needed for scrolling).

### 3.3 Slack Channels (Joined + Not Muted Only)

**Critical filtering rules:**

1. Only include messages from channels where:
   - The current user is **a member**, and
   - The channel is **not muted** for the user.
2. If the user leaves a channel or mutes it:
   - Future events from that channel **should not** appear in the feed.
   - Optionally, existing feed items can remain but won’t get further updates (OK for Phase 1).

Event granularity:

- One feed item per **channel**, keyed by the latest relevant message.

Mapping:
- `sourceType = 'slack_channel'`.
- `sourceId = channelId`.
- `messageId = latest message ts`.
- `title = #channelName`.
- `snippet = latest message text (trimmed)`.
- `fromLabel = sender display name`.
- `timestamp = latest message ts`.
- `hasMentions = true` if the latest message @mentioned this user.
- `isUnread = true` if there are unread messages for this user in that channel.
- `isMuted` = true if the user has muted that channel (these should be filtered out at the query layer).

Drawer behavior:

- On click:
  - Open Universal Drawer with **Slack Channel mode**.
  - Load the channel using `channelId = sourceId`.
  - Optionally scroll to the message ID or bottom.

---

## 4. Aggregation Logic

### 4.1 Query / Retrieval (Client-side Concept)

For a first implementation we can aggregate on the client by querying each subsystem and merging:

```ts
async function loadDashboardFeedForUser(userId: string): Promise<DashboardFeedItem[]> {
  const emailItems = await getEmailFeedItems(userId);        // from Inbox
  const dmItems = await getSlackDMFeedItems(userId);         // from Slack DM integration
  const channelItems = await getSlackChannelFeedItems(userId); // only joined + not muted

  const allItems = [...emailItems, ...dmItems, ...channelItems];

  return allItems
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100); // apply sane limit
}
```

Requirements:

- Sorting must be **strictly by timestamp**, newest first.
- Apply a **limit** (e.g. 100–200 items) with pagination or lazy loading for more.
- The function must be structured so we can later replace sources or add new ones without breaking the API.

### 4.2 Real-Time Updates (Phase 1)

For Phase 1, “real-time enough” is acceptable. Strategy:

- **Minimum**: poll key sources on an interval (e.g., every 60–120s) and refresh.
- If we already have realtime streams (Firestore `onSnapshot`, websockets for Slack, etc.):
  - Wire those streams to update their respective sub-feeds, and re-merge.

Implementation guidance:

- Use a **single React hook** e.g. `useDashboardFeed(userId)` that:
  - Subscribes to underlying sources (or polling functions).
  - Maintains a local `feedItems` state array.
  - Normalizes and merges items on every update.

---

## 5. UI / Table Spec (Dashboard Feed)

### 5.1 Columns

Proposed base columns for the Dashboard Feed table:

1. **Source / Icon**
   - Icon + label:
     - ✉️ Email  
     - 💬 DM  
     - #️⃣ Slack Channel  
   - Show label text: `Email`, `Slack DM`, `Slack Channel`.

2. **Title**
   - Email: subject line  
   - DM: “DM with {Name}” or the other participant’s name  
   - Channel: “#channelName”  

3. **Snippet**
   - Short preview of last message / content.
   - Truncate gracefully.

4. **From**
   - Display name of sender of latest message (for DM / Email / Channel).

5. **Status / Badges**
   - Unread badge (e.g. blue dot) if `isUnread` true.
   - Mention badge (e.g. `@` pill) if `hasMentions` true.
   - Muted indicator if `isMuted` (mainly for debugging; muted channels should usually be filtered out).

6. **Timestamp**
   - Right-aligned.
   - Show relative time (`5 min ago`) with tooltip for full date/time.

### 5.2 Interaction

- **Row click**:
  - Opens Universal Drawer with the correct scope based on `item.drawerScope.scopeType`.
  - Use a single router/helper, e.g. `openDrawerFromFeedItem(item)`.

- **Keyboard navigation** (optional phase 1):
  - Up/Down to move in table.
  - Enter to open drawer.

### 5.3 Do Not Change

- Do **not** alter layouts of existing Inbox / Slack pages except where needed to share hooks or APIs.
- Do **not** move Inbox fetch logic inside Dashboard feed – share but don’t entangle.

---

## 6. Drawer Integration

Implement a single helper that takes a `DashboardFeedItem` and opens the correct scope:

```ts
function openDrawerFromFeedItem(item: DashboardFeedItem) {
  switch (item.drawerScope.scopeType) {
    case 'email':
      openEmailDrawer({ threadId: item.drawerScope.threadId! });
      break;
    case 'slack_dm':
      openSlackDMDrawer({ channelId: item.drawerScope.channelId! });
      break;
    case 'slack_channel':
      openSlackChannelDrawer({ channelId: item.drawerScope.channelId! });
      break;
    default:
      console.warn('Unknown drawer scope type', item);
  }
}
```

Requirements:

- Reuse the **existing drawer components** and loader functions.
- The Dashboard shouldn’t know drawer implementation details – just call the appropriate helper.

---

## 7. Future Sources (For Reference / Design Guardrails)

Not part of Phase 1 implementation, but design must support:

- **Job orders** – e.g., “New Application for Job #12345”
- **Candidate events** – e.g., “Candidate moved to Interview stage”
- **Tasks / reminders** – e.g., “Follow up with client”
- **System alerts** – e.g., “Sync failure”, “Integration error”

We’ll add each as a new source type with its own adapter and Drawer scope.

Guardrails:

- Don’t hard-code UI to show only the three initial types.
- Make icons/labels extendable via mapping, e.g.:

  ```ts
  const SOURCE_META: Record<FeedSourceType, { icon: ReactNode; label: string }> = {
    email: { icon: <EmailIcon />, label: 'Email' },
    slack_dm: { icon: <DMIcon />, label: 'Slack DM' },
    slack_channel: { icon: <ChannelIcon />, label: 'Slack Channel' },
  };
  ```

---

## 8. Testing Checklist

Before marking Phase 1 as complete, verify:

1. **Aggregation**
   - Dashboard shows items from:
     - Email Inbox
     - Slack DMs
     - Slack Channels (joined + not muted)
   - Items are sorted by timestamp desc.

2. **Filtering**
   - Muted Slack channels do **not** produce new feed activity.
   - Leaving a Slack channel prevents new feed items from that channel.

3. **Navigation**
   - Clicking a feed row opens the Universal Drawer with the correct content for:
     - Email
     - Slack DM
     - Slack Channel

4. **Unread / Mentions**
   - When a new email arrives, feed item shows as unread.
   - When a new channel message @mentions the user, `hasMentions` is reflected visually.
   - Marking an email or slack item as read updates the feed state.

5. **Performance**
   - Feed loads within reasonable time (under a few seconds for 100 items).
   - No obvious UI jank when new items stream in.

---

## 9. Implementation Notes for Cursor

- Keep this as a **modular feature** – ideally a new `DashboardFeed` component + `useDashboardFeed` hook.
- Reuse existing APIs / wrappers for Inbox and Slack; do **not** duplicate business logic.
- When in doubt, prefer:
  - Clear adapters per source (Email → FeedItem, DM → FeedItem, Channel → FeedItem).
  - A single merge+sort step at the top level.
- Do **not** change any behavior unrelated to:
  - Fetching items for the dashboard feed
  - Rendering the dashboard feed list/table
  - Opening the drawer for a feed item
