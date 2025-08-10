import { 
  doc, 
  getDoc,
  collection,
  getDocs
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../firebase';

// 🎯 SIMPLE ASSOCIATION SERVICE
// Uses maps in each entity document instead of separate association documents

export interface SimpleAssociations {
  companies?: string[];
  deals?: string[];
  contacts?: string[];
  salespeople?: string[];
  tasks?: string[];
  locations?: string[];
}

export interface EntityWithAssociations {
  id: string;
  associations?: SimpleAssociations;
  [key: string]: any;
}

export class SimpleAssociationService {
  private tenantId: string;
  private userId: string;
  private functions: any;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(tenantId: string, userId: string) {
    this.tenantId = tenantId;
    this.userId = userId;
    this.functions = getFunctions();
  }

  // 🗑️ CLEAR CACHE
  private clearCache(): void {
    this.cache.clear();
  }

  // 🔍 GET CACHED DATA
  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`✅ Using cached data for: ${key}`);
      return cached.data;
    }
    if (cached) {
      console.log(`⏰ Cache expired for: ${key}`);
      this.cache.delete(key);
    }
    return null;
  }

  // 💾 SET CACHED DATA
  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    console.log(`💾 Cached data for: ${key}`);
  }

  // 🔗 ADD ASSOCIATION
  async addAssociation(
    sourceEntityType: string,
    sourceEntityId: string,
    targetEntityType: string,
    targetEntityId: string
  ): Promise<void> {
    try {
      console.log(`🔗 Adding association: ${sourceEntityType}:${sourceEntityId} → ${targetEntityType}:${targetEntityId}`);

      // Use Firebase Function for association management
      const manageAssociations = httpsCallable(this.functions, 'manageAssociations');
      
      const result = await manageAssociations({
        action: 'add',
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId,
        tenantId: this.tenantId
      });

      console.log(`✅ Added association via Firebase Function:`, result.data);

      // Clear cache for affected entities
      this.clearCache();

    } catch (error) {
      console.error('❌ Error adding association:', error);
      throw new Error(`Failed to add association: ${error.message}`);
    }
  }

  // 🗑️ REMOVE ASSOCIATION
  async removeAssociation(
    sourceEntityType: string,
    sourceEntityId: string,
    targetEntityType: string,
    targetEntityId: string
  ): Promise<void> {
    try {
      console.log(`🗑️ Removing association: ${sourceEntityType}:${sourceEntityId} → ${targetEntityType}:${targetEntityId}`);

      // Use Firebase Function for association management
      const manageAssociations = httpsCallable(this.functions, 'manageAssociations');
      
      const result = await manageAssociations({
        action: 'remove',
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId,
        tenantId: this.tenantId
      });

      console.log(`✅ Removed association via Firebase Function:`, result.data);

      // Clear cache for affected entities
      this.clearCache();

    } catch (error) {
      console.error('❌ Error removing association:', error);
      throw new Error(`Failed to remove association: ${error.message}`);
    }
  }

  // 🔍 GET ASSOCIATIONS
  async getAssociations(
    entityType: string,
    entityId: string
  ): Promise<{
    associations: SimpleAssociations;
    entities: {
      companies: any[];
      deals: any[];
      contacts: any[];
      salespeople: any[];
      tasks: any[];
      locations: any[];
    };
  }> {
    try {
      console.log(`🔍 Getting associations for ${entityType}:${entityId}`);

      // Check cache first
      const cacheKey = `associations_${entityType}_${entityId}`;
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      // Get entity document
      const collectionPath = this.getCollectionPath(entityType);
      const entityRef = doc(db, collectionPath, entityId);
      const entityDoc = await getDoc(entityRef);

      if (!entityDoc.exists()) {
        throw new Error(`Entity ${entityType}:${entityId} not found`);
      }

      const entityData = entityDoc.data();
      const associations = entityData.associations || {};

      console.log(`📊 Found associations:`, associations);

      // Load associated entities
      const entities = await this.loadAssociatedEntities(associations);

      const result = {
        associations,
        entities
      };

      // Cache the result
      this.setCachedData(cacheKey, result);

      return result;

    } catch (error) {
      console.error('❌ Error getting associations:', error);
      throw new Error(`Failed to get associations: ${error.message}`);
    }
  }

  // 🔄 LOAD ASSOCIATED ENTITIES
  private async loadAssociatedEntities(associations: SimpleAssociations): Promise<{
    companies: any[];
    deals: any[];
    contacts: any[];
    salespeople: any[];
    tasks: any[];
    locations: any[];
  }> {
    console.log(`🔍 loadAssociatedEntities called with associations:`, associations);
    
    // Load all entity types in parallel for better performance
    const loadPromises = {
      companies: associations.companies && associations.companies.length > 0 
        ? this.loadEntitiesBatch('crm_companies', associations.companies)
        : Promise.resolve([]),
      deals: associations.deals && associations.deals.length > 0 
        ? this.loadEntitiesBatch('crm_deals', associations.deals)
        : Promise.resolve([]),
      contacts: associations.contacts && associations.contacts.length > 0 
        ? this.loadEntitiesBatch('crm_contacts', associations.contacts)
        : Promise.resolve([]),
      salespeople: associations.salespeople && associations.salespeople.length > 0 
        ? this.loadUsersBatch(associations.salespeople)
        : Promise.resolve([]),
      tasks: associations.tasks && associations.tasks.length > 0 
        ? this.loadEntitiesBatch('crm_tasks', associations.tasks)
        : Promise.resolve([]),
      locations: associations.locations && associations.locations.length > 0 
        ? this.loadLocationsOptimized(associations.locations)
        : Promise.resolve([])
    };

    // Wait for all loads to complete in parallel
    const [companies, deals, contacts, salespeople, tasks, locations] = await Promise.all([
      loadPromises.companies,
      loadPromises.deals,
      loadPromises.contacts,
      loadPromises.salespeople,
      loadPromises.tasks,
      loadPromises.locations
    ]);

    const entities = {
      companies,
      deals,
      contacts,
      salespeople,
      tasks,
      locations
    };

    console.log(`✅ loadAssociatedEntities completed, returning:`, entities);
    return entities;
  }

  // 🔄 LOAD ENTITIES BY IDS (BATCH OPTIMIZED)
  private async loadEntitiesBatch(collectionName: string, entityIds: string[]): Promise<any[]> {
    if (entityIds.length === 0) return [];

    const entities: any[] = [];
    const batchSize = 10; // Firestore batch limit is 10
    
    // Process in batches to avoid overwhelming Firestore
    for (let i = 0; i < entityIds.length; i += batchSize) {
      const batch = entityIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (entityId) => {
        try {
          const collectionPath = this.getCollectionPath(collectionName.replace('crm_', ''));
          const entityRef = doc(db, collectionPath, entityId);
          const entityDoc = await getDoc(entityRef);

          if (entityDoc.exists()) {
            return {
              id: entityDoc.id,
              ...entityDoc.data()
            };
          }
          return null;
        } catch (error) {
          console.error(`❌ Error loading entity ${entityId}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      entities.push(...batchResults.filter(entity => entity !== null));
    }

    return entities;
  }

  // 👥 LOAD USERS (SALESPEOPLE) - BATCH OPTIMIZED
  private async loadUsersBatch(userIds: string[]): Promise<any[]> {
    if (userIds.length === 0) return [];

    const users: any[] = [];
    const batchSize = 10;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (userId) => {
        try {
          const userRef = doc(db, 'users', userId);
          const userDoc = await getDoc(userRef);

          if (userDoc.exists()) {
            const userData = userDoc.data();
            // Only include users with CRM sales access
            if (userData.crm_sales) {
              return {
                id: userDoc.id,
                ...userData
              };
            }
          }
          return null;
        } catch (error) {
          console.error(`❌ Error loading user ${userId}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      users.push(...batchResults.filter(user => user !== null));
    }

    return users;
  }

  // 🏢 LOAD LOCATIONS (OPTIMIZED VERSION)
  private async loadLocationsOptimized(locationIds: string[]): Promise<any[]> {
    console.log(`🔍 Loading ${locationIds.length} locations (optimized):`, locationIds);
    
    if (locationIds.length === 0) return [];

    try {
      // Get all companies once
      const companiesRef = collection(db, `tenants/${this.tenantId}/crm_companies`);
      const companiesSnapshot = await getDocs(companiesRef);
      
      if (companiesSnapshot.empty) {
        console.log('⚠️ No companies found for location search');
        return [];
      }

      const companies = companiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Array<{ id: string; companyName?: string; name?: string; [key: string]: any }>;

      // Create a map of company IDs for faster lookup
      const companyMap = new Map(companies.map(company => [company.id, company]));

      // Load all locations in parallel with optimized company lookup
      const locationPromises = locationIds.map(async (locationId) => {
        try {
          // Search through companies in parallel
          const companyPromises = companies.map(async (company) => {
            const locationRef = doc(db, `tenants/${this.tenantId}/crm_companies/${company.id}/locations`, locationId);
            const locationDoc = await getDoc(locationRef);
            
            if (locationDoc.exists()) {
              return {
                id: locationDoc.id,
                companyId: company.id,
                companyName: company.companyName || company.name || 'Unknown Company',
                ...locationDoc.data()
              };
            }
            return null;
          });

          const results = await Promise.all(companyPromises);
          const foundLocation = results.find(result => result !== null);
          
          if (foundLocation) {
            console.log(`✅ Found location ${locationId} in company ${foundLocation.companyId}`);
            return foundLocation;
          }
          
          console.log(`⚠️ Location ${locationId} not found in any company`);
          return null;
        } catch (error) {
          console.error(`❌ Error loading location ${locationId}:`, error);
          return null;
        }
      });

      const locationResults = await Promise.all(locationPromises);
      const validLocations = locationResults.filter(location => location !== null);
      
      console.log(`✅ Loaded ${validLocations.length} locations:`, validLocations);
      return validLocations;
      
    } catch (error) {
      console.error('❌ Error loading locations:', error);
      return [];
    }
  }

  // 🛣️ GET COLLECTION PATH
  private getCollectionPath(entityType: string): string {
    const collectionMap: { [key: string]: string } = {
      'company': `tenants/${this.tenantId}/crm_companies`,
      'companies': `tenants/${this.tenantId}/crm_companies`,
      'deal': `tenants/${this.tenantId}/crm_deals`,
      'deals': `tenants/${this.tenantId}/crm_deals`,
      'contact': `tenants/${this.tenantId}/crm_contacts`,
      'contacts': `tenants/${this.tenantId}/crm_contacts`,
      'salesperson': `users`,
      'salespeople': `users`,
      'task': `tenants/${this.tenantId}/crm_tasks`,
      'tasks': `tenants/${this.tenantId}/crm_tasks`,
      // Note: Locations are stored as subcollections under companies, not as a top-level collection
      'location': `tenants/${this.tenantId}/crm_companies`, // This will need special handling
      'locations': `tenants/${this.tenantId}/crm_companies`  // This will need special handling
    };

    return collectionMap[entityType] || `tenants/${this.tenantId}/crm_${entityType}s`;
  }
}

// 🎯 FACTORY FUNCTION
export const createSimpleAssociationService = (tenantId: string, userId: string): SimpleAssociationService => {
  return new SimpleAssociationService(tenantId, userId);
};