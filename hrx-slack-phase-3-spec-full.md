# HRX Slack Integration — Phase 3 Spec (Mapping, Messages, Unread, UI Hooks)

**Goal**: Complete the Slack → HRX integration by implementing tenant mapping, user/channel mapping, message integration with internal messaging, unread count updates, and admin UI for mapping management.

**Status**: Phase 2 (Message Ingestion) Complete → Phase 3 (Full Integration) Pending

**Reference**: See `hrx-slack-tenant-storage-spec.md` for detailed collection structures.

---

## 1. Overview

Phase 3 transforms the one-way Slack message ingestion (Phase 2) into a fully integrated two-way system where:
- Slack messages appear in HRX's internal messaging system
- Unread counts update the top-bar 💬 badge
- Users can manage Slack team/user/channel mappings via UI
- Messages are properly scoped to tenants

---

## 2. Implementation Phases

### Phase 3.1: Team → Tenant Mapping
### Phase 3.2: User Mapping (Slack → HRX Users)
### Phase 3.3: Channel Mapping (Slack → HRX Conversations)
### Phase 3.4: Message Integration & Unread Counts
### Phase 3.5: Admin UI for Mapping Management

---

## 3. Phase 3.1: Team → Tenant Mapping

### 3.1.1. Create Helper Function

**File**: `functions/src/messaging/slackMapping.ts` (new file)

```typescript
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Get tenantId from Slack team_id
 * 
 * Checks slackTeams collection first, then tries to find via integrations.
 * Creates mapping if found via integrations.
 */
export async function getTenantIdFromSlackTeam(teamId: string): Promise<string | null> {
  try {
    // Check slackTeams collection
    const teamDoc = await db.collection('slackTeams').doc(teamId).get();
    if (teamDoc.exists) {
      const data = teamDoc.data();
      if (data?.tenantId) {
        logger.info(`Found tenant mapping for Slack team ${teamId}: ${data.tenantId}`);
        return data.tenantId;
      }
    }
    
    // Try to find via integrations collection
    // Query all tenants' integrations/slack documents
    const integrationsQuery = await db.collectionGroup('integrations')
      .where(admin.firestore.FieldPath.documentId(), '==', 'slack')
      .get();
    
    for (const doc of integrationsQuery.docs) {
      const data = doc.data();
      // Check if workspaceId matches teamId
      if (data.workspaceId === teamId || data.teamId === teamId) {
        const tenantId = doc.ref.parent.parent?.id;
        if (tenantId) {
          // Create mapping in slackTeams
          await db.collection('slackTeams').doc(teamId).set({
            id: teamId,
            tenantId,
            teamName: data.teamName || data.workspaceName || 'Unknown',
            domain: data.domain,
            botUserId: data.botUserId,
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          
          logger.info(`Created tenant mapping for Slack team ${teamId} → ${tenantId}`);
          return tenantId;
        }
      }
    }
    
    logger.warn(`No tenant mapping found for Slack team ${teamId}`);
    return null;
  } catch (error: any) {
    logger.error(`Error getting tenant from Slack team ${teamId}:`, error);
    return null;
  }
}
```

### 3.1.2. Update `handleSlackEventAsync`

**File**: `functions/src/slackEvents.ts`

```typescript
import { getTenantIdFromSlackTeam } from './messaging/slackMapping';

async function handleSlackEventAsync(payload: SlackEventPayload): Promise<void> {
  // ... existing message filtering logic ...
  
  // NEW: Resolve tenantId from teamId
  const tenantId = await getTenantIdFromSlackTeam(payload.team_id);
  
  if (!tenantId) {
    logger.warn(`Cannot process Slack message: no tenant mapping for team ${payload.team_id}`);
    // Still write to slack_messages for debugging, but skip HRX integration
  }
  
  // Create normalized message document
  const messageDoc: SlackMessageDoc = {
    source: 'slack',
    eventId: eventId || `manual-${Date.now()}-${Math.random()}`,
    teamId: payload.team_id,
    tenantId: tenantId || '', // Add tenantId field
    channelId: event.channel || '',
    channelType,
    slackUserId: event.user,
    text: event.text,
    ts: event.ts || '',
    threadTs: event.thread_ts || undefined,
    isThreadReply,
    raw: payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
  };
  
  // Write to Firestore (existing Phase 2 logic)
  await db.collection('slack_messages').add(messageDoc);
  
  // If no tenantId, stop here (can't integrate with HRX)
  if (!tenantId) {
    return;
  }
  
  // Continue with Phase 3.2, 3.3, 3.4 below...
}
```

