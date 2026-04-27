# Slack Micro-Reactions — UX + Technical Spec (Cursor Build)

## 1. Product Goal

Allow users to add **Slack-style micro-reactions** (✓ 👀 🙌 ❤️ 👍 🔥, etc.) to Slack messages **inside our app UI**, and optionally sync those reactions back to Slack via API.

- Reactions feel like Slack, but are rendered in **our React app**.
- Realtime updates via Firestore / WebSocket / listener.
- Clean, composable React components with MUI.
- Future‑proof for non‑Slack messages (internal comments, notes, etc.).

---

## 2. UX & Behavior

### 2.1 Where Reactions Appear

Within each Slack message row (e.g. in our Inbox / Slack view):

```text
[ message preview + metadata … ]
✓ 3   👀 1   🙌 2    +
```

- Reactions row is right under the message body or aligned at the right side of the row footer.
- Compact spacing so it doesn’t overpower the message.

### 2.2 Interactions

| Action                     | Behavior                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| Click on reaction icon     | Toggle current user’s reaction on/off for that emoji.                   |
| Hover reaction (desktop)   | Tooltip: “You, Donna, Greg reacted” (first few names + `+N more`).      |
| Click “+” button           | Opens **emoji selector** (pre‑filtered to a small curated set + search). |
| Click outside selector     | Closes selector.                                                        |
| Long‑press on mobile       | Opens selector.                                                         |
| Message row click          | Normal message behavior (open drawer, etc.); reactions remain separate. |

### 2.3 Visual States

- **No reactions yet** → show only subtle `+` button (`Add reaction` tooltip).
- **Has reactions** → show each emoji pill: icon + count.
- **User reacted** → pill is highlighted:
  - Elevated background (primary tint).
  - Emoji and count in stronger color.
- **Disabled (no permission)** → pills are greyed and non‑interactive.

### 2.4 Layout Rules

- Limit to **max 6** emoji pills visible; if more exist, show `+N` overflow pill.
- Small paddings so row height stays tight.
- Align with other message metadata (status chips, timestamps).

---

## 3. Data Model & Backend

### 3.1 Firestore Collection: `slackMessageReactions`

```ts
// Collection: slackMessageReactions
// Doc ID: `${channelId}__${messageTs}` or a hash

export interface SlackMessageReactionsDoc {
  channelId: string;
  messageTs: string; // Slack message "ts" or internal ID
  reactions: {
    emoji: string;        // e.g. 'white_check_mark', 'eyes', 'raised_hands'
    users: string[];      // internal userIds or Slack user IDs
    updatedAt: FirebaseFirestore.Timestamp;
  }[];
  updatedAt: FirebaseFirestore.Timestamp;
}
```

**Indexing:**  
- Composite index on `(channelId, messageTs)` for fast lookups.

### 3.2 Slack Sync (Optional but Recommended)

**Slack OAuth Scopes:**

```text
reactions:read
reactions:write
channels:history
chat:write
users:read
```

**Flows:**

1. **React in app → Slack**  
   - When user toggles reaction:
     - Update Firestore doc.
     - Call `reactions.add` or `reactions.remove` with:
       - `channel` (Slack channel ID)
       - `timestamp` (message `ts`)
       - `name` (emoji name)
2. **React in Slack → app**  
   - Subscribe to Slack Events API (e.g. `reaction_added`, `reaction_removed`).  
   - Cloud Function updates Firestore → frontend listener updates UI.

### 3.3 Realtime Updates

Use any one (or combo):

- Firestore `onSnapshot` on `slackMessageReactions` doc per message.
- Or subscribe to a channel-level query (e.g. `where('channelId', '==', activeChannelId)` and filter in memory).

Front-end recomputes counts and per‑user state from the doc.

---

## 4. React + MUI Component Blueprint

> The goal is **minimal, composable components** that Cursor can flesh out into full implementation.

### 4.1 Component Tree

```text
SlackMessageRow
  ├─ SlackMessageHeader (username, timestamp, etc.)
  ├─ SlackMessageBody   (text, attachments, etc.)
  └─ SlackMessageReactionsBar
       ├─ ReactionPill (x N)
       └─ AddReactionButton → ReactionEmojiPicker
```

### 4.2 Types

```ts
// src/types/slackReactions.ts
export interface ReactionSummary {
  emoji: string;        // 'white_check_mark'
  count: number;        // total users
  userHasReacted: boolean;
  userIds: string[];    // optional, for tooltips
}

export interface SlackReactionContext {
  messageId: string;    // internal ID or `${channelId}__${ts}`
  channelId: string;
  messageTs: string;    // Slack ts
}
```

### 4.3 Hook: `useSlackReactions`

