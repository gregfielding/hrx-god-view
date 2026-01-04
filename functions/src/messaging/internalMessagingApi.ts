/**
 * Internal Messaging API
 * 
 * Handles Slack-style internal messaging (DMs and Channels).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  InternalMessage,
  DirectMessage,
  InternalChannel,
  getOrCreateDM,
  getOrCreateGroupDM,
  calculateUnreadCounts,
} from './internalMessaging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Get unread message counts for a user
 */
export const getInternalMessageCountsApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, userId } = request.data;
      
      if (!tenantId || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters: tenantId, userId');
      }
      
      // Verify user has access to this tenant
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }
      
      const counts = await calculateUnreadCounts(tenantId, userId);
      
      return {
        success: true,
        counts,
      };
    } catch (error: any) {
      logger.error('Error getting internal message counts:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to get message counts: ${error.message}`);
    }
  }
);

/**
 * Get direct messages for a user
 */
export const getDirectMessagesApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, userId } = request.data;
      
      if (!tenantId || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters: tenantId, userId');
      }
      
      // Get all DMs where user is participant
      const dmsQuery = await db.collection('tenants').doc(tenantId)
        .collection('internalDMs')
        .where('participants', 'array-contains', userId)
        .orderBy('lastMessageAt', 'desc')
        .limit(100)
        .get();
      
      const dms: DirectMessage[] = [];
      dmsQuery.docs.forEach(doc => {
        dms.push({
          id: doc.id,
          ...doc.data(),
        } as DirectMessage);
      });
      
      return {
        success: true,
        dms,
      };
    } catch (error: any) {
      logger.error('Error getting direct messages:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to get direct messages: ${error.message}`);
    }
  }
);

/**
 * Get channels for a user
 */
export const getChannelsApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, userId } = request.data;
      
      if (!tenantId || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters: tenantId, userId');
      }
      
      // Get all channels where user is member
      const channelsQuery = await db.collection('tenants').doc(tenantId)
        .collection('internalChannels')
        .where('memberIds', 'array-contains', userId)
        .orderBy('lastMessageAt', 'desc')
        .limit(100)
        .get();
      
      const channels: InternalChannel[] = [];
      channelsQuery.docs.forEach(doc => {
        channels.push({
          id: doc.id,
          ...doc.data(),
        } as InternalChannel);
      });
      
      return {
        success: true,
        channels,
      };
    } catch (error: any) {
      logger.error('Error getting channels:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to get channels: ${error.message}`);
    }
  }
);

/**
 * Get messages for a conversation (DM or Channel)
 */
export const getConversationMessagesApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, conversationType, conversationId, limit = 50 } = request.data;
      
      if (!tenantId || !conversationType || !conversationId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters');
      }
      
      // Verify user has access to this conversation
      const userId = request.auth?.uid;
      if (!userId) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
      }
      
      if (conversationType === 'dm') {
        const dmDoc = await db.collection('tenants').doc(tenantId)
          .collection('internalDMs').doc(conversationId).get();
        
        if (!dmDoc.exists) {
          throw new HttpsError('not-found', 'DM not found');
        }
        
        const dmData = dmDoc.data() as DirectMessage;
        if (!dmData.participants.includes(userId)) {
          throw new HttpsError('permission-denied', 'Access denied');
        }
      } else if (conversationType === 'channel') {
        const channelDoc = await db.collection('tenants').doc(tenantId)
          .collection('internalChannels').doc(conversationId).get();
        
        if (!channelDoc.exists) {
          throw new HttpsError('not-found', 'Channel not found');
        }
        
        const channelData = channelDoc.data() as InternalChannel;
        if (!channelData.memberIds.includes(userId)) {
          throw new HttpsError('permission-denied', 'Access denied');
        }
      }
      
      // Get messages (exclude deleted)
      const messagesQuery = await db.collection('tenants').doc(tenantId)
        .collection('internalMessages')
        .where('conversationType', '==', conversationType)
        .where('conversationId', '==', conversationId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      // Filter out deleted messages client-side
      const activeMessages = messagesQuery.docs.filter(doc => {
        const data = doc.data();
        return !data.deletedAt;
      });
      
      const messages: InternalMessage[] = [];
      activeMessages.forEach(doc => {
        messages.push({
          id: doc.id,
          ...doc.data(),
        } as InternalMessage);
      });
      
      // Reverse to show oldest first
      messages.reverse();
      
      return {
        success: true,
        messages,
      };
    } catch (error: any) {
      logger.error('Error getting conversation messages:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to get messages: ${error.message}`);
    }
  }
);