### 3.1.3. Admin UI for Team Mapping (Optional)

**File**: `src/pages/TenantViews/IntegrationsTab.tsx` (add Slack team mapping section)

Add a section to manually map Slack teams to tenants if auto-discovery fails.

---

## 4. Phase 3.2: User Mapping (Slack → HRX Users)

### 4.1. Create Helper Function

**File**: `functions/src/messaging/slackMapping.ts`

```typescript
/**
 * Map Slack user to HRX user
 * 
 * 1. Check if slackUsers doc exists
 * 2. If exists and has hrxUserId, return it
 * 3. If not, try to match by email
 * 4. Create/update slackUsers doc
 */
export async function mapSlackUserToHRXUser(
  tenantId: string,
  slackUserId: string,
  slackEmail?: string,
  slackDisplayName?: string
): Promise<string | null> {
  try {
    const slackUserRef = db.collection('tenants').doc(tenantId)
      .collection('slackUsers').doc(slackUserId);
    
    const slackUserDoc = await slackUserRef.get();
    
    // If exists and already mapped, return hrxUserId
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
        const userData = usersQuery.docs[0].data();
        
        // Update or create slackUsers doc
        await slackUserRef.set({
          id: slackUserId,
          tenantId,
          slackTeamId: '', // Will be set by caller
          hrxUserId,
          email: slackEmail,
          displayName: slackDisplayName || userData.displayName || userData.firstName || slackEmail.split('@')[0],
          realName: userData.firstName && userData.lastName 
            ? `${userData.firstName} ${userData.lastName}` 
            : slackDisplayName,
          avatar: userData.avatar,
          isBot: false,
          isDeleted: false,
          mappedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: slackUserDoc.exists 
            ? slackUserDoc.data()?.createdAt 
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        
        logger.info(`Mapped Slack user ${slackUserId} → HRX user ${hrxUserId} (email: ${slackEmail})`);
        return hrxUserId;
      }
    }
    
    // Create slackUsers doc without hrxUserId (manual mapping later)
    if (!slackUserDoc.exists) {
      await slackUserRef.set({
        id: slackUserId,
        tenantId,
        slackTeamId: '', // Will be set by caller
        email: slackEmail,
        displayName: slackDisplayName || slackEmail?.split('@')[0] || 'Unknown',
        isBot: false,
        isDeleted: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      logger.info(`Created slackUsers doc for ${slackUserId} (no HRX user match)`);
    }
    
    return null;
  } catch (error: any) {
    logger.error(`Error mapping Slack user ${slackUserId} to HRX user:`, error);
    return null;
  }
}
```

### 4.2. Fetch Slack User Info (Optional)

If `SLACK_BOT_TOKEN` is available, use Slack API to fetch user email:

```typescript
async function fetchSlackUserInfo(slackUserId: string): Promise<{ email?: string; displayName?: string } | null> {
  try {
    const botToken = SLACK_BOT_TOKEN.value();
    if (!botToken) {
      return null;
    }
    
    const axios = require('axios');
    const response = await axios.get(`https://slack.com/api/users.info`, {
      params: { user: slackUserId },
      headers: { Authorization: `Bearer ${botToken}` },
    });
    
    if (response.data.ok && response.data.user) {
      const user = response.data.user;
      return {
        email: user.profile?.email,
        displayName: user.profile?.display_name || user.profile?.real_name || user.name,
      };
    }
    
    return null;
  } catch (error: any) {
    logger.warn(`Failed to fetch Slack user info for ${slackUserId}:`, error);
    return null;
  }
}
```

### 4.3. Update `handleSlackEventAsync`

```typescript
// After resolving tenantId (Phase 3.1)
const hrxUserId = await mapSlackUserToHRXUser(
  tenantId,
  messageDoc.slackUserId,
  undefined, // email - fetch from Slack API if needed
  undefined  // displayName - fetch from Slack API if needed
);

