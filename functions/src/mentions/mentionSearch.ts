/**
 * Mention Search Callable Function
 * 
 * Provides autocomplete search for @mention functionality.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface MentionSearchRequest {
  query: string;
  limit?: number;
}

interface MentionableUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  avatarUrl?: string;
  slackUsername?: string;
  presence?: 'online' | 'away' | 'offline';
}

/**
 * Search for mentionable users (teammates only)
 * 
 * Rules:
 * - Case-insensitive
 * - Match start of username, firstName, lastName, or email before "@"
 * - Only return users from the same tenant
 */
export const mentionSearch = onCall(
  {
    cors: true,
  },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError(
        'unauthenticated',
        'Authentication required'
      );
    }

    const { query, limit = 20 } = request.data as MentionSearchRequest;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { users: [] };
    }

    try {
      // Get user's tenant
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data();
      const tenantId = userData?.activeTenantId || userData?.tenantId;
      
      if (!tenantId) {
        return { users: [] };
      }

      // Get all users in the tenant
      // Note: Firestore doesn't support direct queries on nested map fields like tenantIds.${tenantId}.securityLevel
      // So we'll fetch a larger set and filter client-side, or use a different approach
      // For now, we'll fetch users and filter by checking tenantIds in memory
      const usersQuery = await db
        .collection('users')
        .limit(500) // Get a larger set to filter from
        .get();

      const searchTerm = query.toLowerCase().trim();
      const results: MentionableUser[] = [];

      for (const doc of usersQuery.docs) {
        const data = doc.data();
        const uid = doc.id;

        // Skip the requesting user
        if (uid === userId) {
          continue;
        }

        // Check if user is in the tenant
        const userTenantIds = data?.tenantIds || {};
        const userTenantData = userTenantIds[tenantId];
        // Only include users who are in this tenant (have tenantIds entry or have activeTenantId)
        const isInTenant = 
          !!userTenantData || 
          data?.activeTenantId === tenantId || 
          data?.tenantId === tenantId;
        
        if (!isInTenant) {
          continue;
        }

        // Extract searchable fields
        const email = (data?.email || '').toLowerCase();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const displayName = (data?.displayName || '').toLowerCase();
        const username = email.split('@')[0] || '';

        // Get Slack username if available
        const slackIntegration = data?.integrations?.slack;
        const slackUsername = slackIntegration?.username?.toLowerCase() || '';

        // Check if matches search term
        const matches =
          username.startsWith(searchTerm) ||
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          displayName.startsWith(searchTerm) ||
          email.startsWith(searchTerm) ||
          slackUsername.startsWith(searchTerm);

        if (matches) {
          const fullName =
            displayName ||
            `${firstName} ${lastName}`.trim() ||
            email.split('@')[0] ||
            'Unknown';

          results.push({
            id: uid,
            fullName,
            username: username || email.split('@')[0] || 'user',
            email: data?.email || '',
            avatarUrl: data?.avatar || data?.avatarUrl,
            slackUsername: slackIntegration?.username,
            presence: undefined, // TODO: Add presence tracking
          });

          if (results.length >= limit) {
            break;
          }
        }
      }

      // Sort by relevance (exact username match first, then alphabetical)
      results.sort((a, b) => {
        const aExact = a.username === searchTerm || a.slackUsername === searchTerm;
        const bExact = b.username === searchTerm || b.slackUsername === searchTerm;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.fullName.localeCompare(b.fullName);
      });

      return { users: results.slice(0, limit) };
    } catch (error: any) {
      logger.error('Error in mentionSearch:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        'internal',
        `Failed to search users: ${error.message}`
      );
    }
  }
);

