/**
 * Feed Create Post Cloud Function
 * 
 * Creates a feed post with mention parsing and optional Slack posting.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { createNotification } from '../utils/createNotification';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Slack bot token from Secret Manager
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

interface FeedCreatePostRequest {
  tenantId: string;
  body: string;
  targetChannelId?: string;
  visibility: 'tenant' | 'team' | 'private';
}

interface FeedCreatePostResponse {
  postId: string;
}

/**
 * Resolve a mention token to an entity
 */
async function resolveMentionEntity(
  prefix: '@' | '#' | '&' | '%' | '!' | '^' | '*' | '~',
  token: string,
  tenantId: string
): Promise<{ id: string; label: string; type: 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task' | 'worker' } | null> {
  const searchTerm = token.toLowerCase().trim();
  
  switch (prefix) {
    case '@': {
      // Search internal team (securityLevel 5-7)
      const usersQuery = await db.collection('users').limit(500).get();
      for (const doc of usersQuery.docs) {
        const data = doc.data();
        const userTenantIds = data?.tenantIds || {};
        const isInTenant = 
          !!userTenantIds[tenantId] || 
          data?.activeTenantId === tenantId || 
          data?.tenantId === tenantId;
        
        if (!isInTenant) continue;
        
        // Get security level from tenant-specific data or global
        const userTenantData = userTenantIds[tenantId];
        const securityLevel = userTenantData?.securityLevel || data?.securityLevel;
        const securityLevelNum = parseInt(securityLevel || '0', 10);
        
        // Only include internal team (securityLevel 5-7)
        if (securityLevelNum < 5 || securityLevelNum > 7) {
          continue;
        }
        
        const email = (data?.email || '').toLowerCase();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const displayName = (data?.displayName || '').toLowerCase();
        const username = email.split('@')[0] || '';
        
        if (
          username.startsWith(searchTerm) ||
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          displayName.startsWith(searchTerm) ||
          email.startsWith(searchTerm)
        ) {
          return {
            id: doc.id,
            label: displayName || `${data?.firstName || ''} ${data?.lastName || ''}`.trim() || email.split('@')[0] || 'Unknown',
            type: 'user',
          };
        }
      }
      break;
    }
    
    case '#': {
      // Search contacts
      const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
      const contactsQuery = await contactsRef.limit(100).get();
      
      for (const doc of contactsQuery.docs) {
        const data = doc.data();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
        const email = (data?.email || '').toLowerCase();
        
        if (
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          fullName.toLowerCase().startsWith(searchTerm) ||
          email.startsWith(searchTerm)
        ) {
          return {
            id: doc.id,
            label: fullName || email || 'Unnamed Contact',
            type: 'contact',
          };
        }
      }
      break;
    }
    
    case '&': {
      // Search workers (securityLevel 1-4)
      const usersQuery = await db.collection('users').limit(500).get();
      
      for (const doc of usersQuery.docs) {
        const data = doc.data();
        const userTenantIds = data?.tenantIds || {};
        const isInTenant = 
          !!userTenantIds[tenantId] || 
          data?.activeTenantId === tenantId || 
          data?.tenantId === tenantId;
        
        if (!isInTenant) continue;
        
        // Get security level from tenant-specific data or global
        const userTenantData = userTenantIds[tenantId];
        const securityLevel = userTenantData?.securityLevel || data?.securityLevel;
        const securityLevelNum = parseInt(securityLevel || '0', 10);
        
        // Only include workers (securityLevel 1-4)
        if (securityLevelNum < 1 || securityLevelNum > 4) {
          continue;
        }
        
        const email = (data?.email || '').toLowerCase();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const displayName = (data?.displayName || '').toLowerCase();
        const username = email.split('@')[0] || '';
        
        if (
          username.startsWith(searchTerm) ||
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          displayName.startsWith(searchTerm) ||
          email.startsWith(searchTerm)
        ) {
          return {
            id: doc.id,
            label: displayName || `${data?.firstName || ''} ${data?.lastName || ''}`.trim() || email.split('@')[0] || 'Unknown',
            type: 'worker',
          };
        }
      }
      break;
    }
    
    case '%': {
      // Search deals
      const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
      const dealsQuery = await dealsRef.limit(100).get();
      
      for (const doc of dealsQuery.docs) {
        const data = doc.data();
        const dealName = (data?.dealName || data?.name || '').toLowerCase();
        const companyName = (data?.companyName || '').toLowerCase();
        
        if (
          dealName.startsWith(searchTerm) ||
          dealName.includes(searchTerm) ||
          companyName.includes(searchTerm)
        ) {
          return {
            id: doc.id,
            label: data?.dealName || data?.name || 'Unnamed Deal',
            type: 'deal',
          };
        }
      }
      break;
    }
    
    case '!': {
      // Search jobs
      const jobsRef = db.collection('tenants').doc(tenantId).collection('jobOrders');
      const jobsQuery = await jobsRef.limit(100).get();
      
      for (const doc of jobsQuery.docs) {
        const data = doc.data();
        const jobTitle = (data?.jobTitle || data?.title || data?.name || '').toLowerCase();
        
        if (jobTitle.startsWith(searchTerm) || jobTitle.includes(searchTerm)) {
          return {
            id: doc.id,
            label: data?.jobTitle || data?.title || data?.name || 'Unnamed Job',
            type: 'job',
          };
        }
      }
      break;
    }
    
    case '^': {
      // Search candidates
      const candidatesRef = db.collection('tenants').doc(tenantId).collection('candidates');
      const candidatesQuery = await candidatesRef.limit(100).get();
      
      for (const doc of candidatesQuery.docs) {
        const data = doc.data();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim().toLowerCase();
        const email = (data?.email || '').toLowerCase();
        
        if (
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          fullName.startsWith(searchTerm) ||
          email.startsWith(searchTerm)
        ) {
          return {
            id: doc.id,
            label: fullName || email || 'Unnamed Candidate',
            type: 'candidate',
          };
        }
      }
      break;
    }
    
    case '*': {
      // Search locations
      const locationsRef = db.collection('tenants').doc(tenantId).collection('locations');
      const locationsQuery = await locationsRef.limit(100).get();
      
      for (const doc of locationsQuery.docs) {
        const data = doc.data();
        const locationName = (data?.name || data?.locationName || '').toLowerCase();
        
        if (locationName.startsWith(searchTerm) || locationName.includes(searchTerm)) {
          return {
            id: doc.id,
            label: data?.name || data?.locationName || 'Unnamed Location',
            type: 'location',
          };
        }
      }
      break;
    }
    
    case '~': {
      // Search tasks
      const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');
      const tasksQuery = await tasksRef.limit(100).get();
      
      for (const doc of tasksQuery.docs) {
        const data = doc.data();
        const taskTitle = (data?.title || data?.name || '').toLowerCase();
        
        if (taskTitle.startsWith(searchTerm) || taskTitle.includes(searchTerm)) {
          return {
            id: doc.id,
            label: data?.title || data?.name || 'Unnamed Task',
            type: 'task',
          };
        }
      }
      break;
    }
  }
  
  return null;
}

