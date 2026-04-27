# HRX Presence & Online Status Spec

This document defines the **presence system** for HRX internal messaging, including:

- Data model for user presence
- Backend & client responsibilities
- `useUserPresence` hook (read)
- `useHeartbeatPresence` hook (write)
- `StatusDot` React component skeleton
- Integration points for the Messages UI (DM people list + threads)

Assumptions:

- Stack: **React + TypeScript + MUI**, Firestore, Firebase Auth
- Existing `User` / `HrxUser` model with `id`, `displayName`, `email`, `avatarUrl`
- Presence is **app-level**, with optional Slack presence enrichment later

---

## 1. Data Model

### 1.1 Firestore Collection

**Collection:** `userPresence`  
**Document ID:** `userId` (same as Firebase Auth UID or internal user id)

```ts
// firestore document: userPresence/{userId}

export type PresenceStatus = 'online' | 'idle' | 'offline';

export interface UserPresenceDoc {
  status: PresenceStatus;        // derived, but stored for simplicity
  lastSeenAt: firebase.firestore.Timestamp;
  device?: 'web' | 'mobile' | 'unknown';
  source?: 'hrx' | 'slack' | 'combined';

  // Optional enrichment (future)
  slackPresence?: 'active' | 'away' | 'unknown';
  // could be expanded with zoom, teams, etc.
}
```

> **Note:** `status` is technically derivable from `lastSeenAt`, but storing it keeps UI logic simple and allows external systems (Cloud Functions) to update it.

### 1.2 Derived Status Rules

These rules should be applied **consistently** in a shared util:

```ts
// utils/presence.ts

import { differenceInMinutes } from 'date-fns';
import type { UserPresenceDoc, PresenceStatus } from '../types/presence';

export function getEffectiveStatus(doc: UserPresenceDoc | null | undefined): PresenceStatus {
  if (!doc || !doc.lastSeenAt) return 'offline';

  const lastSeen = doc.lastSeenAt.toDate();
  const minutesAgo = differenceInMinutes(new Date(), lastSeen);

  if (minutesAgo <= 2) return 'online';      // active in last 2 minutes
  if (minutesAgo <= 30) return 'idle';       // 2–30 minutes
  return 'offline';                          // otherwise offline
}
```

These thresholds can be moved to config if needed.

---

## 2. Client Heartbeat (Writing Presence)

Presence writes should be done **only by the active session** for a user.

### 2.1 `useHeartbeatPresence` Hook

**Responsibility:**  
- Start a heartbeat when the user is logged in and viewing the app
- Update presence every N seconds
- Mark user as `offline` on best-effort unmount

```tsx
// src/hooks/useHeartbeatPresence.ts

import { useEffect } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase'; // your Firestore instance
import { useAuth } from '../contexts/AuthContext'; // assumes you have this

const HEARTBEAT_INTERVAL_MS = 45_000; // 45 seconds

export function useHeartbeatPresence() {
  const { user } = useAuth(); // { uid, ... }

  useEffect(() => {
    if (!user) return;

    const userId = user.uid;
    const ref = doc(db, 'userPresence', userId);

    let intervalId: number | undefined;

    const writePresence = (status: 'online' | 'idle' | 'offline') => {
      return setDoc(
        ref,
        {
          status,
          lastSeenAt: serverTimestamp(),
          device: 'web',
          source: 'hrx',
        },
        { merge: true }
      );
    };

    // Initial write as online
    void writePresence('online');

    // Heartbeat
    intervalId = window.setInterval(() => {
      void writePresence('online');
    }, HEARTBEAT_INTERVAL_MS);

    // Best-effort mark offline on unload
    const handleBeforeUnload = () => {
      // Navigator.sendBeacon or synchronous XHR are options;
      // but for simplicity we just fire and forget
      void writePresence('offline');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // On route change/unmount we don't force offline, in case user opened another tab.
    };
  }, [user]);
}
```

**Usage:**  
Call `useHeartbeatPresence()` once in a top-level component, e.g. `AppShell` or `DashboardLayout`.

```tsx
// src/AppShell.tsx

export const AppShell: React.FC = () => {
  useHeartbeatPresence();

  return (
    // ...
  );
};
```

> Future: Add idle detection based on mouse/keyboard inactivity and switch to `idle` when no activity for e.g. 10 minutes.

---

## 3. Reading Presence

### 3.1 `useUserPresence` Hook (single user)

```tsx
// src/hooks/useUserPresence.ts

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserPresenceDoc, PresenceStatus } from '../types/presence';
import { getEffectiveStatus } from '../utils/presence';

export interface UseUserPresenceResult {
  status: PresenceStatus;
  lastSeenAt: Date | null;
  raw: UserPresenceDoc | null;
  loading: boolean;
}

export function useUserPresence(userId: string | undefined | null): UseUserPresenceResult {
  const [raw, setRaw] = useState<UserPresenceDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(!!userId);

  useEffect(() => {
    if (!userId) {
      setRaw(null);
      setLoading(false);
      return;
    }

    const ref = doc(db, 'userPresence', userId);

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setRaw(null);
        } else {
          setRaw(snap.data() as UserPresenceDoc);
        }
        setLoading(false);
      },
      (error) => {
        console.error('useUserPresence error', error);
        setRaw(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const status = getEffectiveStatus(raw);
  const lastSeenAt = raw?.lastSeenAt?.toDate() ?? null;

  return { status, lastSeenAt, raw, loading };
}
```