// Store hrxUserId in messageDoc for later use
messageDoc.hrxUserId = hrxUserId || undefined;
```

---

## 5. Phase 3.3: Channel Mapping (Slack → HRX Conversations)

### 5.1. Create Helper Function

**File**: `functions/src/messaging/slackMapping.ts`

```typescript
/**
 * Map Slack channel to HRX conversation
 * 
 * For DMs: Automatically maps to HRX internalDMs
 * For channels: Returns null (manual mapping required)
 */
export async function mapSlackChannelToHRXConversation(
  tenantId: string,
  slackTeamId: string,
  channelId: string,
  channelType: 'im' | 'channel' | 'group' | 'mpim',
  participantSlackUserIds?: string[]
): Promise<{ conversationType: string; conversationId: string } | null> {
  try {
    const channelRef = db.collection('tenants').doc(tenantId)
      .collection('slackChannels').doc(channelId);
    
    const channelDoc = await channelRef.get();
    
    // If exists and already mapped, return mapping
    if (channelDoc.exists) {
      const data = channelDoc.data();
      if (data?.hrxConversationId && data?.hrxConversationType) {
        return {
          conversationType: data.hrxConversationType,
          conversationId: data.hrxConversationId,
        };
      }
    }
    
    // For DMs, automatically map to HRX internalDMs
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
        const { getOrCreateDM } = await import('./internalMessaging');
        const dmId = await getOrCreateDM(tenantId, hrxUserId1, hrxUserId2);
        
        // Update channel mapping
        await channelRef.set({
          id: channelId,
          tenantId,
          slackTeamId,
          channelType: 'im',
          isPrivate: true,
          isArchived: false,
          hrxConversationType: 'dm',
          hrxConversationId: dmId,
          dmParticipantSlackUserIds: participantSlackUserIds,
          mappedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: channelDoc.exists 
            ? channelDoc.data()?.createdAt 
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        
        logger.info(`Mapped Slack DM ${channelId} → HRX DM ${dmId}`);
        return { conversationType: 'dm', conversationId: dmId };
      } else {
        logger.warn(`Cannot map Slack DM ${channelId}: missing HRX user mappings`);
      }
    }
    
    // For channels/groups, create mapping without hrxConversationId (manual mapping later)
    if (!channelDoc.exists && (channelType === 'channel' || channelType === 'group')) {
      await channelRef.set({
        id: channelId,
        tenantId,
        slackTeamId,
        channelType,
        isPrivate: channelType === 'group',
        isArchived: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      logger.info(`Created slackChannels doc for ${channelId} (manual mapping required)`);
    }
    
    return null;
  } catch (error: any) {
    logger.error(`Error mapping Slack channel ${channelId} to HRX conversation:`, error);
    return null;
  }
}
```

### 5.2. Update `handleSlackEventAsync`

```typescript
// After mapping user (Phase 3.2)
// For DMs, we need to get participant IDs from Slack API or from channel info
// For now, we'll try to infer from the channel type

let hrxConversationMapping = null;
if (channelType === 'im') {
  // For DMs, we need both participant IDs
  // The sender is event.user, the recipient is the other participant
  // We can get this from Slack API or store it when DM is first created
  // For now, we'll create the mapping without participant IDs and update later
  hrxConversationMapping = await mapSlackChannelToHRXConversation(
    tenantId,
    payload.team_id,
    messageDoc.channelId,
    channelType,
    undefined // participantSlackUserIds - fetch from Slack API if needed
  );
} else {
  // For channels/groups, create mapping doc (manual mapping required)
  hrxConversationMapping = await mapSlackChannelToHRXConversation(
    tenantId,
    payload.team_id,
    messageDoc.channelId,
    channelType
  );
}

// Store mapping in messageDoc
if (hrxConversationMapping) {
  messageDoc.hrxConversationId = hrxConversationMapping.conversationId;
  messageDoc.hrxConversationType = hrxConversationMapping.conversationType as any;
}
```

---

## 6. Phase 3.4: Message Integration & Unread Counts

### 6.1. Write to Internal Messages

**File**: `functions/src/slackEvents.ts`

```typescript
// After all mappings are complete (Phase 3.1, 3.2, 3.3)
if (tenantId && hrxUserId && hrxConversationMapping) {
  const { InternalMessage } = await import('./messaging/internalMessaging');
  
  // Create normalized internal message
  const internalMessage: Omit<InternalMessage, 'id'> = {
    tenantId,
    conversationType: hrxConversationMapping.conversationType as 'dm' | 'channel',
    conversationId: hrxConversationMapping.conversationId,
    threadId: messageDoc.threadTs || undefined, // For future thread support
    content: messageDoc.text,
    contentType: 'text',
    fromUserId: hrxUserId,
    fromUserName: '', // Will be populated from user doc
    fromUserAvatar: undefined,
    reactions: [],
    createdAt: messageDoc.createdAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  
  // Get user name and avatar
  try {
    const userDoc = await db.collection('users').doc(hrxUserId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      internalMessage.fromUserName = userData.displayName || 
        `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 
        userData.email?.split('@')[0] || 'Unknown';
      internalMessage.fromUserAvatar = userData.avatar;
    }
  } catch (err) {
    logger.warn(`Failed to fetch user data for ${hrxUserId}:`, err);
  }
  
  // Write to internalMessages subcollection
  const conversationRef = hrxConversationMapping.conversationType === 'dm'
    ? db.collection('tenants').doc(tenantId)
        .collection('internalDMs').doc(hrxConversationMapping.conversationId)
    : db.collection('tenants').doc(tenantId)
        .collection('internalChannels').doc(hrxConversationMapping.conversationId);
  
  const messageRef = await conversationRef
    .collection('internalMessages')
    .add(internalMessage);
  
  logger.info(`Created internal message ${messageRef.id} from Slack message`);
  
  // Update conversation lastMessage fields
  await conversationRef.update({
    lastMessage: messageDoc.text.substring(0, 100),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageFrom: internalMessage.fromUserId,
    lastMessageFromUserId: internalMessage.fromUserId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  
  // Update unread counts (Phase 3.4.2)
  await updateUnreadCountsForSlackMessage(
    tenantId,
    hrxConversationMapping.conversationType,
    hrxConversationMapping.conversationId,
    hrxUserId, // Sender - don't increment for them
    conversationRef
  );
}
```

### 6.2. Update Unread Counts

**File**: `functions/src/messaging/slackMapping.ts`

```typescript
/**
 * Update unread counts for a Slack message
 * 
 * Increments unreadCounts for all participants except the sender
 */
export async function updateUnreadCountsForSlackMessage(
  tenantId: string,
  conversationType: 'dm' | 'channel',
  conversationId: string,
  senderUserId: string,
  conversationRef: admin.firestore.DocumentReference
): Promise<void> {
  try {
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
      logger.warn(`Conversation ${conversationId} not found for unread count update`);
      return;
    }
    
    const conversationData = conversationDoc.data();
    const updates: any = {};
    
    if (conversationType === 'dm') {
      // For DMs, increment for the other participant
      const participants = conversationData?.participants || [];
      const otherParticipant = participants.find((p: string) => p !== senderUserId);
      
      if (otherParticipant) {
        updates[`unreadCounts.${otherParticipant}`] = admin.firestore.FieldValue.increment(1);
      }
    } else if (conversationType === 'channel') {
      // For channels, increment for all members except sender
      const memberIds = conversationData?.memberIds || [];
      memberIds.forEach((memberId: string) => {
        if (memberId !== senderUserId) {
          updates[`unreadCounts.${memberId}`] = admin.firestore.FieldValue.increment(1);
        }
      });
    }
    
    if (Object.keys(updates).length > 0) {
      await conversationRef.update(updates);
      logger.info(`Updated unread counts for ${conversationType} ${conversationId}`);
    }
  } catch (error: any) {
    logger.error(`Error updating unread counts for Slack message:`, error);
    // Don't throw - unread counts are nice-to-have, not critical
  }
}
```

---

## 7. Phase 3.5: Admin UI for Mapping Management

### 7.1. Slack Mappings Tab

**File**: `src/pages/TenantViews/SlackMappingsTab.tsx` (new file)

Create a new tab in tenant settings for managing Slack mappings:

- **Team Mapping**: Show current Slack team → tenant mapping
- **User Mappings**: List all Slack users, show HRX user matches, allow manual mapping
- **Channel Mappings**: List all Slack channels, show HRX conversation matches, allow manual mapping

### 7.2. Manual User Mapping UI

```typescript
// Component to map Slack user to HRX user
<Autocomplete
  options={hrxUsers}
  getOptionLabel={(option) => `${option.displayName} (${option.email})`}
  onChange={(_, user) => {
    // Call API to update slackUsers doc
    updateSlackUserMapping(tenantId, slackUserId, user.id);
  }}
/>
```

### 7.3. Manual Channel Mapping UI

```typescript
// Component to map Slack channel to HRX conversation
<Select
  value={hrxConversationType}
  onChange={(e) => {
    // Update slackChannels doc
    updateSlackChannelMapping(tenantId, channelId, {
      hrxConversationType: e.target.value,
      hrxConversationId: selectedConversationId,
    });
  }}
>
  <MenuItem value="dm">Direct Message</MenuItem>
  <MenuItem value="channel">Internal Channel</MenuItem>
  <MenuItem value="deal">Deal</MenuItem>
  <MenuItem value="customer">Customer</MenuItem>
  <MenuItem value="job">Job</MenuItem>
</Select>
```

### 7.4. API Functions for Manual Mapping

**File**: `functions/src/messaging/slackMappingApi.ts` (new file)

```typescript
/**
 * Update Slack user mapping
 */
export const updateSlackUserMappingApi = onCall({
  cors: true,
}, async (request) => {
  const { tenantId, slackUserId, hrxUserId } = request.data;
  const userId = request.auth?.uid;
  
  // Verify user has admin access to tenant
  // ... validation ...
  
  await db.collection('tenants').doc(tenantId)
    .collection('slackUsers').doc(slackUserId)
    .update({
      hrxUserId,
      mappedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  
  return { success: true };
});

/**
 * Update Slack channel mapping
 */
export const updateSlackChannelMappingApi = onCall({
  cors: true,
}, async (request) => {
  const { tenantId, channelId, hrxConversationType, hrxConversationId, dealId, customerId, jobId } = request.data;
  const userId = request.auth?.uid;
  
  // Verify user has admin access to tenant
  // ... validation ...
  
  const updateData: any = {
    hrxConversationType,
    hrxConversationId,
    mappedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  
  if (dealId) updateData.dealId = dealId;
  if (customerId) updateData.customerId = customerId;
  if (jobId) updateData.jobId = jobId;
  
  await db.collection('tenants').doc(tenantId)
    .collection('slackChannels').doc(channelId)
    .update(updateData);
  
  return { success: true };
});
```

---

## 8. Complete Updated `handleSlackEventAsync`

**File**: `functions/src/slackEvents.ts`

```typescript
async function handleSlackEventAsync(payload: SlackEventPayload): Promise<void> {
  const event = payload.event;

  // ... existing message filtering logic (Phase 2) ...

  // Phase 3.1: Resolve tenantId from teamId
  const tenantId = await getTenantIdFromSlackTeam(payload.team_id);
  
  if (!tenantId) {
    logger.warn(`Cannot process Slack message: no tenant mapping for team ${payload.team_id}`);
    // Still write to slack_messages for debugging
    await db.collection('slack_messages').add(messageDoc);
    return;
  }
  
  // Phase 3.2: Map Slack user to HRX user
  const hrxUserId = await mapSlackUserToHRXUser(
    tenantId,
    messageDoc.slackUserId,
    undefined, // email - could fetch from Slack API
    undefined  // displayName - could fetch from Slack API
  );
  
  // Phase 3.3: Map Slack channel to HRX conversation
  let hrxConversationMapping = null;
  if (channelType === 'im') {
    // For DMs, try to map automatically
    hrxConversationMapping = await mapSlackChannelToHRXConversation(
      tenantId,
      payload.team_id,
      messageDoc.channelId,
      channelType,
      undefined // participantSlackUserIds - could fetch from Slack API
    );
  } else {
    // For channels, create mapping doc (manual mapping required)
    hrxConversationMapping = await mapSlackChannelToHRXConversation(
      tenantId,
      payload.team_id,
      messageDoc.channelId,
      channelType
    );
  }
  
  // Write to slack_messages (Phase 2)
  await db.collection('slack_messages').add({
    ...messageDoc,
    tenantId,
    hrxUserId: hrxUserId || undefined,
    hrxConversationId: hrxConversationMapping?.conversationId,
    hrxConversationType: hrxConversationMapping?.conversationType,
  });
  
  // Phase 3.4: Write to internalMessages if fully mapped
  if (tenantId && hrxUserId && hrxConversationMapping) {
    // ... message integration logic from section 6.1 ...
    // ... unread count updates from section 6.2 ...
  }
}
```

---

## 9. Firestore Indexes

Add composite indexes for efficient queries:

```json
{
  "indexes": [
    {
      "collectionGroup": "slackUsers",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tenantId", "order": "ASCENDING" },
        { "fieldPath": "hrxUserId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "slackChannels",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tenantId", "order": "ASCENDING" },
        { "fieldPath": "hrxConversationType", "order": "ASCENDING" },
        { "fieldPath": "hrxConversationId", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 10. Testing Checklist

### Phase 3.1: Team Mapping
- [ ] Send Slack message from connected workspace
- [ ] Verify `slackTeams/{teamId}` document is created
- [ ] Verify `tenantId` is stored in `slack_messages`

### Phase 3.2: User Mapping
- [ ] Send Slack message from user with matching email
- [ ] Verify `slackUsers/{slackUserId}` document is created
- [ ] Verify `hrxUserId` is populated automatically
- [ ] Verify `hrxUserId` is stored in `slack_messages`

### Phase 3.3: Channel Mapping
- [ ] Send DM in Slack
- [ ] Verify `slackChannels/{channelId}` document is created
- [ ] Verify DM is automatically mapped to HRX `internalDMs`
- [ ] Verify `hrxConversationId` is stored in `slack_messages`

### Phase 3.4: Message Integration
- [ ] Send fully mapped message (team + user + channel all mapped)
- [ ] Verify message appears in `internalMessages` subcollection
- [ ] Verify `unreadCounts` are incremented for recipient
- [ ] Verify top-bar 💬 badge updates (via existing `calculateUnreadCounts`)

### Phase 3.5: Admin UI
- [ ] Access Slack Mappings tab in tenant settings
- [ ] View list of unmapped Slack users
- [ ] Manually map a Slack user to HRX user
- [ ] View list of unmapped Slack channels
- [ ] Manually map a Slack channel to HRX conversation

---

## 11. Deployment Order

1. **Deploy helper functions** (`slackMapping.ts`, `slackMappingApi.ts`)
2. **Update `slackEvents.ts`** with Phase 3.1-3.4 logic
3. **Deploy updated function**
4. **Create Firestore indexes**
5. **Build and deploy frontend** (Phase 3.5 UI)
6. **Test end-to-end flow**

---

## 12. Notes

- **Backward Compatibility**: Keep writing to `slack_messages` root collection during migration
- **Performance**: Batch Firestore writes where possible
- **Error Handling**: Gracefully handle missing mappings (log warnings, don't crash)
- **Slack API Calls**: Use `SLACK_BOT_TOKEN` to fetch user/channel info when needed (rate-limited)
- **Deduplication**: Continue using `eventId` for message deduplication

---

**Ready to implement?** Start with Phase 3.1 (Team → Tenant Mapping) and proceed sequentially through the phases.