/**
 * Send an internal message
 */
export const sendInternalMessageApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, conversationType, conversationId, content, recipientIds } = request.data;
      const userId = request.auth?.uid;
      
      if (!tenantId || !conversationType || !content || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters');
      }
      
      // Get user info
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }
      
      const userData = userDoc.data();
      const userName = userData?.displayName || userData?.firstName || userData?.email || 'User';
      const userAvatar = userData?.avatarUrl;
      
      let finalConversationId = conversationId;
      
      // Handle DM creation if needed
      if (conversationType === 'dm') {
        if (!conversationId && recipientIds && recipientIds.length > 0) {
          // Create new DM
          if (recipientIds.length === 1) {
            finalConversationId = await getOrCreateDM(tenantId, userId, recipientIds[0]);
          } else {
            finalConversationId = await getOrCreateGroupDM(tenantId, [userId, ...recipientIds]);
          }
        }
        
        // Verify user has access
        const dmDoc = await db.collection('tenants').doc(tenantId)
          .collection('internalDMs').doc(finalConversationId).get();
        
        if (!dmDoc.exists) {
          throw new HttpsError('not-found', 'DM not found');
        }
        
        const dmData = dmDoc.data() as DirectMessage;
        if (!dmData.participants.includes(userId)) {
          throw new HttpsError('permission-denied', 'Access denied');
        }
      } else if (conversationType === 'channel') {
        // Verify user is member of channel
        const channelDoc = await db.collection('tenants').doc(tenantId)
          .collection('internalChannels').doc(finalConversationId).get();
        
        if (!channelDoc.exists) {
          throw new HttpsError('not-found', 'Channel not found');
        }
        
        const channelData = channelDoc.data() as InternalChannel;
        if (!channelData.memberIds.includes(userId)) {
          throw new HttpsError('permission-denied', 'Access denied');
        }
      }
      
      // Create message
      const messageRef = db.collection('tenants').doc(tenantId)
        .collection('internalMessages').doc();
      
      const message: InternalMessage = {
        id: messageRef.id,
        tenantId,
        conversationType,
        conversationId: finalConversationId,
        content,
        contentType: 'text',
        fromUserId: userId,
        fromUserName: userName,
        fromUserAvatar: userAvatar,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await messageRef.set(message);
      
      // Update conversation
      const now = admin.firestore.FieldValue.serverTimestamp();
      const contentSnippet = content.length > 100 ? content.substring(0, 100) + '...' : content;
      
      if (conversationType === 'dm') {
        const dmRef = db.collection('tenants').doc(tenantId)
          .collection('internalDMs').doc(finalConversationId);
        
        await dmRef.update({
          lastMessage: contentSnippet,
          lastMessageAt: now,
          lastMessageFrom: userName,
          lastMessageFromUserId: userId,
          updatedAt: now,
        });
        
        // Increment unread counts for all participants except sender
        const dmDoc = await dmRef.get();
        const dmData = dmDoc.data() as DirectMessage;
        const updates: any = {};
        
        dmData.participants.forEach(participantId => {
          if (participantId !== userId) {
            updates[`unreadCounts.${participantId}`] = admin.firestore.FieldValue.increment(1);
          }
        });
        
        if (Object.keys(updates).length > 0) {
          await dmRef.update(updates);
        }
      } else if (conversationType === 'channel') {
        const channelRef = db.collection('tenants').doc(tenantId)
          .collection('internalChannels').doc(finalConversationId);
        
        await channelRef.update({
          lastMessage: contentSnippet,
          lastMessageAt: now,
          lastMessageFrom: userName,
          lastMessageFromUserId: userId,
          updatedAt: now,
        });
        
        // Increment unread counts for all members except sender
        const channelDoc = await channelRef.get();
        const channelData = channelDoc.data() as InternalChannel;
        const updates: any = {};
        
        channelData.memberIds.forEach(memberId => {
          if (memberId !== userId) {
            updates[`unreadCounts.${memberId}`] = admin.firestore.FieldValue.increment(1);
          }
        });
        
        if (Object.keys(updates).length > 0) {
          await channelRef.update(updates);
        }
      }
      
      return {
        success: true,
        messageId: messageRef.id,
        message: {
          ...message,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        },
      };
    } catch (error: any) {
      logger.error('Error sending internal message:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to send message: ${error.message}`);
    }
  }
);

