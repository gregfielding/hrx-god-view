/**
 * Email Thread Search API
 * 
 * Backend search functionality for email threads
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getUserEmailThreads, EmailThread } from './emailThreading';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Parse search query to extract filters and text
 */
function parseSearchQuery(query: string): {
  text: string;
  filters: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    category?: string;
    before?: Date;
    after?: Date;
  };
} {
  const filters: any = {};
  let text = query;

  // Extract filter syntax (Gmail-style)
  // from:email@example.com
  const fromMatch = text.match(/\bfrom:([^\s]+)/i);
  if (fromMatch) {
    filters.from = fromMatch[1];
    text = text.replace(/\bfrom:[^\s]+\s*/gi, '').trim();
  }

  // to:email@example.com
  const toMatch = text.match(/\bto:([^\s]+)/i);
  if (toMatch) {
    filters.to = toMatch[1];
    text = text.replace(/\bto:[^\s]+\s*/gi, '').trim();
  }

  // subject:keyword
  const subjectMatch = text.match(/\bsubject:([^\s]+)/i);
  if (subjectMatch) {
    filters.subject = subjectMatch[1];
    text = text.replace(/\bsubject:[^\s]+\s*/gi, '').trim();
  }

  // is:unread
  if (/\bis:unread\b/i.test(text)) {
    filters.isUnread = true;
    text = text.replace(/\bis:unread\b/gi, '').trim();
  }

  // is:starred
  if (/\bis:starred\b/i.test(text)) {
    filters.isStarred = true;
    text = text.replace(/\bis:starred\b/gi, '').trim();
  }

  // has:attachment
  if (/\bhas:attachment\b/i.test(text)) {
    filters.hasAttachment = true;
    text = text.replace(/\bhas:attachment\b/gi, '').trim();
  }

  // category:primary
  const categoryMatch = text.match(/\bcategory:([^\s]+)/i);
  if (categoryMatch) {
    filters.category = categoryMatch[1];
    text = text.replace(/\bcategory:[^\s]+\s*/gi, '').trim();
  }

  // before:2024-01-01
  const beforeMatch = text.match(/\bbefore:([^\s]+)/i);
  if (beforeMatch) {
    try {
      filters.before = new Date(beforeMatch[1]);
      text = text.replace(/\bbefore:[^\s]+\s*/gi, '').trim();
    } catch (e) {
      // Invalid date, ignore
    }
  }

  // after:2024-01-01
  const afterMatch = text.match(/\bafter:([^\s]+)/i);
  if (afterMatch) {
    try {
      filters.after = new Date(afterMatch[1]);
      text = text.replace(/\bafter:[^\s]+\s*/gi, '').trim();
    } catch (e) {
      // Invalid date, ignore
    }
  }

  return { text: text.trim(), filters };
}

/**
 * Search email threads
 */
