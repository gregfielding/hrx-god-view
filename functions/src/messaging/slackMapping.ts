/**
 * Slack → HRX Mapping Helpers
 * 
 * Provides functions to map Slack teams, users, and channels to HRX tenants, users, and conversations.
 * Uses `/tenants/{tenantId}/...` structure.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ============================================================================
// Security Level Helpers
// ============================================================================

export interface TenantMembershipSettings {
  addedAt?: admin.firestore.Timestamp;
  crm_sales?: boolean;
  department?: string;
  departmentId?: string;
  divisionId?: string;
  employmentType?: string;
  securityLevel?: string | number; // "1"–"7" or 1–7
  role?: string;
  // extendable
}

export interface UserDoc {
  activeTenantId?: string;
  securityLevel?: string | number; // legacy global
  role?: string;
  tenantIds?: {
    [tenantId: string]: TenantMembershipSettings;
  };
  // plus any other existing fields (email, displayName, etc.)
  [key: string]: any;
}

// Minimal level required for Slack access
export const MIN_SLACK_SECURITY_LEVEL = 5;

// Normalize "7" | 7 | undefined → number (default 1)
export function normalizeSecurityLevel(level: string | number | undefined | null): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return level;

  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7); // clamp 1..7
}

/**
 * Returns the **effective** security level for the user's active tenant.
 *
 * Priority:
 *   1) tenantIds[activeTenantId].securityLevel
 *   2) legacy user.securityLevel
 *   3) default 1
 */
export function getSecurityLevelForActiveTenant(user: UserDoc): number {
  const activeTenantId = user.activeTenantId;
  if (!activeTenantId) {
    return normalizeSecurityLevel(user.securityLevel);
  }

  const tenantSettings = user.tenantIds?.[activeTenantId];
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }

  // fallback: legacy global security
  return normalizeSecurityLevel(user.securityLevel);
}

/**
 * Returns true if the user is allowed to use Slack (DMs + channels)
 * for their current active tenant.
 */
export function canUserAccessSlack(user: UserDoc): boolean {
  const level = getSecurityLevelForActiveTenant(user);
  return level >= MIN_SLACK_SECURITY_LEVEL;
}

// ============================================================================
// Phase 3.1: Team → Tenant Mapping
// ============================================================================

/**
 * Get tenantId from Slack team_id
 * 
 * Checks slackTeams collection first, then tries to find via integrations.
 * Creates mapping if found via integrations.
 */
