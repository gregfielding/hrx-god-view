/**
 * Email Search Utilities
 * 
 * Provides Firestore-based full-text search for emails
 * Uses Firestore queries with text matching
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface EmailSearchOptions {
  tenantId: string;
  userId: string;
  userEmail?: string;
  query: string;
  limit?: number;
  filters?: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    category?: string;
  };
}

export interface EmailSearchResult {
  threadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  lastMessageAt: Date;
  unreadCount: number;
  messageCount: number;
  starred?: boolean;
}

/**
 * Parse search query for operators (from:, to:, subject:, etc.)
 */
export function parseSearchQuery(searchQuery: string): {
  text: string;
  operators: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
  };
} {
  let text = searchQuery.trim();
  const operators: any = {};

  // Extract from: operator
  const fromMatch = text.match(/\bfrom:([^\s]+)/i);
  if (fromMatch) {
    operators.from = fromMatch[1];
    text = text.replace(/\bfrom:[^\s]+/gi, '').trim();
  }

  // Extract to: operator
  const toMatch = text.match(/\bto:([^\s]+)/i);
  if (toMatch) {
    operators.to = toMatch[1];
    text = text.replace(/\bto:[^\s]+/gi, '').trim();
  }

  // Extract subject: operator
  const subjectMatch = text.match(/\bsubject:([^\s]+)/i);
  if (subjectMatch) {
    operators.subject = subjectMatch[1];
    text = text.replace(/\bsubject:[^\s]+/gi, '').trim();
  }

  // Extract has:attachment
  if (/\bhas:attachment\b/i.test(text)) {
    operators.hasAttachment = true;
    text = text.replace(/\bhas:attachment\b/gi, '').trim();
  }

  // Extract is:unread
  if (/\bis:unread\b/i.test(text)) {
    operators.isUnread = true;
    text = text.replace(/\bis:unread\b/gi, '').trim();
  }

  // Extract is:starred
  if (/\bis:starred\b/i.test(text)) {
    operators.isStarred = true;
    text = text.replace(/\bis:starred\b/gi, '').trim();
  }

  return { text: text.trim(), operators };
}

/**
 * Search email threads
 * 
 * Note: Firestore doesn't support full-text search natively.
 * This implementation does basic field matching.
 * For production, consider using Algolia or Elasticsearch.
 */
export async function searchEmailThreads(
  options: EmailSearchOptions
): Promise<EmailSearchResult[]> {
  const {
    tenantId,
    userId,
    userEmail,
    query: searchQuery,
    limit: limitCount = 50,
    filters = {},
  } = options;

  const { text, operators } = parseSearchQuery(searchQuery);
  const combinedFilters = { ...filters, ...operators };

  try {
    const threadsRef = collection(db, 'tenants', tenantId, 'emailThreads');

    // Build base query
    let threadsQuery: any = threadsRef;

    // Query by participant
    try {
      threadsQuery = query(
        threadsRef,
        where('participantUserIds', 'array-contains', userId),
        where('status', '==', 'active'),
        orderBy('lastMessageAt', 'desc'),
        limit(limitCount * 3) // Get more to filter in memory
      );
    } catch (err) {
      // Fallback to email-based query
      if (userEmail) {
        threadsQuery = query(
          threadsRef,
          where('participants', 'array-contains', userEmail.toLowerCase()),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc'),
          limit(limitCount * 3)
        );
      } else {
        throw new Error('No userEmail provided');
      }
    }

    const snapshot = await getDocs(threadsQuery);
    let threads = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, any>;
      return {
        id: doc.id,
        ...data,
      } as any;
    });

    // Filter in memory
    if (combinedFilters.from) {
      threads = threads.filter((t) =>
        t.participants?.some((p: string) =>
          p.toLowerCase().includes(combinedFilters.from!.toLowerCase())
        )
      );
    }

    if (combinedFilters.to) {
      threads = threads.filter((t) =>
        t.participants?.some((p: string) =>
          p.toLowerCase().includes(combinedFilters.to!.toLowerCase())
        )
      );
    }

    if (combinedFilters.subject) {
      threads = threads.filter((t) =>
        t.subject?.toLowerCase().includes(combinedFilters.subject!.toLowerCase())
      );
    }

    if (combinedFilters.isUnread) {
      threads = threads.filter((t) => (t.unreadCount || 0) > 0);
    }

    if (combinedFilters.isStarred) {
      threads = threads.filter((t) => t.starred === true);
    }

    // Text search in subject and snippet
    if (text) {
      const searchLower = text.toLowerCase();
      threads = threads.filter((t) => {
        const subjectMatch = t.subject?.toLowerCase().includes(searchLower);
        const snippetMatch = t.lastMessageSnippet?.toLowerCase().includes(searchLower);
        return subjectMatch || snippetMatch;
      });
    }

    // Limit results
    threads = threads.slice(0, limitCount);

    // Map to search results
    return threads.map((thread) => ({
      threadId: thread.id,
      subject: thread.subject || '',
      snippet: thread.lastMessageSnippet || '',
      participants: thread.participants || [],
      lastMessageAt: thread.lastMessageAt?.toDate() || new Date(),
      unreadCount: thread.unreadCount || 0,
      messageCount: thread.messageCount || 0,
      starred: thread.starred || false,
    }));
  } catch (error) {
    console.error('Error searching email threads:', error);
    throw error;
  }
}

/**
 * Debounce search function
 */
export function createDebouncedSearch(
  searchFn: (query: string) => Promise<EmailSearchResult[]>,
  delay = 300
): (query: string) => Promise<EmailSearchResult[]> {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastQuery = '';

  return (query: string): Promise<EmailSearchResult[]> => {
    return new Promise((resolve, reject) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      lastQuery = query;

      timeoutId = setTimeout(async () => {
        if (lastQuery === query) {
          try {
            const results = await searchFn(query);
            resolve(results);
          } catch (error) {
            reject(error);
          }
        }
      }, delay);
    });
  };
}