async function searchEmailThreads(
  userId: string,
  tenantId: string,
  query: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ threads: EmailThread[]; totalCount: number }> {
  const { text, filters } = parseSearchQuery(query);
  const searchLower = text.toLowerCase().trim();

  // Get all user's threads (with higher limit for search)
  const allThreads = await getUserEmailThreads(userId, tenantId, {
    limit: options?.limit ? options.limit * 3 : 1000, // Get more threads for search
    unreadOnly: filters.isUnread,
  });

  // Apply filters
  let filteredThreads = allThreads;

  // Filter by from email
  if (filters.from) {
    const fromLower = filters.from.toLowerCase();
    filteredThreads = filteredThreads.filter(thread =>
      thread.participants?.some(p => p.toLowerCase().includes(fromLower))
    );
  }

  // Filter by to email
  if (filters.to) {
    const toLower = filters.to.toLowerCase();
    filteredThreads = filteredThreads.filter(thread =>
      thread.participants?.some(p => p.toLowerCase().includes(toLower))
    );
  }

  // Filter by subject
  if (filters.subject) {
    const subjectLower = filters.subject.toLowerCase();
    filteredThreads = filteredThreads.filter(thread =>
      thread.subject?.toLowerCase().includes(subjectLower)
    );
  }

  // Filter by starred
  if (filters.isStarred) {
    filteredThreads = filteredThreads.filter(thread => thread.starred === true);
  }

  // Filter by category
  if (filters.category) {
    filteredThreads = filteredThreads.filter(thread => {
      const labels = thread.labels || [];
      if (filters.category === 'primary' && labels.length === 0) {
        return true; // Include uncategorized in primary
      }
      return labels.includes(filters.category);
    });
  }

  // Filter by date
  if (filters.before || filters.after) {
    filteredThreads = filteredThreads.filter(thread => {
      if (!thread.lastMessageAt) return false;
      
      let messageDate: Date;
      if (thread.lastMessageAt instanceof admin.firestore.Timestamp) {
        messageDate = thread.lastMessageAt.toDate();
      } else if (thread.lastMessageAt && typeof thread.lastMessageAt === 'object' && 'toDate' in thread.lastMessageAt) {
        messageDate = (thread.lastMessageAt as any).toDate();
      } else if (thread.lastMessageAt instanceof Date) {
        messageDate = thread.lastMessageAt;
      } else {
        try {
          messageDate = new Date(thread.lastMessageAt as any);
        } catch {
          return false;
        }
      }
      
      if (isNaN(messageDate.getTime())) return false;
      
      if (filters.before && messageDate > filters.before) return false;
      if (filters.after && messageDate < filters.after) return false;
      return true;
    });
  }

  // Apply text search (subject, participants, snippet, contact names)
  if (searchLower) {
    filteredThreads = filteredThreads.filter(thread => {
      // Search in subject
      if (thread.subject?.toLowerCase().includes(searchLower)) return true;
      
      // Search in enriched contact names (from participantContacts)
      if (thread.participantContacts?.some(contact => {
        // Search in contact name
        if (contact.contactName?.toLowerCase().includes(searchLower)) return true;
        // Search in user name
        if (contact.userName?.toLowerCase().includes(searchLower)) return true;
        // Search in company name
        if (contact.companyName?.toLowerCase().includes(searchLower)) return true;
        return false;
      })) return true;
      
      // Search in participants (email addresses and names)
      if (thread.participants?.some(p => {
        const emailLower = p.toLowerCase();
        
        // Extract name from "Name <email@domain.com>" format
        const nameMatch = p.match(/^(.+?)\s*</);
        const name = nameMatch ? nameMatch[1].toLowerCase().trim() : '';
        
        // Extract email part (remove name if present)
        const emailPart = p.includes('<') 
          ? p.match(/<(.+?)>/)?.[1]?.toLowerCase() || emailLower
          : emailLower;
        
        // Search in full email address
        if (emailPart.includes(searchLower)) return true;
        
        // Search in email username (part before @)
        const emailUsername = emailPart.split('@')[0];
        if (emailUsername.includes(searchLower)) return true;
        
        // Search in display name
        if (name && name.includes(searchLower)) return true;
        
        // Search in domain (part after @)
        const emailDomain = emailPart.split('@')[1];
        if (emailDomain && emailDomain.includes(searchLower)) return true;
        
        return false;
      })) return true;
      
      // Search in snippet
      if (thread.lastMessageSnippet?.toLowerCase().includes(searchLower)) return true;
      
      return false;
    });
  }

  // Apply limit and offset
  const totalCount = filteredThreads.length;
  const offset = options?.offset || 0;
  const limit = options?.limit || 50;
  const paginatedThreads = filteredThreads.slice(offset, offset + limit);

  return {
    threads: paginatedThreads,
    totalCount,
  };
}

/**
 * GET /searchEmailThreadsApi
 * 
 * Search email threads
 */
export const searchEmailThreadsApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      const userId = request.query.userId as string;
      const tenantId = request.query.tenantId as string;
      const query = request.query.query as string;
      const limit = request.query.limit ? Number(request.query.limit) : 100;
      const offset = request.query.offset ? Number(request.query.offset) : 0;

      if (!userId || !tenantId || !query) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'userId, tenantId, and query are required' },
        });
        return;
      }

      const { threads, totalCount } = await searchEmailThreads(userId, tenantId, query, {
        limit,
        offset,
      });

      // Serialize Firestore Timestamps
      const serializedThreads = threads.map(thread => {
        const serializeTimestamp = (value: any): any => {
          if (!value) return value;
          if (value instanceof admin.firestore.Timestamp) {
            return value.toDate().toISOString();
          }
          if (value && typeof value.toDate === 'function') {
            return value.toDate().toISOString();
          }
          return value;
        };

        return {
          ...thread,
          lastMessageAt: serializeTimestamp(thread.lastMessageAt),
          createdAt: serializeTimestamp(thread.createdAt),
          updatedAt: serializeTimestamp(thread.updatedAt),
        };
      });

      const { text, filters } = parseSearchQuery(query);

      response.status(200).json({
        success: true,
        threads: serializedThreads,
        totalCount,
        query: text,
        filters,
      });
    } catch (error: any) {
      logger.error('Error in searchEmailThreadsApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

