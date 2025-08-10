import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Base interface for all specialized agents
export interface SpecializedAgent {
  // Agent Identity
  agentId: string;
  agentName: string;
  agentDomain: string;
  
  // Context Detection
  detectionPatterns: RegExp[];
  contextTriggers: string[];
  
  // Context Gathering
  getEnhancedContext: (entityId: string, tenantId: string, userId: string) => Promise<EnhancedContext>;
  
  // Prompt Generation
  generateSystemPrompt: (context: EnhancedContext) => string;
  enhanceUserMessage: (message: string, context: EnhancedContext) => string;
  
  // Response Enhancement
  enhanceResponse?: (response: string, context: EnhancedContext) => string;
  
  // Validation
  validateEntity?: (entityId: string, tenantId: string) => Promise<boolean>;
}

// Enhanced context interface
export interface EnhancedContext {
  [key: string]: any;
}

// Context share interface for agent communication
export interface ContextShare {
  agentId: string;
  entityId: string;
  contextType: string;
  enhancedContext: EnhancedContext;
  systemPrompt: string;
  enhancedMessage: string;
  metadata: {
    confidence: number;
    relevance: number;
    lastUpdated: Date;
  };
}

// Base agent class that provides common functionality
export abstract class BaseAgent implements SpecializedAgent {
  abstract agentId: string;
  abstract agentName: string;
  abstract agentDomain: string;
  abstract detectionPatterns: RegExp[];
  abstract contextTriggers: string[];
  
  abstract getEnhancedContext(entityId: string, tenantId: string, userId: string): Promise<EnhancedContext>;
  abstract generateSystemPrompt(context: EnhancedContext): string;
  abstract enhanceUserMessage(message: string, context: EnhancedContext): string;
  
  // Default response enhancement (can be overridden)
  enhanceResponse(response: string, context: EnhancedContext): string {
    return response; // Default: no enhancement
  }
  
  // Default entity validation (can be overridden)
  async validateEntity(entityId: string, tenantId: string): Promise<boolean> {
    try {
      const entityRef = db.doc(`tenants/${tenantId}/${this.getEntityCollection()}/${entityId}`);
      const entitySnap = await entityRef.get();
      return entitySnap.exists;
    } catch (error) {
      console.error(`Error validating entity for ${this.agentId}:`, error);
      return false;
    }
  }
  
  // Abstract method for entity collection name
  protected abstract getEntityCollection(): string;
  
  // Common utility methods
  protected async getEntityData(entityId: string, tenantId: string): Promise<any> {
    try {
      const entityRef = db.doc(`tenants/${tenantId}/${this.getEntityCollection()}/${entityId}`);
      const entitySnap = await entityRef.get();
      return entitySnap.exists ? entitySnap.data() : null;
    } catch (error) {
      console.error(`Error getting entity data for ${this.agentId}:`, error);
      return null;
    }
  }
  
  protected async getRelatedData(entityId: string, tenantId: string, collection: string, field: string): Promise<any[]> {
    try {
      const query = db.collection(`tenants/${tenantId}/${collection}`)
        .where(field, '==', entityId)
        .limit(20);
      const snap = await query.get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error(`Error getting related data for ${this.agentId}:`, error);
      return [];
    }
  }
  
  protected async getNotes(entityId: string, tenantId: string): Promise<any[]> {
    try {
      const notesQuery = db.collection(`tenants/${tenantId}/${this.getEntityCollection()}/${entityId}/notes`)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const notesSnap = await notesQuery.get();
      return notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error(`Error getting notes for ${this.agentId}:`, error);
      return [];
    }
  }
  
  protected async getActivities(entityId: string, tenantId: string): Promise<any[]> {
    try {
      const activitiesQuery = db.collection(`tenants/${tenantId}/activities`)
        .where(this.getEntityField(), '==', entityId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const activitiesSnap = await activitiesQuery.get();
      return activitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error(`Error getting activities for ${this.agentId}:`, error);
      return [];
    }
  }
  
  // Abstract method for entity field name in activities
  protected abstract getEntityField(): string;
  
  // Common prompt generation utilities
  protected generateBasePrompt(context: EnhancedContext, domainSpecificInstructions: string): string {
    return `You are ${this.agentName}, a specialized AI assistant with comprehensive ${this.agentDomain} context.

${domainSpecificInstructions}

INSTRUCTIONS:
1. Provide strategic, actionable advice based on the available context
2. Consider all relevant data when making recommendations
3. Be specific about next steps and actions
4. Reference relevant context when making suggestions
5. Maintain a helpful, professional tone
6. Focus on practical, implementable advice

RESPONSE FORMAT:
- Provide a brief analysis of the current situation
- Suggest specific next steps and actions
- Reference relevant context when making recommendations
- Be specific about what actions to take and when
- Consider the unique dynamics of this specific ${this.agentDomain} situation`;
  }
  
  protected enhanceMessageWithContext(message: string, context: EnhancedContext, contextSummary: string): string {
    return `${message}

[${this.agentName} Context: ${contextSummary}]`;
  }
}
