# Comprehensive Message Sender Management Plan

## Problem Statement

Currently, the messaging system uses:
- **Email**: Single SendGrid sender (`sender@hrxone.com` or default)
- **SMS**: Main Twilio number or messaging service
- **Gmail**: Individual user Gmail accounts (poorly integrated, not in unified system)

**Issues Identified:**

1. **No way to send from recruiter-specific Twilio numbers**
   - Recruiter numbers exist in `/tenants/{tenantId}/recruiterNumbers/{recruiterId}`
   - But `TwilioSmsProvider` only uses main number or messaging service
   - No logic to look up and use recruiter's assigned number

2. **Gmail integration is broken/separate**
   - Gmail sending exists in `gmailTasksIntegration.ts` but:
     - Uses tenant-level config (`/tenants/{tenantId}/integrations/gmail`) which doesn't exist
     - Tokens are actually stored at user level (`/users/{userId}/gmailTokens`)
     - No token refresh logic (tokens expire after 1 hour)
     - Not integrated into unified messaging orchestrator
     - No fallback to SendGrid if Gmail fails
     - No proper error handling for expired/revoked tokens

3. **No sender selection UI**
   - MessageDrawer doesn't show sender options
   - Users can't choose to send from their Gmail or recruiter number

4. **No fallback logic**
   - If recruiter number unavailable → should use main number
   - If Gmail token expired → should use SendGrid
   - Currently just fails

## Current State Analysis

### Email Senders
- **SendGrid**: Uses `SENDGRID_FROM_EMAIL` secret (currently `sender@hrxone.com`)
- **Gmail**: Individual user tokens stored in `/users/{userId}/gmailTokens`
- **Issue**: Gmail sending is not integrated into unified messaging orchestrator

### SMS Senders
- **Main Number**: `TWILIO_MESSAGING_PHONE_NUMBER` or `TWILIO_A2P_CAMPAIGN`
- **Recruiter Numbers**: Stored in `/tenants/{tenantId}/recruiterNumbers/{recruiterId}`
- **Issue**: Recruiter numbers exist but aren't used by messaging orchestrator

### Current Data Structures

**Recruiter Numbers** (`/tenants/{tenantId}/recruiterNumbers/{recruiterId}`):
```typescript
{
  recruiterId: string;
  tenantId: string;
  twilioNumber?: string; // E.164 format
  twilioNumberSid?: string;
  useMainNumber: boolean; // Fallback to tenant's main number
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Gmail Tokens** (`/users/{userId}/gmailTokens`):
```typescript
{
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
  email: string; // Gmail address
}
```

## Proposed Solution: Sender Identity System

### 1. Sender Identity Registry

Create a new collection: `/tenants/{tenantId}/senderIdentities/{senderId}`

```typescript
interface SenderIdentity {
  id: string;
  tenantId: string;
  name: string; // Display name: "Main System", "John Doe (Recruiter)", etc.
  type: 'system' | 'recruiter' | 'user';
  userId?: string; // For recruiter/user senders
  
  // Email configuration
  emailProvider: 'sendgrid' | 'gmail';
  emailAddress?: string; // For SendGrid
  gmailUserId?: string; // For Gmail (references user's Gmail tokens)
  
  // SMS configuration
  smsProvider: 'twilio';
  twilioNumber?: string; // E.164 format
  twilioNumberSid?: string;
  useMainNumber?: boolean; // Fallback to tenant main number
  
