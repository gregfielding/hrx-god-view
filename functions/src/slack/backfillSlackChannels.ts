/**
 * Backfill Slack Channels
 * 
 * Callable function to sync all Slack channels from a workspace into Firestore.
 * Requires securityLevel >= 7 for the active tenant.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Slack bot token from Secret Manager
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

interface SlackConversation {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  created?: number;
}

interface SlackConversationsListResponse {
  ok: boolean;
  channels?: SlackConversation[];
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

/**
 * Normalize security level to a number (1-7)
 */
function normalizeSecurityLevel(level: string | number | undefined | null): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return level;
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

/**
 * Get effective security level for user's active tenant
 */
function getSecurityLevelForActiveTenant(user: any): number {
  const activeTenantId = user.activeTenantId;
  if (!activeTenantId) {
    return normalizeSecurityLevel(user.securityLevel);
  }

  const tenantSettings = user.tenantIds?.[activeTenantId];
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }

  return normalizeSecurityLevel(user.securityLevel);
}

export const backfillSlackChannels = onCall(
  {
    secrets: [SLACK_BOT_TOKEN],
    cors: true,
    invoker: 'public', // Allow unauthenticated CORS preflight requests
    maxInstances: 2,
  },
  async (request) => {
    // 1. Auth & basic checks
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const tenantId: string | undefined = request.data?.tenantId;
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    // 2. Load user doc and validate securityLevel for active tenant
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }

    const user = userSnap.data();
    const activeTenantId: string = user?.activeTenantId;
    const tenantSettings = user?.tenantIds?.[activeTenantId];

    const securityLevel = getSecurityLevelForActiveTenant(user);

    // Require high-level admin to run the backfill
    if (activeTenantId !== tenantId || securityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions to backfill Slack channels. Requires security level 7.'
      );
    }

    // 3. Resolve Slack workspace (slackTeams or integrations)
    logger.info(`Looking for Slack workspace for tenant: ${tenantId}`);
    let slackTeam: any = null;
    let teamId: string | undefined;
    let botToken: string | undefined;
    
    // First try: Check slackTeams collection (doc ID = tenantId)
    logger.info(`Checking slackTeams collection (doc ID = ${tenantId})`);
    const teamByTenant = await db.collection('slackTeams').doc(tenantId).get();
    if (teamByTenant.exists) {
      const data = teamByTenant.data();
      logger.info(`Found slackTeams doc by tenantId, status: ${data?.status}`);
      if (data?.status === 'active') {
        slackTeam = data;
        teamId = data.teamId;
        botToken = data.botToken;
        logger.info(`Using slackTeams doc, teamId: ${teamId}, hasBotToken: ${!!botToken}`);
      }
    } else {
      logger.info(`No slackTeams doc found with ID = ${tenantId}`);
    }

    // Second try: Query slackTeams by tenantId field
    if (!slackTeam) {
      logger.info(`Querying slackTeams collection by tenantId field`);
      const teamsQuery = await db
        .collection('slackTeams')
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

      if (!teamsQuery.empty) {
        slackTeam = teamsQuery.docs[0].data();
        teamId = slackTeam.teamId;
        botToken = slackTeam.botToken;
        logger.info(`Found slackTeams doc via query, teamId: ${teamId}, hasBotToken: ${!!botToken}`);
      } else {
        logger.info(`No slackTeams docs found via query for tenantId: ${tenantId}`);
      }
    }

    // Third try: Check integrations collection and create slackTeams doc if found
    if (!slackTeam) {
      logger.info(`Checking integrations collection: tenants/${tenantId}/integrations/slack`);
      const integrationsDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('integrations')
        .doc('slack')
        .get();
      
      logger.info(`Integrations doc exists: ${integrationsDoc.exists}`);
      
      if (integrationsDoc.exists) {
        const integrationData = integrationsDoc.data();
        logger.info(`Found Slack integration doc for tenant ${tenantId}`, {
          enabled: integrationData?.enabled,
          status: integrationData?.status,
          hasWorkspaceId: !!integrationData?.workspaceId,
          hasTeamId: !!integrationData?.teamId,
          hasBotToken: !!integrationData?.botToken,
        });
        
        // Check if Slack has required config (be more lenient - just need botToken)
        // Don't require enabled=true or status='active' - if botToken exists, try to use it
        if (integrationData?.botToken) {
          teamId = integrationData.workspaceId || integrationData.teamId;
          botToken = integrationData.botToken;
          
          let teamName = integrationData.teamName || integrationData.workspaceName;
          
          // If we have botToken but no teamId, try to get it from the bot token
          // (we can call auth.test to get team_id)
          if (botToken && !teamId) {
            try {
              logger.info('Attempting to get teamId from Slack auth.test API');
              const authTestRes = await fetch('https://slack.com/api/auth.test', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${botToken}`,
                  'Content-Type': 'application/json',
                },
              });
              
              if (!authTestRes.ok) {
                logger.warn(`auth.test HTTP error: ${authTestRes.status} ${authTestRes.statusText}`);
                throw new Error(`HTTP ${authTestRes.status}: ${authTestRes.statusText}`);
              }
              
              const authTestData = await authTestRes.json();
              logger.info('auth.test response', { ok: authTestData.ok, error: authTestData.error, hasTeamId: !!authTestData.team_id });
              
              if (authTestData.ok && authTestData.team_id) {
                teamId = authTestData.team_id;
                if (!teamName && authTestData.team) {
                  teamName = authTestData.team;
                }
                logger.info(`Successfully got teamId from auth.test: ${teamId}`);
              } else {
                logger.warn('auth.test failed or missing team_id', { 
                  ok: authTestData.ok, 
                  error: authTestData.error,
                  response: authTestData 
                });
                throw new Error(`Slack auth.test failed: ${authTestData.error || 'Unknown error'}`);
              }
            } catch (err: any) {
              logger.error('Failed to get teamId from auth.test', { 
                error: err.message,
                stack: err.stack 
              });
              // Don't throw here - let it fall through to the error message below
            }
          }
          
          if (teamId && botToken) {
            // Create slackTeams document for future use
            await db.collection('slackTeams').doc(tenantId).set({
              tenantId,
              teamId,
              teamName: teamName || 'Unknown',
              botToken,
              status: 'active',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            
            slackTeam = {
              tenantId,
              teamId,
              botToken,
              status: 'active',
            };
            
            logger.info(`Created slackTeams document from integrations for tenant ${tenantId}`);
          } else {
            logger.warn(`Slack integration exists but missing teamId or botToken`, {
              hasTeamId: !!teamId,
              hasBotToken: !!botToken,
            });
          }
        } else {
          logger.warn(`Slack integration doc exists but has no botToken for tenant ${tenantId}`);
        }
      } else {
        logger.warn(`No Slack integration doc found for tenant ${tenantId}`);
      }
    }

    // Fourth try: Get bot token from secret (if available)
    if (!botToken) {
      try {
        botToken = SLACK_BOT_TOKEN.value();
        logger.info('Using bot token from Secret Manager');
      } catch (err) {
        logger.warn('Could not get bot token from secret', err);
      }
    }

    // If we have botToken from secret but no teamId, fetch it from Slack
    if (botToken && !teamId) {
      try {
        logger.info('Attempting to get teamId from Slack auth.test API (using secret token)');
        const authTestRes = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (!authTestRes.ok) {
          logger.warn(`auth.test HTTP error: ${authTestRes.status} ${authTestRes.statusText}`);
        } else {
          const authTestData = await authTestRes.json();
          logger.info('auth.test response', { ok: authTestData.ok, error: authTestData.error, hasTeamId: !!authTestData.team_id });
          
          if (authTestData.ok && authTestData.team_id) {
            teamId = authTestData.team_id;
            const teamName = authTestData.team || 'Unknown';
            
            // Create slackTeams document for future use
            await db.collection('slackTeams').doc(tenantId).set({
              tenantId,
              teamId,
              teamName,
              botToken,
              status: 'active',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            
            slackTeam = {
              tenantId,
              teamId,
              botToken,
              status: 'active',
            };
            
            logger.info(`Successfully got teamId from auth.test and created slackTeams doc: ${teamId}`);
          } else {
            logger.warn('auth.test failed or missing team_id', { 
              ok: authTestData.ok, 
              error: authTestData.error,
              response: authTestData 
            });
          }
        }
      } catch (err: any) {
        logger.error('Failed to get teamId from auth.test (using secret token)', { 
          error: err.message,
          stack: err.stack 
        });
      }
    }

    if (!slackTeam || !teamId || !botToken) {
      // Provide detailed error message
      let errorMessage = 'No active Slack workspace found for this tenant.';
      
      if (!botToken) {
        errorMessage += ' Bot token is missing.';
      }
      if (!teamId) {
        errorMessage += ' Workspace ID is missing.';
      }
      
      errorMessage += ' Please configure Slack integration in Settings (Integrations tab) with a valid bot token.';
      
      logger.error('Slack workspace not found', {
        tenantId,
        hasSlackTeam: !!slackTeam,
        hasTeamId: !!teamId,
        hasBotToken: !!botToken,
      });
      
      throw new HttpsError('failed-precondition', errorMessage);
    }

    if (!botToken) {
      throw new HttpsError(
        'failed-precondition',
        'Slack bot token missing. Please configure Slack integration in Settings.'
      );
    }

    // 4. Call Slack conversations.list with pagination
    let cursor: string | undefined;
    let processed = 0;
    const tenantChannelsCol = db
      .collection('tenants')
      .doc(tenantId)
      .collection('slackChannels');
    
    // Track all channel IDs returned by Slack (to identify deleted channels)
    const slackChannelIds = new Set<string>();

    do {
      const params = new URLSearchParams({
        types: 'public_channel,private_channel',
        limit: '200',
      });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(
        'https://slack.com/api/conversations.list?' + params.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const json: SlackConversationsListResponse = await res.json();

      if (!json.ok) {
        logger.error('Slack conversations.list error', json);
        throw new HttpsError(
          'internal',
          `Slack conversations.list failed: ${json.error || 'Unknown error'}`
        );
      }

      const channels: SlackConversation[] = json.channels ?? [];
      const batch = db.batch();

      for (const ch of channels) {
        // Track this channel ID (whether archived or not)
        slackChannelIds.add(ch.id);
        
        const docRef = tenantChannelsCol.doc(ch.id);

        // Mark archived channels as archived, but skip full processing
        if (ch.is_archived) {
          batch.set(
            docRef,
            {
              isArchived: true,
              status: 'unlinked', // Ensure status field exists
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          continue; // Skip full processing of archived channels
        }

        // For non-archived channels, process normally
        const createdAt =
          ch.created != null
            ? admin.firestore.Timestamp.fromMillis(ch.created * 1000)
            : admin.firestore.FieldValue.serverTimestamp();

        batch.set(
          docRef,
          {
            tenantId,
            teamId,
            channelId: ch.id,
            name: ch.name,
            isPrivate: !!ch.is_private,
            isArchived: false, // Explicitly set to false for active channels
            createdAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),

            // Initial view state
            status: 'unlinked', // Unified status field for frontend
            watchStatus: 'unwatched',
            muted: false,
            unreadCount: 0,
            unreadMentions: 0,

            // Activity will be updated by events
            lastMessageAt: null,
            lastMessageText: null,
            lastMessageUserId: null,
            lastMessageUserName: null,

            // HRX links empty for now
            linkedDeals: [],
            linkedCustomers: [],
            linkedJobs: [],
            linkedTeams: [],
          },
          { merge: true } // merge so we don't blow away future fields
        );
      }

      await batch.commit();
      processed += channels.length;
      logger.info(`Processed ${channels.length} channels (total: ${processed})`);

      cursor = json.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // 5. Mark channels in Firestore that weren't returned by Slack as archived (deleted)
    logger.info(`Checking for deleted channels (channels in Firestore but not in Slack response)`);
    const existingChannelsSnap = await tenantChannelsCol.get();
    const deletedChannels: string[] = [];
    
    for (const docSnap of existingChannelsSnap.docs) {
      const channelId = docSnap.id;
      // If this channel wasn't in the Slack response, mark it as archived
      if (!slackChannelIds.has(channelId)) {
        const data = docSnap.data();
        // Only mark as archived if it's not already archived (to avoid unnecessary updates)
        if (!data.isArchived) {
          deletedChannels.push(channelId);
        }
      }
    }
    
    // Batch update deleted channels
    if (deletedChannels.length > 0) {
      logger.info(`Marking ${deletedChannels.length} deleted channels as archived`);
      const deleteBatch = db.batch();
      for (const channelId of deletedChannels) {
        const docRef = tenantChannelsCol.doc(channelId);
        deleteBatch.set(
          docRef,
          {
            isArchived: true,
            status: 'unlinked',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await deleteBatch.commit();
      logger.info(`Marked ${deletedChannels.length} channels as archived`);
    }

    logger.info(`Backfill complete: ${processed} channels processed, ${deletedChannels.length} channels marked as archived for tenant ${tenantId}`);

    return {
      ok: true,
      tenantId,
      teamId,
      channelsProcessed: processed,
      channelsArchived: deletedChannels.length,
    };
  }
);

