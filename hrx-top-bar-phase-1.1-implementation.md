# HRX Top Bar & Messages — Phase 1.1 Implementation Plan

_Last updated: 2025-01-XX_  
_Based on: hrx-slack-topbar-spec.md + hrx-slack-wireframes.md_

This document outlines the step-by-step implementation plan for Phase 1.1, which includes:
1. **Top Bar Notifications** (already started)
2. **Messages Module** (internal Slack-style messaging)
3. **Data Structures & APIs**

---

## 🎯 Phase 1.1 Goals

### Primary Objectives:
- ✅ Complete top bar notifications UI (already done)
- ⏳ Implement Messages counter data fetching
- ⏳ Build Messages module (DMs + Channels)
- ⏳ Set up Firestore collections for internal messages
- ⏳ Create real-time message listeners
- ⏳ Implement unread count tracking

### Success Criteria:
- Users can send/receive internal messages
- Unread counts update in real-time
- Messages module accessible from top bar
- Clean separation: Inbox (external) vs Messages (internal)

---

## 📋 Implementation Checklist

### Part 1: Top Bar Notifications (Mostly Complete)

- [x] Add notification icons to Layout.tsx
- [x] Implement Inbox counter (already working)
- [x] Add Messages counter UI (placeholder)
- [x] Add Alerts counter UI (placeholder)
- [x] Implement Avatar dropdown menu
- [ ] **TODO**: Fetch Messages unread count from Firestore
- [ ] **TODO**: Fetch Alerts count from Firestore
- [ ] **TODO**: Add real-time listeners for counts

### Part 2: Firestore Data Structure

- [ ] Create `internalMessages` collection structure
- [ ] Create `internalChannels` collection structure
- [ ] Create `channelMembers` subcollection
- [ ] Create `messageReads` tracking structure
- [ ] Set up Firestore security rules

### Part 3: Messages Module UI

- [ ] Create `MessagesPage.tsx` component
- [ ] Create `MessagesSidebar.tsx` component
- [ ] Create `MessagesContent.tsx` component
- [ ] Create `MessageBubble.tsx` component
- [ ] Create `MessageInput.tsx` component
- [ ] Create `NewChannelDialog.tsx` component
- [ ] Add Messages route to router

### Part 4: Backend APIs

- [ ] Create `getInternalMessagesApi` function
- [ ] Create `sendInternalMessageApi` function
- [ ] Create `getChannelsApi` function
- [ ] Create `createChannelApi` function
- [ ] Create `getUnreadCountsApi` function
- [ ] Create `markMessageReadApi` function

### Part 5: Real-time Updates

- [ ] Set up Firestore listeners for messages
- [ ] Set up Firestore listeners for unread counts
- [ ] Implement optimistic UI updates
- [ ] Handle offline/online states

---

## 🗂️ Firestore Collection Structure

### 1. Internal Messages Collection

**Path**: `/tenants/{tenantId}/internalMessages/{messageId}`

```typescript
interface InternalMessage {
  id: string;
  tenantId: string;
  
  // Conversation context
  conversationType: 'dm' | 'channel';
  conversationId: string; // DM: userId, Channel: channelId
  threadId?: string; // For future thread replies
  
  // Message content
  content: string;
  contentType?: 'text' | 'file' | 'link';
  attachments?: Array<{
    type: string;
    url: string;
    name: string;
    size: number;
  }>;
  
  // Sender
  fromUserId: string;
  fromUserName: string;
  fromUserAvatar?: string;
  
  // Metadata
  editedAt?: Timestamp;
  deletedAt?: Timestamp;
  reactions?: Array<{
    emoji: string;
    userId: string;
  }>;
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2. Direct Messages (DMs) Collection

**Path**: `/tenants/{tenantId}/internalDMs/{dmId}`

```typescript
interface DirectMessage {
  id: string;
  tenantId: string;
  
  // Participants
  participants: string[]; // Array of userIds (sorted)
  participantNames: string[]; // For display
  participantAvatars?: string[];
  
  // Last message info
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  lastMessageFrom?: string;
  
  // Unread counts per user
  unreadCounts: {
    [userId: string]: number;
  };
  
