/**
 * useMentionSearch Hook
 * 
 * Provides search functions for all mentionable entities (users, contacts, companies, deals).
 */

import { useCallback } from 'react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import type { MentionableEntity, MentionType } from '../types/crossSystemMentions';
import { useAuth } from '../contexts/AuthContext';

export interface UseMentionSearchResult {
  searchUsers: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchContacts: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchCompanies: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchDeals: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
}

/**
 * Hook for searching mentionable entities
 */
export function useMentionSearch(): UseMentionSearchResult {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id || '';

  const searchUsers = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId || !searchQuery.trim()) {
      return [];
    }

    try {
      // Use the existing mentionSearch callable function for users
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../firebase');
      const mentionSearch = httpsCallable(functions, 'mentionSearch');
      
      const result = await mentionSearch({ query: searchQuery, limit: limitCount });
      const users = (result.data as any)?.users || [];
      
      return users.map((user: any) => ({
        id: user.id,
        type: 'user' as MentionType,
        label: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        slug: user.username || user.email?.split('@')[0],
        avatarUrl: user.avatarUrl || user.avatar,
      }));
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  }, [tenantId]);

  const searchContacts = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId || !searchQuery.trim()) {
      return [];
    }

    try {
      const searchTerm = searchQuery.toLowerCase().trim();
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      
      // Search by firstName, lastName, or email
      // Note: Firestore doesn't support case-insensitive search natively,
      // so we'll fetch a reasonable number and filter client-side
      const contactsQuery = query(
        contactsRef,
        orderBy('firstName'),
        limit(100) // Fetch more to filter client-side
      );
      
      const snapshot = await getDocs(contactsQuery);
      const results: MentionableEntity[] = [];
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const firstName = (data.firstName || '').toLowerCase();
        const lastName = (data.lastName || '').toLowerCase();
        const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
        const email = (data.email || '').toLowerCase();
        const companyName = (data.companyName || '').toLowerCase();
        
        // Match if search term appears in name or email
        if (
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          fullName.toLowerCase().startsWith(searchTerm) ||
          email.startsWith(searchTerm) ||
          companyName.includes(searchTerm)
        ) {
          results.push({
            id: doc.id,
            type: 'contact',
            label: fullName || email || 'Unnamed Contact',
            slug: email.split('@')[0] || firstName,
            avatarUrl: data.avatar || data.avatarUrl,
            subtitle: data.companyName || undefined,
          });
          
          if (results.length >= limitCount) {
            break;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error searching contacts:', error);
      return [];
    }
  }, [tenantId]);

  const searchCompanies = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId || !searchQuery.trim()) {
      return [];
    }

    try {
      const searchTerm = searchQuery.toLowerCase().trim();
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      
      // Search by companyName
      const companiesQuery = query(
        companiesRef,
        orderBy('companyName'),
        limit(100) // Fetch more to filter client-side
      );
      
      const snapshot = await getDocs(companiesQuery);
      const results: MentionableEntity[] = [];
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const companyName = (data.companyName || data.name || '').toLowerCase();
        const displayName = data.companyName || data.name || 'Unnamed Company';
        
        // Match if search term appears in company name
        if (companyName.startsWith(searchTerm) || companyName.includes(searchTerm)) {
          results.push({
            id: doc.id,
            type: 'company',
            label: displayName,
            slug: companyName.replace(/\s+/g, '-').substring(0, 30),
            avatarUrl: data.logo,
          });
          
          if (results.length >= limitCount) {
            break;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error searching companies:', error);
      return [];
    }
  }, [tenantId]);

  const searchDeals = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId || !searchQuery.trim()) {
      return [];
    }

    try {
      const searchTerm = searchQuery.toLowerCase().trim();
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      
      // Search by dealName or companyName
      const dealsQuery = query(
        dealsRef,
        orderBy('dealName'),
        limit(100) // Fetch more to filter client-side
      );
      
      const snapshot = await getDocs(dealsQuery);
      const results: MentionableEntity[] = [];
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const dealName = (data.dealName || data.name || '').toLowerCase();
        const companyName = (data.companyName || '').toLowerCase();
        const displayName = data.dealName || data.name || 'Unnamed Deal';
        
        // Match if search term appears in deal name or company name
        if (
          dealName.startsWith(searchTerm) ||
          dealName.includes(searchTerm) ||
          companyName.includes(searchTerm)
        ) {
          results.push({
            id: doc.id,
            type: 'deal',
            label: displayName,
            slug: dealName.replace(/\s+/g, '-').substring(0, 30),
            subtitle: data.companyName || undefined,
          });
          
          if (results.length >= limitCount) {
            break;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error searching deals:', error);
      return [];
    }
  }, [tenantId]);

  return {
    searchUsers,
    searchContacts,
    searchCompanies,
    searchDeals,
  };
}

