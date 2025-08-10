import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  serverTimestamp,
  limit as firestoreLimit
} from 'firebase/firestore';

import { db } from '../firebase';
import { companyConverter, contactConverter, dealConverter } from '../firebase/converters';
import { 
  CRMAssociation, 
  AssociationQuery, 
  AssociationResult,
  CRMCompany,
  CRMLocation,
  CRMContact,
  CRMDeal
} from '../types/CRM';

// 🎯 UNIVERSAL ASSOCIATION SERVICE
// This service provides bulletproof, scalable association management for the entire CRM system

export class AssociationService {
  private tenantId: string;
  private userId: string;
  
  // Caching system for performance optimization
  private cache = {
    entities: new Map<string, { data: any; timestamp: number; ttl: number }>(),
    associations: new Map<string, { data: any; timestamp: number; ttl: number }>(),
    availableEntities: new Map<string, { data: any; timestamp: number; ttl: number }>()
  };
  
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(tenantId: string, userId: string) {
    this.tenantId = tenantId;
    this.userId = userId;
  }

  // Cache management methods
  private getCacheKey(type: string, ...params: any[]): string {
    return `${type}:${this.tenantId}:${params.join(':')}`;
  }

  private getFromCache<T>(cacheMap: Map<string, { data: any; timestamp: number; ttl: number }>, key: string): T | null {
    const cached = cacheMap.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      cacheMap.delete(key);
      return null;
    }
    
