# Email Inbox Implementation Plan

## Goal
Build a Gmail-like inbox that:
- Displays all emails (inbound from Gmail + outbound from SendGrid/Gmail)
- Groups emails by thread/conversation
- Allows replying via MessageDrawer
- Supports attachments (view and send)
- Is rock-solid and stable

## Architecture

### Data Model
- **Email Threads**: `/tenants/{tenantId}/emailThreads/{threadId}`
  - Groups emails by conversation
  - Tracks participants, subject, last message time
- **Email Messages**: `/tenants/{tenantId}/emailThreads/{threadId}/messages/{messageId}`
  - Individual email in a thread
  - Stores: from, to, cc, bcc, subject, body (HTML + plain), attachments, direction, status
- **Attachments**: Firebase Storage
  - Path: `/tenants/{tenantId}/emailAttachments/{attachmentId}`
  - Metadata in message document

### Components Needed

1. **EmailInboxPage** (main inbox view)
   - Thread list (like Gmail inbox)
   - Unread/read states
   - Starred/favorite
   - Search/filter
   - Pagination

2. **EmailThreadView** (conversation view)
   - Shows all messages in thread
   - Reply button opens MessageDrawer
   - Attachment display
   - Message detail (headers, etc.)

3. **MessageDrawer Enhancements**
   - Email-specific fields (To, Cc, Bcc)
   - Attachment upload
   - Reply-to-thread support
   - Rich text editor (already have)

4. **Backend Functions**
   - `createEmailThread` - Start new conversation
   - `sendEmailReply` - Send reply via Gmail/SendGrid
   - `uploadAttachment` - Store attachment in Firebase Storage
   - `markThreadRead` - Update read status
   - `syncGmailThreads` - Sync Gmail conversations

## Implementation Phases

### Phase 1: Core Threading & Display (Foundation)
- [ ] Create `emailThreads` collection structure
- [ ] Migrate existing emails to threads
- [ ] Build `EmailThreadView` component
- [ ] Update inbox to show threads instead of individual messages
- [ ] Thread grouping logic (by subject + participants)

### Phase 2: Reply & Compose
- [ ] Enhance `MessageDrawer` for email (To, Cc, Bcc fields)
- [ ] Reply-to-thread functionality
- [ ] Send via Gmail API (if user's Gmail) or SendGrid
- [ ] Update thread with new message

### Phase 3: Attachments
- [ ] Attachment upload UI in MessageDrawer
- [ ] Firebase Storage integration
- [ ] Attachment display in thread view
- [ ] Download functionality

### Phase 4: Gmail-like Features
- [ ] Unread/read states
- [ ] Starred/favorite
- [ ] Search/filter
- [ ] Archive/delete
- [ ] Labels/folders (optional)

### Phase 5: Stability & Polish
- [ ] Error handling
- [ ] Loading states
- [ ] Optimistic updates
- [ ] Offline support (optional)
- [ ] Performance optimization
- [ ] Testing

## Technical Decisions

### Thread Identification
- **Gmail Threads**: Use Gmail's `threadId` when available
- **SendGrid Threads**: Group by subject + participants (Reply-To header)
- **Manual Threading**: Subject normalization + participant matching

### Email Sending
- **User's Gmail**: Use Gmail API (OAuth2)
- **System SendGrid**: Use SendGrid API
- **Fallback**: Always try Gmail first, fallback to SendGrid

### Attachment Storage
- **Storage**: Firebase Storage
- **Max Size**: 25MB per attachment (Gmail limit)
- **Allowed Types**: Images, PDFs, documents
- **Security**: Signed URLs for download

## API Endpoints Needed

### Threads
- `GET /api/email/threads` - List threads
- `GET /api/email/threads/:threadId` - Get thread with messages
- `POST /api/email/threads` - Create new thread
- `PATCH /api/email/threads/:threadId` - Update thread (read, starred, etc.)

### Messages
- `POST /api/email/threads/:threadId/messages` - Send reply
- `GET /api/email/threads/:threadId/messages/:messageId/attachments/:attachmentId` - Download attachment

### Sync
- `POST /api/email/sync` - Manual Gmail sync
- `GET /api/email/sync/status` - Check sync status

## Stability Requirements

1. **Error Handling**
   - Graceful degradation if Gmail API fails
   - Retry logic for transient failures
   - User-friendly error messages

2. **Performance**
   - Lazy loading for threads
   - Pagination for large inboxes
   - Caching for frequently accessed threads

3. **Data Consistency**
   - Idempotent operations
   - Transaction safety for thread updates
   - Conflict resolution for concurrent updates

4. **Security**
   - Validate user permissions
   - Sanitize email content
   - Secure attachment uploads
   - Rate limiting

## Success Criteria

- [ ] User can view all emails in inbox
- [ ] Emails are grouped by thread
- [ ] User can reply to emails
- [ ] User can send new emails
- [ ] Attachments work (upload and view)
- [ ] System is stable under normal load
- [ ] Error states are handled gracefully

