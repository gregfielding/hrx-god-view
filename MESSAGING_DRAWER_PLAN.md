# Messaging Drawer Component Plan

## Overview
Create a standardized, reusable messaging drawer component that slides in from the right (~40% width on desktop) for sending messages to users individually or in groups.

## Component Structure

### `MessageDrawer.tsx`
- **Location**: `src/components/MessageDrawer.tsx`
- **Type**: Drawer component (MUI Drawer)
- **Width**: ~40% of screen on desktop, full width on mobile
- **Anchor**: Right side

### Props Interface
```typescript
interface MessageDrawerProps {
  open: boolean;
  onClose: () => void;
  recipients: MessageRecipient[]; // Single user or multiple users/groups
  tenantId: string;
  initialChannel?: Channel; // Pre-select a channel
  onSend?: (result: SendResult) => void; // Callback after sending
}
```

## UI Components

### 1. Header Section
- Title: "Send Message" or "Send Message to [User Name]" or "Send Message to [N] Recipients"
- Close button (X icon)
- Optional: Back button if needed

### 2. Recipients Section
- Display selected recipients
- Show user names, emails, phones
- Allow adding/removing recipients (if multiple)
- Show chips for each recipient with remove option
- If from user profile: Show user avatar + name prominently

### 3. Channel Selector
- Multi-select checkboxes or toggle buttons
- Options: SMS, Email, Push
- Visual indicators (icons)
- Show channel availability per recipient (if some don't have email/phone)
- Disable unavailable channels with tooltip explanation

### 4. Subject Field (Conditional)
- Only visible when Email is selected
- Required when Email is selected
- TextField with placeholder

### 5. Message Content Editor
- **For SMS**: Simple TextField (multiline, character counter)
- **For Email**: Rich text editor (reuse EmailTemplateEditor component)
- **For Push**: TextField with title + body fields
- Show preview based on selected channels
- Variable insertion palette (if using templates)

### 6. Template Selector (Optional)
- Dropdown to select from existing templates
- Auto-populate subject/body when template selected
- "Use Template" toggle

### 7. Footer Actions
- Cancel button
- Send button (disabled until valid)
- Loading state during send
- Success/error feedback

## Integration Points

### API Integration
- Use `sendMessageApi` from `/api/messaging/send`
- For multiple recipients: Loop through and send individually
- Show progress for bulk sends
- Handle partial failures gracefully

### Message Type
- Use a generic message type like `direct_message` or `user_message`
- Or allow selection of message type from dropdown

### Context Variables
- Auto-populate user variables (firstName, lastName, email, phone, etc.)
- Allow manual variable insertion

## Usage Examples

### From User Profile Page
```tsx
<MessageDrawer
  open={messageDrawerOpen}
  onClose={() => setMessageDrawerOpen(false)}
  recipients={[{ userId: user.id, name: user.name, email: user.email, phone: user.phone }]}
  tenantId={tenantId}
/>
```

### From User List (Multiple Selection)
```tsx
<MessageDrawer
  open={messageDrawerOpen}
  onClose={() => setMessageDrawerOpen(false)}
  recipients={selectedUsers.map(u => ({ userId: u.id, name: u.name, email: u.email, phone: u.phone }))}
  tenantId={tenantId}
/>
```

### From User Group
```tsx
<MessageDrawer
  open={messageDrawerOpen}
  onClose={() => setMessageDrawerOpen(false)}
  recipients={[{ groupId: group.id, groupName: group.name, memberCount: group.members.length }]}
  tenantId={tenantId}
/>
```

## Design Considerations

1. **Responsive**: Full width on mobile, 40% on desktop
2. **Accessibility**: Keyboard navigation, ARIA labels
3. **Validation**: 
   - Subject required for email
   - Body required for all channels
   - At least one channel selected
   - At least one recipient
4. **Error Handling**: Show clear error messages
5. **Loading States**: Disable form during send, show progress
6. **Success Feedback**: Snackbar or inline success message

## Implementation Steps

1. Create `MessageDrawer.tsx` component
2. Create `MessageRecipient` type definition
3. Integrate with `sendMessageApi` or `sendTestMessage` utility
4. Add to user profile pages
5. Add to user list/table components
6. Add to user group pages
7. Test with single recipient
8. Test with multiple recipients
9. Test with different channels
10. Test error handling