    return cached.data as T;
  }

  private setCache<T>(cacheMap: Map<string, { data: any; timestamp: number; ttl: number }>, key: string, data: T): void {
    cacheMap.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.CACHE_TTL
    });
  }

  private clearCache(type?: string): void {
    if (type) {
      this.cache[type as keyof typeof this.cache]?.clear();
    } else {
      Object.values(this.cache).forEach(cacheMap => cacheMap.clear());
    }
  }

  // 🔗 CREATE ASSOCIATION
  async createAssociation(
    sourceEntityType: CRMAssociation['sourceEntityType'],
    sourceEntityId: string,
    targetEntityType: CRMAssociation['targetEntityType'],
    targetEntityId: string,
    associationType: CRMAssociation['associationType'] = 'primary',
    role?: string,
    strength: CRMAssociation['strength'] = 'medium',
    metadata?: CRMAssociation['metadata']
  ): Promise<string> {
    try {
      // Validate entities exist
      await this.validateEntityExists(sourceEntityType, sourceEntityId);
      await this.validateEntityExists(targetEntityType, targetEntityId);

      // Check for existing association
      const existingAssociation = await this.findAssociation(
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId
      );

      if (existingAssociation) {
        // Update existing association
        const updateData: any = {
          associationType,
          strength,
          updatedAt: serverTimestamp(),
          updatedBy: this.userId
        };
        if (role !== undefined) updateData.role = role;
        if (metadata !== undefined) updateData.metadata = metadata;
        await this.updateAssociation(existingAssociation.id, updateData);
        return existingAssociation.id;
      }

      // Create new association - filter out undefined values
      const associationData: any = {
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId,
        associationType,
        strength,
        tenantId: this.tenantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: this.userId,
        updatedBy: this.userId
      };

      // Only add optional fields if they have values
      if (role !== undefined) associationData.role = role;
      if (metadata !== undefined) associationData.metadata = metadata;

      const docRef = await addDoc(
        collection(db, 'tenants', this.tenantId, 'crm_associations'),
        associationData
      );

      // Update association counts on both entities
      await this.updateAssociationCounts(sourceEntityType, sourceEntityId, targetEntityType, 1);
      await this.updateAssociationCounts(targetEntityType, targetEntityId, sourceEntityType, 1);

      // Clear relevant caches
      this.clearCache('associations');

      console.log(`✅ Created association: ${sourceEntityType}:${sourceEntityId} → ${targetEntityType}:${targetEntityId}`);
      return docRef.id;

    } catch (error) {
      console.error('❌ Error creating association:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create association: ${message}`);
    }
  }

  // 🔍 FIND ASSOCIATION
  async findAssociation(
    sourceEntityType: string,
    sourceEntityId: string,
    targetEntityType: string,
    targetEntityId: string
  ): Promise<CRMAssociation | null> {
    try {
      const associationsRef = collection(db, 'tenants', this.tenantId, 'crm_associations');
      const q = query(
        associationsRef,
        where('sourceEntityType', '==', sourceEntityType),
        where('sourceEntityId', '==', sourceEntityId),
        where('targetEntityType', '==', targetEntityType),
        where('targetEntityId', '==', targetEntityId)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() } as CRMAssociation;

    } catch (error) {
      console.error('❌ Error finding association:', error);
      return null;
    }
  }

  // 🔄 UPDATE ASSOCIATION
  async updateAssociation(associationId: string, updates: Partial<CRMAssociation>): Promise<void> {
    try {
      const associationRef = doc(db, 'tenants', this.tenantId, 'crm_associations', associationId);
      
      // Filter out undefined values from updates
      const filteredUpdates: any = {
        updatedAt: serverTimestamp(),
        updatedBy: this.userId
      };
      
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          filteredUpdates[key] = value;
        }
      });
      
      await updateDoc(associationRef, filteredUpdates);

      console.log(`✅ Updated association: ${associationId}`);

    } catch (error) {
      console.error('❌ Error updating association:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update association: ${message}`);
    }
  }

  // 🗑️ DELETE ASSOCIATION
  async deleteAssociation(associationId: string): Promise<void> {
    try {
      console.log(`🗑️ Attempting to delete association: ${associationId}`);
      
      // Check if this is an implicit association (starts with "implicit_")
      if (associationId.startsWith('implicit_')) {
        console.log('📋 This is an implicit association, updating source entity field');
        
        // Parse the implicit association ID: implicit_{sourceId}_{targetType}_{targetId}
        const parts = associationId.split('_');
        if (parts.length !== 4) {
          throw new Error('Invalid implicit association ID format');
        }
        
        const sourceEntityId = parts[1];
        const targetEntityType = parts[2];
        const targetEntityId = parts[3];
        
        // Determine the source entity type and field to update
        let sourceEntityType: string | null = null;
        
        // Try to determine source entity type by checking different collections
        const collections = ['crm_companies', 'crm_contacts', 'crm_deals'];
        
        for (const collection of collections) {
          try {
            const entityRef = doc(db, 'tenants', this.tenantId, collection, sourceEntityId);
            const entityDoc = await getDoc(entityRef);
            if (entityDoc.exists()) {
              sourceEntityType = collection.replace('crm_', '');
              break;
            }
          } catch (error) {
            continue;
          }
        }
        
        if (!sourceEntityType) {
          throw new Error('Could not determine source entity type for implicit association');
        }
        
        // Map target entity type to the field name in the source entity
        const fieldMap: { [key: string]: string } = {
          'company': 'companyId',
          'contact': 'contactIds',
          'location': 'locationId',
          'salesperson': 'salesOwnerId',
          'deal': 'dealIds'
        };
        
        const fieldToUpdate = fieldMap[targetEntityType];
        if (!fieldToUpdate) {
          throw new Error(`Unknown target entity type: ${targetEntityType}`);
        }
        
        // Update the source entity to remove the association
        const sourceEntityRef = doc(db, 'tenants', this.tenantId, `crm_${(sourceEntityType as string)}s`, sourceEntityId);
        const sourceEntityDoc = await getDoc(sourceEntityRef);
        
        if (!sourceEntityDoc.exists()) {
          throw new Error('Source entity not found');
        }
        
        const sourceEntityData = sourceEntityDoc.data() as any;
        const updates: any = {};
        
        if (fieldToUpdate === 'contactIds' || fieldToUpdate === 'dealIds') {
          // Handle array fields - remove the target ID from the array
          const currentArray = sourceEntityData[fieldToUpdate] || [];
          const updatedArray = currentArray.filter((id: string) => id !== targetEntityId);
          updates[fieldToUpdate] = updatedArray;
        } else {
          // Handle single ID fields - set to null or empty string
          updates[fieldToUpdate] = null;
        }
        
        // Add timestamp
        updates.updatedAt = serverTimestamp();
        updates.updatedBy = this.userId;
        
        await updateDoc(sourceEntityRef, updates);
        
        console.log(`✅ Updated source entity ${sourceEntityType}:${sourceEntityId} to remove ${targetEntityType}:${targetEntityId} association`);
        
        // Clear relevant caches
        this.clearCache('associations');
        
        return;
      }
      
      // Handle explicit associations (actual Firestore documents)
      const associationRef = doc(db, 'tenants', this.tenantId, 'crm_associations', associationId);
      const associationDoc = await getDoc(associationRef);
      
      if (!associationDoc.exists()) {
        console.error(`❌ Association document not found: ${associationId}`);
        throw new Error('Association not found');
      }

      const association = associationDoc.data() as CRMAssociation;
      console.log(`📋 Found association to delete:`, association);

      // Delete the association
      await deleteDoc(associationRef);
      console.log(`✅ Deleted association document: ${associationId}`);

      // Update association counts on both entities
      await this.updateAssociationCounts(
        association.sourceEntityType,
        association.sourceEntityId,
        association.targetEntityType,
        -1
      );
      await this.updateAssociationCounts(
        association.targetEntityType,
        association.targetEntityId,
        association.sourceEntityType,
        -1
      );

      // Clear relevant caches
      this.clearCache('associations');

      console.log(`✅ Successfully deleted association: ${associationId}`);

    } catch (error) {
      console.error('❌ Error deleting association:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete association: ${message}`);
    }
  }

  // 🔍 QUERY ASSOCIATIONS
  async queryAssociations(queryParams: AssociationQuery): Promise<AssociationResult> {
    try {
      // Check cache first
      const cacheKey = this.getCacheKey('associations', 
        queryParams.entityType, 
        queryParams.entityId, 
        queryParams.targetTypes?.join(','), 
        queryParams.associationTypes?.join(','), 
        queryParams.strength?.join(','), 
        queryParams.limit
      );
      const cached = this.getFromCache<AssociationResult>(this.cache.associations, cacheKey);
      if (cached) {
        console.log('✅ Using cached associations data');
        return cached;
      }

      // Get explicit associations from crm_associations collection
      const associationsRef = collection(db, 'tenants', this.tenantId, 'crm_associations');
      
      // Query for associations where current entity is the source
      let sourceQuery = query(
        associationsRef,
        where('sourceEntityType', '==', queryParams.entityType),
        where('sourceEntityId', '==', queryParams.entityId)
      );

      // Add target type filter if specified
      if (queryParams.targetTypes && queryParams.targetTypes.length > 0) {
        sourceQuery = query(sourceQuery, where('targetEntityType', 'in', queryParams.targetTypes));
      }

      // Add association type filter if specified
      if (queryParams.associationTypes && queryParams.associationTypes.length > 0) {
        sourceQuery = query(sourceQuery, where('associationType', 'in', queryParams.associationTypes));
      }

      // Add strength filter if specified
      if (queryParams.strength && queryParams.strength.length > 0) {
        sourceQuery = query(sourceQuery, where('strength', 'in', queryParams.strength));
      }

      // Add limit if specified
      if (queryParams.limit) {
        sourceQuery = query(sourceQuery, firestoreLimit(queryParams.limit));
      }

      const sourceSnapshot = await getDocs(sourceQuery);
      const sourceAssociations = sourceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CRMAssociation[];
      
      console.log(`🔍 Found ${sourceAssociations.length} source associations for ${queryParams.entityType}:${queryParams.entityId}`);
      sourceAssociations.forEach(assoc => {
        console.log(`   - SOURCE: ${assoc.id}: ${assoc.sourceEntityType}:${assoc.sourceEntityId} → ${assoc.targetEntityType}:${assoc.targetEntityId}`);
      });

      // Query for associations where current entity is the target
      let targetQuery = query(
        associationsRef,
        where('targetEntityType', '==', queryParams.entityType),
        where('targetEntityId', '==', queryParams.entityId)
      );

      // Add source type filter if specified (reverse the targetTypes to sourceTypes)
      if (queryParams.targetTypes && queryParams.targetTypes.length > 0) {
        targetQuery = query(targetQuery, where('sourceEntityType', 'in', queryParams.targetTypes));
      }

      // Add association type filter if specified
      if (queryParams.associationTypes && queryParams.associationTypes.length > 0) {
        targetQuery = query(targetQuery, where('associationType', 'in', queryParams.associationTypes));
      }

      // Add strength filter if specified
      if (queryParams.strength && queryParams.strength.length > 0) {
        targetQuery = query(targetQuery, where('strength', 'in', queryParams.strength));
      }

      // Add limit if specified
      if (queryParams.limit) {
        targetQuery = query(targetQuery, firestoreLimit(queryParams.limit));
      }

      const targetSnapshot = await getDocs(targetQuery);
      const targetAssociations = targetSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CRMAssociation[];
      
      console.log(`🔍 Found ${targetAssociations.length} target associations for ${queryParams.entityType}:${queryParams.entityId}`);
      targetAssociations.forEach(assoc => {
        console.log(`   - TARGET: ${assoc.id}: ${assoc.sourceEntityType}:${assoc.sourceEntityId} → ${assoc.targetEntityType}:${assoc.targetEntityId}`);
      });

      // Combine source and target associations
      const explicitAssociations = [...sourceAssociations, ...targetAssociations];

      // Get implicit associations from entity fields (like companyId, contactIds, etc.)
      const implicitAssociations = await this.getImplicitAssociations(queryParams.entityType, queryParams.entityId);
      
              console.log(`🔍 Found ${implicitAssociations.length} implicit associations for ${queryParams.entityType}:${queryParams.entityId}:`, implicitAssociations);
      implicitAssociations.forEach(assoc => {
        console.log(`   - IMPLICIT: ${assoc.sourceEntityType}:${assoc.sourceEntityId} → ${assoc.targetEntityType}:${assoc.targetEntityId}`);
      });

      // Combine explicit and implicit associations
      const allAssociations = [...explicitAssociations, ...implicitAssociations];

      // Load associated entities
      const entities = await this.loadAssociatedEntities(allAssociations);
      
      console.log(`🔍 Loaded entities:`, {
        companies: entities.companies.length,
        locations: entities.locations.length,
        contacts: entities.contacts.length,
        deals: entities.deals.length,
        salespeople: entities.salespeople.length,
        divisions: entities.divisions.length
      });
      console.log(`🔍 Full entities object:`, entities);

      // Generate summary
      const summary = this.generateAssociationSummary(allAssociations);

      const result = {
        associations: allAssociations,
        entities,
        summary
      };

      // Cache the result
      this.setCache(this.cache.associations, cacheKey, result);

      return result;

    } catch (error) {
      console.error('❌ Error querying associations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to query associations: ${message}`);
    }
  }

  // 🔄 BULK ASSOCIATION OPERATIONS
  async bulkCreateAssociations(associations: Array<{
    sourceEntityType: CRMAssociation['sourceEntityType'];
    sourceEntityId: string;
    targetEntityType: CRMAssociation['targetEntityType'];
    targetEntityId: string;
    associationType?: CRMAssociation['associationType'];
    role?: string;
    strength?: CRMAssociation['strength'];
    metadata?: CRMAssociation['metadata'];
  }>): Promise<string[]> {
    const batch = writeBatch(db);
    const associationIds: string[] = [];

    try {
      for (const association of associations) {
        // Validate entities exist
        await this.validateEntityExists(association.sourceEntityType, association.sourceEntityId);
        await this.validateEntityExists(association.targetEntityType, association.targetEntityId);

        // Check for existing association
        const existing = await this.findAssociation(
          association.sourceEntityType,
          association.sourceEntityId,
          association.targetEntityType,
          association.targetEntityId
        );

        if (existing) {
          associationIds.push(existing.id);
          continue;
        }

        // Create new association
        const associationData: Omit<CRMAssociation, 'id'> = {
          sourceEntityType: association.sourceEntityType,
          sourceEntityId: association.sourceEntityId,
          targetEntityType: association.targetEntityType,
          targetEntityId: association.targetEntityId,
          associationType: association.associationType || 'primary',
          strength: association.strength || 'medium',
          tenantId: this.tenantId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: this.userId,
          updatedBy: this.userId,
          ...(association.role !== undefined ? { role: association.role } : {}),
          ...(association.metadata !== undefined ? { metadata: association.metadata } : {})
        };

        const docRef = doc(collection(db, 'tenants', this.tenantId, 'crm_associations'));
        batch.set(docRef, associationData);
        associationIds.push(docRef.id);
      }

      await batch.commit();

      // Update association counts (this could be optimized with a separate batch)
      for (const association of associations) {
        await this.updateAssociationCounts(
          association.sourceEntityType,
          association.sourceEntityId,
          association.targetEntityType,
          1
        );
        await this.updateAssociationCounts(
          association.targetEntityType,
          association.targetEntityId,
          association.sourceEntityType,
          1
        );
      }

      console.log(`✅ Bulk created ${associations.length} associations`);
      return associationIds;

    } catch (error) {
      console.error('❌ Error in bulk association creation:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to bulk create associations: ${message}`);
    }
  }

  // 🔍 AI CONTEXT RESEARCH
  async getAIContext(
    entityType: string,
    entityId: string,
    contextDepth: 'shallow' | 'medium' | 'deep' = 'medium'
  ): Promise<{
    directAssociations: AssociationResult;
    indirectAssociations: AssociationResult;
    contextSummary: string;
  }> {
    try {
      // Get direct associations
      const directAssociations = await this.queryAssociations({
        entityType: entityType as any,
        entityId,
        includeMetadata: true
      });

      // Get indirect associations based on depth
                        const indirectAssociations: AssociationResult = {
        associations: [],
        entities: { companies: [], locations: [], contacts: [], deals: [], salespeople: [], divisions: [] },
        summary: { totalAssociations: 0, byType: {}, byStrength: {} }
      };

      if (contextDepth === 'deep') {
        // Get associations of associated entities (2 levels deep)
        const indirectIds = new Set<string>();
        
        for (const association of directAssociations.associations) {
          const indirectResult = await this.queryAssociations({
            entityType: association.targetEntityType,
            entityId: association.targetEntityId,
            includeMetadata: true
          });
          
          indirectResult.associations.forEach(indirectAssoc => {
            if (indirectAssoc.targetEntityId !== entityId) {
              indirectIds.add(`${indirectAssoc.targetEntityType}:${indirectAssoc.targetEntityId}`);
            }
          });
        }

        // Load indirect associations
        for (const indirectId of indirectIds) {
          const [type, id] = indirectId.split(':');
          const result = await this.queryAssociations({
            entityType: type as any,
            entityId: id,
            includeMetadata: true
          });
          
          indirectAssociations.associations.push(...result.associations);
          // Merge entities (avoiding duplicates)
          this.mergeEntities(indirectAssociations.entities, result.entities);
        }
      }

      // Generate context summary
      const contextSummary = this.generateAIContextSummary(directAssociations, indirectAssociations);

      return {
        directAssociations,
        indirectAssociations,
        contextSummary
      };

    } catch (error) {
      console.error('❌ Error getting AI context:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get AI context: ${message}`);
    }
  }

  // 🔧 PRIVATE HELPER METHODS

  private async validateEntityExists(entityType: string, entityId: string): Promise<void> {
    let collectionPath: string;
    
    switch (entityType) {
      case 'company':
        collectionPath = `tenants/${this.tenantId}/crm_companies`;
        break;
      case 'location':
        collectionPath = `tenants/${this.tenantId}/crm_companies/*/locations`;
        break;
      case 'contact':
        collectionPath = `tenants/${this.tenantId}/crm_contacts`;
        break;
      case 'deal':
        collectionPath = `tenants/${this.tenantId}/crm_deals`;
        break;
      case 'salesperson':
        collectionPath = 'users';
        break;
      case 'division':
        collectionPath = `tenants/${this.tenantId}/crm_companies/*/divisions`;
        break;
      default:
        throw new Error(`Invalid entity type: ${entityType}`);
    }

    const entityRef = doc(db, collectionPath, entityId);
    const entityDoc = await getDoc(entityRef);
    
    if (!entityDoc.exists()) {
      throw new Error(`${entityType} with ID ${entityId} does not exist`);
    }
  }

  private async updateAssociationCounts(
    entityType: string,
    entityId: string,
    targetType: string,
    increment: number
  ): Promise<void> {
    try {
      let collectionPath: string;
      
      switch (entityType) {
        case 'company':
          collectionPath = `tenants/${this.tenantId}/crm_companies`;
          break;
        case 'contact':
          collectionPath = `tenants/${this.tenantId}/crm_contacts`;
          break;
        case 'deal':
          collectionPath = `tenants/${this.tenantId}/crm_deals`;
          break;
        case 'location':
          collectionPath = `tenants/${this.tenantId}/crm_companies/*/locations`;
          break;
        default:
          return; // Skip for unsupported types
      }

      const entityRef = doc(db, collectionPath, entityId);
      const entityDoc = await getDoc(entityRef);
      
      if (entityDoc.exists()) {
        const currentData = entityDoc.data();
        const currentCounts = currentData.associationCounts || {};
        const currentCount = currentCounts[`${targetType}s`] || 0;
        const newCount = Math.max(0, currentCount + increment);

        await updateDoc(entityRef, {
          [`associationCounts.${targetType}s`]: newCount,
          updatedAt: serverTimestamp()
        });
      }

    } catch (error) {
      console.error(`❌ Error updating association counts for ${entityType}:${entityId}:`, error);
      // Don't throw - this is a background operation
    }
  }

  private async loadAssociatedEntities(associations: CRMAssociation[]): Promise<AssociationResult['entities']> {
    console.log(`🔍 loadAssociatedEntities called with ${associations.length} associations`);
    
    const entities = {
      companies: [] as CRMCompany[],
      locations: [] as CRMLocation[],
      contacts: [] as CRMContact[],
      deals: [] as CRMDeal[],
      salespeople: [] as any[],
      divisions: [] as any[]
    };

    const entityIds = {
      companies: new Set<string>(),
      locations: new Set<string>(),
      contacts: new Set<string>(),
      deals: new Set<string>(),
      salespeople: new Set<string>(),
      divisions: new Set<string>()
    };

    // Collect unique entity IDs
    console.log(`🔍 Processing ${associations.length} associations for entity loading`);
    for (const association of associations) {
      // Map entity types to the correct plural form
      const getPluralType = (singularType: string) => {
        const pluralMap: { [key: string]: string } = {
          'salesperson': 'salespeople',
          'person': 'people',
          'company': 'companies',
          'location': 'locations',
          'contact': 'contacts',
          'deal': 'deals',
          'division': 'divisions'
        };
        return pluralMap[singularType] || `${singularType}s`;
      };
      
      // Add source entity
      const sourcePluralType = getPluralType(association.sourceEntityType);
      console.log(`🔍 Association source: ${association.sourceEntityType} → ${sourcePluralType} (${association.sourceEntityId})`);
      if (entityIds[sourcePluralType as keyof typeof entityIds]) {
        entityIds[sourcePluralType as keyof typeof entityIds].add(association.sourceEntityId);
      } else {
        console.log(`⚠️ No entityIds key for source plural type: ${sourcePluralType}`);
      }
      
      // Add target entity
      const targetPluralType = getPluralType(association.targetEntityType);
      console.log(`🔍 Association target: ${association.targetEntityType} → ${targetPluralType} (${association.targetEntityId})`);
      if (entityIds[targetPluralType as keyof typeof entityIds]) {
        entityIds[targetPluralType as keyof typeof entityIds].add(association.targetEntityId);
      } else {
        console.log(`⚠️ No entityIds key for target plural type: ${targetPluralType}`);
      }
    }

    console.log(`🔍 Collected entity IDs:`, {
      companies: Array.from(entityIds.companies),
      locations: Array.from(entityIds.locations),
      contacts: Array.from(entityIds.contacts),
      deals: Array.from(entityIds.deals),
      salespeople: Array.from(entityIds.salespeople),
      divisions: Array.from(entityIds.divisions)
    });

    // Load entities in parallel
    const loadPromises = [];

    // Load companies
    if (entityIds.companies.size > 0) {
      loadPromises.push(
        this.loadCompanies(Array.from(entityIds.companies))
          .then(companies => entities.companies.push(...companies))
      );
    }

    // Load contacts
    if (entityIds.contacts.size > 0) {
      loadPromises.push(
        this.loadContacts(Array.from(entityIds.contacts))
          .then(contacts => entities.contacts.push(...contacts))
      );
    }

    // Load deals
    if (entityIds.deals.size > 0) {
      loadPromises.push(
        this.loadDeals(Array.from(entityIds.deals))
          .then(deals => entities.deals.push(...deals))
      );
    }

    // Load locations (this is more complex due to subcollections)
    if (entityIds.locations.size > 0) {
      loadPromises.push(
        this.loadLocations(Array.from(entityIds.locations))
          .then(locations => entities.locations.push(...locations))
      );
    }

    // Load salespeople using Firebase function
    if (entityIds.salespeople.size > 0) {
      console.log(`🔍 Loading ${entityIds.salespeople.size} salespeople:`, Array.from(entityIds.salespeople));
      loadPromises.push(
        this.loadSalespeople(Array.from(entityIds.salespeople))
          .then(salespeople => {
            console.log(`✅ Loaded ${salespeople.length} salespeople entities:`, salespeople.map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })));
            entities.salespeople.push(...salespeople);
          })
          .catch(error => {
            console.error(`❌ Error loading salespeople:`, error);
          })
      );
    } else {
      console.log(`🔍 No salespeople IDs to load`);
    }

    // Load divisions
    if (entityIds.divisions.size > 0) {
      loadPromises.push(
        this.loadDivisions(Array.from(entityIds.divisions))
          .then(divisions => entities.divisions.push(...divisions))
      );
    }

    await Promise.all(loadPromises);
    
    console.log(`🔍 Final entities result:`, {
      companies: entities.companies.length,
      locations: entities.locations.length,
      contacts: entities.contacts.length,
      deals: entities.deals.length,
      salespeople: entities.salespeople.length,
      divisions: entities.divisions.length
    });
    
    return entities;
  }

  private async loadCompanies(entityIds: string[]): Promise<CRMCompany[]> {
    const out: CRMCompany[] = [];
    const col = collection(db, 'tenants', this.tenantId, 'crm_companies').withConverter(companyConverter);
    for (const id of entityIds) {
      const ref = doc(col, id);
      const snap = await getDoc(ref);
      if (snap.exists()) out.push(snap.data() as unknown as CRMCompany); else console.warn(`⚠️ Company not found: crm_companies/${id}`);
    }
    return out;
  }

  private async loadContacts(entityIds: string[]): Promise<CRMContact[]> {
    const out: CRMContact[] = [];
    const col = collection(db, 'tenants', this.tenantId, 'crm_contacts').withConverter(contactConverter);
    for (const id of entityIds) {
      const ref = doc(col, id);
      const snap = await getDoc(ref);
      if (snap.exists()) out.push(snap.data() as unknown as CRMContact); else console.warn(`⚠️ Contact not found: crm_contacts/${id}`);
    }
    return out;
  }

  private async loadDeals(entityIds: string[]): Promise<CRMDeal[]> {
    const out: CRMDeal[] = [];
    const col = collection(db, 'tenants', this.tenantId, 'crm_deals').withConverter(dealConverter);
    for (const id of entityIds) {
      const ref = doc(col, id);
      const snap = await getDoc(ref);
      if (snap.exists()) out.push(snap.data() as unknown as CRMDeal); else console.warn(`⚠️ Deal not found: crm_deals/${id}`);
    }
    return out;
  }

  private async loadLocations(locationIds: string[]): Promise<CRMLocation[]> {
    const locations: CRMLocation[] = [];
    const collectionRef = collection(db, 'tenants', this.tenantId, 'crm_companies');

    for (const locationId of locationIds) {
      const companyRef = doc(collectionRef, locationId.split('/')[1]); // Assuming locationId is like 'companies/{companyId}/locations/{locationId}'
      const companyDoc = await getDoc(companyRef);
      if (companyDoc.exists()) {
        const companyData = companyDoc.data() as any;
        const locationRef = doc(collectionRef, locationId);
        const locationDoc = await getDoc(locationRef);
        if (locationDoc.exists()) {
          locations.push({ 
            id: locationDoc.id, 
            companyId: companyData.id,
            ...locationDoc.data() 
          } as CRMLocation);
        } else {
          console.warn(`⚠️ Location document not found: ${locationId}`);
        }
      } else {
        console.warn(`⚠️ Company document not found for location: ${locationId}`);
      }
    }
    return locations;
  }

  private async loadSalespeople(salespersonIds: string[]): Promise<any[]> {
    console.log(`🔍 loadSalespeople called with ${salespersonIds.length} IDs:`, salespersonIds);
    const salespeople: any[] = [];
    const collectionRef = collection(db, 'users'); // Changed from 'workforce' to 'users'

    for (const salespersonId of salespersonIds) {
      const salespersonRef = doc(collectionRef, salespersonId);
      const salespersonDoc = await getDoc(salespersonRef);
      if (salespersonDoc.exists()) {
        const data = salespersonDoc.data();
        console.log(`✅ Found salesperson ${salespersonId}:`, { id: salespersonDoc.id, firstName: data.firstName, lastName: data.lastName });
        salespeople.push({ id: salespersonDoc.id, ...data });
      } else {
        console.warn(`⚠️ Salesperson document not found: ${salespersonId}`);
      }
    }
    console.log(`🔍 loadSalespeople returning ${salespeople.length} salespeople`);
    return salespeople;
  }

  private async loadDivisions(divisionIds: string[]): Promise<any[]> {
    const divisions: any[] = [];
    const collectionRef = collection(db, 'tenants', this.tenantId, 'crm_companies');

    for (const divisionId of divisionIds) {
      const companyRef = doc(collectionRef, divisionId.split('/')[1]); // Assuming divisionId is like 'companies/{companyId}/divisions/{divisionId}'
      const companyDoc = await getDoc(companyRef);
      if (companyDoc.exists()) {
        const companyData = companyDoc.data() as any;
        const divisionRef = doc(collectionRef, divisionId);
        const divisionDoc = await getDoc(divisionRef);
        if (divisionDoc.exists()) {
          divisions.push({ 
            id: divisionDoc.id, 
            companyId: companyData.id,
            ...divisionDoc.data() 
          });
        } else {
          console.warn(`⚠️ Division document not found: ${divisionId}`);
        }
      } else {
        console.warn(`⚠️ Company document not found for division: ${divisionId}`);
      }
    }
    return divisions;
  }

  private async getImplicitAssociations(entityType: string, entityId: string): Promise<CRMAssociation[]> {
    const implicitAssociations: CRMAssociation[] = [];

    switch (entityType) {
      case 'company': {
        // Check if the company has a salesOwnerId
        const companyRef = doc(db, 'tenants', this.tenantId, 'crm_companies', entityId);
        const companyDoc = await getDoc(companyRef);
        if (companyDoc.exists()) {
          const companyData = companyDoc.data() as any;
          if (companyData.salesOwnerId) {
            console.log(`🔍 Creating implicit salesperson association for company ${entityId}: salesOwnerId = ${companyData.salesOwnerId}`);
            implicitAssociations.push({
              id: `implicit_${entityId}_salesperson_${companyData.salesOwnerId}`,
              sourceEntityType: 'company',
              sourceEntityId: entityId,
              targetEntityType: 'salesperson',
              targetEntityId: companyData.salesOwnerId,
              associationType: 'primary',
              strength: 'medium',
              tenantId: this.tenantId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: this.userId,
              updatedBy: this.userId
            });
          } else {
            console.log(`🔍 Company ${entityId} has no salesOwnerId`);
          }
        }
        break;
      }
      case 'contact': {
        // Check if the contact has a company
        const contactRef = doc(db, 'tenants', this.tenantId, 'crm_contacts', entityId);
        const contactDoc = await getDoc(contactRef);
        if (contactDoc.exists()) {
          const contactData = contactDoc.data() as any;
          if (contactData.companyId) {
            implicitAssociations.push({
              id: `implicit_${entityId}_company_${contactData.companyId}`,
              sourceEntityType: 'contact',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: contactData.companyId,
              associationType: 'primary',
              strength: 'medium',
              tenantId: this.tenantId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: this.userId,
              updatedBy: this.userId
            });
          }
        }
        break;
      }
      case 'deal': {
        // Check if the deal has a company
        const dealRef = doc(db, 'tenants', this.tenantId, 'crm_deals', entityId);
        const dealDoc = await getDoc(dealRef);
        if (dealDoc.exists()) {
          const dealData = dealDoc.data() as any;
          if (dealData.companyId) {
            implicitAssociations.push({
              id: `implicit_${entityId}_company_${dealData.companyId}`,
              sourceEntityType: 'deal',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: dealData.companyId,
              associationType: 'primary',
              strength: 'medium',
              tenantId: this.tenantId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: this.userId,
              updatedBy: this.userId
            });
          }
        }
        break;
      }
      case 'salesperson': {
        // Check if the salesperson has a company
        const salespersonRef = doc(db, 'tenants', this.tenantId, 'workforce', entityId);
        const salespersonDoc = await getDoc(salespersonRef);
        if (salespersonDoc.exists()) {
          const salespersonData = salespersonDoc.data() as any;
          if (salespersonData.companyId) {
            implicitAssociations.push({
              id: `implicit_${entityId}_company_${salespersonData.companyId}`,
              sourceEntityType: 'salesperson',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: salespersonData.companyId,
              associationType: 'primary',
              strength: 'medium',
              tenantId: this.tenantId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: this.userId,
              updatedBy: this.userId
            });
          }
        }
        break;
      }
      case 'division': {
        // Check if the division has a company
        const divisionRef = doc(db, 'tenants', this.tenantId, 'crm_companies', entityId);
        const divisionDoc = await getDoc(divisionRef);
        if (divisionDoc.exists()) {
          const divisionData = divisionDoc.data() as any;
          if (divisionData.parentCompanyId) {
            implicitAssociations.push({
              id: `implicit_${entityId}_company_${divisionData.parentCompanyId}`,
              sourceEntityType: 'division',
              sourceEntityId: entityId,
              targetEntityType: 'company',
              targetEntityId: divisionData.parentCompanyId,
              associationType: 'primary',
              strength: 'medium',
              tenantId: this.tenantId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: this.userId,
              updatedBy: this.userId
            });
          }
        }
        break;
      }
      default:
        break;
    }

    return implicitAssociations;
  }

  private mergeEntities(target: any, source: any): void {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          if (!target[key]) {
            target[key] = {};
          }
          this.mergeEntities(target[key], source[key]);
        } else if (Array.isArray(source[key])) {
          if (!target[key]) {
            target[key] = [];
          }
          target[key] = [...new Set([...target[key], ...source[key]])];
        } else {
          target[key] = source[key];
        }
      }
    }
  }

  private generateAssociationSummary(associations: CRMAssociation[]): AssociationResult['summary'] {
    const summary: AssociationResult['summary'] = {
      totalAssociations: associations.length,
      byType: {},
      byStrength: {}
    };

    associations.forEach(assoc => {
      const typeKey = `${assoc.sourceEntityType}→${assoc.targetEntityType}`;
      if (!summary.byType[typeKey]) {
        summary.byType[typeKey] = 0;
      }
      summary.byType[typeKey]++;

      const strengthKey = `${assoc.sourceEntityType}→${assoc.targetEntityType} (${assoc.strength})`;
      if (!summary.byStrength[strengthKey]) {
        summary.byStrength[strengthKey] = 0;
      }
      summary.byStrength[strengthKey]++;
    });

    return summary;
  }

  private generateAIContextSummary(directAssociations: AssociationResult, indirectAssociations: AssociationResult): string {
    const directCount = directAssociations.associations.length;
    const indirectCount = indirectAssociations.associations.length;

    let summary = `Direct associations: ${directCount}\n`;
    summary += `Indirect associations: ${indirectCount}\n`;

    const directTypes = new Set<string>();
    directAssociations.associations.forEach(assoc => {
      directTypes.add(`${assoc.sourceEntityType}→${assoc.targetEntityType}`);
    });
    summary += `Direct association types: ${Array.from(directTypes).join(', ')}\n`;

    const indirectTypes = new Set<string>();
    indirectAssociations.associations.forEach(assoc => {
      indirectTypes.add(`${assoc.sourceEntityType}→${assoc.targetEntityType}`);
    });
    summary += `Indirect association types: ${Array.from(indirectTypes).join(', ')}\n`;

    return summary;
  }
}

// 🎯 FACTORY FUNCTION
export const createAssociationService = (tenantId: string, userId: string): AssociationService => {
  return new AssociationService(tenantId, userId);
};