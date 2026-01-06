
# HRX Mentions Channel Spec (`mentions-channel-spec.md`)

## 0. Goals

1. Treat **@mentions as a first‑class notification channel** in HRX.
2. Support **Slack mentions** and **HRX‑native mentions** in a unified way.
3. Power:
   - A **“Mentions” filter** in the Dashboard Feed
   - An optional **top‑bar Mentions badge** (unread count)
4. Provide a **typed, inline autocomplete** UX when a user types `@` in HRX text inputs.

---

## 1. Data Model

### 1.1 Slack User Mapping

We need a stable mapping from HRX users → Slack users.

**Firestore**

```ts
// Collection: users/{uid}/integrations/slack
export interface UserSlackIntegration {
  slackUserId: string;     // e.g. "U04ABC123"
  teamId: string;          // Slack workspace ID
  displayName: string;     // "Donna Persson"
  username: string;        // "donna" (lowercase, used for @donna)
  email: string;           // user email
  avatarUrl?: string;      // Slack avatar
  linkedAt: Timestamp;
}
```

> NOTE: `username` is important for typed autocomplete (`@do` → `donna`).

**Population options**

- **Auto match by email**: when the user first connects Slack in HRX, we call `users.list` and match by email.
- **Manual override**: admin UI allows linking a user to a slackUserId if auto‑match fails.

---

### 1.2 Mention Feed Items

All mentions (Slack + HRX internal) become **Dashboard feed items**.

```ts
export type MentionOrigin = 'slack' | 'hrx';

export interface MentionMetadataSlack {
  origin: 'slack';
  slackTeamId: string;
  slackChannelId: string;
  slackChannelName?: string;
  slackTs: string;            // message timestamp
  slackMessagePermalink?: string;
}

export interface MentionMetadataHrx {
  origin: 'hrx';
  threadId: string;           // HRX internal thread / conversation
  messageId: string;
  contextType: 'deal' | 'company' | 'contact' | 'task' | 'generic';
  contextId?: string;
  contextName?: string;
}

export type MentionMetadata = MentionMetadataSlack | MentionMetadataHrx;

export interface MentionFeedItem extends DashboardFeedItemBase {
  kind: 'mention';
  mentionedUserId: string;     // HRX uid
  mentionedByUserId: string;   // HRX uid of author (if known)
  textSnippet: string;
  channelLabel: string;        // e.g. "#dev", "Deal: C1–Sodexo"
  metadata: MentionMetadata;
}
```

The `DashboardFeedItem` type should gain:

```ts
export type DashboardFeedItemKind =
  | 'email'
  | 'slack_message'
  | 'calendar'
  | 'task'
  | 'mention';  // NEW
```

---

### 1.3 Internal Message Mentions

For HRX-native comments/messages we store mentions directly on the message:

```ts
export interface HrxMessage {
  id: string;
  threadId: string;
  authorId: string;
  body: string;                 // original markdown / text with @tokens
  plainText: string;            // stripped text for search/snippet
  mentionedUserIds: string[];   // HRX uids
  createdAt: Timestamp;
  editedAt?: Timestamp;
}
```

---

## 2. Slack Mention Detection

Because we use a **workspace bot token** (not per‑user OAuth), we must detect mentions **ourselves**.

### 2.1 Slack Event Handler

In `functions/src/slack/events.ts`:

```ts
const MENTION_REGEX = /<@([A-Z0-9]+)>/g;

async function handleMessage(event: SlackMessageEvent) {
  const { text = '', channel, ts, user: authorSlackId, team } = event;

  // 1️⃣ Extract mentioned Slack user IDs
  const mentionedSlackIds = Array.from(text.matchAll(MENTION_REGEX))
    .map(m => m[1]);

  if (mentionedSlackIds.length === 0) return;

  // 2️⃣ Map Slack IDs → HRX users
  const hrxUsers = await lookupHrxUsersBySlackIds(mentionedSlackIds, team);

  if (!hrxUsers.length) return;

  // 3️⃣ Build snippet + channel label
  const snippet = buildSlackSnippet(text);
  const channelInfo = await getOrCacheChannelInfo(team, channel);
  const channelLabel = `#${channelInfo.name}`;

  // 4️⃣ Resolve author HRX user (best effort by email/slackId)
  const authorHrx = await lookupHrxUserBySlackUserId(authorSlackId, team);

  // 5️⃣ Create feed items
  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const hrxUser of hrxUsers) {
    const id = `mention:${team}:${channel}:${ts}:${hrxUser.id}`;

    const item: MentionFeedItem = {
      id,
      userId: hrxUser.id,
      kind: 'mention',
      mentionedUserId: hrxUser.id,
      mentionedByUserId: authorHrx?.id ?? null,
      textSnippet: snippet,
      channelLabel,
      createdAt: now,
      isUnread: true,
      metadata: {
        origin: 'slack',
        slackTeamId: team,
        slackChannelId: channel,
        slackChannelName: channelInfo.name,
        slackTs: ts,
        slackMessagePermalink: await getMessagePermalink(team, channel, ts),
      },
    };

    const ref = db.collection('dashboardFeed').doc(id);
    batch.set(ref, item, { merge: true });
  }

  await batch.commit();
}
```

Key points:

- **We never ask Slack for “mentions by user”**.  
  We compute them by scanning all messages we are receiving anyway.
- We **normalize into MentionFeedItem** for the dashboard.

---

## 3. HRX‑Native @Mention Parsing

When a user posts a comment in HRX, we support a **Slack‑style `@username` text experience**, but the stored representation is:

- A message `body` that includes some syntax (`[@uid:greg]` or just `@greg`)  
- A `mentionedUserIds: string[]` derived from the parse

### 3.1 Canonical Token Format

Internally we recommend **UID‑based tokens**, to avoid problems when names change:

```text
"Hey [@uid:abc123] can you review this?"
```

But the user **sees and types**:

```text
"Hey @greg can you review this?"
```

The editor component handles:

- Displaying `greg` instead of `@uid:abc123`
- Maintaining a mapping of token → HRX user

### 3.2 Parsing Mentions on Save

```ts
const UID_TOKEN_REGEX = /\[@uid:([a-zA-Z0-9_-]+)\]/g;