```ts
// src/hooks/useSlackReactions.ts
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/client';
import { ReactionSummary, SlackReactionContext } from '@/types/slackReactions';
import { callReactToSlackMessage } from '@/api/slackReactionsApi'; // https callable

export function useSlackReactions(
  ctx: SlackReactionContext,
  currentUserId: string
) {
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'slackMessageReactions', `${ctx.channelId}__${ctx.messageTs}`);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setReactions([]);
        setLoading(false);
        return;
      }
      const data = snap.data() as any;
      const summaries: ReactionSummary[] =
        (data.reactions ?? []).map((r: any) => ({
          emoji: r.emoji,
          count: r.users.length,
          userHasReacted: r.users.includes(currentUserId),
          userIds: r.users,
        }));

      setReactions(summaries);
      setLoading(false);
    });

    return () => unsub();
  }, [ctx.channelId, ctx.messageTs, currentUserId]);

  const toggleReaction = async (emoji: string) => {
    await callReactToSlackMessage({
      channelId: ctx.channelId,
      messageTs: ctx.messageTs,
      emoji,
    });
  };

  return { reactions, loading, toggleReaction };
}
```

> `callReactToSlackMessage` will be a Cloud Function that updates Firestore and optionally calls Slack’s API.

### 4.4 `SlackMessageReactionsBar` Component

```tsx
// src/components/slack/SlackMessageReactionsBar.tsx
import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Chip } from '@mui/material';
import AddReactionIcon from '@mui/icons-material/AddReaction';
import { useSlackReactions } from '@/hooks/useSlackReactions';
import { SlackReactionContext } from '@/types/slackReactions';
import { mapEmojiNameToGlyph } from '@/utils/emojiMap'; // 'white_check_mark' → '✅'
import { ReactionEmojiPicker } from './ReactionEmojiPicker';

interface Props {
  ctx: SlackReactionContext;
  currentUserId: string;
  compact?: boolean;
}

export const SlackMessageReactionsBar: React.FC<Props> = ({
  ctx,
  currentUserId,
  compact = false,
}) => {
  const { reactions, toggleReaction } = useSlackReactions(ctx, currentUserId);
  const [pickerAnchorEl, setPickerAnchorEl] = useState<HTMLElement | null>(null);

  const hasReactions = reactions.length > 0;

  const handleOpenPicker = (e: React.MouseEvent<HTMLElement>) => {
    setPickerAnchorEl(e.currentTarget);
  };

  const handleClosePicker = () => setPickerAnchorEl(null);

  const handleSelectEmoji = (emoji: string) => {
    toggleReaction(emoji);
    handleClosePicker();
  };

  if (!hasReactions && !pickerAnchorEl) {
    // Super subtle row – could even be hidden until hover on desktop
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          mt: 0.5,
          pl: compact ? 0 : 1,
        }}
      >
        <Tooltip title="Add reaction">
          <IconButton
            size="small"
            onClick={handleOpenPicker}
            sx={{ borderRadius: 2 }}
          >
            <AddReactionIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <ReactionEmojiPicker
          anchorEl={pickerAnchorEl}
          onClose={handleClosePicker}
          onSelect={handleSelectEmoji}
        />
      </Box>
    );
  }

  const visibleReactions = reactions.slice(0, 6);
  const overflowCount = reactions.length - visibleReactions.length;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 0.5,
        pl: compact ? 0 : 1,
      }}
    >
      {visibleReactions.map((r) => {
        const glyph = mapEmojiNameToGlyph(r.emoji);
        const label = `${glyph} ${r.count}`;

        const tooltipText = r.userHasReacted
          ? `You${r.count > 1 ? ` + ${r.count - 1} others` : ''}`
          : `${r.count} reacted`;

        return (
          <Tooltip key={r.emoji} title={tooltipText}>
            <Chip
              size="small"
              label={label}
              onClick={() => toggleReaction(r.emoji)}
              sx={{
                borderRadius: 2,
                px: 0.5,
                bgcolor: r.userHasReacted ? 'primary.light' : 'grey.100',
                color: r.userHasReacted ? 'primary.dark' : 'text.secondary',
                '&:hover': {
                  bgcolor: r.userHasReacted ? 'primary.main' : 'grey.200',
                },
              }}
            />
          </Tooltip>
        );
      })}

      {overflowCount > 0 && (
        <Chip
          size="small"
          label={`+${overflowCount}`}
          sx={{
            borderRadius: 2,
            px: 0.5,
            bgcolor: 'grey.100',
            color: 'text.secondary',
          }}
        />
      )}

      <Tooltip title="Add reaction">
        <IconButton
          size="small"
          onClick={handleOpenPicker}
          sx={{ borderRadius: 2 }}
        >
          <AddReactionIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <ReactionEmojiPicker
        anchorEl={pickerAnchorEl}
        onClose={handleClosePicker}
        onSelect={handleSelectEmoji}
      />
    </Box>
  );
};
```