  // Metadata
  isGroup: boolean; // true if > 2 participants
  groupName?: string;
  groupAvatar?: string;
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3. Channels Collection

**Path**: `/tenants/{tenantId}/internalChannels/{channelId}`

```typescript
interface InternalChannel {
  id: string;
  tenantId: string;
  
  // Channel info
  name: string; // e.g., "sales", "recruiting"
  description?: string;
  isPrivate: boolean;
  
  // Members
  memberIds: string[];
  memberCount: number;
  createdBy: string;
  
  // Last message info
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  lastMessageFrom?: string;
  
  // Unread counts per user
  unreadCounts: {
    [userId: string]: number;
  };
  
  // Settings
  mutedBy: string[]; // User IDs who muted this channel
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4. Message Reads Tracking

**Path**: `/tenants/{tenantId}/internalMessages/{messageId}/reads/{userId}`

```typescript
interface MessageRead {
  userId: string;
  readAt: Timestamp;
}
```

---

## 🔧 Backend API Functions

### 1. Get Unread Counts

**Function**: `getInternalMessageCountsApi`

```typescript
// Returns:
{
  success: boolean;
  counts: {
    messages: number; // Total unread DMs + channels
    dms: number; // Unread DMs only
    channels: number; // Unread channels only
  };
}
```

**Logic**:
- Query all DMs where user is participant
- Query all channels where user is member
- Sum unreadCounts[userId] for each
- Exclude muted channels

### 2. Get Direct Messages

**Function**: `getDirectMessagesApi`

```typescript
// Parameters:
{
  tenantId: string;
  userId: string;
  limit?: number;
}

// Returns:
{
  success: boolean;
  dms: DirectMessage[];
}
```

### 3. Get Channels

**Function**: `getChannelsApi`

```typescript
// Parameters:
{
  tenantId: string;
  userId: string; // To filter by membership
}

// Returns:
{
  success: boolean;
  channels: InternalChannel[];
}
```

### 4. Send Message

**Function**: `sendInternalMessageApi`

```typescript
// Parameters:
{
  tenantId: string;
  conversationType: 'dm' | 'channel';
  conversationId: string;
  content: string;
  fromUserId: string;
}

// Returns:
{
  success: boolean;
  messageId: string;
  message: InternalMessage;
}
```

**Logic**:
- Create message document
- Update conversation's lastMessage fields
- Increment unreadCounts for all participants except sender
- Update conversation's updatedAt

### 5. Mark Messages as Read

**Function**: `markInternalMessagesReadApi`

```typescript
// Parameters:
{
  tenantId: string;
  conversationType: 'dm' | 'channel';
  conversationId: string;
  userId: string;
  lastReadMessageId?: string; // Optional: mark up to specific message
}

// Returns:
{
  success: boolean;
}
```

**Logic**:
- Set unreadCounts[userId] = 0 for conversation
- Create read tracking documents for all messages up to lastReadMessageId

---

## 🎨 Component Implementation Order

### Step 1: Create Base Components

1. **MessagesPage.tsx** (Main container)
   - Layout structure
   - Tab switching (DMs / Channels)
   - State management

2. **MessagesSidebar.tsx**
   - Tab buttons
   - DM list
   - Channel list
   - New channel button

3. **MessagesContent.tsx**
   - Empty state
   - Message thread view
   - Input area

### Step 2: Add Message Components

4. **MessageBubble.tsx**
   - Message display
   - Avatar
   - Timestamp
   - Reactions (future)

5. **MessageInput.tsx**
   - Text input
   - Send button
   - Attachment button (future)
   - Character counter

### Step 3: Add Channel Management

6. **NewChannelDialog.tsx**
   - Channel name input
   - Description input
   - Privacy toggle
   - Member selection

7. **ChannelInfo.tsx** (Future)
   - Channel details
   - Member list
   - Settings

---

## 📝 Implementation Steps

### Week 1: Data Structure & APIs

**Day 1-2: Firestore Setup**
- [ ] Create collection structures in Firestore
- [ ] Write security rules
- [ ] Create TypeScript interfaces
- [ ] Test data creation manually

**Day 3-4: Backend APIs**
- [ ] Implement `getInternalMessageCountsApi`
- [ ] Implement `getDirectMessagesApi`
- [ ] Implement `getChannelsApi`
- [ ] Implement `sendInternalMessageApi`
- [ ] Implement `markInternalMessagesReadApi`
- [ ] Deploy functions

**Day 5: Integration Testing**
- [ ] Test API endpoints
- [ ] Verify security rules
- [ ] Test unread count calculations

### Week 2: UI Components

**Day 1-2: Base Layout**
- [ ] Create MessagesPage.tsx
- [ ] Create MessagesSidebar.tsx
- [ ] Create MessagesContent.tsx
- [ ] Add route to router
- [ ] Add menu item to sidebar

**Day 3-4: Message Display**
- [ ] Create MessageBubble.tsx
- [ ] Implement message list rendering
- [ ] Add date separators
- [ ] Style message bubbles

**Day 5: Input & Sending**
- [ ] Create MessageInput.tsx
- [ ] Implement send functionality
- [ ] Add optimistic updates
- [ ] Handle errors

### Week 3: Real-time & Polish

**Day 1-2: Real-time Updates**
- [ ] Add Firestore listeners for messages
- [ ] Add Firestore listeners for unread counts
- [ ] Update top bar counter in real-time
- [ ] Handle connection states

**Day 3: Channel Management**
- [ ] Create NewChannelDialog.tsx
- [ ] Implement channel creation
- [ ] Add channel joining logic
- [ ] Test channel messaging

**Day 4-5: Polish & Testing**
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add empty states
- [ ] Test on mobile
- [ ] Performance optimization

---

## 🔐 Security Rules

### Firestore Rules for Internal Messages

```javascript
match /tenants/{tenantId}/internalMessages/{messageId} {
  allow read: if request.auth != null && 
    request.auth.token.tenantId == tenantId &&
    (resource.data.conversationType == 'dm' && 
     request.auth.uid in get(/databases/$(database)/documents/tenants/$(tenantId)/internalDMs/$(resource.data.conversationId)).data.participants ||
     resource.data.conversationType == 'channel' &&
     request.auth.uid in get(/databases/$(database)/documents/tenants/$(tenantId)/internalChannels/$(resource.data.conversationId)).data.memberIds);
  
  allow create: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.resource.data.fromUserId == request.auth.uid;
  
  allow update, delete: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    resource.data.fromUserId == request.auth.uid;
}

match /tenants/{tenantId}/internalDMs/{dmId} {
  allow read: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.auth.uid in resource.data.participants;
  
  allow create: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.auth.uid in request.resource.data.participants;
  
  allow update: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.auth.uid in resource.data.participants;
}

match /tenants/{tenantId}/internalChannels/{channelId} {
  allow read: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    (!resource.data.isPrivate || request.auth.uid in resource.data.memberIds);
  
  allow create: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.resource.data.createdBy == request.auth.uid;
  
  allow update: if request.auth != null &&
    request.auth.token.tenantId == tenantId &&
    request.auth.uid in resource.data.memberIds;
}
```

---

## 🧪 Testing Plan

### Unit Tests
- [ ] Message creation logic
- [ ] Unread count calculation
- [ ] Channel membership checks
- [ ] Security rule validation

### Integration Tests
- [ ] Send message → appears in real-time
- [ ] Unread count updates correctly
- [ ] Mark as read → count decreases
- [ ] Channel creation → appears in list
- [ ] DM creation → appears in list

### E2E Tests
- [ ] User A sends DM to User B
- [ ] User B sees unread badge
- [ ] User B opens message
- [ ] Unread count clears
- [ ] User A and B can exchange messages

---

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] All Firestore indexes created
- [ ] Security rules tested
- [ ] API functions deployed
- [ ] Error handling tested
- [ ] Performance tested (load 100+ messages)

### Post-Deployment
- [ ] Monitor function invocations
- [ ] Monitor Firestore reads/writes
- [ ] Check error logs
- [ ] Gather user feedback
- [ ] Monitor unread count accuracy

---

## 📊 Success Metrics

### Technical Metrics
- Message send latency < 500ms
- Real-time update latency < 1s
- Unread count accuracy: 100%
- Zero data loss

### User Experience Metrics
- Users can send/receive messages successfully
- Unread counts are always accurate
- No notification spam
- Clean, calm UI

---

## 🔮 Future Enhancements (Post Phase 1.1)

- Thread replies
- Message reactions
- File attachments
- Rich text formatting
- Message search
- Voice/video calls
- Slack integration
- Entity-linked channels

---

_End of Implementation Plan_




