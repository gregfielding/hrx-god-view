import * as admin from 'firebase-admin';
import { SpecializedAgent, ContextShare, EnhancedContext } from './baseAgent';
import { dealCoachAgent } from './dealCoachAgent';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export class AgentRegistry {
  private agents: Map<string, SpecializedAgent> = new Map();
  
  constructor() {
    // Register default agents
    this.registerAgent(dealCoachAgent);
  }
  
  registerAgent(agent: SpecializedAgent): void {
    this.agents.set(agent.agentId, agent);
    console.log(`✅ Registered agent: ${agent.agentName} (${agent.agentId})`);
  }
  
  getAgent(agentId: string): SpecializedAgent | undefined {
    return this.agents.get(agentId);
  }
  
  getAllAgents(): SpecializedAgent[] {
    return Array.from(this.agents.values());
  }
  
  async detectRelevantAgent(message: string): Promise<SpecializedAgent | null> {
    for (const agent of this.agents.values()) {
      if (agent.detectionPatterns.some(pattern => pattern.test(message))) {
        console.log(`🎯 Detected relevant agent: ${agent.agentName} (${agent.agentId})`);
        return agent;
      }
    }
    return null;
  }
  
  async extractEntityId(message: string, agent: SpecializedAgent, tenantId: string): Promise<string | null> {
    // Extract entity ID based on agent patterns
    for (const pattern of agent.detectionPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const potentialId = match[1];
        
        // Verify entity exists
        if (agent.validateEntity) {
          const isValid = await agent.validateEntity(potentialId, tenantId);
          if (isValid) {
            console.log(`✅ Found valid entity ID: ${potentialId} for agent ${agent.agentId}`);
            return potentialId;
          }
        } else {
          // If no validation method, assume it's valid
          console.log(`⚠️  No validation method for agent ${agent.agentId}, assuming valid entity ID: ${potentialId}`);
          return potentialId;
        }
      }
    }
    
    // Try to find entity by name if no direct ID match
    return await this.searchEntityByName(message, agent, tenantId);
  }
  
  private async searchEntityByName(message: string, agent: SpecializedAgent, tenantId: string): Promise<string | null> {
    try {
      // Extract potential entity name from message
      const words = message.split(' ').filter(word => word.length > 2);
      
      // Also try to extract company names (common patterns)
      const companyPatterns = [
        /(?:deal|deals|company|client)\s+(?:for\s+)?([A-Z][a-zA-Z\s]+)/i,
        /(?:about|regarding|concerning)\s+([A-Z][a-zA-Z\s]+)/i,
        /([A-Z][a-zA-Z\s]+)\s+(?:deal|deals|company|client)/i
      ];
      
      // Try company name patterns first
      for (const pattern of companyPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          const companyName = match[1].trim();
          console.log(`🔍 Searching for company: "${companyName}"`);
          
          // Search for deals by company name
          const dealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
            .where('companyName', '>=', companyName)
            .where('companyName', '<=', companyName + '\uf8ff')
            .limit(5);
          
          const dealsSnap = await dealsQuery.get();
          if (!dealsSnap.empty) {
            const dealId = dealsSnap.docs[0].id;
            console.log(`✅ Found deal by company name: ${dealId} for "${companyName}"`);
            return dealId;
          }
          
          // Also try searching companies collection
          const companiesQuery = db.collection(`tenants/${tenantId}/crm_companies`)
            .where('name', '>=', companyName)
            .where('name', '<=', companyName + '\uf8ff')
            .limit(5);
          
          const companiesSnap = await companiesQuery.get();
          if (!companiesSnap.empty) {
            const companyId = companiesSnap.docs[0].id;
            console.log(`✅ Found company: ${companyId} for "${companyName}"`);
            
            // Find a deal associated with this company
            const associatedDealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
              .where('companyId', '==', companyId)
              .limit(1);
            
            const associatedDealsSnap = await associatedDealsQuery.get();
            if (!associatedDealsSnap.empty) {
              const dealId = associatedDealsSnap.docs[0].id;
              console.log(`✅ Found deal associated with company: ${dealId}`);
              return dealId;
            }
          }
        }
      }
      
      // Fallback to word-based search
      for (const word of words) {
        // Search for entities with similar names
        const collectionName = (agent as any).getEntityCollection ? (agent as any).getEntityCollection() : 'entities';
        const query = db.collection(`tenants/${tenantId}/${collectionName}`)
          .where('name', '>=', word)
          .where('name', '<=', word + '\uf8ff')
          .limit(5);
        
        const snap = await query.get();
        if (!snap.empty) {
          const entityId = snap.docs[0].id;
          console.log(`🔍 Found entity by name search: ${entityId} for agent ${agent.agentId}`);
          return entityId;
        }
      }
    } catch (error) {
      console.warn(`Error searching entity by name for agent ${agent.agentId}:`, error);
    }
    
    return null;
  }
  
  async loadAgentContext(agent: SpecializedAgent, entityId: string, tenantId: string, userId: string): Promise<ContextShare> {
    console.log(`📊 Loading context for ${agent.agentName} (${agent.agentId}) - Entity: ${entityId}`);
    
    const enhancedContext = await agent.getEnhancedContext(entityId, tenantId, userId);
    const systemPrompt = agent.generateSystemPrompt(enhancedContext);
    
    return {
      agentId: agent.agentId,
      entityId,
      contextType: agent.agentDomain,
      enhancedContext,
      systemPrompt,
      enhancedMessage: '', // Will be set by the calling function
      metadata: {
        confidence: 0.9, // High confidence for detected agents
        relevance: 0.95, // High relevance for specialized agents
        lastUpdated: new Date()
      }
    };
  }
  
  async enhanceWithAgentContext(message: string, contextShare: ContextShare): Promise<string> {
    const agent = this.getAgent(contextShare.agentId);
    if (!agent) {
      console.warn(`⚠️  Agent not found: ${contextShare.agentId}`);
      return message;
    }
    
    return agent.enhanceUserMessage(message, contextShare.enhancedContext);
  }
  
  async enhanceResponseWithAgentContext(response: string, contextShare: ContextShare): Promise<string> {
    const agent = this.getAgent(contextShare.agentId);
    if (!agent) {
      console.warn(`⚠️  Agent not found: ${contextShare.agentId}`);
      return response;
    }
    
    return agent.enhanceResponse ? agent.enhanceResponse(response, contextShare.enhancedContext) : response;
  }
  
  async detectAndEnhance(message: string, tenantId: string, userId: string): Promise<{
    enhanced: boolean;
    agent?: SpecializedAgent;
    contextShare?: ContextShare;
    systemPrompt?: string;
    enhancedMessage?: string;
  }> {
    // Detect relevant agent
    const relevantAgent = await this.detectRelevantAgent(message);
    
    if (relevantAgent) {
      console.log(`🎯 Detected ${relevantAgent.agentName} context needed`);
      
      // Extract entity ID from message
      const entityId = await this.extractEntityId(message, relevantAgent, tenantId);
      
      if (entityId) {
        // Load enhanced context from specialized agent
        const contextShare = await this.loadAgentContext(relevantAgent, entityId, tenantId, userId);
        
        // Enhance user message
        const enhancedMessage = await this.enhanceWithAgentContext(message, contextShare);
        
        return {
          enhanced: true,
          agent: relevantAgent,
          contextShare,
          systemPrompt: contextShare.systemPrompt,
          enhancedMessage
        };
      } else {
        // For Deal Coach, provide general sales advice even without specific deal
        if (relevantAgent.agentId === 'dealCoach') {
          console.log(`🎯 No specific deal found, providing general sales advice`);
          
          try {
            const generalContext = await (relevantAgent as any).getGeneralSalesContext(tenantId, userId);
            const systemPrompt = relevantAgent.generateSystemPrompt(generalContext);
            const enhancedMessage = relevantAgent.enhanceUserMessage(message, generalContext);
            
            return {
              enhanced: true,
              agent: relevantAgent,
              contextShare: {
                agentId: relevantAgent.agentId,
                entityId: 'general',
                contextType: 'general_sales',
                enhancedContext: generalContext,
                systemPrompt,
                enhancedMessage,
                metadata: {
                  confidence: 0.8,
                  relevance: 0.9,
                  lastUpdated: new Date()
                }
              },
              systemPrompt,
              enhancedMessage
            };
          } catch (error) {
            console.error('Error providing general sales advice:', error);
          }
        } else {
          console.log(`⚠️  Could not extract entity ID for ${relevantAgent.agentName}`);
        }
      }
    }
    
    return { enhanced: false };
  }
  
  // Utility method to get agent statistics
  getAgentStats(): { totalAgents: number; agentDetails: Array<{ id: string; name: string; domain: string }> } {
    const agentDetails = Array.from(this.agents.values()).map(agent => ({
      id: agent.agentId,
      name: agent.agentName,
      domain: agent.agentDomain
    }));
    
    return {
      totalAgents: this.agents.size,
      agentDetails
    };
  }
}

// Export singleton instance
export const agentRegistry = new AgentRegistry();
