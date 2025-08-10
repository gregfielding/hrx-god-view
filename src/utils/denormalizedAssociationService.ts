import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../firebase';

// Types for denormalized associations
export interface DenormalizedAssociations {
  companies: {
    id: string;
    name: string;
    type: 'primary' | 'secondary';
  }[];
  contacts: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  }[];
  salespeople: {
    id: string;
    name: string;
    email?: string;
  }[];
  locations: {
    id: string;
    name: string;
    address?: string;
  }[];
  deals: {
    id: string;
    name: string;
    stage?: string;
    value?: number;
  }[];
  divisions: {
    id: string;
    name: string;
  }[];
  tasks: {
    id: string;
    title: string;
    status?: string;
  }[];
  lastUpdated: any;
}

export interface AssociationUpdate {
  entityType: 'deal' | 'company' | 'contact' | 'salesperson' | 'location' | 'division' | 'task';
  entityId: string;
  tenantId: string;
  associations: DenormalizedAssociations;
}

export class DenormalizedAssociationService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  // 🚀 INSTANT LOADING - No queries needed!
  async getAssociations(entityType: string, entityId: string): Promise<DenormalizedAssociations> {
    try {
      const collectionPath = this.getCollectionPath(entityType);
      console.log(`🔍 Getting associations from: ${collectionPath}/${entityId}`);
      
      const entityRef = doc(db, collectionPath, entityId);
      const entityDoc = await getDoc(entityRef);

      if (!entityDoc.exists()) {
        console.log(`❌ Entity ${entityType}:${entityId} not found`);
        throw new Error(`Entity ${entityType}:${entityId} not found`);
      }

      const entityData = entityDoc.data();
      console.log(`📄 Entity data:`, entityData);
      console.log(`🔗 Associations field:`, entityData.associations);
      
      const rawAssociations = entityData.associations || this.getEmptyAssociations();
      const result = this.convertAssociationsToUnifiedFormat(rawAssociations);
      console.log(`✅ Returning associations:`, result);
      return result;
    } catch (error) {
      console.error('Error loading denormalized associations:', error);
      return this.getEmptyAssociations();
    }
  }

  // 🔄 UPDATE ASSOCIATIONS (triggers cloud function to sync)
  async updateAssociations(
    entityType: string,
    entityId: string,
    associations: Partial<DenormalizedAssociations>
  ): Promise<void> {
    try {
      const collectionPath = this.getCollectionPath(entityType);
      const entityRef = doc(db, collectionPath, entityId);

      // Update the associations field
      await updateDoc(entityRef, {
        associations: {
          ...associations,
          lastUpdated: serverTimestamp()
        }
      });

      // The cloud function will handle syncing to other entities
      console.log(`✅ Updated associations for ${entityType}:${entityId}`);
    } catch (error) {
      console.error('Error updating associations:', error);
      throw error;
    }
  }

  // ➕ ADD ASSOCIATION
  async addAssociation(
    entityType: string,
    entityId: string,
    targetType: keyof DenormalizedAssociations,
    targetEntity: any
  ): Promise<void> {
    try {
      const currentAssociations = await this.getAssociations(entityType, entityId);
      
      // Ensure targetEntity has the required structure for quick reference
      const normalizedTargetEntity = this.normalizeAssociationObject(targetEntity, targetType);
      
      const updatedAssociations = {
        ...currentAssociations,
        [targetType]: [...(currentAssociations[targetType] || []), normalizedTargetEntity]
      };

      await this.updateAssociations(entityType, entityId, updatedAssociations);
    } catch (error) {
      console.error('Error adding association:', error);
      throw error;
    }
  }

  // 🔧 NORMALIZE ASSOCIATION OBJECT
  private normalizeAssociationObject(entity: any, type: keyof DenormalizedAssociations): any {
    // If it's already an object with id and name, return as is
    if (entity && typeof entity === 'object' && entity.id && entity.name) {
      return entity;
    }
    
    // If it's just an ID, we need to fetch the full entity data
    // For now, return a basic structure - in production, you'd fetch the full data
    if (typeof entity === 'string') {
      return {
        id: entity,
        name: 'Unknown', // This should be fetched from the actual entity
        email: '',
        phone: '',
        type: type === 'companies' ? 'primary' : undefined
      };
    }
    
    // If it's an object but missing required fields, normalize it
    return {
      id: entity.id || entity._id || 'unknown',
      name: entity.name || entity.fullName || entity.companyName || entity.title || 'Unknown',
      email: entity.email || '',
      phone: entity.phone || '',
      type: type === 'companies' ? 'primary' : undefined
    };
  }

  // 🔄 CONVERT ASSOCIATIONS TO UNIFIED FORMAT
  private convertAssociationsToUnifiedFormat(associations: any): DenormalizedAssociations {
    const result: DenormalizedAssociations = {
      companies: [],
      contacts: [],
      salespeople: [],
      locations: [],
      deals: [],
      divisions: [],
      tasks: [],
      lastUpdated: associations.lastUpdated || null
    };

    // Helper function to convert array items to objects
    const convertArray = (array: any[], type: keyof DenormalizedAssociations): any[] => {
      if (!Array.isArray(array)) return [];
      
      return array.map(item => {
        if (typeof item === 'string') {
          // Convert string ID to object format
          return {
            id: item,
            name: 'Unknown', // Will be populated when entity data is loaded
            email: '',
            phone: '',
            type: type === 'companies' ? 'primary' : undefined
          };
        } else if (item && typeof item === 'object') {
          // Ensure object has required fields
          return {
            id: item.id || item._id || 'unknown',
            name: item.name || item.fullName || item.companyName || item.title || 'Unknown',
            email: item.email || '',
            phone: item.phone || '',
            type: type === 'companies' ? 'primary' : undefined
          };
        }
        return item;
      });
    };

    // Convert each association type
    result.companies = convertArray(associations.companies, 'companies');
    result.contacts = convertArray(associations.contacts, 'contacts');
    result.salespeople = convertArray(associations.salespeople, 'salespeople');
    result.locations = convertArray(associations.locations, 'locations');
    result.deals = convertArray(associations.deals, 'deals');
    result.divisions = convertArray(associations.divisions, 'divisions');
    result.tasks = convertArray(associations.tasks, 'tasks');

    return result;
  }

  // ➖ REMOVE ASSOCIATION
  async removeAssociation(
    entityType: string,
    entityId: string,
    targetType: keyof DenormalizedAssociations,
    targetEntityId: string
  ): Promise<void> {
    try {
      const currentAssociations = await this.getAssociations(entityType, entityId);
      const updatedAssociations = {
        ...currentAssociations,
        [targetType]: (currentAssociations[targetType] || []).filter(
          (entity: any) => entity.id !== targetEntityId
        )
      };

      await this.updateAssociations(entityType, entityId, updatedAssociations);
    } catch (error) {
      console.error('Error removing association:', error);
      throw error;
    }
  }

  // 🔍 GET COLLECTION PATH
  private getCollectionPath(entityType: string): string {
    const collectionMap: { [key: string]: string } = {
      deal: `tenants/${this.tenantId}/crm_deals`,
      company: `tenants/${this.tenantId}/crm_companies`,
      contact: `tenants/${this.tenantId}/crm_contacts`,
      salesperson: `tenants/${this.tenantId}/crm_salespeople`,
      location: `tenants/${this.tenantId}/crm_locations`,
      division: `tenants/${this.tenantId}/crm_divisions`,
      task: `tenants/${this.tenantId}/crm_tasks`
    };

    return collectionMap[entityType] || `tenants/${this.tenantId}/${entityType}s`;
  }

  // 📦 GET EMPTY ASSOCIATIONS
  private getEmptyAssociations(): DenormalizedAssociations {
    return {
      companies: [],
      contacts: [],
      salespeople: [],
      locations: [],
      deals: [],
      divisions: [],
      tasks: [],
      lastUpdated: null
    };
  }

  // ⚡ BULK LOAD MULTIPLE ENTITIES
  async getMultipleAssociations(
    entities: Array<{ type: string; id: string }>
  ): Promise<{ [key: string]: DenormalizedAssociations }> {
    const results: { [key: string]: DenormalizedAssociations } = {};

    // Load all entities in parallel
    const loadPromises = entities.map(async ({ type, id }) => {
      const key = `${type}_${id}`;
      try {
        results[key] = await this.getAssociations(type, id);
      } catch (error) {
        console.error(`Error loading associations for ${type}:${id}:`, error);
        results[key] = this.getEmptyAssociations();
      }
    });

    await Promise.all(loadPromises);
    return results;
  }
}

// Factory function
export const createDenormalizedAssociationService = (tenantId: string) => {
  return new DenormalizedAssociationService(tenantId);
};
