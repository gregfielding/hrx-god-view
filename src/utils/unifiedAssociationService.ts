import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  serverTimestamp
} from 'firebase/firestore';

import { db } from '../firebase';

// 🎯 UNIFIED ASSOCIATION SERVICE
// Single source of truth for all CRM associations
// This service consolidates all association data and provides a consistent API

export interface UnifiedAssociation {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  associationType: 'primary' | 'secondary' | 'ownership' | 'assignment' | 'involvement';
  strength: 'strong' | 'medium' | 'weak';
  metadata?: any;
  createdAt: any;
  updatedAt: any;
}

export interface UnifiedAssociationResult {
  associations: UnifiedAssociation[];
  entities: {
    companies: any[];
    locations: any[];
    contacts: any[];
    deals: any[];
    salespeople: any[];
    tasks: any[];
  };
  summary: {
    totalAssociations: number;
    byType: { [key: string]: number };
    byStrength: { [key: string]: number };
  };
}

export interface UnifiedAssociationQuery {
  entityType: string;
  entityId: string;
  targetTypes?: string[];
  associationTypes?: string[];
  strength?: string[];
  includeMetadata?: boolean;
  limit?: number;
}

export class UnifiedAssociationService {
  private tenantId: string;
  private userId: string;
  
  // Centralized cache for performance
  private cache = new Map<string, { data: UnifiedAssociationResult; timestamp: number; ttl: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(tenantId: string, userId: string) {
    this.tenantId = tenantId;
    this.userId = userId;
  }

  // 🔍 GET ALL ASSOCIATIONS FOR AN ENTITY
  async getEntityAssociations(entityType: string, entityId: string): Promise<UnifiedAssociationResult> {
    const cacheKey = `associations_${entityType}_${entityId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`🔍 UnifiedAssociationService: Getting associations for ${entityType}:${entityId} (user ${this.userId})`);

      // 1. Get explicit associations from crm_associations collection
      const explicitAssociations = await this.getExplicitAssociations(entityType, entityId);
      console.log(`📊 Found ${explicitAssociations.length} explicit associations`);

      // 2. Get implicit associations from entity document fields
      const implicitAssociations = await this.getImplicitAssociations(entityType, entityId);
      console.log(`📊 Found ${implicitAssociations.length} implicit associations`);

      // 3. Merge and deduplicate associations
      const allAssociations = this.mergeAssociations([...explicitAssociations, ...implicitAssociations]);
      console.log(`📊 Total unique associations: ${allAssociations.length}`);

      // 4. Load only essential entities (contacts and salespeople) with timeout
      const entities = await this.loadEssentialEntities(allAssociations);

      // 5. Generate summary
      const summary = this.generateSummary(allAssociations);

      const result: UnifiedAssociationResult = {
        associations: allAssociations,
        entities,
        summary
      };

      // Cache the result
      this.setCache(cacheKey, result);

      return result;

    } catch (error) {
      console.error('❌ Error getting entity associations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get associations: ${message}`);
    }
  }

  // 🔍 GET EXPLICIT ASSOCIATIONS (from crm_associations collection)
  private async getExplicitAssociations(entityType: string, entityId: string): Promise<UnifiedAssociation[]> {
    const associationsRef = collection(db, 'tenants', this.tenantId, 'crm_associations');
    
    // Query where entity is source
    const sourceQuery = query(
      associationsRef,
      where('sourceEntityType', '==', entityType),
      where('sourceEntityId', '==', entityId)
    );
    const sourceSnapshot = await getDocs(sourceQuery);
    const sourceAssociations = sourceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UnifiedAssociation[];

    // Query where entity is target
    const targetQuery = query(
      associationsRef,
      where('targetEntityType', '==', entityType),
      where('targetEntityId', '==', entityId)
    );
    const targetSnapshot = await getDocs(targetQuery);
    const targetAssociations = targetSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UnifiedAssociation[];

    return [...sourceAssociations, ...targetAssociations];
  }

  // 🔍 GET IMPLICIT ASSOCIATIONS (from entity document fields)
  private async getImplicitAssociations(entityType: string, entityId: string): Promise<UnifiedAssociation[]> {
    const associations: UnifiedAssociation[] = [];

    try {
      // Get the entity document
      const collectionPath = this.getCollectionPath(entityType);
      const entityRef = doc(db, collectionPath, entityId);
      const entityDoc = await getDoc(entityRef);

      if (!entityDoc.exists()) {
        console.log(`⚠️ Entity document not found: ${entityType}:${entityId}`);
        return associations;
      }

      const entityData = entityDoc.data();
      console.log(`📊 Entity data for implicit associations:`, entityData);

      // Handle different entity types
      switch (entityType) {
        case 'deal':
          // Deal has contactIds, salespeopleIds, companyId, locationId
          if (entityData.contactIds && entityData.contactIds.length > 0) {
            entityData.contactIds.forEach((contactId: string) => {
              associations.push({
                id: `implicit_${entityId}_contact_${contactId}`,
                sourceEntityType: 'deal',
                sourceEntityId: entityId,
                targetEntityType: 'contact',
                targetEntityId: contactId,
                associationType: 'involvement',
                strength: 'strong',
                metadata: { source: 'contactIds' },
                createdAt: entityData.createdAt || serverTimestamp(),
                updatedAt: entityData.updatedAt || serverTimestamp()
              });
            });
          }

          if (entityData.salespeopleIds && entityData.salespeopleIds.length > 0) {
            entityData.salespeopleIds.forEach((salespersonId: string) => {
              associations.push({
                id: `implicit_${entityId}_salesperson_${salespersonId}`,
                sourceEntityType: 'deal',
                sourceEntityId: entityId,
                targetEntityType: 'salesperson',
                targetEntityId: salespersonId,
                associationType: 'assignment',
                strength: 'strong',
                metadata: { source: 'salespeopleIds' },
                createdAt: entityData.createdAt || serverTimestamp(),
                updatedAt: entityData.updatedAt || serverTimestamp()
              });
            });
          }

          if (entityData.salesOwnerId) {
            associations.push({
              id: `implicit_${entityId}_salesowner_${entityData.salesOwnerId}`,
              sourceEntityType: 'deal',
              sourceEntityId: entityId,
              targetEntityType: 'salesperson',
              targetEntityId: entityData.salesOwnerId,
              associationType: 'ownership',
              strength: 'strong',
              metadata: { source: 'salesOwnerId' },
              createdAt: entityData.createdAt || serverTimestamp(),
              updatedAt: entityData.updatedAt || serverTimestamp()
            });
          }

          if (entityData.companyId) {
            associations.push({
              id: `implicit_${entityId}_company_${entityData.companyId}`,
              sourceEntityType: 'deal',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: entityData.companyId,
              associationType: 'primary',
              strength: 'strong',
              metadata: { source: 'companyId' },
              createdAt: entityData.createdAt || serverTimestamp(),
              updatedAt: entityData.updatedAt || serverTimestamp()
            });
          }

          if (entityData.locationId) {
            associations.push({
              id: `implicit_${entityId}_location_${entityData.locationId}`,
              sourceEntityType: 'deal',
              sourceEntityId: entityId,
              targetEntityType: 'location',
              targetEntityId: entityData.locationId,
              associationType: 'primary',
              strength: 'medium',
              metadata: { source: 'locationId' },
              createdAt: entityData.createdAt || serverTimestamp(),
              updatedAt: entityData.updatedAt || serverTimestamp()
            });
          }
          break;

        case 'task':
          // Task has associations field with arrays
          if (entityData.associations) {
            Object.entries(entityData.associations).forEach(([type, ids]) => {
              if (Array.isArray(ids)) {
                ids.forEach((targetId: string) => {
                  associations.push({
                    id: `implicit_${entityId}_${type}_${targetId}`,
                    sourceEntityType: 'task',
                    sourceEntityId: entityId,
                    targetEntityType: type.slice(0, -1), // Remove 's' to get singular
                    targetEntityId: targetId,
                    associationType: 'involvement',
                    strength: 'medium',
                    metadata: { source: 'associations' },
                    createdAt: entityData.createdAt || serverTimestamp(),
                    updatedAt: entityData.updatedAt || serverTimestamp()
                  });
                });
              }
            });
          }
          break;

        case 'contact':
          // Contact has companyId, deals, etc.
          if (entityData.companyId) {
            associations.push({
              id: `implicit_${entityId}_company_${entityData.companyId}`,
              sourceEntityType: 'contact',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: entityData.companyId,
              associationType: 'primary',
              strength: 'strong',
              metadata: { source: 'companyId' },
              createdAt: entityData.createdAt || serverTimestamp(),
              updatedAt: entityData.updatedAt || serverTimestamp()
            });
          }

          // Handle deals from associations.deals
          if (entityData.associations && entityData.associations.deals && Array.isArray(entityData.associations.deals)) {
            entityData.associations.deals.forEach((dealEntry: any) => {
              // Handle both string IDs and object entries with id field
              const dealId = typeof dealEntry === 'string' ? dealEntry : (dealEntry?.id || '');
              if (dealId && typeof dealId === 'string') {
                associations.push({
                  id: `implicit_${entityId}_deal_${dealId}`,
                  sourceEntityType: 'contact',
                  sourceEntityId: entityId,
                  targetEntityType: 'deal',
                  targetEntityId: dealId,
                  associationType: 'involvement',
                  strength: 'strong',
                  metadata: { source: 'associations.deals' },
                  createdAt: entityData.createdAt || serverTimestamp(),
                  updatedAt: entityData.updatedAt || serverTimestamp()
                });
              }
            });
          }
          break;

        default:
          console.log(`⚠️ No implicit association logic for entity type: ${entityType}`);
      }

    } catch (error) {
      console.error('❌ Error getting implicit associations:', error);
    }

    return associations;
  }

  // 🔄 MERGE AND DEDUPLICATE ASSOCIATIONS
  private mergeAssociations(associations: UnifiedAssociation[]): UnifiedAssociation[] {
    const uniqueAssociations = new Map<string, UnifiedAssociation>();

    associations.forEach(association => {
      // Create a unique key based on source, target, and type
      const key = `${association.sourceEntityType}:${association.sourceEntityId}:${association.targetEntityType}:${association.targetEntityId}:${association.associationType}`;
      
      if (!uniqueAssociations.has(key)) {
        uniqueAssociations.set(key, association);
      } else {
        // If duplicate exists, prefer the one with higher strength
        const existing = uniqueAssociations.get(key)!;
        const strengthOrder = { 'strong': 3, 'medium': 2, 'weak': 1 };
        if (strengthOrder[association.strength] > strengthOrder[existing.strength]) {
          uniqueAssociations.set(key, association);
        }
      }
    });

    return Array.from(uniqueAssociations.values());
  }

  // (removed unused loadAssociatedEntities; using loadEssentialEntities instead)

  // 🔍 LOAD ESSENTIAL ENTITIES (contacts, salespeople, companies, and locations)
  private async loadEssentialEntities(associations: UnifiedAssociation[]): Promise<UnifiedAssociationResult['entities']> {
    const entities: UnifiedAssociationResult['entities'] = {
      companies: [] as any[],
      locations: [] as any[],
      contacts: [] as any[],
      deals: [] as any[],
      salespeople: [] as any[],
      tasks: [] as any[]
    };

    // Group entity IDs by type (essential types for Deal Details)
    const entityIds = {
      companies: new Set<string>(),
      locations: new Set<string>(),
      contacts: new Set<string>(),
      deals: new Set<string>(),
      salespeople: new Set<string>()
    };

    associations.forEach(association => {
      // Add source entity
      const sourceType = this.getPluralType(association.sourceEntityType);
      if (entityIds[sourceType as keyof typeof entityIds]) {
        entityIds[sourceType as keyof typeof entityIds].add(association.sourceEntityId);
      }

      // Add target entity
      const targetType = this.getPluralType(association.targetEntityType);
      if (entityIds[targetType as keyof typeof entityIds]) {
        entityIds[targetType as keyof typeof entityIds].add(association.targetEntityId);
      }
    });

    // Load essential entities with timeout
    const loadPromises = [];
    const timeout = 10000; // 10 second timeout

    // Load companies with timeout
    if (entityIds.companies.size > 0) {
      const companiesPromise = this.loadEntitiesBatch('crm_companies', Array.from(entityIds.companies))
        .then(companies => entities.companies.push(...companies))
        .catch(err => console.warn('⚠️ Failed to load companies:', err));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Companies load timeout')), timeout)
      );
      
      loadPromises.push(Promise.race([companiesPromise, timeoutPromise]).catch(() => {
        console.warn('⚠️ Companies load timed out, continuing with empty companies');
      }));
    }

    // Load locations with timeout
    if (entityIds.locations.size > 0) {
      const locationsPromise = this.loadLocationsBatch(Array.from(entityIds.locations))
        .then(locations => entities.locations.push(...locations))
        .catch(err => console.warn('⚠️ Failed to load locations:', err));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Locations load timeout')), timeout)
      );
      
      loadPromises.push(Promise.race([locationsPromise, timeoutPromise]).catch(() => {
        console.warn('⚠️ Locations load timed out, continuing with empty locations');
      }));
    }

    // Load contacts with timeout
    if (entityIds.contacts.size > 0) {
      const contactsPromise = this.loadEntitiesBatch('crm_contacts', Array.from(entityIds.contacts))
        .then(contacts => entities.contacts.push(...contacts))
        .catch(err => console.warn('⚠️ Failed to load contacts:', err));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Contacts load timeout')), timeout)
      );
      
      loadPromises.push(Promise.race([contactsPromise, timeoutPromise]).catch(() => {
        console.warn('⚠️ Contacts load timed out, continuing with empty contacts');
      }));
    }

    // Load salespeople with timeout
    if (entityIds.salespeople.size > 0) {
      const salespeoplePromise = this.loadSalespeopleBatch(Array.from(entityIds.salespeople))
        .then(salespeople => entities.salespeople.push(...salespeople))
        .catch(err => console.warn('⚠️ Failed to load salespeople:', err));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Salespeople load timeout')), timeout)
      );
      
      loadPromises.push(Promise.race([salespeoplePromise, timeoutPromise]).catch(() => {
        console.warn('⚠️ Salespeople load timed out, continuing with empty salespeople');
      }));
    }

    // Load deals with timeout
    if (entityIds.deals.size > 0) {
      const dealsPromise = this.loadEntitiesBatch('crm_deals', Array.from(entityIds.deals))
        .then(deals => entities.deals.push(...deals))
        .catch(err => console.warn('⚠️ Failed to load deals:', err));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Deals load timeout')), timeout)
      );
      
      loadPromises.push(Promise.race([dealsPromise, timeoutPromise]).catch(() => {
        console.warn('⚠️ Deals load timed out, continuing with empty deals');
      }));
    }

    // Wait for all essential entities to load (or timeout)
    await Promise.allSettled(loadPromises);

    return entities;
  }

  // 🔍 LOAD ENTITIES BATCH
  private async loadEntitiesBatch(collectionName: string, ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];

    // Filter out invalid IDs
    const validIds = ids.filter(id => id && typeof id === 'string' && id.trim() !== '');
    if (validIds.length === 0) return [];

    const entities: any[] = [];
    const batchSize = 10; // Firestore limit for 'in' queries

    for (let i = 0; i < validIds.length; i += batchSize) {
      const batch = validIds.slice(i, i + batchSize);
      const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
      const q = query(collectionRef, where('__name__', 'in', batch));
      const snapshot = await getDocs(q);
      
      snapshot.docs.forEach(doc => {
        entities.push({ id: doc.id, ...doc.data() });
      });
    }

    return entities;
  }

  // 🔍 LOAD SALESPEOPLE BATCH
  private async loadSalespeopleBatch(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];

    const salespeople = [];

    for (const id of ids) {
      try {
        // Try tenant users first
        let userDoc = await getDoc(doc(db, 'tenants', this.tenantId, 'users', id));
        
        if (!userDoc.exists()) {
          // Try global users
          userDoc = await getDoc(doc(db, 'users', id));
        }

        if (userDoc.exists()) {
          const userData = userDoc.data();
          salespeople.push({
            id: userDoc.id,
            firstName: userData.firstName || userData.name?.split(' ')[0] || '',
            lastName: userData.lastName || userData.name?.split(' ')[1] || '',
            email: userData.email || '',
            displayName: userData.displayName || '',
            ...userData
          });
        }
      } catch (error) {
        console.error(`❌ Error loading salesperson ${id}:`, error);
      }
    }

    return salespeople;
  }

  // 🔍 LOAD LOCATIONS BATCH
  private async loadLocationsBatch(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];

    const locations = [];

    for (const id of ids) {
      try {
        // Locations are in subcollections, so we need to query differently
        const locationsRef = collection(db, 'tenants', this.tenantId, 'crm_companies');
        const companiesSnapshot = await getDocs(locationsRef);
        
        for (const companyDoc of companiesSnapshot.docs) {
          const locationRef = doc(db, 'tenants', this.tenantId, 'crm_companies', companyDoc.id, 'locations', id);
          const locationDoc = await getDoc(locationRef);
          
          if (locationDoc.exists()) {
            locations.push({ id: locationDoc.id, ...locationDoc.data() });
            break; // Found the location, no need to continue
          }
        }
      } catch (error) {
        console.error(`❌ Error loading location ${id}:`, error);
      }
    }

    return locations;
  }

  // 🔍 GENERATE SUMMARY
  private generateSummary(associations: UnifiedAssociation[]): UnifiedAssociationResult['summary'] {
    const summary = {
      totalAssociations: associations.length,
      byType: {} as { [key: string]: number },
      byStrength: {} as { [key: string]: number }
    };

    associations.forEach(association => {
      // Count by association type
      summary.byType[association.associationType] = (summary.byType[association.associationType] || 0) + 1;
      
      // Count by strength
      summary.byStrength[association.strength] = (summary.byStrength[association.strength] || 0) + 1;
    });

    return summary;
  }

  // 🔧 UTILITY METHODS
  private getCollectionPath(entityType: string): string {
    const collectionMap: { [key: string]: string } = {
      'company': `tenants/${this.tenantId}/crm_companies`,
      'contact': `tenants/${this.tenantId}/crm_contacts`,
      'deal': `tenants/${this.tenantId}/crm_deals`,
      'task': `tenants/${this.tenantId}/crm_tasks`,
      'salesperson': 'users', // Global users collection
      'location': `tenants/${this.tenantId}/crm_companies` // Locations are subcollections
    };
    return collectionMap[entityType] || `tenants/${this.tenantId}/crm_${entityType}s`;
  }

  private getPluralType(singularType: string): string {
    const pluralMap: { [key: string]: string } = {
      'salesperson': 'salespeople',
      'person': 'people',
      'company': 'companies',
      'location': 'locations',
      'contact': 'contacts',
      'deal': 'deals',
      'task': 'tasks'
    };
    return pluralMap[singularType] || `${singularType}s`;
  }

  private getFromCache(key: string): UnifiedAssociationResult | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: UnifiedAssociationResult): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.CACHE_TTL
    });
  }

  // 🧹 CLEAR CACHE
  clearCache(): void {
    this.cache.clear();
  }

  // 🔍 QUERY ASSOCIATIONS (for backward compatibility)
  async queryAssociations(queryParams: UnifiedAssociationQuery): Promise<UnifiedAssociationResult> {
    const result = await this.getEntityAssociations(queryParams.entityType, queryParams.entityId);
    
    // Apply filters if specified
    let filteredAssociations = result.associations;

    if (queryParams.targetTypes && queryParams.targetTypes.length > 0) {
      filteredAssociations = filteredAssociations.filter(assoc => 
        queryParams.targetTypes!.includes(assoc.targetEntityType)
      );
    }

    if (queryParams.associationTypes && queryParams.associationTypes.length > 0) {
      filteredAssociations = filteredAssociations.filter(assoc => 
        queryParams.associationTypes!.includes(assoc.associationType)
      );
    }

    if (queryParams.strength && queryParams.strength.length > 0) {
      filteredAssociations = filteredAssociations.filter(assoc => 
        queryParams.strength!.includes(assoc.strength)
      );
    }

    if (queryParams.limit) {
      filteredAssociations = filteredAssociations.slice(0, queryParams.limit);
    }

    return {
      ...result,
      associations: filteredAssociations,
      summary: this.generateSummary(filteredAssociations)
    };
  }
}

// Factory function for backward compatibility
export const createUnifiedAssociationService = (tenantId: string, userId: string) => {
  return new UnifiedAssociationService(tenantId, userId);
}; 