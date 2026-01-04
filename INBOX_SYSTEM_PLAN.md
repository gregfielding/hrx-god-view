# Unified Inbox System Plan

## Overview
Build comprehensive inbox systems for both users (candidates/workers) and internal team members (recruiters/admins) to view, manage, and respond to all messages across Email, SMS, and Push channels.

## User Types & Requirements

### 1. User Inbox (Candidates/Workers)
**Location**: `/c1/messages` or `/workforce/messages` (worker routes)

**Features**:
- View all messages received (Email, SMS, Push)
- Reply to SMS threads
- View email conversations (read-only initially)
- Mark messages as read/unread
- Filter by channel, date, status
- Search messages
- Real-time updates for new messages

**Permissions**: Users can only see their own messages

### 2. Internal Team Inbox (Recruiters/Admins)
**Location**: `/recruiter/messages` or `/messages` (admin routes)

**Features**:
- View all messages sent/received
- View messages by recipient (when viewing user profile)
- Reply to SMS threads
- Compose new messages (opens MessageDrawer)
- View email conversations (with reply capability)
- Filter by:
  - Channel (Email, SMS, Push)
  - Direction (Sent, Received)
  - Status (Sent, Delivered, Failed, etc.)
  - Recipient
  - Date range
- Search across all messages
- Bulk actions (mark as read, archive)
- Real-time updates

**Permissions**: Admins can see all messages, recruiters see their own + team messages

## Technical Architecture

### Data Sources

**Message Logs**: `/tenants/{tenantId}/messageLogs/{logId}`
- All messages (Email, SMS, Push)
- Includes direction, status, content, timestamps

**SMS Threads**: `/tenants/{tenantId}/smsThreads/{threadId}`
- SMS conversations
- Includes messages subcollection

**Email Threads** (Future): `/tenants/{tenantId}/emailThreads/{threadId}`
- Email conversations
- Grouped by subject/participants

### API Endpoints Needed

**For Users**:
- `GET /api/messaging/inbox/user` - Get user's inbox (all channels)
- `GET /api/messaging/inbox/user/threads` - Get user's SMS threads
- `POST /api/messaging/inbox/mark-read` - Mark messages as read

**For Internal Team**:
- `GET /api/messaging/inbox/team` - Get team inbox (all messages)
- `GET /api/messaging/inbox/team/sent` - Get sent messages
- `GET /api/messaging/inbox/team/received` - Get received messages
- `GET /api/messaging/inbox/team/by-recipient/:userId` - Get messages for specific user
- `POST /api/messaging/inbox/mark-read` - Mark messages as read
- `POST /api/messaging/inbox/archive` - Archive messages

## UI Components

### 1. UserInboxPage.tsx
**Route**: `/c1/messages` or `/workforce/messages`

**Layout**:
- Left sidebar: Channel filters (All, Email, SMS, Push)
- Main area: Message list with conversation view
- Right drawer: Message detail/compose (slides in)

**Features**:
- Unread count badges
- Message preview cards
- Click to view full message
- Reply button for SMS threads
- Mark as read/unread
- Search bar

### 2. TeamInboxPage.tsx
**Route**: `/recruiter/messages` or `/messages`

**Layout**:
- Left sidebar: 
  - Filters (Channel, Direction, Status, Date range)
  - Quick filters (Unread, Today, This Week)
- Main area: 
  - Message list (table or cards)
  - Grouped by conversation/thread
- Right drawer: 
  - Message detail
  - Compose new message
  - Reply to thread

**Features**:
- Advanced filtering
- Bulk selection
- Export messages
- Real-time updates
- Unread indicators
- Status indicators

### 3. InboxMessageCard.tsx
**Reusable component for message display**

**Shows**:
- Channel icon (Email/SMS/Push)
- Sender/Recipient name
- Subject/Preview
- Timestamp
- Status indicator
- Unread badge
- Actions (Reply, View, Archive)

### 4. ConversationView.tsx
**Threaded conversation display**

**Features**:
- Chat-style message bubbles
- Grouped by date
- Read receipts
- Status indicators
- Reply input at bottom
- Auto-scroll to latest

### 5. InboxFilters.tsx
**Filter sidebar component**

**Filters**:
- Channel (Email, SMS, Push)
- Direction (Inbound, Outbound)
- Status (Sent, Delivered, Failed, etc.)
- Date range
- Search query
- Unread only

## Data Models

