# Dashboard — Phase 1 Acceptance Checklist
_Derived from `dashboard-master-feed-ui-spec.md` (Phase 1 scope)._

## Access & Routing
- [ ] **Admin-only access**: Users with `securityLevel` **5–7** can access `/dashboard`.
- [ ] **Staff redirect**: Users with `securityLevel` **0–4** who navigate to `/dashboard` are **redirected to `/profile`**.
- [ ] **Home redirect**: `/` routes users to **`/dashboard` (5–7)** or **`/profile` (0–4)**.

## Layout & UI Standards
- [ ] **Header** uses the “Inbox standard” header patterns (title, toolbar/actions; calm, enterprise, no visual noise).
- [ ] **Quick Actions Toolbar**: 6 pill buttons exist and are not crowded.
- [ ] **Two-column desktop layout**:
  - Left ~2/3: Master Feed
  - Right ~1/3: Calendar (top) + To‑Dos (bottom)
- [ ] **Scrolling**: Dashboard page content scrolls correctly; user can reach all content.
- [ ] **Bottom padding**: 16px bottom padding on scroll container(s).

## Master Feed (Phase 1)
- [ ] **Sources included**:
  - Email (Inbox)
  - Slack DMs
  - Slack Channels (member + not muted)
- [ ] **Chronological**: Feed is sorted by newest-first (or newest within time buckets).
- [ ] **Time bucket headers** appear in the list:
  - Now
  - Earlier Today
  - Yesterday
  - This Week
  - Older
- [ ] **Row click opens Universal Drawer** for each source type (no navigation required).
- [ ] **Pagination**: Feed paginates and footer matches the standard table pagination.

## Calendar Widget (Phase 1)
- [ ] **Connected state**: Calendar renders when Google Calendar is connected.
- [ ] **Not connected state**: A **“Sync Calendar”** CTA appears when not connected (no crash).

## To‑Dos Widget (Phase 1)
- [ ] **Widget renders** in right column bottom half.
- [ ] **Basic interaction** works (view items) without breaking Dashboard scroll/layout.

## Non-Goals for Phase 1 (explicitly deferred)
- [ ] Hover actions (reply/complete/snooze) — Phase 2
- [ ] Drawer-first for Calendar events + To‑Dos — Phase 2
- [ ] Persisted unified `feedEvents/` Firestore model — Phase 2/3


