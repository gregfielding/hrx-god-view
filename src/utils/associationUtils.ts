/**
 * Unified Association Utilities
 * 
 * This module provides consistent logic for determining associations between
 * salespeople and CRM entities (companies, deals, contacts).
 * 
 * Priority order for association detection:
 * 1. activeSalespeople (computed field) - most reliable
 * 2. associations.salespeople (new structure)
 * 3. Legacy fields (backward compatibility)
 */

export const AssociationUtils = {
  /**
   * Check if a company is associated with a user
   * Priority: activeSalespeople > associations.salespeople > legacy fields
   * 
   * @param company - Company object from Firestore
   * @param userId - User ID to check association for
   * @returns boolean indicating if the user is associated with the company
   */
  isCompanyAssociatedWithUser: (company: any, userId: string): boolean => {
    if (!company || !userId) {
      return false;
    }

    // Primary: Check activeSalespeople (computed field - most reliable)
    if (company.activeSalespeople && typeof company.activeSalespeople === 'object') {
      if (company.activeSalespeople[userId]) {
        return true;
      }
    }
    
    // Secondary: Check associations.salespeople (new structure)
    if (company.associations?.salespeople) {
      return company.associations.salespeople.some((salesperson: any) => {
        if (typeof salesperson === 'string') {
          return salesperson === userId;
        } else if (salesperson && typeof salesperson === 'object') {
          return salesperson.id === userId;
        }
        return false;
      });
    }
    
    // Legacy: Check old fields (DO NOT REMOVE - maintains backward compatibility)
    if (company.salesOwnerId === userId || company.accountOwnerId === userId) {
      return true;
    }

    // Additional legacy checks for backward compatibility
    if (company.associatedUsers && Array.isArray(company.associatedUsers)) {
      return company.associatedUsers.includes(userId);
    }

    if (company.associatedEmails && Array.isArray(company.associatedEmails)) {
      // This would require user email lookup, but keeping for completeness
      return false;
    }
    
    return false;
  },
  
  /**
   * Check if a deal is associated with a user
   * Priority: associations.salespeople > legacy fields
   * 
   * @param deal - Deal object from Firestore
   * @param userId - User ID to check association for
   * @returns boolean indicating if the user is associated with the deal
   */
  isDealAssociatedWithUser: (deal: any, userId: string): boolean => {
    if (!deal || !userId) {
      return false;
    }

    // Primary: Check associations.salespeople (new structure)
    if (deal.associations?.salespeople) {
      return deal.associations.salespeople.some((salesperson: any) => {
        if (typeof salesperson === 'string') {
          return salesperson === userId;
        } else if (salesperson && typeof salesperson === 'object') {
          return salesperson.id === userId;
        }
        return false;
      });
    }
    
    // Legacy: Check old fields (DO NOT REMOVE - maintains backward compatibility)
    if (deal.salesOwnerId === userId || deal.owner === userId) {
      return true;
    }

    // Additional legacy checks
    if (deal.salespersonIds && Array.isArray(deal.salespersonIds)) {
      return deal.salespersonIds.includes(userId);
    }

    if (deal.salespeopleIds && Array.isArray(deal.salespeopleIds)) {
      return deal.salespeopleIds.includes(userId);
    }

    if (deal.assignedTo === userId) {
      return true;
    }
    
    return false;
  },
  
  /**
   * Check if a contact is associated with a user
   * Priority: direct salesperson association > company association
   * 
   * @param contact - Contact object from Firestore
   * @param userId - User ID to check association for
   * @param myCompanyIds - Array of company IDs that the user is associated with
   * @returns boolean indicating if the user is associated with the contact
   */
  isContactAssociatedWithUser: (contact: any, userId: string, myCompanyIds: string[]): boolean => {
    if (!contact || !userId) {
      return false;
    }

    // Primary: Check if contact has direct salesperson association
    if (contact.associations?.salespeople) {
      return contact.associations.salespeople.some((salesperson: any) => {
        if (typeof salesperson === 'string') {
          return salesperson === userId;
        } else if (salesperson && typeof salesperson === 'object') {
          return salesperson.id === userId;
        }
        return false;
      });
    }
    
    // Secondary: Check if contact belongs to user's companies
    const assocCompanies = (contact.associations?.companies || [])
      .map((c: any) => (typeof c === 'string' ? c : c?.id))
      .filter(Boolean);
    
    if (assocCompanies.some((cid: string) => myCompanyIds.includes(cid))) {
      return true;
    }

    // Legacy: Check old companyId field
    if (contact.companyId && myCompanyIds.includes(contact.companyId)) {
      return true;
    }

    // Legacy: Check salesperson fields
    if (contact.salesOwnerId === userId || contact.accountOwnerId === userId) {
      return true;
    }
    
    return false;
  },
  
  /**
   * Get all companies associated with a user
   * 
   * @param companies - Array of company objects
   * @param userId - User ID to filter by
   * @returns Array of companies associated with the user
   */
  getUserAssociatedCompanies: (companies: any[], userId: string): any[] => {
    if (!companies || !userId) {
      return [];
    }
    return companies.filter(company => AssociationUtils.isCompanyAssociatedWithUser(company, userId));
  },
  
  /**
   * Get all deals associated with a user
   * 
   * @param deals - Array of deal objects
   * @param userId - User ID to filter by
   * @returns Array of deals associated with the user
   */
  getUserAssociatedDeals: (deals: any[], userId: string): any[] => {
    if (!deals || !userId) {
      return [];
    }
    return deals.filter(deal => AssociationUtils.isDealAssociatedWithUser(deal, userId));
  },
  
  /**
   * Get all contacts associated with a user
   * 
   * @param contacts - Array of contact objects
   * @param userId - User ID to filter by
   * @param myCompanyIds - Array of company IDs that the user is associated with
   * @returns Array of contacts associated with the user
   */
  getUserAssociatedContacts: (contacts: any[], userId: string, myCompanyIds: string[]): any[] => {
    if (!contacts || !userId) {
      return [];
    }
    return contacts.filter(contact => AssociationUtils.isContactAssociatedWithUser(contact, userId, myCompanyIds));
  },

  /**
   * Get association status information for debugging and UI indicators
   * 
   * @param entity - Company, deal, or contact object
   * @param userId - User ID to check
   * @returns Object with association status information
   */
  getAssociationStatus: (entity: any, userId: string) => {
    if (!entity || !userId) {
      return {
        isAssociated: false,
        hasActiveSalespeople: false,
        isUserActive: false,
        lastUpdated: null,
        associationSources: []
      };
    }

    const sources: string[] = [];
    let isAssociated = false;

    // Check activeSalespeople (companies only)
    if (entity.activeSalespeople && typeof entity.activeSalespeople === 'object') {
      if (entity.activeSalespeople[userId]) {
        isAssociated = true;
        sources.push('activeSalespeople');
      }
    }

    // Check associations.salespeople
    if (entity.associations?.salespeople) {
      const hasUser = entity.associations.salespeople.some((salesperson: any) => {
        if (typeof salesperson === 'string') {
          return salesperson === userId;
        } else if (salesperson && typeof salesperson === 'object') {
          return salesperson.id === userId;
        }
        return false;
      });
      if (hasUser) {
        isAssociated = true;
        sources.push('associations.salespeople');
      }
    }

    // Check legacy fields
    if (entity.salesOwnerId === userId) {
      isAssociated = true;
      sources.push('salesOwnerId');
    }
    if (entity.accountOwnerId === userId) {
      isAssociated = true;
      sources.push('accountOwnerId');
    }
    if (entity.owner === userId) {
      isAssociated = true;
      sources.push('owner');
    }

    return {
      isAssociated,
      hasActiveSalespeople: !!(entity.activeSalespeople && Object.keys(entity.activeSalespeople).length > 0),
      isUserActive: !!(entity.activeSalespeople && entity.activeSalespeople[userId]),
      lastUpdated: entity.activeSalespeopleUpdatedAt,
      associationSources: sources
    };
  },

  /**
   * Debug helper to log association information
   * 
   * @param entity - Entity to debug
   * @param userId - User ID to check
   * @param entityType - Type of entity ('company', 'deal', 'contact')
   */
  debugAssociation: (entity: any, userId: string, entityType = 'entity') => {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    const status = AssociationUtils.getAssociationStatus(entity, userId);
    
    console.log(`🔍 Association Debug - ${entityType}:`, {
      entityId: entity.id,
      userId,
      isAssociated: status.isAssociated,
      hasActiveSalespeople: status.hasActiveSalespeople,
      isUserActive: status.isUserActive,
      associationSources: status.associationSources,
      lastUpdated: status.lastUpdated?.toDate?.() || status.lastUpdated,
      activeSalespeopleCount: entity.activeSalespeople ? Object.keys(entity.activeSalespeople).length : 0,
      associationsSalespeopleCount: entity.associations?.salespeople?.length || 0
    });
  }
};