/**
 * Parse mentions from text
 */
async function parseMentions(
  text: string,
  tenantId: string
): Promise<Array<{ type: 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task' | 'worker'; id: string; label: string }>> {
  const MENTION_REGEX = /([@#&%!^*~])([^\s.,!?]+)/g;
  const mentions: Array<{ type: 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task' | 'worker'; id: string; label: string }> = [];
  const seen = new Set<string>();
  
  let match;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1] as '@' | '#' | '&' | '%' | '!' | '^' | '*' | '~';
    const token = match[2];
    const key = `${prefix}${token}`;
    
    if (seen.has(key)) continue;
    seen.add(key);
    
    const entity = await resolveMentionEntity(prefix, token, tenantId);
    if (entity) {
      mentions.push(entity);
    }
  }
  
  return mentions;
}

/**
 * Post message to Slack channel
 */
async function postToSlack(
  channelId: string,
  text: string,
  tenantId: string
): Promise<{ slackChannelId: string; slackTs: string } | null> {
  try {
    // Get bot token
    let botToken: string;
    try {
      botToken = SLACK_BOT_TOKEN.value();
    } catch (err) {
      // Try fallback from integrations collection
      const integrationsDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('integrations')
        .doc('slack')
        .get();
      
      if (integrationsDoc.exists) {
        const integrationData = integrationsDoc.data();
        botToken = integrationData?.botToken;
      }
      
      if (!botToken) {
        logger.warn('Slack bot token not found, skipping Slack post');
        return null;
      }
    }
    
    // Post to Slack
    const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text: text.trim(),
        metadata: {
          event_type: 'hrx_feed_post',
        },
      }),
    });
    
    const slackData = await slackResponse.json();
    
    if (!slackData.ok) {
      logger.error('Slack chat.postMessage error', {
        error: slackData.error,
        channelId,
        tenantId,
      });
      return null;
    }
    
    const messageTs = slackData.ts || slackData.message?.ts;
    if (!messageTs) {
      logger.warn('Slack API did not return message timestamp');
      return null;
    }
    
    return {
      slackChannelId: channelId,
      slackTs: messageTs,
    };
  } catch (error: any) {
    logger.error('Error posting to Slack:', error);
    return null;
  }
}

