# HRX — Slack-Style Internal Messaging Wireframes
## UI Layout, Component Structure, and Interaction Flows

_Last updated: 2025-01-XX_  
_Based on: hrx-slack-topbar-spec.md_

This document provides detailed wireframes and UI specifications for the internal messaging system (Messages module) that provides Slack-style team collaboration within HRX.

---

## 📐 Overall Layout Structure

### Main Messages Page (`/messages`)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [HRX Logo]  Messages                    [📥 9] [💬 3] [🔔 1] [👤]    │
├──────────┬──────────────────────────────────────────────────────────────┤
│          │                                                              │
│  SIDEBAR │  MAIN CONTENT AREA                                          │
│          │                                                              │
│  [Tabs]  │  ┌────────────────────────────────────────────────────┐     │
│          │  │                                                    │     │
│  Direct  │  │  MESSAGE LIST / CHANNEL VIEW                      │     │
│  Messages│  │                                                    │     │
│          │  │  ┌────────────────────────────────────────────┐   │     │
│  Channels│  │  │ [Avatar] John Doe                          │   │     │
│          │  │  │ Hey, can you review this candidate?         │   │     │
│  #sales  │  │  │ 2:30 PM                                     │   │     │
│  #ops    │  │  └────────────────────────────────────────────┘   │     │
│  #recruit│  │                                                    │     │
│          │  │  ┌────────────────────────────────────────────┐   │     │
│  + New   │  │  │ [Avatar] Sarah Chen                        │   │     │
│  Channel │  │  │ The deal is moving forward!                │   │     │
│          │  │  │ 2:45 PM                                     │   │     │
│          │  │  └────────────────────────────────────────────┘   │     │
│          │  │                                                    │     │
│          │  └────────────────────────────────────────────────────┘     │
│          │                                                              │
│          │  ┌────────────────────────────────────────────────────┐     │
│          │  │ [Type a message...]                    [Send]     │     │
│          │  └────────────────────────────────────────────────────┘     │
│          │                                                              │
└──────────┴──────────────────────────────────────────────────────────────┘
```

---

## 🎨 Component Breakdown

### 1. Left Sidebar — Navigation & Channel List

**Width**: 240px (desktop), collapsible to 64px  
**Background**: Subtle gray (#F5F7FA)  
**Border**: Right border, 1px solid #E5E7EB

#### Structure:
```
┌─────────────────────┐
│  [Tabs]             │
│  ┌─────┬─────────┐  │
│  │ DMs │Channels │  │
│  └─────┴─────────┘  │
│                     │
│  [Direct Messages] │
│  ─────────────────  │
│  📧 John Doe    (2) │
│  📧 Sarah Chen  (1) │
│  📧 Mike      (3)│
│                     │
│  [Channels]         │
│  ─────────────────  │
│  # sales        (5) │
│  # recruiting   (2) │
│  # ops          (0) │
│  # leadership   (1) │
│                     │
│  [+ New Channel]    │
└─────────────────────┘
```

**Design Notes**:
- Tab buttons: Full width, clear active state
- Unread counts: Badge on right, muted color
- Hover state: Light background highlight
- Active conversation: Bold text + left border accent

---

### 2. Main Content Area — Message Thread View

**Layout**: Flex column, fills remaining space

#### Header Section:
```
┌─────────────────────────────────────────────────────────────┐
│  [Avatar] John Doe                    [⋯] [Info] [Call]    │
│  Active now                                                │
└─────────────────────────────────────────────────────────────┘
```

**Shows**:
- Conversation participant(s) name(s)
- Presence indicator (Active now, Away, etc.)
- Action menu (⋯)
- Info button (for group chats)
- Call button (future)

#### Message List:
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Today                                                      │
│  ────────────────────────────────────────────────────────   │
│                                                             │
│  [Avatar] John Doe                                          │
│  Hey, can you review this candidate profile?               │
│  2:30 PM                                                    │
│                                                             │
│  [Avatar] You                                               │
│  Sure, I'll take a look.                                    │
│  2:32 PM                                                    │
│                                                             │
│  [Avatar] John Doe                                          │
│  Thanks! Here's the link: [link]                            │
│  2:33 PM                                                    │
│                                                             │
│  ────────────────────────────────────────────────────────   │
│  Yesterday                                                  │
│  ────────────────────────────────────────────────────────   │
│                                                             │
│  [Avatar] John Doe                                          │
│  Initial message...                                         │
│  Yesterday 4:20 PM                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Design Notes**:
- Date separators: Subtle, muted text
- Message bubbles: Clean, minimal borders
- Your messages: Right-aligned, primary color background
- Their messages: Left-aligned, gray background
- Timestamps: Small, muted, below message
- Avatars: 32px, circular, initials fallback

#### Input Area:
```
┌─────────────────────────────────────────────────────────────┐
│  [Type a message...]                           [📎] [Send]  │
└─────────────────────────────────────────────────────────────┘
```

**Features**:
- Multi-line text input
- Character counter (for SMS compatibility)
- Attachment button (📎)
- Send button (disabled when empty)
- Keyboard shortcut: Ctrl/Cmd + Enter to send

---

### 3. Channel View — Similar Layout, Different Sidebar

**Sidebar shows**:
- Channel list with unread counts
- Channel description on hover
- Member count
- Mute/unmute toggle

**Main area**:
- Same message thread view
- Shows channel name in header
- Shows channel members in header
- Thread replies (future phase)

---

## 📱 Responsive Behavior

### Mobile (< 768px):
- Sidebar becomes bottom sheet or drawer
- Main content full width
- Input area fixed at bottom
- Hamburger menu to toggle sidebar

### Tablet (768px - 1024px):
- Sidebar can collapse to icons only
- Main content adjusts width
- Touch-optimized spacing

### Desktop (> 1024px):
- Full sidebar always visible
- Optimal spacing and typography
- Keyboard shortcuts enabled

---

## 🎯 Interaction Flows

### Flow 1: Starting a New Direct Message

1. User clicks "Direct Messages" tab
2. Clicks "+ New Message" button
3. Search/select dialog opens
4. User selects recipient(s)
5. New conversation opens in main area
6. Input field focused automatically

### Flow 2: Joining a Channel

1. User clicks "Channels" tab
2. Sees list of available channels
3. Clicks channel name
4. Channel opens in main area
5. User can start typing immediately

### Flow 3: Creating a Channel

1. User clicks "+ New Channel"
2. Dialog opens:
   - Channel name (required)
   - Description (optional)
   - Privacy (Public/Private)
   - Add members (optional)
3. Channel created
4. Channel opens in main area
5. User is auto-added as member

### Flow 4: Replying to Message

1. User clicks on conversation in sidebar
2. Conversation loads in main area
3. User types in input field
4. User presses Enter or clicks Send
5. Message appears immediately (optimistic update)
6. Message confirmed when saved to Firestore

---

## 🎨 Visual Design Specifications

### Typography:
- **Headers**: 16px, semibold (600)
- **Message text**: 14px, regular (400)
- **Timestamps**: 12px, muted color (#6B7280)
- **Unread badges**: 11px, semibold

### Colors:
- **Primary**: HRX brand blue (#235DA9)
- **Background**: White (#FFFFFF)
- **Sidebar**: Light gray (#F5F7FA)
- **Borders**: #E5E7EB
- **Text primary**: #111827
- **Text secondary**: #6B7280
- **Unread indicator**: Primary blue

### Spacing:
- **Sidebar padding**: 12px
- **Message padding**: 12px vertical, 16px horizontal
- **Message gap**: 8px between messages
- **Input padding**: 16px

### Shadows:
- **Sidebar border**: Subtle right border only
- **Message bubbles**: No shadow (flat design)
- **Input area**: Top border only

---

## 🔧 Technical Implementation Notes

### Component Structure:
```
MessagesPage.tsx
├── MessagesSidebar.tsx
│   ├── MessagesTabs.tsx
│   ├── DirectMessagesList.tsx
│   └── ChannelsList.tsx
├── MessagesContent.tsx
│   ├── MessageThreadHeader.tsx
│   ├── MessageList.tsx
│   │   └── MessageBubble.tsx
│   └── MessageInput.tsx
└── NewChannelDialog.tsx
```

### State Management:
- Use React Context for active conversation
- Real-time Firestore listeners for messages
- Optimistic updates for sent messages
- Debounced typing indicators

### Performance:
- Virtual scrolling for long message lists
- Lazy load older messages
- Pagination: Load 50 messages at a time
- Cache avatars and user data

---

## 🚀 Phase 1 MVP Features

### Must Have:
- ✅ Direct Messages (1:1)
- ✅ Channel list and viewing
- ✅ Message sending
- ✅ Real-time message updates
- ✅ Unread counts
- ✅ Basic presence (online/offline)

### Nice to Have (Phase 1.5):
- ⏳ Group DMs (2-6 users)
- ⏳ Typing indicators
- ⏳ Message reactions
- ⏳ File attachments
- ⏳ Channel creation UI

### Future Phases:
- 🔮 Thread replies
- 🔮 Message search
- 🔮 Rich formatting
- 🔮 Voice/video calls
- 🔮 Slack integration
- 🔮 Entity-linked channels

---

## 📋 Accessibility Requirements

- Keyboard navigation: Tab through conversations
- Screen reader support: ARIA labels on all interactive elements
- Focus indicators: Clear visible focus states
- Color contrast: WCAG AA compliant
- Alt text: For all avatars and icons

---

## 🧪 Testing Checklist

- [ ] Send message in DM
- [ ] Send message in channel
- [ ] Receive real-time message
- [ ] Unread count updates correctly
- [ ] Sidebar navigation works
- [ ] Mobile responsive layout
- [ ] Keyboard shortcuts work
- [ ] Error handling (network failures)
- [ ] Loading states display correctly
- [ ] Empty states (no messages, no channels)

---

## 📝 Notes for Implementation

1. **Start Simple**: Build the basic DM view first, then add channels
2. **Reuse Components**: MessageBubble can be used in both DMs and channels
3. **Real-time First**: Use Firestore listeners from day one
4. **Optimistic UI**: Show sent messages immediately, confirm later
5. **Error Recovery**: Handle offline scenarios gracefully
6. **Performance**: Virtual scrolling is essential for large teams

---

_End of Wireframes Document_




