# Inbox Phase 1 Implementation Plan
## Based on ChatGPT Feedback - "Gmail Reliability + Mimestream Smoothness"

---

## 🎯 CURRENT STATE AUDIT

### ✅ What We Already Have

**Gmail Integration:**
- ✅ OAuth Gmail connection (`getGmailAuthUrl`, `handleGmailCallback`)
- ✅ One-way sync (`syncGmailEmails`, `monitorGmailForContactEmailsInternal`)
- ✅ Email threading (`findOrCreateEmailThread`, `addMessageToThread`)
- ✅ Gmail message ID tracking (`gmailMessageId`, `gmailThreadId`)
- ✅ Token refresh handling

**Inbox UI:**
- ✅ Basic threaded email view (`EmailThreadView`)
- ✅ Email threads list (`UserInboxPage` - Email tab)
- ✅ SMS threads list (`UserInboxPage` - SMS tab)
- ✅ Pagination (basic)
- ✅ Compose button

**Composer:**
- ✅ Multi-recipient (To, Cc, Bcc) in `MessageDrawer`
- ✅ Rich text editor (`EmailTemplateEditor`)
- ✅ Attachments (file upload to Firebase Storage)
- ✅ Sender selection (System, Gmail, Recruiter SMS)
- ✅ Channel selection (Email, SMS, Push)

**Thread View:**
- ✅ Full conversation stack (`EmailThreadView`)
- ✅ Sender avatars
- ✅ Inline reply box (via `MessageDrawer`)
- ✅ Attachments display

**SMS:**
- ✅ Threaded conversations (`SmsThread`, `ReplyDrawer`)
- ✅ Two-way messaging
- ✅ STOP/HELP keyword handling

---

## ❌ PHASE 1 GAPS (Must-Have Features Missing)

### 🔗 Gmail Sync — Missing Two-Way Features

**Current:** One-way sync (Gmail → HRX)
**Needed:**
- [ ] **Read state sync** - Mark Gmail messages as read when viewed in HRX
- [ ] **Archive/Delete sync** - Archive/delete in HRX should sync to Gmail
- [ ] **Labels ↔ Folders** - Map Gmail labels to HRX folders/categories
- [ ] **Sent mail sync** - Currently only syncing received emails
- [ ] **Aliases + signature mapping** - Support multiple Gmail accounts/aliases
- [ ] **Gmail push notifications** - Use Gmail watch API instead of polling

**Files to Update:**
- `functions/src/gmailIntegration.ts` - Add two-way sync functions
- `functions/src/messaging/emailThreadsApi.ts` - Add archive/delete/read endpoints
- New: `functions/src/messaging/gmailSyncService.ts` - Centralized sync logic

---

### 📥 Inbox UI — Missing Polish

**Current:** Basic table with columns
**Needed:**
- [ ] **Unread bolding** - Bold unread threads in list
- [ ] **Quick-preview pane** - Show message preview on hover or side panel
- [ ] **Keyboard navigation** - Arrow keys, Enter to open, etc.
- [ ] **Better column layout** - From, Subject, Snippet, Date (already have, but needs styling)
- [ ] **Infinite scroll option** - Currently pagination only

**Files to Update:**
- `src/pages/UserInboxPage.tsx` - Add unread styling, preview pane, keyboard handlers
- New: `src/components/EmailPreviewPane.tsx` - Quick preview component

---

### ✉️ Composer — Missing Features

**Current:** Good foundation
**Needed:**
- [ ] **Email templates dropdown** - Quick access to saved templates
- [ ] **Signature support** - Auto-append user signatures
- [ ] **Clickable recipient chips** - Remove recipients easily
- [ ] **Drive attachments** - Link to Google Drive files (future)
- [ ] **Formatting toolbar enhancements** - Already have rich text, but add quote formatting

**Files to Update:**
- `src/components/MessageDrawer.tsx` - Add template selector, signature support, chip removal
- New: `src/components/SignatureManager.tsx` - Manage user signatures

---

### 🧵 Thread View — Missing Features

**Current:** Good conversation view
**Needed:**
- [ ] **Expand/collapse messages** - Collapse older messages in thread
- [ ] **Highlight outgoing email** - Visual distinction for sent vs received
- [ ] **Better inline reply** - Currently opens drawer, could be inline

**Files to Update:**
- `src/components/EmailThreadView.tsx` - Add expand/collapse, highlight outgoing

---

### 🎯 Inbox Filters — Missing

**Current:** Only Email and SMS tabs
**Needed:**
- [ ] **Filter sidebar** - All mail, Unread, Starred, Sent, Archived, Trash
- [ ] **Labels filter** - Show Gmail labels as filter options
- [ ] **Filter state management** - Persist filter selection

