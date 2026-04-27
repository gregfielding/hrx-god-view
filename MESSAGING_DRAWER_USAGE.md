# Message Drawer Usage Guide

## Overview
The `MessageDrawer` component provides a standardized UI for sending messages to users individually or in groups. It slides in from the right side of the screen and takes up ~40% of the desktop viewport.

## Basic Usage

### From User Profile Page

```tsx
import MessageDrawer, { MessageRecipient } from '../components/MessageDrawer';

const UserProfilePage = () => {
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const user = { id: '...', name: 'John Doe', email: 'john@example.com', phone: '+1234567890' };

  return (
    <>
      <Button onClick={() => setMessageDrawerOpen(true)}>
        Send Message
      </Button>
      
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={[{
          userId: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
        }]}
        tenantId={tenantId}
        onSend={(result) => {
          console.log('Message sent:', result);
          // Handle success
        }}
      />
    </>
  );
};
```

### From User List (Multiple Selection)

```tsx
const UserListPage = () => {
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);

  const recipients: MessageRecipient[] = selectedUsers.map(user => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
  }));

  return (
    <>
      <Button 
        onClick={() => setMessageDrawerOpen(true)}
        disabled={selectedUsers.length === 0}
      >
        Send Message to {selectedUsers.length} Users
      </Button>
      
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={recipients}
        tenantId={tenantId}
      />
    </>
  );
};
```

### Pre-select Channel

```tsx
<MessageDrawer
  open={messageDrawerOpen}
  onClose={() => setMessageDrawerOpen(false)}
  recipients={recipients}
  tenantId={tenantId}
  initialChannel="email" // Pre-select email channel
/>
```

## Component Props

### `MessageDrawerProps`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls drawer visibility |
| `onClose` | `() => void` | Yes | Callback when drawer closes |
| `recipients` | `MessageRecipient[]` | Yes | Array of message recipients |
| `tenantId` | `string` | Yes | Tenant ID for the message |
| `initialChannel` | `Channel` | No | Pre-select a channel (email, sms, push) |
| `onSend` | `(result) => void` | No | Callback after message is sent |

### `MessageRecipient`

```typescript
interface MessageRecipient {
  userId: string;      // Required: User ID
  name: string;        // Required: Display name
  email?: string;      // Optional: Email address
  phone?: string;      // Optional: Phone number
  avatar?: string;     // Optional: Avatar URL
}
```

## Features

### Channel Selection
- **Multi-select**: Users can select multiple channels (Email, SMS, Push)
- **Conditional Fields**: Subject field only appears when Email is selected
- **Channel-specific Editors**: 
  - SMS: Simple text field with character counter
  - Email: Rich text editor (reuses EmailTemplateEditor)
  - Push: Title + Body fields

### Recipient Display
- **Single Recipient**: Shows avatar and name prominently
- **Multiple Recipients**: Shows count and chips for each recipient
- **User Info**: Displays email and phone when available

### Validation
- At least one channel must be selected
- Subject required for email
- Body required for all selected channels
- SMS character limit (1600 characters)

### Error Handling
- Clear error messages
- Success feedback
- Auto-close on success (after 2 seconds)

## Backend Requirements

### Message Type Registration

The component uses `direct_message` as the message type. You need to ensure this message type exists in your message types registry:

```typescript
// In functions/src/messaging/messageTypesRegistry.ts
{
  id: 'direct_message',
  label: 'Direct Message',
  category: 'engagement',
  defaultChannels: ['email', 'sms', 'push'],
  critical: false,
  allowReply: true,
  requiresExplicitSmsOptIn: false,
  requiresTemplate: false, // Important: allows direct content
  aiAllowedToDraft: false,
  aiAllowedToAutoSend: false,
  enabled: true,
}
```

### Template Support (Optional)

If you want to support templates in the drawer:
1. Add a template selector dropdown
2. Load templates from the template API
3. Auto-populate fields when template is selected

## Integration Points

### User Profile Pages
- Add "Send Message" button to user profile header
- Pass user data as recipient

### User Tables/Lists
- Add bulk action for "Send Message"
- Collect selected users and pass as recipients array

### User Groups
- Add "Send Message to Group" action
- Fetch group members and pass as recipients

## Styling

The drawer uses Material-UI's Drawer component with:
- 40% width on desktop (md breakpoint and above)
- 100% width on mobile/tablet
- Max width of 600px
- Right-side anchor

## Future Enhancements

1. **Template Support**: Add template selector
2. **Variable Insertion**: Add variable palette for email
3. **Scheduling**: Add ability to schedule messages
4. **Preview**: Show preview of message before sending
5. **Bulk Progress**: Show progress bar for multiple recipients
6. **Draft Saving**: Save drafts locally
7. **Message History**: Show recent messages to same recipient(s)