/**
 * Mark messages as read
 */
export const markInternalMessagesReadApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, conversationType, conversationId, lastReadMessageId } = request.data;
      const userId = request.auth?.uid;
      
      if (!tenantId || !conversationType || !conversationId || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters');
      }
      
      // Reset unread count for this conversation
      if (conversationType === 'dm') {
        const dmRef = db.collection('tenants').doc(tenantId)
          .collection('internalDMs').doc(conversationId);
        
        await dmRef.update({
          [`unreadCounts.${userId}`]: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (conversationType === 'channel') {
        const channelRef = db.collection('tenants').doc(tenantId)
          .collection('internalChannels').doc(conversationId);
        
        await channelRef.update({
          [`unreadCounts.${userId}`]: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      
      // Optionally mark individual messages as read (for future read receipts)
      if (lastReadMessageId) {
        // This would create read tracking documents
        // For now, we just reset the unread count
      }
      
      return {
        success: true,
      };
    } catch (error: any) {
      logger.error('Error marking messages as read:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to mark messages as read: ${error.message}`);
    }
  }
);

/**
 * Create a new channel
 */
export const createChannelApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, name, description, isPrivate, memberIds } = request.data;
      const userId = request.auth?.uid;
      
      if (!tenantId || !name || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters: tenantId, name');
      }
      
      // Validate channel name (alphanumeric, hyphens, underscores)
      if (!/^[a-z0-9-_]+$/.test(name.toLowerCase())) {
        throw new HttpsError('invalid-argument', 'Channel name must be alphanumeric with hyphens or underscores only');
      }
      
      // Check if channel already exists
      const existingChannelQuery = await db.collection('tenants').doc(tenantId)
        .collection('internalChannels')
        .where('name', '==', name.toLowerCase())
        .get();
      
      if (!existingChannelQuery.empty) {
        throw new HttpsError('already-exists', 'Channel with this name already exists');
      }
      
      // Get user info
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }
      
      const userData = userDoc.data();
      const userName = userData?.displayName || userData?.firstName || userData?.email || 'User';
      
      // Create channel
      const channelRef = db.collection('tenants').doc(tenantId)
        .collection('internalChannels').doc();
      
      const allMembers = [userId, ...(memberIds || [])];
      const unreadCounts: { [userId: string]: number } = {};
      allMembers.forEach(id => {
        unreadCounts[id] = 0;
      });
      
      const channel: InternalChannel = {
        id: channelRef.id,
        tenantId,
        name: name.toLowerCase(),
        description: description || '',
        isPrivate: isPrivate || false,
        memberIds: allMembers,
        memberCount: allMembers.length,
        createdBy: userId,
        createdByName: userName,
        unreadCounts,
        mutedBy: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await channelRef.set(channel);
      
      return {
        success: true,
        channelId: channelRef.id,
        channel: {
          ...channel,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        },
      };
    } catch (error: any) {
      logger.error('Error creating channel:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to create channel: ${error.message}`);
    }
  }
);

/**
 * Add or remove reaction to a message
 */
export const addReactionToMessageApi = onCall(
  {
    cors: true,
  },
  async (request) => {
    try {
      const { tenantId, messageId, emoji } = request.data;
      const userId = request.auth?.uid;

      if (!tenantId || !messageId || !emoji || !userId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters');
      }

      // Get message document
      const messageRef = db.collection('tenants').doc(tenantId)
        .collection('internalMessages').doc(messageId);
      
      const messageDoc = await messageRef.get();
      if (!messageDoc.exists) {
        throw new HttpsError('not-found', 'Message not found');
      }

      const messageData = messageDoc.data() as InternalMessage;
      const reactions = messageData.reactions || [];

      // Check if user already reacted with this emoji
      const existingReactionIndex = reactions.findIndex(
        (r) => r.emoji === emoji && r.userId === userId
      );

      if (existingReactionIndex >= 0) {
        // Remove reaction
        reactions.splice(existingReactionIndex, 1);
      } else {
        // Add reaction
        reactions.push({ emoji, userId });
      }

      // Update message
      await messageRef.update({
        reactions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        reactions,
      };
    } catch (error: any) {
      logger.error('Error adding reaction to message:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', `Failed to add reaction: ${error.message}`);
    }
  }
);