**Files to Create/Update:**
- New: `src/components/InboxFilters.tsx` - Filter sidebar component
- `src/pages/UserInboxPage.tsx` - Integrate filters, update queries

---

### ⭐️ Snooze & Archive — Missing

**Current:** No snooze/archive functionality
**Needed:**
- [ ] **Archive action** - Remove from inbox, keep in thread
- [ ] **Snooze action** - Hide until specified time
- [ ] **Archive view** - Show archived threads separately
- [ ] **Snooze queue** - Background job to restore snoozed items

**Files to Create/Update:**
- `functions/src/messaging/emailThreadsApi.ts` - Add `archiveThread`, `snoozeThread` endpoints
- `src/pages/UserInboxPage.tsx` - Add archive/snooze buttons
- New: `functions/src/messaging/snoozeService.ts` - Handle snooze restoration

---

### 🔥 Fast Search — Missing

**Current:** No search functionality
**Needed:**
- [ ] **Search input** - Global search bar in inbox
- [ ] **Subject search** - Query by subject line
- [ ] **Sender search** - Query by sender email/name
- [ ] **Body text search** - Full-text search (Firestore or Gmail API)
- [ ] **Thread search** - Search within thread messages
- [ ] **Search suggestions** - Autocomplete as you type

**Files to Create/Update:**
- New: `src/components/InboxSearch.tsx` - Search component
- New: `functions/src/messaging/searchApi.ts` - Search endpoint
- `src/pages/UserInboxPage.tsx` - Integrate search

---

### 📌 Quick Actions — Missing

**Current:** Only Reply button
**Needed:**
- [ ] **Hover actions** - Show action buttons on row hover
- [ ] **Archive button** - Quick archive
- [ ] **Delete button** - Quick delete
- [ ] **Mark unread** - Toggle read state
- [ ] **Star button** - Star/unstar thread
- [ ] **Bulk select** - Checkbox column, select multiple
- [ ] **Bulk actions** - Apply action to selected threads

**Files to Update:**
- `src/pages/UserInboxPage.tsx` - Add hover actions, bulk select, action buttons
- `functions/src/messaging/emailThreadsApi.ts` - Add bulk update endpoints

---

### 🔕 Notifications — Missing

**Current:** No badge or notifications
**Needed:**
- [ ] **Unread badge** - Show count on Inbox menu item
- [ ] **Toast confirmations** - "Email sent", "Thread archived", etc.
- [ ] **Real-time updates** - Listen for new messages (Firestore listeners)

**Files to Create/Update:**
- `src/utils/menuGenerator.ts` - Add badge count to Inbox menu item
- New: `src/components/ToastNotifications.tsx` - Toast system
- `src/pages/UserInboxPage.tsx` - Add Firestore listeners

---

### 📱 SMS — Enhancements Needed

**Current:** Basic threading
**Needed:**
- [ ] **Read receipt timestamps** - Show when SMS was read
- [ ] **Character counter** - Show remaining characters (160 limit)
- [ ] **Compliance footer option** - Auto-append STOP/HELP footer
- [ ] **Auto-block opt-out** - Detect "STOP" and block automatically (partially done)

**Files to Update:**
- `src/components/ReplyDrawer.tsx` - Add character counter, read receipts
- `src/components/MessageDrawer.tsx` - Add SMS character counter
- `functions/src/messaging/stopHelpHandler.ts` - Already handles STOP, but enhance

---

### 🔔 Push — Enhancements Needed

**Current:** Basic send capability
**Needed:**
- [ ] **Preview text** - Show preview in composer
- [ ] **Link attachment** - Add URL to push notification
- [ ] **Push history view** - Show sent push notifications

**Files to Update:**
- `src/components/MessageDrawer.tsx` - Add preview text, link field for push
- `src/pages/UserInboxPage.tsx` - Add Push tab (currently removed, but should show history)

---

### 🛡 Security + Safety — Enhancements

**Current:** Basic error handling
**Needed:**
- [ ] **Gmail rate limit handling** - Exponential backoff, queue requests
- [ ] **Message send failure logging** - Enhanced logging
- [ ] **Retry queue** - Retry failed sends automatically

**Files to Create/Update:**
- New: `functions/src/messaging/rateLimitHandler.ts` - Gmail rate limit management
- New: `functions/src/messaging/retryQueue.ts` - Retry failed messages
- `functions/src/messaging/routingOrchestrator.ts` - Integrate retry logic

---

### 🧭 Navigation — Enhancements