  // Status
  enabled: boolean;
  verified: boolean; // Whether sender is verified/authenticated
  lastUsedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2. Default Sender Identities

**System Sender** (auto-created):
- `type: 'system'`
- `emailProvider: 'sendgrid'`
- `emailAddress: SENDGRID_FROM_EMAIL`
- `smsProvider: 'twilio'`
- `useMainNumber: true`

**Recruiter Sender** (created when recruiter number assigned):
- `type: 'recruiter'`
- `userId: recruiterId`
- `emailProvider: 'sendgrid'` (default) or `'gmail'` (if Gmail connected)
- `smsProvider: 'twilio'`
- `twilioNumber: recruiter's assigned number`

### 3. Sender Resolution Logic

**Priority Order:**
1. **Explicit sender** (from MessageDrawer selection)
2. **Recruiter sender** (if `context.source === 'recruiter'` and `context.sourceId` is set)
3. **System sender** (fallback)

**Resolution Function:**
```typescript
async function resolveSenderIdentity(
  tenantId: string,
  context: MessageContext
): Promise<SenderIdentity> {
  // 1. Check for explicit sender in context
  if (context.metadata?.senderId) {
    const sender = await getSenderIdentity(tenantId, context.metadata.senderId);
    if (sender && sender.enabled) return sender;
  }
  
  // 2. Check for recruiter sender
  if (context.source === 'recruiter' && context.sourceId) {
    const recruiterSender = await getRecruiterSenderIdentity(tenantId, context.sourceId);
    if (recruiterSender && recruiterSender.enabled) return recruiterSender;
  }
  
  // 3. Fallback to system sender
  return await getSystemSenderIdentity(tenantId);
}
```

### 4. Provider Updates

#### Email Provider Interface
```typescript
interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<EmailSendResult>;
}

interface SendEmailOptions {
  tenantId: string;
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromEmail: string; // Now required, from sender identity
  fromName: string; // From sender identity
  senderIdentityId?: string; // Track which sender was used
  messageTypeId: string;
  userId?: string;
  // ... existing fields
}
```

#### Gmail Email Provider
Create `GmailEmailProvider` class:
```typescript
class GmailEmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    // Get user's Gmail tokens
    // Refresh token if expired
    // Use Gmail API to send
    // Return structured result
  }
}
```

#### SMS Provider Updates
```typescript
interface SmsSendParams {
  to: string;
  body: string;
  fromNumber?: string; // Optional: override with recruiter number
  messageTypeId: string;
  tenantId: string;
  userId: string;
  senderIdentityId?: string;
}
```

### 5. MessageDrawer UI Updates

**Add Sender Selection:**
- Dropdown/select for "Send As"
- Options:
  - "System" (default SendGrid/Twilio)
  - "My Gmail" (if user has Gmail connected)
  - "My Recruiter Number" (if recruiter has assigned number)
- Show sender details (email/phone) next to selection
- Disable unavailable senders with explanation

### 6. Migration Strategy

**Phase 1: Create Sender Identity System**
1. Create `senderIdentities` collection structure
2. Create system sender for each tenant
3. Migrate existing recruiter numbers to sender identities
4. Create helper functions for sender resolution

**Phase 2: Update Providers**
1. Create `GmailEmailProvider` class
2. Update `EmailProviderFactory` to support Gmail
3. Update `SmsProvider` to accept `fromNumber` override
4. Update `TwilioSmsProvider` to use recruiter numbers

**Phase 3: Update Orchestrator**
1. Add sender resolution to `routingOrchestrator.ts`
2. Pass sender identity to providers
3. Update message logging to include `senderIdentityId`

**Phase 4: Update UI**
1. Add sender selection to MessageDrawer
2. Show sender options based on user permissions
3. Add sender management UI (Settings → Messaging → Sender Identities)

**Phase 5: Gmail Integration**
1. Integrate Gmail sending into orchestrator
2. Handle token refresh automatically
3. Add Gmail sender verification/status

## Implementation Details

### Sender Identity Service

**File**: `functions/src/messaging/senderIdentity.ts`

```typescript
export interface SenderIdentity {
  // ... (see above)
}

export async function getSenderIdentity(
  tenantId: string,
  senderId: string
): Promise<SenderIdentity | null>;

export async function getSystemSenderIdentity(
  tenantId: string
): Promise<SenderIdentity>;

export async function getRecruiterSenderIdentity(
  tenantId: string,
  recruiterId: string
): Promise<SenderIdentity | null>;

export async function createRecruiterSenderIdentity(
  tenantId: string,
  recruiterId: string,
  options: {
    twilioNumber?: string;
    useGmail?: boolean;
  }
): Promise<SenderIdentity>;

export async function verifySenderIdentity(
  tenantId: string,
  senderId: string
): Promise<boolean>;
```

### Gmail Email Provider

**File**: `functions/src/messaging/gmailEmailProvider.ts`

```typescript
export class GmailEmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    // 1. Get user's Gmail tokens
    // 2. Refresh token if expired
    // 3. Initialize Gmail API client
    // 4. Build email message (RFC 2822 format)
    // 5. Send via Gmail API
    // 6. Return structured result
  }
  
  private async refreshTokenIfNeeded(userId: string): Promise<void>;
  private async getGmailClient(userId: string): Promise<gmail_v1.Gmail>;
}
```

### Updated Email Provider Factory

```typescript
export function getEmailProvider(senderIdentity: SenderIdentity): EmailProvider {
  if (senderIdentity.emailProvider === 'gmail') {
    return new GmailEmailProvider();
  } else {
    return getSendGridEmailProvider(); // Existing
  }
}
```

### Updated SMS Provider

```typescript
// In TwilioSmsProvider.sendSms()
async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
  // Use params.fromNumber if provided (recruiter number)
  // Otherwise use main number or messaging service
  const fromNumber = params.fromNumber || 
                     messagingPhoneNumber.value() || 
                     (messagingServiceSid ? undefined : messagingServiceSid);
  
  // ... rest of implementation
}
```

## UI Components

### MessageDrawer Sender Selection

```tsx
<FormControl fullWidth>
  <FormLabel>Send As</FormLabel>
  <Select
    value={selectedSenderId}
    onChange={(e) => setSelectedSenderId(e.target.value)}
  >
    <MenuItem value="system">
      System ({systemSender.emailAddress})
    </MenuItem>
    {userGmailSender && (
      <MenuItem value={userGmailSender.id}>
        My Gmail ({userGmailSender.emailAddress})
      </MenuItem>
    )}
    {recruiterSmsSender && (
      <MenuItem value={recruiterSmsSender.id}>
        My Number ({recruiterSmsSender.twilioNumber})
      </MenuItem>
    )}
  </Select>
</FormControl>
```

## Security & Validation

1. **Permission Checks**:
   - Only recruiters can use their assigned numbers
   - Only users with Gmail connected can use Gmail sender
   - System sender available to all admins

2. **Token Management**:
   - Auto-refresh Gmail tokens before expiry
   - Handle token revocation gracefully
   - Log all sender usage for audit

3. **Fallback Logic**:
   - If recruiter number unavailable → use main number
   - If Gmail token expired/revoked → fallback to SendGrid
   - Always log fallback usage

## Testing Strategy

1. **Unit Tests**:
   - Sender resolution logic
   - Gmail token refresh
   - Fallback scenarios

2. **Integration Tests**:
   - Send email via Gmail provider
   - Send SMS via recruiter number
   - Fallback to system sender

3. **E2E Tests**:
   - MessageDrawer sender selection
   - End-to-end message delivery with different senders

## Rollout Plan

1. **Week 1**: Create sender identity system, migrate existing data
2. **Week 2**: Implement Gmail provider, update SMS provider
3. **Week 3**: Update orchestrator, add sender resolution
4. **Week 4**: Update UI, add sender selection to MessageDrawer
5. **Week 5**: Testing, bug fixes, documentation

## Success Metrics

- ✅ Recruiters can send from their assigned Twilio numbers
- ✅ Users can send from their Gmail accounts
- ✅ System automatically falls back when sender unavailable
- ✅ All messages logged with sender identity
- ✅ UI clearly shows sender options and status