### 3.2 Optional: `useManyUserPresence`

For the **People** list in Messages, you may want a batched version that listens to multiple users with `where('__name__', 'in', [...])`, or simply call `useUserPresence` per person (start simple, optimize later).

---

## 4. `StatusDot` Component (React + MUI)

### 4.1 Component API

```ts
export type StatusDotSize = 'xs' | 'sm' | 'md';

export interface StatusDotProps {
  status: PresenceStatus;
  size?: StatusDotSize;
  showLabel?: boolean;
  lastSeenAt?: Date | null;
  variant?: 'solid' | 'subtle'; // subtle for less-dominant places
  className?: string;
}
```

### 4.2 Implementation Skeleton

```tsx
// src/components/presence/StatusDot.tsx

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { PresenceStatus } from '../../types/presence';
import type { StatusDotProps, StatusDotSize } from './types';
import { formatDistanceToNowStrict } from 'date-fns';

const SIZE_MAP: Record<StatusDotSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
};

const COLOR_MAP: Record<PresenceStatus, string> = {
  online: '#22c55e',  // green
  idle: '#facc15',    // yellow
  offline: '#9ca3af', // gray
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  size = 'sm',
  showLabel = false,
  lastSeenAt,
  variant = 'solid',
  className,
}) => {
  const px = SIZE_MAP[size];
  const color = COLOR_MAP[status];

  const label = React.useMemo(() => {
    if (status === 'online') return 'Online';
    if (status === 'idle') return 'Idle';
    if (!lastSeenAt) return 'Offline';

    const distance = formatDistanceToNowStrict(lastSeenAt, { addSuffix: true });
    return `Offline · ${distance}`;
  }, [status, lastSeenAt]);

  const dotStyles =
    variant === 'solid'
      ? {
          backgroundColor: color,
        }
      : {
          border: `2px solid ${color}`,
        };

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      gap={0.75}
      className={className}
    >
      <Box
        component="span"
        sx={{
          width: px,
          height: px,
          borderRadius: '999px',
          ...dotStyles,
        }}
      />
      {showLabel && (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
};
```

> This component is intentionally minimal so it can be reused in multiple contexts.

---

## 5. Integration Points

### 5.1 Messages Drawer – People List

**Goal:** show presence next to each coworker in the left column.

For each internal user row:

```tsx
// src/components/messages/PeopleListItem.tsx

import { StatusDot } from '../presence/StatusDot';
import { useUserPresence } from '../../hooks/useUserPresence';

interface PeopleListItemProps {
  user: HrxUser;
  onClick: () => void;
}

export const PeopleListItem: React.FC<PeopleListItemProps> = ({ user, onClick }) => {
  const { status, lastSeenAt } = useUserPresence(user.id);

  return (
    <ListItem button onClick={onClick}>
      <ListItemAvatar>
        {/* existing Avatar */}
      </ListItemAvatar>
      <ListItemText
        primary={user.displayName}
        secondary={user.title ?? user.email}
      />
      <StatusDot status={status} lastSeenAt={lastSeenAt} size="xs" />
    </ListItem>
  );
};
```

### 5.2 DM Thread Header

At the top of a DM thread, show:

- Avatar
- Name
- `StatusDot` with label

```tsx
// src/components/messages/ThreadHeader.tsx

import { StatusDot } from '../presence/StatusDot';
import { useUserPresence } from '../../hooks/useUserPresence';

interface ThreadHeaderProps {
  participant: HrxUser;
}

export const ThreadHeader: React.FC<ThreadHeaderProps> = ({ participant }) => {
  const { status, lastSeenAt } = useUserPresence(participant.id);

  return (
    <Box display="flex" alignItems="center" justifyContent="space-between" px={2} py={1.5}>
      <Box display="flex" alignItems="center" gap={1.5}>
        {/* Avatar + Name */}
      </Box>

      <StatusDot
        status={status}
        lastSeenAt={lastSeenAt}
        size="sm"
        showLabel
      />
    </Box>
  );
};
```

---

## 6. Future Enhancements (Optional)

These can be added later without breaking the current spec:

1. **Idle detection**
   - Track mouse/keyboard activity; if no activity for N minutes, write `status: 'idle'` instead of `'online'`.

2. **Slack presence merge**
   - Add a Cloud Function that periodically syncs `slackPresence` for users who have Slack connected.
   - Update `getEffectiveStatus` to consider Slack presence when app presence is stale.

3. **Multi-device awareness**
   - Add `device` field and show tooltips such as “Online · mobile” vs “Online · desktop”.

4. **Org-wide presence heatmap / analytics**
   - Later, aggregate presence data for leadership dashboards (e.g. typical engagement hours).

---

## 7. Implementation Order for Cursor

1. **Create presence types & utils**
   - `src/types/presence.ts`
   - `src/utils/presence.ts`

2. **Implement `useHeartbeatPresence` and `useUserPresence` hooks**
   - Wire `useHeartbeatPresence` into `AppShell`.

3. **Add `StatusDot` component**
   - Place in `src/components/presence/StatusDot.tsx`.

4. **Integrate into Messages UI**
   - People list entries
   - Thread header

5. **QA**
   - Open app in two browsers with different users → verify status updates in near real time.
   - Check Firestore writes for `userPresence` documents.
