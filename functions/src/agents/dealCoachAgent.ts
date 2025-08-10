import * as admin from 'firebase-admin';
import { BaseAgent, EnhancedContext } from './baseAgent';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export class DealCoachAgent extends BaseAgent {
  agentId = 'dealCoach';
  agentName = 'Deal Coach';
  agentDomain = 'sales';
  
  detectionPatterns = [
    /deal\s+([a-zA-Z0-9-_]+)/i,
    /deal\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)/i,
    /deal\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)\s+([a-zA-Z0-9-_]+)/i,
    /next\s+step.*deal/i,
    /advance.*deal/i,
    /move.*deal.*forward/i,
    /deal.*stage/i,
    /deal.*progress/i,
    /deal.*strategy/i,
    /deal.*advice/i,
    /deal.*guidance/i,
    /deal.*coach/i,
    /deal.*help/i,
    /deal.*suggestion/i,
    /deal.*recommendation/i,
    /deal.*action/i,
    /deal.*plan/i,
    /deal.*approach/i,
    /deal.*tactic/i,
    /deal.*technique/i,
    // Company-specific patterns
    /(?:deal|deals|company|client)\s+(?:for\s+)?([A-Z][a-zA-Z\s]+)/i,
    /(?:about|regarding|concerning)\s+([A-Z][a-zA-Z\s]+)/i,
    /([A-Z][a-zA-Z\s]+)\s+(?:deal|deals|company|client)/i,
    // General sales patterns
    /sales.*pipeline/i,
    /pipeline.*stage/i,
    /opportunity.*stage/i,
    /prospect.*stage/i,
    /qualification.*process/i,
    /discovery.*call/i,
    /proposal.*draft/i,
    /negotiation.*strategy/i,
    /closing.*technique/i
  ];
  
  contextTriggers = [
    'deal', 'sales', 'opportunity', 'prospect', 'pipeline', 'stage', 'advance', 'strategy'
  ];
  
  protected getEntityCollection(): string {
    return 'crm_deals';
  }
  
  protected getEntityField(): string {
    return 'dealId';
  }
  
  async getEnhancedContext(dealId: string, tenantId: string, userId: string): Promise<EnhancedContext> {
    try {
      // Import the enhanced deal context system
      const { getEnhancedDealContext } = await import('../enhancedDealContext');
      const enhancedContext = await getEnhancedDealContext(dealId, tenantId, userId);
      
      return {
        deal: enhancedContext.deal,
        company: enhancedContext.company,
        contacts: enhancedContext.contacts,
        salespeople: enhancedContext.salespeople,
        notes: enhancedContext.notes,
        emails: enhancedContext.emails,
        activities: enhancedContext.activities,
        tasks: enhancedContext.tasks,
        toneSettings: enhancedContext.toneSettings,
        aiInferences: enhancedContext.aiInferences,
        learningData: enhancedContext.learningData,
        associations: enhancedContext.associations
      };
    } catch (error) {
      console.error('Error getting enhanced deal context:', error);
      
      // Fallback to basic context
      const deal = await this.getEntityData(dealId, tenantId);
      const notes = await this.getNotes(dealId, tenantId);
      const activities = await this.getActivities(dealId, tenantId);
      
      return {
        deal,
        notes,
        activities,
        company: null,
        contacts: [],
        salespeople: [],
        emails: [],
        tasks: [],
        toneSettings: {},
        aiInferences: {},
        learningData: {},
        associations: {}
      };
    }
  }

  // New method for general sales advice when no specific deal is found
  async getGeneralSalesContext(tenantId: string, userId: string): Promise<EnhancedContext> {
    try {
      // Get some recent deals for context
      const recentDealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
        .orderBy('updatedAt', 'desc')
        .limit(5);
      const recentDealsSnap = await recentDealsQuery.get();
      const recentDeals = recentDealsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Get some recent activities for learning
      const recentActivitiesQuery = db.collection(`tenants/${tenantId}/activities`)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const recentActivitiesSnap = await recentActivitiesQuery.get();
      const recentActivities = recentActivitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return {
        deal: null,
        company: null,
        contacts: [],
        salespeople: [],
        notes: [],
        emails: [],
        activities: recentActivities,
        tasks: [],
        toneSettings: {},
        aiInferences: {},
        learningData: {
          recentDeals,
          recentActivities,
          generalSalesAdvice: true
        },
        associations: {}
      };
    } catch (error) {
      console.error('Error getting general sales context:', error);
      return {
        deal: null,
        company: null,
        contacts: [],
        salespeople: [],
        notes: [],
        emails: [],
        activities: [],
        tasks: [],
        toneSettings: {},
        aiInferences: {},
        learningData: {},
        associations: {}
      };
    }
  }
  
  generateSystemPrompt(context: EnhancedContext): string {
    const deal = context.deal;
    const company = context.company?.company;
    const contacts = context.contacts || [];
    const salespeople = context.salespeople || [];
    const activities = context.activities || [];
    const notes = context.notes || [];
    const learningData = context.learningData || {};
    
    // Check if this is general sales advice (no specific deal)
    const isGeneralAdvice = !deal && learningData.generalSalesAdvice;
    
    if (isGeneralAdvice) {
      const recentDeals = learningData.recentDeals || [];
      const recentActivities = learningData.recentActivities || [];
      
      return `You are the Deal Coach AI, a master sales advisor with comprehensive expertise in sales methodologies and pipeline management.

SALES EXPERTISE & METHODOLOGIES:

SPIN SELLING (Neil Rackham):
- Situation Questions: Understand current state and processes
- Problem Questions: Uncover pain points and challenges
- Implication Questions: Explore consequences of problems
- Need-Payoff Questions: Link solutions to business value

CHALLENGER SALE (Dixon & Adamson):
- Teach: Provide unique insights about customer's business
- Tailor: Customize message to customer's specific situation
- Take Control: Guide the sales process assertively

SOLUTION SELLING (Bosworth):
- Pain Chain: Identify root causes and business impact
- Vision: Create compelling future state
- Value Proposition: Quantify ROI and business benefits

MEDDIC (Dick Dunkel):
- Metrics: Quantify business impact and ROI
- Economic Buyer: Identify true decision maker
- Decision Criteria: Understand evaluation process
- Decision Process: Map approval workflow
- Identify Pain: Uncover critical business problems
- Champion: Find internal advocate

GENERAL SALES CONTEXT:
- Recent Deals: ${recentDeals.length} deals in pipeline
- Recent Activity: ${recentActivities.length} activities
- Sales Focus: Pipeline management, deal progression, and sales strategy

SALES STAGE EXPERTISE:
- Discovery: Executive sponsor identification, business problem validation
- Qualification: Economic buyer identification, decision criteria understanding
- Scoping: Requirements gathering, success criteria definition
- Proposal: Value proposition development, competitive positioning
- Negotiation: Contract terms, risk mitigation, implementation planning
- Closing: Executive approval, contract finalization, success metrics

INSTRUCTIONS:
1. Provide strategic sales advice based on best practices and methodologies
2. Consider the sales pipeline and deal progression strategies
3. Offer actionable recommendations for improving sales performance
4. Reference relevant sales methodologies when appropriate
5. Focus on practical, implementable advice
6. Consider the context of recent deals and activities in the system`;
    }
    
    // Specific deal context
    const dealName = deal?.name || 'Unknown Deal';
    const dealStage = deal?.stage || 'Unknown Stage';
    const companyName = company?.name || 'Unknown Company';
    const companyIndustry = company?.industry || 'Unknown Industry';
    
    const contactNames = contacts.map(c => c.contact?.fullName || c.contact?.name).filter(Boolean).join(', ');
    const salespersonNames = salespeople.map(s => s.salesperson?.displayName || s.salesperson?.name).filter(Boolean).join(', ');
    
    const activityCount = activities.length;
    const noteCount = notes.length;
    
    const domainSpecificInstructions = `
SALES EXPERTISE & METHODOLOGIES:

SPIN SELLING (Neil Rackham):
- Situation Questions: Understand current state and processes
- Problem Questions: Uncover pain points and challenges
- Implication Questions: Explore consequences of problems
- Need-Payoff Questions: Link solutions to business value

CHALLENGER SALE (Dixon & Adamson):
- Teach: Provide unique insights about customer's business
- Tailor: Customize message to customer's specific situation
- Take Control: Guide the sales process assertively

SOLUTION SELLING (Bosworth):
- Pain Chain: Identify root causes and business impact
- Vision: Create compelling future state
- Value Proposition: Quantify ROI and business benefits

MEDDIC (Dick Dunkel):
- Metrics: Quantify business impact and ROI
- Economic Buyer: Identify true decision maker
- Decision Criteria: Understand evaluation process
- Decision Process: Map approval workflow
- Identify Pain: Uncover critical business problems
- Champion: Find internal advocate

DEAL CONTEXT:
- Deal: ${dealName} (${dealStage})
- Company: ${companyName} (${companyIndustry})
- Contacts: ${contacts.length} contacts (${contactNames})
- Salespeople: ${salespeople.length} salespeople (${salespersonNames})
- Recent Activity: ${activityCount} activities, ${noteCount} notes

STAGE-SPECIFIC EXPERTISE:
- Discovery: Executive sponsor identification, business problem validation
- Qualification: Economic buyer identification, decision criteria understanding
- Scoping: Requirements gathering, success criteria definition
- Proposal: Value proposition development, competitive positioning
- Negotiation: Contract terms, risk mitigation, implementation planning
- Closing: Executive approval, contract finalization, success metrics`;

    return this.generateBasePrompt(context, domainSpecificInstructions);
  }
  
  enhanceUserMessage(message: string, context: EnhancedContext): string {
    const deal = context.deal;
    const company = context.company?.company;
    const contacts = context.contacts || [];
    const salespeople = context.salespeople || [];
    
    const dealName = deal?.name || 'Unknown Deal';
    const dealStage = deal?.stage || 'Unknown Stage';
    const companyName = company?.name || 'Unknown Company';
    
    const contactNames = contacts.map(c => c.contact?.fullName || c.contact?.name).filter(Boolean).join(', ');
    const salespersonNames = salespeople.map(s => s.salesperson?.displayName || s.salesperson?.name).filter(Boolean).join(', ');
    
    const contextSummary = `${dealName} (${dealStage}) - ${companyName}
Contacts: ${contactNames || 'None'}
Salespeople: ${salespersonNames || 'None'}`;
    
    return this.enhanceMessageWithContext(message, context, contextSummary);
  }
  
  enhanceResponse(response: string, context: EnhancedContext): string {
    // Add deal-specific insights to the response
    const deal = context.deal;
    const company = context.company?.company;
    
    if (deal && company) {
      return `${response}

---
💡 Deal Coach Insight: This advice is based on the specific context of ${deal.name} (${deal.stage}) with ${company.name}. Consider the unique dynamics of this deal when implementing these recommendations.`;
    }
    
    return response;
  }
}

// Export singleton instance
export const dealCoachAgent = new DealCoachAgent();