export function extractMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(UID_TOKEN_REGEX)) {
    ids.add(match[1]);
  }
  return [...ids];
}
```

---

## 4. Typed Autocomplete for `@username`

### 4.1 Mention Suggestion Source

**Firestore collection:** `users` (existing)

We expose a **mention search API** that filters **only internal teammates**:

```ts
export interface MentionableUser {
  id: string;               // HRX uid
  fullName: string;         // "Donna Persson"
  username: string;         // "donna"
  email: string;
  avatarUrl?: string;
  slackUsername?: string;   // optional, from Slack link
  presence?: 'online' | 'away' | 'offline';
}
```

Backend function:

```ts
// callable: mentionSearch({ query: string, limit?: number })

// rules:
// - case-insensitive
// - match start of username, firstName, lastName, or email before "@"
```

---

### 4.2 React Hook: `useMentionAutocomplete`

```ts
export interface MentionOption {
  id: string;            // HRX uid
  username: string;      // "donna"
  label: string;         // "Donna Persson"
  email: string;
  avatarUrl?: string;
}

export interface UseMentionAutocompleteResult {
  options: MentionOption[];
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  selectOption: (opt: MentionOption) => void;
  reset: () => void;
}

/**
 * Hook that powers @mention autocomplete.
 * - Debounces search
 * - Caches recent results
 */
export function useMentionAutocomplete(
  initialQuery = ''
): UseMentionAutocompleteResult {
  // implementation left for Cursor
}
```

---

### 4.3 `MentionTextField` Component Skeleton

A wrapper around MUI `TextField` that:

- Watches for `@` + partial text
- Pops a suggestions list
- When an option is chosen, replaces the typed `@do` with internal token `[@uid:USER_ID]` but **renders** `@donna` as a chip.

```tsx
interface MentionTextFieldProps
  extends Omit<TextFieldProps, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
}

export const MentionTextField: React.FC<MentionTextFieldProps> = ({
  value,
  onChange,
  ...rest
}) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [triggerIndex, setTriggerIndex] = React.useState<number | null>(null);
  const [currentToken, setCurrentToken] = React.useState('');
  const { options, loading, setQuery, selectOption } = useMentionAutocomplete();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    onChange(text);

    const caret = e.target.selectionStart ?? text.length;
    const slice = text.slice(0, caret);
    const match = /(^|\s)@([a-zA-Z0-9_.-]*)$/.exec(slice);

    if (match) {
      const prefix = match[2] ?? '';
      setTriggerIndex(caret - prefix.length - 1);
      setCurrentToken(prefix);
      setQuery(prefix);
      setAnchorEl(e.target);
    } else {
      setTriggerIndex(null);
      setAnchorEl(null);
      setQuery('');
    }
  };

  const handleSelect = (opt: MentionOption) => {
    if (triggerIndex == null) return;
    // Replace "@partial" with internal token
    const before = value.slice(0, triggerIndex);
    // everything after caret of current token:
    const caret = (rest.inputProps as any)?.selectionStart ?? value.length;
    const after = value.slice(caret);

    const token = `[@uid:${opt.id}]`;
    const next = `${before}${token} ${after}`;
    onChange(next);

    setTriggerIndex(null);
    setAnchorEl(null);
    setQuery('');
  };

  // Wire selectOption -> handleSelect
  React.useEffect(() => {
    selectOption && (selectOption as any).callback?.(handleSelect);
  }, [selectOption, handleSelect]);

  return (
    <>
      <TextField
        {...rest}
        value={value}
        onChange={handleChange}
        multiline
      />
      <MentionSuggestionsPopover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        loading={loading}
        options={options}
        onSelect={handleSelect}
      />
    </>
  );
};
```

> Cursor can replace the pseudo code with a clean implementation.  
> The key is matching `/(^|\s)@([a-zA-Z0-9_.-]*)$/` on the text *before* the caret.

---

### 4.4 `MentionSuggestionsPopover` Blueprint

```tsx
interface MentionSuggestionsPopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  loading: boolean;
  options: MentionOption[];
  onSelect: (opt: MentionOption) => void;
}