### 4.5 `ReactionEmojiPicker` Skeleton

```tsx
// src/components/slack/ReactionEmojiPicker.tsx
import React from 'react';
import {
  Popover,
  Box,
  Typography,
  IconButton,
  TextField,
} from '@mui/material';

interface Props {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSelect: (emoji: string) => void; // emoji name: 'white_check_mark', 'eyes', etc.
}

const DEFAULT_EMOJIS = [
  'white_check_mark',
  'eyes',
  'raised_hands',
  'heart',
  'thumbsup',
  'fire',
];

export const ReactionEmojiPicker: React.FC<Props> = ({
  anchorEl,
  onClose,
  onSelect,
}) => {
  const open = Boolean(anchorEl);
  const id = open ? 'reaction-emoji-picker' : undefined;

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
  };

  return (
    <Popover
      id={id}
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
    >
      <Box sx={{ p: 1.5, minWidth: 220 }}>
        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
          Add a reaction
        </Typography>

        {/* Optional filter/search – can be wired later */}
        <TextField
          size="small"
          fullWidth
          placeholder="Search emoji…"
          sx={{ mb: 1 }}
        />

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
          }}
        >
          {DEFAULT_EMOJIS.map((emoji) => (
            <IconButton
              key={emoji}
              size="small"
              onClick={() => handleSelect(emoji)}
              sx={{ borderRadius: 2 }}
            >
              {/* This maps to actual unicode glyph */}
              <span style={{ fontSize: 18 }}>{/* mapEmojiNameToGlyph */}</span>
            </IconButton>
          ))}
        </Box>
      </Box>
    </Popover>
  );
};
```

### 4.6 Utility: `mapEmojiNameToGlyph`

```ts
// src/utils/emojiMap.ts
const EMOJI_MAP: Record<string, string> = {
  white_check_mark: '✅',
  eyes: '👀',
  raised_hands: '🙌',
  heart: '❤️',
  thumbsup: '👍',
  fire: '🔥',
};

export function mapEmojiNameToGlyph(name: string): string {
  return EMOJI_MAP[name] ?? '❓';
}
```

---

## 5. Backend Function Blueprint (High Level)

> Cursor can convert this into full Cloud Functions, but here’s the contract.

### 5.1 HTTPS Callable: `reactToSlackMessage`

```ts
// functions/src/slack/reactToSlackMessage.ts
interface ReactToSlackMessageInput {
  channelId: string;
  messageTs: string;
  emoji: string;
}

interface ReactToSlackMessageResult {
  success: boolean;
}

export const reactToSlackMessage = functions.https.onCall(
  async (data: ReactToSlackMessageInput, context): Promise<ReactToSlackMessageResult> => {
    const userId = context.auth?.uid;
    if (!userId) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { channelId, messageTs, emoji } = data;
    // 1. Load existing document
    // 2. Toggle current user in that emoji's users list
    // 3. Save back to Firestore
    // 4. Optionally call Slack reactions.add / reactions.remove
    // 5. Return success

    return { success: true };
  }
);
```

### 5.2 Slack Webhook Listener (Events API)

- Handle `reaction_added` and `reaction_removed`.
- Normalize into same document format as above.
- Ensure idempotent updates (avoid double counting).
- Store in `slackMessageReactions`.

---

## 6. Phased Rollout Plan

### Phase 1 — Local Reactions Only
- Implement React components + Firestore storage.  
- No Slack API calls yet.  
- Use only internal userIds.

### Phase 2 — Full Slack Sync
- Wire `reactToSlackMessage` to Slack `reactions.add/remove`.  
- Add Events API webhook to backfill remote reactions.  

### Phase 3 — Polish & Analytics
- Avatar previews on hover.  
- Per‑channel “reaction heatmap”.  
- Filters (e.g. “show messages I reacted to”).

---

## 7. Acceptance Criteria

- [ ] User can add/remove reactions in the app.  
- [ ] Reactions update live for all users viewing the channel.  
- [ ] UI uses MUI components and matches app design language.  
- [ ] No more than 6 reactions visible; overflow collapsed.  
- [ ] (Phase 2) Slack reactions remain in sync with app reactions.  

---

**Next Step for Cursor:**  
1. Create these files in the repo:  
   - `src/types/slackReactions.ts`  
   - `src/hooks/useSlackReactions.ts`  
   - `src/components/slack/SlackMessageReactionsBar.tsx`  
   - `src/components/slack/ReactionEmojiPicker.tsx`  
   - `src/utils/emojiMap.ts`  
2. Implement the basic Firestore‑only behavior.  
3. Wire `SlackMessageReactionsBar` into the Slack message row component.
