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
  searchUsers: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;  // Internal team (securityLevel 5-7)
  searchContacts: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchCompanies: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchDeals: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;
  searchWorkers: (query: string, limitCount?: number) => Promise<MentionableEntity[]>;  // Workers (securityLevel 1-4)
}

/**
 * Hook for searching mentionable entities
 */
export function useMentionSearch(): UseMentionSearchResult {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id || '';

  const searchUsers = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId) {
      return [];
    }

    try {
      // Search for internal team members (securityLevel 5-7) in the users collection
      const searchTerm = (searchQuery || '').toLowerCase().trim();
      const usersRef = collection(db, 'users');
      
      // Fetch users and filter by securityLevel 5-7 and tenant membership
      const usersQuery = query(usersRef, limit(500)); // Fetch more to filter client-side
      const snapshot = await getDocs(usersQuery);
      const results: MentionableEntity[] = [];
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const uid = doc.id;
        
        // Check if user is in the tenant
        const userTenantIds = data?.tenantIds || {};
        const userTenantData = userTenantIds[tenantId];
        const isInTenant = 
          !!userTenantData || 
          data?.activeTenantId === tenantId || 
          data?.tenantId === tenantId;
        
        if (!isInTenant) {
          continue;
        }
        
        // Get security level from tenant-specific data or global
        const securityLevel = userTenantData?.securityLevel || data?.securityLevel;
        const securityLevelNum = parseInt(securityLevel || '0', 10);
        
        // Only include internal team (securityLevel 5-7)
        if (securityLevelNum < 5 || securityLevelNum > 7) {
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
        
        // If no search term, include all internal team members (up to limit)
        // Otherwise, check if matches search term
        if (
          searchTerm.length === 0 ||
          username.startsWith(searchTerm) ||
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          displayName.startsWith(searchTerm) ||
          email.startsWith(searchTerm) ||
          slackUsername.startsWith(searchTerm)
        ) {
          const fullName =
            displayName ||
            `${data?.firstName || ''} ${data?.lastName || ''}`.trim() ||
            email.split('@')[0] ||
            'Unknown';
          
          results.push({
            id: uid,
            type: 'user',
            label: fullName,
            slug: username || email.split('@')[0] || 'user',
            avatarUrl: data?.avatar || data?.avatarUrl,
          });
          
          if (results.length >= limitCount) {
            break;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  }, [tenantId]);

  const searchContacts = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId) {
      return [];
    }

    try {
      const searchTerm = (searchQuery || '').toLowerCase().trim();
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
        
        // If no search term, include all contacts (up to limit)
        // Otherwise, match if search term appears in name or email
        if (
          searchTerm.length === 0 ||
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
    if (!tenantId) {
      return [];
    }

    try {
      const searchTerm = (searchQuery || '').toLowerCase().trim();
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
        
        // If no search term, include all companies (up to limit)
        // Otherwise, match if search term appears in company name
        if (searchTerm.length === 0 || companyName.startsWith(searchTerm) || companyName.includes(searchTerm)) {
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
        
        // If no search term, include all deals (up to limit)
        // Otherwise, match if search term appears in deal name or company name
        if (
          searchTerm.length === 0 ||
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

  const searchWorkers = useCallback(async (searchQuery: string, limitCount = 20): Promise<MentionableEntity[]> => {
    if (!tenantId) {
      return [];
    }

    try {
      // Search for workers (securityLevel 1-4) in the users collection
      const searchTerm = (searchQuery || '').toLowerCase().trim();
      const usersRef = collection(db, 'users');
      
      // Fetch users and filter by securityLevel 1-4 and tenant membership
      const usersQuery = query(usersRef, limit(500)); // Fetch more to filter client-side
      const snapshot = await getDocs(usersQuery);
      const results: MentionableEntity[] = [];
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const uid = doc.id;
        
        // Check if user is in the tenant
        const userTenantIds = data?.tenantIds || {};
        const userTenantData = userTenantIds[tenantId];
        const isInTenant = 
          !!userTenantData || 
          data?.activeTenantId === tenantId || 
          data?.tenantId === tenantId;
        
        if (!isInTenant) {
          continue;
        }
        
        // Get security level from tenant-specific data or global
        const securityLevel = userTenantData?.securityLevel || data?.securityLevel;
        const securityLevelNum = parseInt(securityLevel || '0', 10);
        
        // Only include workers (securityLevel 1-4)
        if (securityLevelNum < 1 || securityLevelNum > 4) {
          continue;
        }
        
        // Extract searchable fields
        const email = (data?.email || '').toLowerCase();
        const firstName = (data?.firstName || '').toLowerCase();
        const lastName = (data?.lastName || '').toLowerCase();
        const displayName = (data?.displayName || '').toLowerCase();
        const username = email.split('@')[0] || '';
        
        // If no search term, include all workers (up to limit)
        // Otherwise, check if matches search term
        if (
          searchTerm.length === 0 ||
          username.startsWith(searchTerm) ||
          firstName.startsWith(searchTerm) ||
          lastName.startsWith(searchTerm) ||
          displayName.startsWith(searchTerm) ||
          email.startsWith(searchTerm)
        ) {
          const fullName =
            displayName ||
            `${data?.firstName || ''} ${data?.lastName || ''}`.trim() ||
            email.split('@')[0] ||
            'Unknown';
          
          results.push({
            id: uid,
            type: 'worker',
            label: fullName,
            slug: username || email.split('@')[0] || 'worker',
            avatarUrl: data?.avatar || data?.avatarUrl,
          });
          
          if (results.length >= limitCount) {
            break;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error searching workers:', error);
      return [];
    }
  }, [tenantId]);

  return {
    searchUsers,
    searchContacts,
    searchCompanies,
    searchDeals,
    searchWorkers,
  };
}