### InboxMessage (Unified View)
```typescript
interface InboxMessage {
  id: string;
  threadId?: string; // For grouping conversations
  channel: 'email' | 'sms' | 'push';
  direction: 'inbound' | 'outbound';
  from: {
    name: string;
    email?: string;
    phone?: string;
    userId?: string;
  };
  to: {
    name: string;
    email?: string;
    phone?: string;
    userId: string;
  };
  subject?: string; // Email only
  preview: string; // First 100 chars
  content: string; // Full content
  status: string;
  read: boolean;
  readAt?: Timestamp;
  createdAt: Timestamp;
  // Channel-specific fields
  emailThreadId?: string;
  smsThreadId?: string;
}
```

### Conversation Thread
```typescript
interface ConversationThread {
  id: string;
  channel: 'email' | 'sms';
  participants: string[]; // User IDs
  subject?: string; // Email subject or SMS thread identifier
  lastMessageAt: Timestamp;
  lastMessagePreview: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'closed';
}
```

## Implementation Phases

### Phase 1: User Inbox (Basic)
1. Create `UserInboxPage` component
2. Build API endpoint `getUserInbox`
3. Display messages in list view
4. Add channel filtering
5. Add message detail modal
6. Add SMS reply functionality

### Phase 2: User Inbox (Enhanced)
1. Add conversation threading
2. Add read/unread status
3. Add search functionality
4. Add real-time updates (Firestore listeners)
5. Add push notification integration

### Phase 3: Team Inbox (Basic)
1. Create `TeamInboxPage` component
2. Build API endpoint `getTeamInbox`
3. Display sent/received messages
4. Add advanced filtering
5. Add compose message button

### Phase 4: Team Inbox (Enhanced)
1. Add conversation threading
2. Add bulk actions
3. Add export functionality
4. Add recipient filtering
5. Add real-time updates
6. Add email reply capability

### Phase 5: Email Threading
1. Create email thread detection logic
2. Group emails by subject/participants
3. Build email conversation view
4. Add email reply functionality

## API Endpoints to Build

### Backend Functions

**analyticsApi.ts** (extend existing):
```typescript
// GET /api/messaging/inbox/user
export const getUserInbox = onRequest(...)

// GET /api/messaging/inbox/team
export const getTeamInbox = onRequest(...)

// GET /api/messaging/inbox/team/by-recipient/:userId
export const getInboxByRecipient = onRequest(...)
```

**threadsApi.ts** (extend existing):
```typescript
// GET /api/messaging/inbox/threads
export const getInboxThreads = onRequest(...)

// POST /api/messaging/inbox/mark-read
export const markMessagesRead = onRequest(...)
```

## UI/UX Considerations

### User Inbox
- **Mobile-first**: Optimized for worker mobile app
- **Simple**: Easy to read and reply
- **Fast**: Quick access to latest messages
- **Clear**: Obvious what's unread

### Team Inbox
- **Powerful**: Advanced filtering and search
- **Efficient**: Bulk actions, keyboard shortcuts
- **Comprehensive**: See all team activity
- **Actionable**: Quick compose, reply, forward

## Real-time Updates

**Firestore Listeners**:
- Listen to `/tenants/{tenantId}/messageLogs` for new messages
- Listen to `/tenants/{tenantId}/smsThreads/{threadId}/messages` for thread updates
- Update inbox in real-time
- Show notification badges

## Search & Filtering

**Search Fields**:
- Message content
- Sender/recipient name
- Subject (email)
- Phone number (SMS)

**Filter Options**:
- Channel (Email, SMS, Push)
- Direction (Inbound, Outbound)
- Status (Sent, Delivered, Failed, etc.)
- Date range
- Unread only
- Has attachments (email)

## Integration Points

1. **MessageDrawer**: Use for composing new messages from inbox
2. **ReplyDrawer**: Use for SMS thread replies
3. **EmailReplyDrawer** (new): For email replies
4. **MessagesTab**: Link to inbox from user profile
5. **Notification System**: Show unread counts in nav

## Success Criteria

1. ✅ Users can view all their messages in one place
2. ✅ Users can reply to SMS threads easily
3. ✅ Internal team can see all sent/received messages
4. ✅ Internal team can filter and search effectively
5. ✅ Real-time updates work reliably
6. ✅ Mobile-friendly for user inbox
7. ✅ Desktop-optimized for team inbox
8. ✅ Performance is good with large message volumes

## Next Steps

1. Review and approve this plan
2. Start with Phase 1 (User Inbox Basic)
3. Build incrementally, test each phase
4. Add real-time updates early
5. Iterate based on user feedback

