# Unified Inbox Implementation Status

## ✅ Completed

### 1. TypeScript Types (`src/types/unifiedInbox.ts`)
- ✅ Created comprehensive `BaseMessage` interface
- ✅ Created channel-specific interfaces (`EmailMessage`, `SmsMessage`, `SlackMessage`, `InternalMessage`)
- ✅ Created `UnifiedInboxMessage` with channel discrimination
- ✅ Created `UnifiedInboxFilters` interface
- ✅ Added backward compatibility aliases

### 2. Normalization Utilities (`src/utils/unifiedInboxNormalizers.ts`)
- ✅ Created normalizers for Email, SMS, Slack, and Internal messages
- ✅ Implemented timestamp sorting utilities

### 3. React Hook (`src/hooks/useUnifiedInboxMessages.ts`)
- ✅ Created hook to fetch messages from all channels
- ✅ Implements filtering (channel, status, unread, date, search)
- ✅ Respects Slack visibility (security level >= 5)
- ✅ Merges and sorts messages by timestamp

### 4. UI Components
- ✅ Created `ChannelBadge` component
- ✅ Added "All" tab to inbox (default view)
- ✅ Implemented unified table layout
- ✅ Added channel, status, and unread filters
- ✅ Integrated search functionality
- ✅ Added Slack tab (only visible for security level >= 5)

### 5. Security
- ✅ Client-side Slack visibility gating via `canUserAccessSlack()`
- ✅ Hook excludes Slack queries for unauthorized users

## 🔄 In Progress / To Do

### 1. Firestore Security Rules
**Status**: Needs implementation
**Location**: `firestore.rules`

**Required Rules**:
- Email messages: `/emails/{emailId}` or `/tenants/{tenantId}/emailThreads/{threadId}`
- SMS messages: `/sms_messages/{smsId}` or `/tenants/{tenantId}/smsThreads/{threadId}`
- Slack messages: `/tenants/{tenantId}/slack_messages/{messageId}` (security level >= 5)
- Internal messages: `/tenants/{tenantId}/internalDMs/{threadId}/internalMessages/{messageId}` (security level >= 3)
- Internal channels: `/tenants/{tenantId}/internalChannels/{channelId}/internalMessages/{messageId}` (security level >= 3)

**Helper Functions Needed**:
```firestore
function isSignedIn()
function userDocPath()
function userTenantId()
function userSecurityLevel()
function hasSecurityLevel(minLevel)
function isTenantDoc(tenantId)
```

### 2. Enhanced Hook Implementation
**Status**: Partial - Currently uses API calls for Email/SMS
**Enhancement**: Add real-time listeners (`onSnapshot`) where possible

**Current Approach**:
- Email: API call to `getUserEmailThreads`
- SMS: API call to `listThreadsApi`
- Slack: Direct Firestore query
- Internal: Direct Firestore query

**Recommended Enhancement**:
- Add real-time listeners for Slack and Internal messages
- Keep API calls for Email/SMS (if backend handles real-time updates differently)

### 3. UI Enhancements
**Status**: Basic implementation complete
**Enhancements Needed**:
- [ ] Message detail drawer (Phase 1.5)
- [ ] Star/unstar functionality
- [ ] Archive functionality
- [ ] Better date formatting (relative time with tooltip)
- [ ] Association tags (Deal, Job, Company)
- [ ] Direction icons (inbound/outbound)

### 4. Normalizers Update
**Status**: Uses legacy `UnifiedMessage` type
**Enhancement**: Update to use full `UnifiedInboxMessage` structure with channel-specific data

## 📋 Implementation Pack Alignment

### Completed from Pack:
- ✅ TypeScript DTOs structure (BaseMessage + channel extensions)
- ✅ UnifiedInboxFilters interface
- ✅ Basic hook skeleton
- ✅ Channel badges
- ✅ Filter UI
- ✅ Security gating

### Remaining from Pack:
- ⏳ Firestore security rules (Section 1)
- ⏳ Real-time listeners in hook (Section 3)
- ⏳ Message detail drawer (Section 4.2.5)
- ⏳ Enhanced table with direction icons, tags, relative time (Section 4.2.4)
- ⏳ Acceptance tests (Section 5)

## 🎯 Next Steps

1. **Firestore Rules** (Priority: High)
   - Add helper functions to existing `firestore.rules`
   - Add rules for email, SMS, Slack, and internal message collections
   - Ensure tenant isolation and security level checks

2. **Hook Enhancement** (Priority: Medium)
   - Add real-time listeners for Slack and Internal messages
   - Consider adding real-time support for Email/SMS if backend supports it

3. **UI Polish** (Priority: Medium)
   - Add message detail drawer
   - Enhance table with additional metadata
   - Add star/archive functionality

4. **Testing** (Priority: Low)
   - Write unit tests for hook
   - Write component tests
   - Write E2E tests

## 📝 Notes

- Current implementation maintains backward compatibility with existing code
- Email and SMS use existing API endpoints (may need to be updated if collection structure changes)
- Slack messages are stored in `/tenants/{tenantId}/slack_messages` (tenant-scoped)
- Internal messages are in `/tenants/{tenantId}/internalDMs` and `/tenants/{tenantId}/internalChannels`