/**
 * Create a feed post
 */
export const feedCreatePost = onCall(
  {
    secrets: [SLACK_BOT_TOKEN],
    cors: true,
  },
  async (request): Promise<FeedCreatePostResponse> => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const { tenantId, body, targetChannelId, visibility } = request.data as FeedCreatePostRequest;

    if (!tenantId || !body || !body.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId and body are required');
    }

    if (!['tenant', 'team', 'private'].includes(visibility)) {
      throw new HttpsError('invalid-argument', 'visibility must be tenant, team, or private');
    }

    try {
      // 1. Verify tenant access
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data();
      const userTenantIds = userData?.tenantIds || {};
      const isInTenant = 
        !!userTenantIds[tenantId] || 
        userData?.activeTenantId === tenantId || 
        userData?.tenantId === tenantId;
      
      if (!isInTenant) {
        throw new HttpsError('permission-denied', 'User does not have access to this tenant');
      }

      // 2. Parse mentions from text
      const mentions = await parseMentions(body, tenantId);
      
      logger.info('Parsed mentions', {
        tenantId,
        userId,
        mentionCount: mentions.length,
      });

      // 3. Build feed post document
      const now = admin.firestore.Timestamp.now();
      const postRef = db.collection('tenants').doc(tenantId).collection('feed_posts').doc();
      
      const postData: any = {
        id: postRef.id,
        tenantId,
        authorId: userId,
        body: body.trim(),
        mentions: mentions.map(m => ({
          type: m.type,
          id: m.id,
          label: m.label,
        })),
        visibility,
        targetChannelId: targetChannelId || null,
        createdAt: now,
        updatedAt: now,
      };

      // 4. Post to Slack if targetChannelId is provided
      if (targetChannelId) {
        const slackResult = await postToSlack(targetChannelId, body, tenantId);
        if (slackResult) {
          postData.slackChannelId = slackResult.slackChannelId;
          postData.slackTs = slackResult.slackTs;
        }
      }

      // 5. Save feed post
      await postRef.set(postData);

      // 6. Create mentions_index entries and notifications
      if (mentions.length > 0) {
        const batch = db.batch();
        const notificationPromises: Promise<void>[] = [];
        
        // Get author info for notifications
        const authorDoc = await db.collection('users').doc(userId).get();
        const authorData = authorDoc.data();
        const authorName = authorData?.displayName || 
          `${authorData?.firstName || ''} ${authorData?.lastName || ''}`.trim() ||
          authorData?.email?.split('@')[0] ||
          'Someone';

        for (const mention of mentions) {
          const indexRef = db
            .collection('tenants')
            .doc(tenantId)
            .collection('mentions_index')
            .doc();
          
          batch.set(indexRef, {
            mentionType: mention.type,
            mentionId: mention.id,
            refType: 'feed_post',
            refId: postRef.id,
            createdAt: now,
            tenantId, // For easier querying
            userId: mention.type === 'user' ? mention.id : null, // For user-specific queries
          });

          // Create notification for user mentions (skip self-mentions)
          if (mention.type === 'user' && mention.id !== userId) {
            const postPreview = body.length > 100 ? body.substring(0, 100) + '...' : body;
            const notificationMessage = `${authorName} mentioned you in a post: "${postPreview}"`;

            notificationPromises.push(
              createNotification({
                recipientType: 'user',
                recipientId: mention.id,
                type: 'mention',
                message: notificationMessage,
                relatedId: postRef.id,
                status: 'unread',
              }).catch((err) => {
                logger.warn(`Failed to create notification for mention ${mention.id}:`, err);
              })
            );
          }
        }
        await batch.commit();

        // Send notifications in parallel (don't block on failures)
        await Promise.allSettled(notificationPromises);
      }

      logger.info('Feed post created successfully', {
        postId: postRef.id,
        tenantId,
        userId,
        mentionCount: mentions.length,
        postedToSlack: !!postData.slackTs,
      });

      return {
        postId: postRef.id,
      };
    } catch (error: any) {
      logger.error('Error creating feed post', {
        error: error.message,
        stack: error.stack,
        tenantId,
        userId,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', `Failed to create post: ${error.message}`);
    }
  }
);

