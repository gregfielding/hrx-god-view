# HRX Slack Tenant Storage Specification

**Goal**: Define how Slack data (teams, users, channels, messages) is stored in Firestore with proper tenant isolation and mapping to HRX entities.

**Status**: Phase 2 (Message Ingestion) Complete → Phase 3 (Tenant Mapping) Pending

---

## 1. Overview

Slack Events API provides events with a `team_id` (Slack workspace ID). We need to:
1. Map Slack `team_id` → HRX `tenantId`
2. Map Slack `user_id` → HRX `userId`
3. Map Slack `channel_id` → HRX conversation (DM/Channel/Deal/Customer)
4. Store all Slack data in tenant-scoped collections

---

## 2. Core Collections Structure

### 2.1. Slack Team → Tenant Mapping

**Collection**: `slackTeams` (root-level, for cross-tenant lookup)

```typescript
interface SlackTeam {
  id: string; // Slack team_id
  tenantId: string; // HRX tenant ID
  teamName: string; // Slack workspace name
  domain?: string; // Slack workspace domain (e.g., "hrxone.slack.com")
  botUserId?: string; // Slack bot user ID
  botToken?: string; // Encrypted bot token (stored in Secret Manager, reference only)
  signingSecret?: string; // Encrypted signing secret (stored in Secret Manager, reference only)
  connectedAt: Timestamp;
  lastSyncAt?: Timestamp;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Access Pattern**: 
- Query by `team_id` to find `tenantId`
- One Slack team → One HRX tenant (1:1 mapping)

**Example Document**:
```
slackTeams/T1234567890
{
  id: "T1234567890",
  tenantId: "BCiP2bQ9CgVOCTfV6MhD",
  teamName: "HRX One",
  domain: "hrxone.slack.com",
  botUserId: "U9876543210",
  connectedAt: Timestamp("2025-01-01T12:00:00Z"),
  status: "active",
  createdAt: Timestamp("2025-01-01T12:00:00Z"),
  updatedAt: Timestamp("2025-01-01T12:00:00Z")
}
```

---

### 2.2. Slack Users → HRX Users Mapping

**Collection**: `tenants/{tenantId}/slackUsers` (tenant-scoped)

```typescript
interface SlackUser {
  id: string; // Slack user_id
  tenantId: string; // HRX tenant ID (for querying)
  slackTeamId: string; // Slack team_id
  hrxUserId?: string; // HRX user ID (if mapped)
  email?: string; // Slack user email (from users.info API)
  displayName?: string; // Slack display name
  realName?: string; // Slack real name
  avatar?: string; // Slack avatar URL
  isBot: boolean;
  isDeleted: boolean;
  mappedAt?: Timestamp; // When hrxUserId was set
  lastSeenAt?: Timestamp; // Last message timestamp
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Access Patterns**:
- Query by `slackUserId` to find `hrxUserId`
- Query by `email` to find matching HRX user
- Query by `tenantId` to list all Slack users for a tenant

**Example Document**:
```
tenants/BCiP2bQ9CgVOCTfV6MhD/slackUsers/U1234567890
{
  id: "U1234567890",
  tenantId: "BCiP2bQ9CgVOCTfV6MhD",
  slackTeamId: "T1234567890",
  hrxUserId: "zazCFZdVZMTX3AJZsVmrYzHmb6Q2",
  email: "g.fielding@c1staffing.com",
  displayName: "Greg Fielding",
  realName: "Greg Fielding",
  avatar: "https://avatars.slack-edge.com/...",
  isBot: false,
  isDeleted: false,
  mappedAt: Timestamp("2025-01-01T12:00:00Z"),
  createdAt: Timestamp("2025-01-01T12:00:00Z"),
  updatedAt: Timestamp("2025-01-01T12:00:00Z")
}
```

---

### 2.3. Slack Channels → HRX Conversations Mapping

**Collection**: `tenants/{tenantId}/slackChannels` (tenant-scoped)

```typescript
interface SlackChannel {
  id: string; // Slack channel_id
  tenantId: string; // HRX tenant ID
  slackTeamId: string; // Slack team_id
  channelType: 'channel' | 'group' | 'im' | 'mpim';
  name?: string; // Channel name (for public/private channels)
  isPrivate: boolean;
  isArchived: boolean;
  
  // HRX Conversation Mapping
  hrxConversationType?: 'dm' | 'channel' | 'deal' | 'customer' | 'job' | 'team';
  hrxConversationId?: string; // ID in internalDMs, internalChannels, or external entity
  
  // For DMs (channelType === 'im')
  dmParticipantSlackUserIds?: string[]; // Array of Slack user IDs in DM
  
  // For external entity mapping (deal/customer/job)
  dealId?: string;
  customerId?: string;
  jobId?: string;
  
  // Metadata
  topic?: string; // Channel topic
  purpose?: string; // Channel purpose
  memberCount?: number;
  mappedAt?: Timestamp;
  lastMessageAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Access Patterns**:
- Query by `channelId` to find HRX conversation mapping
- Query by `tenantId` and `channelType` to list channels
- Query by `hrxConversationType` and `hrxConversationId` to find Slack channel

**Example Documents**:

**Public Channel**:
```
tenants/BCiP2bQ9CgVOCTfV6MhD/slackChannels/C1234567890
{
  id: "C1234567890",
  tenantId: "BCiP2bQ9CgVOCTfV6MhD",
  slackTeamId: "T1234567890",
  channelType: "channel",
  name: "sales",
  isPrivate: false,
  isArchived: false,
  hrxConversationType: "channel",
  hrxConversationId: "sales-channel-id",
  topic: "Sales team discussions",
  memberCount: 12,
  createdAt: Timestamp("2025-01-01T12:00:00Z"),
  updatedAt: Timestamp("2025-01-01T12:00:00Z")
}
```

**Direct Message**:
```
tenants/BCiP2bQ9CgVOCTfV6MhD/slackChannels/D1234567890
{
  id: "D1234567890",
  tenantId: "BCiP2bQ9CgVOCTfV6MhD",
  slackTeamId: "T1234567890",
  channelType: "im",
  isPrivate: true,
  isArchived: false,
  hrxConversationType: "dm",
  hrxConversationId: "user1_user2", // DM ID format
  dmParticipantSlackUserIds: ["U1234567890", "U9876543210"],
  createdAt: Timestamp("2025-01-01T12:00:00Z"),
  updatedAt: Timestamp("2025-01-01T12:00:00Z")
}
```

**Deal-Linked Channel**:
```
tenants/BCiP2bQ9CgVOCTfV6MhD/slackChannels/C9876543210
{
  id: "C9876543210",
  tenantId: "BCiP2bQ9CgVOCTfV6MhD",
  slackTeamId: "T1234567890",
  channelType: "channel",
  name: "deal-acme-corp",
  isPrivate: true,
  isArchived: false,
  hrxConversationType: "deal",
  hrxConversationId: "deal-abc123",
  dealId: "deal-abc123",
  createdAt: Timestamp("2025-01-01T12:00:00Z"),
  updatedAt: Timestamp("2025-01-01T12:00:00Z")
}
```

---

### 2.4. Slack Messages (Phase 2 - Current)

**Collection**: `slack_messages` (root-level, for now)

**Current Structure** (from Phase 2):
```typescript
interface SlackMessageDoc {
  source: 'slack';
  eventId: string; // For deduplication
  teamId: string; // Slack team_id
  channelId: string; // Slack channel_id
  channelType: 'im' | 'channel' | 'group' | 'mpim';
  slackUserId: string; // Slack user_id
  text: string;
  ts: string; // Slack timestamp
  threadTs?: string; // Thread timestamp (if thread reply)
  isThreadReply: boolean;
  raw: any; // Full payload (for debugging)
  createdAt: Timestamp;
}
```

**Future Migration** (Phase 3):
Move to tenant-scoped collection: `tenants/{tenantId}/slackMessages`

```typescript
interface SlackMessage {
  id: string; // Auto-generated
  tenantId: string; // From teamId mapping
  eventId: string; // For deduplication
  slackTeamId: string; // Slack team_id
  slackChannelId: string; // Slack channel_id
  slackUserId: string; // Slack user_id
  hrxUserId?: string; // Mapped HRX user ID
  hrxConversationId?: string; // Mapped HRX conversation ID
  hrxConversationType?: 'dm' | 'channel' | 'deal' | 'customer' | 'job';
  text: string;
  ts: string; // Slack timestamp
  threadTs?: string;
  isThreadReply: boolean;
  raw?: any; // Full payload (can be trimmed later)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 3. Mapping Logic

### 3.1. Team → Tenant Mapping

**When**: On first Slack event for a `team_id`

**Process**:
1. Check `slackTeams/{team_id}` exists
2. If not, try to find tenant by:
   - Checking `tenants/{tenantId}/integrations/slack` for matching `workspaceId`
   - Or prompt admin to map team to tenant
3. Create `slackTeams/{team_id}` document with `tenantId`

**Helper Function**:
```typescript
async function getTenantIdFromSlackTeam(teamId: string): Promise<string | null> {
  // Check slackTeams collection
  const teamDoc = await db.collection('slackTeams').doc(teamId).get();
  if (teamDoc.exists) {
    return teamDoc.data()?.tenantId || null;
  }
  
  // Try to find via integrations
  const integrationsQuery = await db.collectionGroup('integrations')
    .where('__name__', '==', 'slack')
    .where('workspaceId', '==', teamId)
    .limit(1)
    .get();
  
  if (!integrationsQuery.empty) {
    const tenantId = integrationsQuery.docs[0].ref.parent.parent?.id;
    if (tenantId) {
      // Create mapping
      await db.collection('slackTeams').doc(teamId).set({
        id: teamId,
        tenantId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return tenantId;
    }
  }
  
  return null;
}
```

---

### 3.2. User → HRX User Mapping

**When**: On first message from a Slack user, or when processing messages

**Process**:
1. Check `tenants/{tenantId}/slackUsers/{slackUserId}` exists
2. If not, create with `email` from Slack API (`users.info`)
3. Try to match by email: Query `users` collection where `email === slackUser.email`
4. If match found, update `slackUsers` doc with `hrxUserId`
5. If no match, leave `hrxUserId` as `null` (can be mapped manually later)

**Helper Function**:
```typescript
async function mapSlackUserToHRXUser(
  tenantId: string,
  slackUserId: string,
  slackEmail?: string
): Promise<string | null> {
  const slackUserRef = db.collection('tenants').doc(tenantId)
    .collection('slackUsers').doc(slackUserId);
  
  const slackUserDoc = await slackUserRef.get();
  
  if (slackUserDoc.exists) {
    const data = slackUserDoc.data();
    if (data?.hrxUserId) {
      return data.hrxUserId;
    }
  }
  
  // Try to find HRX user by email
  if (slackEmail) {
    const usersQuery = await db.collection('users')
      .where('email', '==', slackEmail.toLowerCase())
      .limit(1)
      .get();
    
    if (!usersQuery.empty) {
      const hrxUserId = usersQuery.docs[0].id;
      
      // Update or create slackUsers doc
      await slackUserRef.set({
        id: slackUserId,
        tenantId,
        hrxUserId,
        email: slackEmail,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      
      return hrxUserId;
    }
  }
  
  // Create slackUsers doc without hrxUserId (manual mapping later)
  if (!slackUserDoc.exists) {
    await slackUserRef.set({
      id: slackUserId,
      tenantId,
      email: slackEmail,
      isBot: false,
      isDeleted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  
  return null;
}
```

---

### 3.3. Channel → HRX Conversation Mapping

**When**: On first message in a channel, or when channel is created/linked

**Process**:
1. Check `tenants/{tenantId}/slackChannels/{channelId}` exists
2. If not, create based on `channelType`:
   - **`im` (DM)**: Map to HRX `internalDMs` conversation
   - **`channel`/`group`**: Map to HRX `internalChannels` or external entity (deal/customer/job)
3. For DMs: Use `getOrCreateDM` helper to create/find HRX DM conversation
4. For channels: Check if channel name matches pattern (e.g., `deal-{dealId}`) or manual mapping

**Helper Function**:
```typescript
async function mapSlackChannelToHRXConversation(
  tenantId: string,
  channelId: string,
  channelType: 'im' | 'channel' | 'group' | 'mpim',
  participantSlackUserIds?: string[]
): Promise<{ conversationType: string; conversationId: string } | null> {
  const channelRef = db.collection('tenants').doc(tenantId)
    .collection('slackChannels').doc(channelId);
  
  const channelDoc = await channelRef.get();
  
  if (channelDoc.exists) {
    const data = channelDoc.data();
    if (data?.hrxConversationId && data?.hrxConversationType) {
      return {
        conversationType: data.hrxConversationType,
        conversationId: data.hrxConversationId,
      };
    }
  }
  
  // For DMs, map to HRX internal DM
  if (channelType === 'im' && participantSlackUserIds && participantSlackUserIds.length === 2) {
    // Get HRX user IDs for both participants
    const [user1SlackId, user2SlackId] = participantSlackUserIds;
    const user1Doc = await db.collection('tenants').doc(tenantId)
      .collection('slackUsers').doc(user1SlackId).get();
    const user2Doc = await db.collection('tenants').doc(tenantId)
      .collection('slackUsers').doc(user2SlackId).get();
    
    const hrxUserId1 = user1Doc.data()?.hrxUserId;
    const hrxUserId2 = user2Doc.data()?.hrxUserId;
    
    if (hrxUserId1 && hrxUserId2) {
      // Use existing getOrCreateDM helper
      const { getOrCreateDM } = await import('./messaging/internalMessaging');
      const dmId = await getOrCreateDM(tenantId, hrxUserId1, hrxUserId2);
      
      // Update channel mapping
      await channelRef.set({
        id: channelId,
        tenantId,
        channelType: 'im',
        isPrivate: true,
        hrxConversationType: 'dm',
        hrxConversationId: dmId,
        dmParticipantSlackUserIds: participantSlackUserIds,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      
      return { conversationType: 'dm', conversationId: dmId };
    }
  }
  
  // For channels, create mapping without hrxConversationId (manual mapping later)
  if (!channelDoc.exists) {
    await channelRef.set({
      id: channelId,
      tenantId,
      channelType,
      isPrivate: channelType === 'group',
      isArchived: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  
  return null;
}
```

---

## 4. Integration with Existing Systems

### 4.1. Internal Messaging System

When a Slack message is mapped to an HRX conversation:
1. Write to `tenants/{tenantId}/internalMessages` (for DMs/channels)
2. Update `unreadCounts` on `internalDMs` or `internalChannels` document
3. Update `lastMessage` and `lastMessageAt` fields

### 4.2. Activity Logs

For deal/customer/job-linked channels:
- Optionally create `activity_logs` entries when messages are posted
- Link to `dealId`, `customerId`, or `jobId`

### 4.3. Email Logs (Legacy)

Slack messages should **NOT** be written to `email_logs` (that's for email only).

---

## 5. Migration Plan

### Phase 3.1: Team → Tenant Mapping
1. Create `slackTeams` collection
2. Update `handleSlackEventAsync` to resolve `teamId` → `tenantId`
3. Store `tenantId` in `slack_messages` documents (add field)

### Phase 3.2: User Mapping
1. Create `tenants/{tenantId}/slackUsers` collection
2. On message receipt, create/update `slackUsers` doc
3. Try to match by email to HRX users
4. Store `hrxUserId` in `slack_messages` (add field)

### Phase 3.3: Channel Mapping
1. Create `tenants/{tenantId}/slackChannels` collection
2. On message receipt, create/update `slackChannels` doc
3. For DMs, automatically map to HRX `internalDMs`
4. For channels, support manual mapping UI

### Phase 3.4: Message Integration
1. Move `slack_messages` to `tenants/{tenantId}/slackMessages`
2. Write normalized messages to `internalMessages` when mapped
3. Update unread counts
4. Remove raw payload storage (keep only essential fields)

---

## 6. Security & Access Control

### Firestore Rules

```javascript
// slackTeams (root-level, read-only for authenticated users)
match /slackTeams/{teamId} {
  allow read: if request.auth != null;
  allow write: if false; // Only server-side writes
}

// slackUsers (tenant-scoped)
match /tenants/{tenantId}/slackUsers/{slackUserId} {
  allow read: if request.auth != null && 
    (resource.data.tenantId in getUserTenantIds() || 
     getTenantAccessLevel(tenantId) >= 5);
  allow write: if false; // Only server-side writes
}

// slackChannels (tenant-scoped)
match /tenants/{tenantId}/slackChannels/{channelId} {
  allow read: if request.auth != null && 
    (resource.data.tenantId in getUserTenantIds() || 
     getTenantAccessLevel(tenantId) >= 5);
  allow write: if false; // Only server-side writes
}

// slackMessages (tenant-scoped, future)
match /tenants/{tenantId}/slackMessages/{messageId} {
  allow read: if request.auth != null && 
    (resource.data.tenantId in getUserTenantIds() || 
     getTenantAccessLevel(tenantId) >= 5);
  allow write: if false; // Only server-side writes
}
```

---

## 7. Implementation Checklist

### Phase 3.1: Team Mapping
- [ ] Create `getTenantIdFromSlackTeam` helper function
- [ ] Update `handleSlackEventAsync` to resolve `tenantId` from `teamId`
- [ ] Add `tenantId` field to `slack_messages` documents
- [ ] Create admin UI for manual team → tenant mapping

### Phase 3.2: User Mapping
- [ ] Create `mapSlackUserToHRXUser` helper function
- [ ] Update `handleSlackEventAsync` to create/update `slackUsers` docs
- [ ] Implement email-based auto-matching
- [ ] Create admin UI for manual user mapping

### Phase 3.3: Channel Mapping
- [ ] Create `mapSlackChannelToHRXConversation` helper function
- [ ] Update `handleSlackEventAsync` to create/update `slackChannels` docs
- [ ] Implement automatic DM → HRX DM mapping
- [ ] Create admin UI for manual channel mapping

### Phase 3.4: Message Integration
- [ ] Migrate `slack_messages` to tenant-scoped collection
- [ ] Write normalized messages to `internalMessages` when mapped
- [ ] Update unread counts on conversations
- [ ] Remove raw payload storage (keep only essential fields)

---

## 8. Example Flow

**Incoming Slack Message Event**:
```json
{
  "team_id": "T1234567890",
  "event": {
    "type": "message",
    "user": "U1234567890",
    "channel": "D9876543210",
    "text": "Hey, can you review this candidate?",
    "ts": "1234567890.123456"
  }
}
```

**Processing Steps**:
1. **Resolve Tenant**: `teamId: "T1234567890"` → `tenantId: "BCiP2bQ9CgVOCTfV6MhD"`
2. **Map User**: `slackUserId: "U1234567890"` → `hrxUserId: "zazCFZdVZMTX3AJZsVmrYzHmb6Q2"`
3. **Map Channel**: `channelId: "D9876543210"` (DM) → `hrxConversationId: "user1_user2"`, `conversationType: "dm"`
4. **Write Message**: 
   - To `slack_messages` (Phase 2, current)
   - To `tenants/{tenantId}/internalMessages` (Phase 3.4, future)
5. **Update Unread Counts**: Increment `unreadCounts` on `internalDMs/{dmId}` for recipient

---

## 9. Notes

- **Secrets**: Bot tokens and signing secrets should be stored in Firebase Secret Manager, not Firestore
- **Deduplication**: Continue using `eventId` for message deduplication
- **Performance**: Use indexes for common queries (tenantId, hrxUserId, hrxConversationId)
- **Backward Compatibility**: Keep `slack_messages` root collection until migration is complete

---

**Next Steps**: Implement Phase 3.1 (Team → Tenant Mapping) first, then proceed with User and Channel mapping.