**Current:** Basic tabs
**Needed:**
- [ ] **Unified inbox tab** - Show all channels in one view (optional)
- [ ] **Search scoped per channel** - Search within Email or SMS separately
- [ ] **Better tab styling** - More Gmail-like

**Files to Update:**
- `src/pages/UserInboxPage.tsx` - Add unified view option, improve tab styling

---

## 📋 PHASE 1 IMPLEMENTATION PRIORITY

### 🔴 CRITICAL (Week 1)
1. **Gmail Two-Way Sync** - Read state, archive/delete
2. **Inbox Filters** - Unread, Starred, Sent, Archived
3. **Fast Search** - Basic search (subject, sender)
4. **Quick Actions** - Archive, delete, star, mark unread
5. **Unread Badge** - Show count in menu

### 🟡 HIGH (Week 2)
6. **Snooze & Archive** - Full archive/snooze functionality
7. **Inbox UI Polish** - Unread bolding, preview pane, keyboard nav
8. **Composer Enhancements** - Templates, signatures, clickable chips
9. **Thread View Enhancements** - Expand/collapse, highlight outgoing
10. **SMS Enhancements** - Character counter, read receipts

### 🟢 MEDIUM (Week 3)
11. **Push Enhancements** - Preview text, link attachment, history
12. **Bulk Actions** - Select multiple, bulk archive/delete
13. **Notifications** - Toast confirmations, real-time updates
14. **Gmail Labels** - Sync and display Gmail labels
15. **Security Enhancements** - Rate limiting, retry queue

---

## 🏗️ TECHNICAL ARCHITECTURE CHANGES

### Data Model Updates

**Current:** `/tenants/{tenantId}/emailThreads/{threadId}`
**Recommended:** Keep current structure, but add:
```typescript
{
  // Existing fields...
  gmailLabels?: string[]; // Gmail labels
  archivedAt?: Timestamp; // Archive timestamp
  snoozedUntil?: Timestamp; // Snooze timestamp
  archivedBy?: string; // User who archived
}
```

**Current:** `/tenants/{tenantId}/emailMessages/{messageId}`
**Recommended:** Add:
```typescript
{
  // Existing fields...
  gmailRead?: boolean; // Synced from Gmail
  readAt?: Timestamp; // When read in HRX
}
```

### New Collections Needed

- `/tenants/{tenantId}/snoozedThreads/{threadId}` - Snooze queue
- `/tenants/{tenantId}/userSignatures/{userId}` - User signatures
- `/tenants/{tenantId}/searchIndex/{docId}` - Search index (optional, can use Firestore queries)

### API Endpoints to Add

- `POST /api/messaging/threads/:threadId/archive` - Archive thread
- `POST /api/messaging/threads/:threadId/unarchive` - Unarchive thread
- `POST /api/messaging/threads/:threadId/snooze` - Snooze thread
- `POST /api/messaging/threads/:threadId/star` - Star/unstar thread
- `POST /api/messaging/threads/:threadId/read` - Mark as read
- `POST /api/messaging/threads/bulk-update` - Bulk actions
- `GET /api/messaging/search` - Search endpoint
- `POST /api/messaging/gmail/sync-read` - Sync read state to Gmail
- `POST /api/messaging/gmail/sync-archive` - Sync archive to Gmail

---

## 🎨 UI/UX IMPROVEMENTS NEEDED

### Inbox List View
- Add hover effects on rows
- Show action buttons on hover (Archive, Delete, Star)
- Add checkbox column for bulk select
- Bold unread threads
- Add preview pane (optional, can be side panel)

### Thread View
- Add expand/collapse for older messages
- Highlight user's outgoing messages
- Better date formatting
- Show read receipts for SMS

### Composer
- Add template selector dropdown
- Add signature selector
- Make recipient chips removable
- Add character counter for SMS
- Improve formatting toolbar

### Navigation
- Add filter sidebar
- Add search bar at top
- Add unread badge to menu item
- Improve tab styling

---

## 🚀 RECOMMENDED STARTING POINT

**Start with these 3 features for maximum impact:**

1. **Inbox Filters** (Unread, Starred, Sent, Archived) - Makes inbox usable
2. **Quick Actions** (Archive, Delete, Star) - Essential workflow
3. **Gmail Two-Way Sync** (Read state, Archive) - Core Gmail integration

These three will give you 80% of the Gmail-like experience.

---

## 📝 NEXT STEPS

Would you like me to:
1. **Start implementing Phase 1 Critical items** (Week 1 priorities)?
2. **Create detailed technical specs** for each feature?
3. **Build a specific feature** you choose?

Let me know which approach you prefer!