export async function getTenantIdFromSlackTeam(teamId: string): Promise<string | null> {
  try {
    // Check slackTeams collection (root-level for now)
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

// ============================================================================
// Phase 3.2: User Mapping
// ============================================================================

/**
 * Map Slack user to HRX user
 * 
 * Returns mapping info including security level and Slack access eligibility.
 * 
 * 1. Check if slackUsers doc exists in /tenants/{tenantId}/slackUsers/{slackUserId}
 * 2. If exists and has hrxUserId, return it with security info
 * 3. If not, try to match by email
 * 4. Create/update slackUsers doc with security level
 */
export interface SlackUserMappingResult {
  hrxUserId: string | null;
  securityLevel: number;
  canAccessSlack: boolean;
}

export async function mapSlackUserToHRXUser(
  tenantId: string,
  slackUserId: string,
  slackTeamId: string,
  slackEmail?: string,
  slackDisplayName?: string
): Promise<SlackUserMappingResult> {
  try {
    const slackUserRef = db.collection('tenants').doc(tenantId)
      .collection('slackUsers').doc(slackUserId);
    
    const slackUserDoc = await slackUserRef.get();
    
    // If exists and already mapped, return hrxUserId with security info
    if (slackUserDoc.exists) {
      const data = slackUserDoc.data();
      if (data?.hrxUserId) {
        // Fetch user doc to get current security level
        const userDoc = await db.collection('users').doc(data.hrxUserId).get();
        let securityLevel = 1;
        let canAccess = false;
        
        if (userDoc.exists) {
          const userData = userDoc.data() as UserDoc;
          securityLevel = getSecurityLevelForActiveTenant(userData);
          canAccess = canUserAccessSlack(userData);
        }
        
        // Update lastSeenAt and security info
        await slackUserRef.update({
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          securityLevel,
          canAccessSlack: canAccess,
        });
        
        return {
          hrxUserId: data.hrxUserId,
          securityLevel,
          canAccessSlack: canAccess,
        };
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
        const userData = usersQuery.docs[0].data() as UserDoc;
        
        // Get security level for this user
        const securityLevel = getSecurityLevelForActiveTenant(userData);
        const canAccess = canUserAccessSlack(userData);
        
        const displayName = slackDisplayName || userData.displayName || userData.firstName || slackEmail.split('@')[0];
        const realName = userData.firstName && userData.lastName 
          ? `${userData.firstName} ${userData.lastName}` 
          : slackDisplayName;
        
        // Update both slackUsers doc and user.integrations.slack in a transaction
        const userRef = db.collection('users').doc(hrxUserId);
        const tenantUserRef = db.collection('tenants').doc(tenantId)
          .collection('users').doc(hrxUserId);
        
        await db.runTransaction(async (tx) => {
          // 1. Update or create slackUsers doc with security info
          tx.set(slackUserRef, {
            id: slackUserId,
            tenantId,
            slackTeamId,
            hrxUserId,
            email: slackEmail,
            displayName,
            realName,
            avatar: userData.avatar || userData.avatarUrl,
            isBot: false,
            isDeleted: false,
            autoLinked: true,
            manualLinked: false,
            securityLevel,
            canAccessSlack: canAccess,
            mappedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: slackUserDoc.exists 
              ? slackUserDoc.data()?.createdAt 
              : admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          
          // 2. Update user.integrations.slack (only if user can access Slack)
          if (canAccess) {
            const integrationUpdate = {
              integrations: {
                slack: {
                  teamId: slackTeamId,
                  slackUserId,
                  slackEmail: slackEmail,
                  displayName: displayName || realName,
                  username: slackEmail?.split('@')[0] || null,
                  linkedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
              },
            };
            
            // Update tenant-scoped user doc if it exists
            const tenantUserSnap = await tx.get(tenantUserRef);
            if (tenantUserSnap.exists) {
              tx.set(tenantUserRef, integrationUpdate, { merge: true });
            }
            
            // Also update root users collection for backward compatibility
            const rootUserSnap = await tx.get(userRef);
            if (rootUserSnap.exists) {
              tx.set(userRef, integrationUpdate, { merge: true });
            }
          }
        });
        
        logger.info(`Mapped Slack user ${slackUserId} → HRX user ${hrxUserId} (email: ${slackEmail}, securityLevel: ${securityLevel}, canAccessSlack: ${canAccess})`);
        return {
          hrxUserId,
          securityLevel,
          canAccessSlack: canAccess,
        };
      }
    }
    
    // Create slackUsers doc without hrxUserId (manual mapping later)
    if (!slackUserDoc.exists) {
      await slackUserRef.set({
        id: slackUserId,
        tenantId,
        slackTeamId,
        email: slackEmail,
        displayName: slackDisplayName || slackEmail?.split('@')[0] || 'Unknown',
        isBot: false,
        isDeleted: false,
        autoLinked: false,
        manualLinked: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      logger.info(`Created slackUsers doc for ${slackUserId} (no HRX user match)`);
    }
    
    return {
      hrxUserId: null,
      securityLevel: 1,
      canAccessSlack: false,
    };
  } catch (error: any) {
    logger.error(`Error mapping Slack user ${slackUserId} to HRX user:`, error);
    return {
      hrxUserId: null,
      securityLevel: 1,
      canAccessSlack: false,
    };
  }
}

/**
 * Fetch Slack user info from Slack API
 * 
 * Uses SLACK_BOT_TOKEN to fetch user email and display name.
 */
export async function fetchSlackUserInfo(
  slackUserId: string,
  botToken: string
): Promise<{ email?: string; displayName?: string } | null> {
  try {
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

// ============================================================================
// Phase 3.3: Channel Mapping
// ============================================================================

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
          autoLinked: true,
          manualLinked: false,
          mappedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: channelDoc.exists 
            ? channelDoc.data()?.createdAt 
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        
        logger.info(`Mapped Slack DM ${channelId} → HRX DM ${dmId}`);
        return { conversationType: 'dm', conversationId: dmId };
      } else {
        logger.warn(`Cannot map Slack DM ${channelId}: missing HRX user mappings (user1: ${hrxUserId1}, user2: ${hrxUserId2})`);
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
        autoLinked: false,
        manualLinked: false,
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

// ============================================================================
// Phase 3.4: Unread Counts
// ============================================================================

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
          // Don't increment if user muted this channel
          if (!conversationData?.mutedBy?.includes(memberId)) {
            updates[`unreadCounts.${memberId}`] = admin.firestore.FieldValue.increment(1);
          }
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
