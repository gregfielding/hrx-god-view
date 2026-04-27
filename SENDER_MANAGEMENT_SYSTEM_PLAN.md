# Bulletproof Sender Management System Plan

## Overview
Create a comprehensive, bulletproof system for managing sender identities (Twilio numbers and Gmail connections) for each team member. This system will be the single source of truth for who can send from where, with clear status indicators and verification.

## Current State

### Twilio Number Assignment
- **Storage**: `/tenants/{tenantId}/recruiterNumbers/{recruiterId}`
- **Fields**: `twilioNumber`, `twilioNumberSid`, `useMainNumber`
- **Functions**: `assignRecruiterNumber`, `releaseRecruiterNumber`, `getRecruiterNumbers`
- **UI**: Exists in `MessagingTab.tsx` → `RecruiterNumbersTab`

### Gmail Connection
- **Storage**: `/users/{userId}` → `gmailConnected`, `gmailTokens`, `gmailTokens.email`
- **Functions**: `getGmailStatus`, `getGmailAuthUrl`, `handleGmailCallback`
- **UI**: Partially exists (GoogleConnectionChip component)

## Problems to Solve

1. **Fragmented Management**: Numbers and Gmail are managed in different places
2. **No Unified View**: Can't see all sender options for a team member in one place
3. **Status Verification**: No easy way to verify if connections are actually working
4. **No Testing**: Can't test sender identity before using it
5. **Limited Visibility**: Hard to see who has what assigned across the team

## Proposed Solution

### 1. New "Sender Management" Page in Settings

**Location**: `/settings/senders` (new route in Settings)

**Features**:
- Unified view of all team members with their sender capabilities
- Table showing:
  - Team member name/email
  - Twilio number assignment status (Assigned/Not Assigned/Using Main)
  - Gmail connection status (Connected/Not Connected/Expired)
  - Actions (Assign/Release number, Connect/Disconnect Gmail, Test)

### 2. Enhanced Data Model

**New Collection**: `/tenants/{tenantId}/senderIdentities/{userId}` (optional, for explicit overrides)

**Enhanced Recruiter Numbers**:
- Add `status` field: 'active' | 'pending' | 'error'
- Add `lastVerifiedAt` timestamp
- Add `verificationError` string
- Add `assignedBy` userId
- Add `assignedAt` timestamp

**Enhanced Gmail Status**:
- Add `lastVerifiedAt` timestamp
- Add `verificationError` string
- Add `connectedAt` timestamp
- Add `expiresAt` timestamp (from token expiry)

### 3. Verification & Testing Functions

**New Functions**:
- `verifyTwilioNumber(tenantId, recruiterId)` - Test if number is active and webhook configured
- `verifyGmailConnection(userId)` - Test if Gmail tokens are valid and API access works
- `testSenderIdentity(tenantId, userId, senderType)` - Send a test message to verify sender works

### 4. UI Components

**SenderManagementPage.tsx**:
- Main page showing all team members
- Filter/search by name, status
- Bulk actions (verify all, test all)
- Individual row actions

**SenderIdentityCard.tsx**:
- Card showing one team member's sender status
- Visual indicators (green = active, yellow = warning, red = error)
- Quick actions (assign number, connect Gmail, test)

**NumberAssignmentDialog.tsx**:
- Enhanced version of existing dialog
- Show number status (available, in use, pending)
- Test number before assigning
- Show webhook configuration status

**GmailConnectionDialog.tsx**:
- Show current connection status
- Test connection button
- Reconnect if expired
- Show email address and scopes

### 5. Status Indicators

**Twilio Number Status**:
- ✅ **Active**: Number assigned, webhook configured, verified
- ⚠️ **Pending**: Number assigned but not verified yet
- ❌ **Error**: Number assigned but webhook failed or verification failed
- ⚪ **Not Assigned**: Using main number

**Gmail Status**:
- ✅ **Connected**: Tokens valid, API access confirmed
- ⚠️ **Expired**: Tokens expired, needs reconnection
- ❌ **Error**: Connection failed or invalid
- ⚪ **Not Connected**: No Gmail connection

## Implementation Phases

### Phase 1: Backend Verification Functions
1. Create `verifyTwilioNumber` function
2. Create `verifyGmailConnection` function  
3. Create `testSenderIdentity` function
4. Add status fields to existing collections

### Phase 2: Unified Data Model
1. Create `senderIdentities` collection structure
2. Update `getRecruiterSenderIdentity` to check verification status
3. Add automatic verification on assignment/connection

### Phase 3: UI - Sender Management Page
1. Create `/settings/senders` route
2. Build `SenderManagementPage` component
3. Create `SenderIdentityCard` component
4. Add filters and search

### Phase 4: Enhanced Assignment Dialogs
1. Update number assignment dialog with verification
2. Create Gmail connection dialog
3. Add test functionality to both

### Phase 5: Status Monitoring
1. Add scheduled verification (daily check)
2. Add alerts for expired/error states
3. Add notification when verification fails

## Technical Details

### Verification Logic

**Twilio Number Verification**:
```typescript
async function verifyTwilioNumber(tenantId: string, recruiterId: string): Promise<VerificationResult> {
  // 1. Check if number is assigned
  // 2. Check Twilio API to confirm number exists and is active
  // 3. Check webhook configuration
  // 4. Test inbound SMS webhook (optional)
  // 5. Update status in Firestore
}
```

**Gmail Connection Verification**:
```typescript
async function verifyGmailConnection(userId: string): Promise<VerificationResult> {
  // 1. Check if tokens exist
  // 2. Check token expiry
  // 3. Test Gmail API access (getProfile)
  // 4. Check required scopes
  // 5. Update status in Firestore
}
```

### Firestore Structure

**Enhanced Recruiter Numbers**:
```
/tenants/{tenantId}/recruiterNumbers/{recruiterId}
{
  recruiterId: string
  tenantId: string
  twilioNumber?: string
  twilioNumberSid?: string
  useMainNumber: boolean
  status: 'active' | 'pending' | 'error'
  lastVerifiedAt?: Timestamp
  verificationError?: string
  assignedBy: string
  assignedAt: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**Sender Identities (Optional Override)**:
```
/tenants/{tenantId}/senderIdentities/{userId}
{
  userId: string
  tenantId: string
  emailProvider: 'sendgrid' | 'gmail'
  smsProvider: 'twilio'
  twilioNumber?: string
  gmailEmail?: string
  enabled: boolean
  verifiedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## Success Criteria

1. ✅ Single page showing all team members' sender capabilities
2. ✅ Clear status indicators (active/pending/error)
3. ✅ One-click verification for any sender
4. ✅ Test functionality before using in production
5. ✅ Automatic status updates on assignment/connection
6. ✅ Clear error messages when verification fails
7. ✅ Easy reconnection/reassignment workflows

## Next Steps

1. Review and approve this plan
2. Start with Phase 1 (backend verification functions)
3. Build UI incrementally
4. Test with real Twilio numbers and Gmail connections
5. Add monitoring and alerts