const MentionSuggestionsPopover: React.FC<MentionSuggestionsPopoverProps> = ({
  anchorEl,
  open,
  loading,
  options,
  onSelect,
}) => (
  <Popover
    open={open}
    anchorEl={anchorEl}
    onClose={() => {}}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
  >
    <List dense sx={{ minWidth: 220, maxHeight: 280, overflowY: 'auto' }}>
      {loading && (
        <ListItem>
          <ListItemText primary="Loading…" />
        </ListItem>
      )}
      {!loading &&
        options.map(opt => (
          <ListItem
            key={opt.id}
            button
            onClick={() => onSelect(opt)}
          >
            <ListItemAvatar>
              <Avatar src={opt.avatarUrl}>{opt.username[0].toUpperCase()}</Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={`@${opt.username}`}
              secondary={opt.email}
            />
          </ListItem>
        ))}
      {!loading && options.length === 0 && (
        <ListItem>
          <ListItemText primary="No matches" />
        </ListItem>
      )}
    </List>
  </Popover>
);
```

---

## 5. Dashboard Feed Integration

### 5.1 Fetch & Merge

`useDashboardFeed` already merges multiple channels. Extend:

```ts
type DashboardSourceFilter =
  | 'all'
  | 'email'
  | 'slack'
  | 'calendar'
  | 'task'
  | 'mentions'; // NEW
```

When `filter === 'mentions'`, query only `kind === 'mention'`.

Otherwise, include mentions in the union but optionally show a **chip**:

- Source icon: `@` in a bubble, or reuse Slack avatar when `origin === 'slack'`.
- Color: purple accent.

### 5.2 Row Rendering Rules

In `DashboardFeedRow`:

```tsx
if (item.kind === 'mention') {
  const isSlack = item.metadata.origin === 'slack';
  const icon = isSlack ? <SlackIcon /> : <MentionIcon />;

  const primary = isSlack
    ? `${item.channelLabel}`
    : item.channelLabel || 'Mention';

  const secondary = item.textSnippet;

  // clicking the row:
  // - if slack: open Slack drawer at channel/timestamp
  // - if hrx: open HRX thread drawer
}
```

---

## 6. Top Bar Mentions Badge

### 6.1 Data

Compute unread mention count:

```ts
// Collection: dashboardFeed
// query where userId == currentUserId AND kind == 'mention' AND isUnread == true
```

Hook:

```ts
export function useUnreadMentionsCount(userId: string) {
  // Firestore onSnapshot; returns { count, loading }
}
```

### 6.2 UI

In the app top bar:

- Add a **bell / @ icon** with a **badge**.
- Clicking it:
  - Option A: opens a small **popover** listing the last N mentions.
  - Option B: navigates to Dashboard with filter `source=mentions`.

---

## 7. Security & Performance

- **Security**: Feed docs are scoped by `userId`.  
  Firestore rules must enforce `request.auth.uid == resource.data.userId`.
- **Performance**:
  - Only create mention feed items for **users that are actually mapped**.
  - Use **collection group index** for `kind == 'mention'` if split per user.
  - Cache Slack `channelId → name` and user lists to minimize API calls.

---

## 8. Implementation Order (for Cursor)

1. **Data & types**
   - Add `MentionFeedItem`, `MentionMetadata`, and extend `DashboardFeedItemKind`.
   - Add `UserSlackIntegration` model & helper to resolve HRX user by slackUserId.

2. **Slack handler**
   - Implement `<@ID>` extraction, HRX mapping, and mention feed doc creation.

3. **Internal mentions**
   - Add `MentionTextField` and `useMentionAutocomplete`.
   - Save HRX messages with `[@uid:...]` syntax and `mentionedUserIds`.

4. **Feed integration**
   - Extend `useDashboardFeed` and `DashboardFeedRow` for `kind === 'mention'`.
   - Add “Mentions” filter + icon.

5. **Top bar badge**
   - Implement `useUnreadMentionsCount` and the UI badge.

This spec should give Cursor enough detail to implement a fully‑typed, Slack‑compatible mention channel with inline typed autocomplete for `@username`.
