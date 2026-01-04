/**
 * Slack Mapping API Functions
 * 
 * Provides callable functions for manually managing Slack → HRX mappings
 * from the admin UI.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Update Slack user mapping
 * 
 * Allows admins to manually link a Slack user to an HRX user.
 */
export const updateSlackUserMappingApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    const { tenantId, slackUserId, hrxUserId } = request.data;
    const userId = request.auth?.uid;

    if (!userId) {
      throw new Error('Unauthorized');
    }

    if (!tenantId || !slackUserId) {
      throw new Error('Missing required fields: tenantId, slackUserId');
    }

    // Verify user has admin access to tenant
    // TODO: Add proper tenant access validation
    // For now, we'll just check if the user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    // If hrxUserId is provided, verify it exists
    if (hrxUserId) {
      const hrxUserDoc = await db.collection('users').doc(hrxUserId).get();
      if (!hrxUserDoc.exists) {
        throw new Error('HRX user not found');
      }
    }

    // Update or create slackUsers doc
    const slackUserRef = db.collection('tenants').doc(tenantId)
      .collection('slackUsers').doc(slackUserId);

    const updateData: any = {
      manualLinked: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Get existing slackUser data for reference
    const existingSlackUserDoc = await slackUserRef.get();
    const existingData = existingSlackUserDoc.data() || {};
    
    if (hrxUserId) {
      updateData.hrxUserId = hrxUserId;
      updateData.mappedAt = admin.firestore.FieldValue.serverTimestamp();
      
      // Get HRX user data for display
      const hrxUserDoc = await db.collection('users').doc(hrxUserId).get();
      const tenantUserRef = db.collection('tenants').doc(tenantId)
        .collection('users').doc(hrxUserId);
      
      if (hrxUserDoc.exists) {
        const hrxUserData = hrxUserDoc.data();
        const displayName = hrxUserData?.displayName || 
          `${hrxUserData?.firstName || ''} ${hrxUserData?.lastName || ''}`.trim() || 
          hrxUserData?.email?.split('@')[0] || 'Unknown';
        const realName = hrxUserData?.firstName && hrxUserData?.lastName 
          ? `${hrxUserData.firstName} ${hrxUserData.lastName}` 
          : displayName;
        
        updateData.displayName = displayName;
        updateData.realName = realName;
        updateData.avatar = hrxUserData?.avatar || hrxUserData?.avatarUrl;
        
        // Update user.integrations.slack in a transaction
        await db.runTransaction(async (tx) => {
          // Update slackUsers doc
          tx.set(slackUserRef, updateData, { merge: true });
          
          // Update user.integrations.slack
          const integrationUpdate = {
            integrations: {
              slack: {
                teamId: existingData.slackTeamId || existingData.teamId || null,
                slackUserId,
                slackEmail: existingData.email || hrxUserData?.email || null,
                displayName: displayName || realName,
                username: hrxUserData?.email?.split('@')[0] || null,
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
          const rootUserRef = db.collection('users').doc(hrxUserId);
          const rootUserSnap = await tx.get(rootUserRef);
          if (rootUserSnap.exists) {
            tx.set(rootUserRef, integrationUpdate, { merge: true });
          }
        });
      } else {
        // HRX user not found, just update slackUsers doc
        await slackUserRef.set(updateData, { merge: true });
      }
    } else {
      // Remove mapping
      updateData.hrxUserId = admin.firestore.FieldValue.delete();
      updateData.mappedAt = admin.firestore.FieldValue.delete();
      
      await slackUserRef.set(updateData, { merge: true });
      
      // Note: We don't remove integrations.slack from user docs when unmapping,
      // as it might be useful to keep the historical link. If you want to remove it,
      // you can add that logic here.
    }

    logger.info(`Updated Slack user mapping: ${slackUserId} → ${hrxUserId || 'unmapped'}`);

    return { success: true };
  }
);

/**
 * Update Slack channel mapping
 * 
 * Allows admins to manually link a Slack channel to an HRX conversation.
 */
export const updateSlackChannelMappingApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    const {
      tenantId,
      channelId,
      hrxConversationType,
      hrxConversationId,
      dealId,
      customerId,
      jobId,
    } = request.data;
    const userId = request.auth?.uid;

    if (!userId) {
      throw new Error('Unauthorized');
    }

    if (!tenantId || !channelId) {
      throw new Error('Missing required fields: tenantId, channelId');
    }

    // Verify user has admin access to tenant
    // TODO: Add proper tenant access validation
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    // Verify conversation exists if provided
    if (hrxConversationId && hrxConversationType) {
      const conversationRef = hrxConversationType === 'dm'
        ? db.collection('tenants').doc(tenantId)
            .collection('internalDMs').doc(hrxConversationId)
        : db.collection('tenants').doc(tenantId)
            .collection('internalChannels').doc(hrxConversationId);

      const conversationDoc = await conversationRef.get();
      if (!conversationDoc.exists) {
        throw new Error('HRX conversation not found');
      }
    }

    const updateData: any = {
      manualLinked: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (hrxConversationType && hrxConversationId) {
      updateData.hrxConversationType = hrxConversationType;
      updateData.hrxConversationId = hrxConversationId;
      updateData.mappedAt = admin.firestore.FieldValue.serverTimestamp();

      if (dealId) updateData.dealId = dealId;
      if (customerId) updateData.customerId = customerId;
      if (jobId) updateData.jobId = jobId;
    } else {
      // Remove mapping
      updateData.hrxConversationType = admin.firestore.FieldValue.delete();
      updateData.hrxConversationId = admin.firestore.FieldValue.delete();
      updateData.mappedAt = admin.firestore.FieldValue.delete();
      updateData.dealId = admin.firestore.FieldValue.delete();
      updateData.customerId = admin.firestore.FieldValue.delete();
      updateData.jobId = admin.firestore.FieldValue.delete();
    }

    await db.collection('tenants').doc(tenantId)
      .collection('slackChannels').doc(channelId)
      .set(updateData, { merge: true });

    logger.info(`Updated Slack channel mapping: ${channelId} → ${hrxConversationType}/${hrxConversationId || 'unmapped'}`);

    return { success: true };
  }
);

/**
 * Get Slack mappings for a tenant
 * 
 * Returns all Slack user and channel mappings for admin UI.
 */
export const getSlackMappingsApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    const { tenantId } = request.data;
    const userId = request.auth?.uid;

    if (!userId) {
      throw new Error('Unauthorized');
    }

    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }

    // Verify user has admin access to tenant
    // TODO: Add proper tenant access validation
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    // Get all Slack users
    const slackUsersSnapshot = await db.collection('tenants').doc(tenantId)
      .collection('slackUsers')
      .get();

    const slackUsers = slackUsersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Get all Slack channels
    const slackChannelsSnapshot = await db.collection('tenants').doc(tenantId)
      .collection('slackChannels')
      .get();

    const slackChannels = slackChannelsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return {
      users: slackUsers,
      channels: slackChannels,
    };
  }
);

