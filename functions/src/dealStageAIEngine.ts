import * as admin from 'firebase-admin';
import { logAIAction } from './utils/aiLogging';

const db = admin.firestore();

/**
 * Deal Stage AI Engine - Provides intelligent task suggestions and strategies for CRM deal stages
 * Analyzes stage requirements, company context, contact information, and email activity
 * to suggest optimal tasks for stage completion and progression
 */
export const processWithDealStageAIEngine = async (logData: any, logId: string): Promise<any> => {
  console.log(`DealStageAIEngine processing log ${logId}:`, logData.eventType);
  
  const start = Date.now();
  const results: any = {
    stageTasks: [],
    stageStrategies: [],
    fieldCompletionTasks: [],
    nextStagePreparation: [],
    emailActivityTasks: [],
    contactEngagementTasks: [],
    companyResearchTasks: [],
    aiGeneratedTasks: [],
    stageInsights: [],
    competitiveAdvantageTasks: []
  };

  try {
    const tenantId = logData.tenantId;
    const dealId = logData.targetId || logData.dealId;
    const userId = logData.userId || logData.assignedTo;

    if (!tenantId || !dealId) {
      throw new Error('Missing required fields: tenantId, dealId');
    }

    // Get comprehensive deal context
    const dealContext = await getDealContext(dealId, tenantId, userId);
    
    // Get current stage requirements and progress
    const stageAnalysis = await analyzeCurrentStage(dealContext);
    
    // Generate stage-specific recommendations
    const stageRecommendations = await generateStageRecommendations(dealContext, stageAnalysis);
    
    // Generate field completion tasks
    const fieldTasks = await generateFieldCompletionTasks(dealContext, stageAnalysis);
    
    // Generate next stage preparation
    const nextStageTasks = await generateNextStagePreparation(dealContext, stageAnalysis);
    
    // Generate email activity tasks
    const emailTasks = await generateEmailActivityTasks(dealContext);
    
    // Generate contact engagement tasks
    const contactTasks = await generateContactEngagementTasks(dealContext);
    
    // Generate company research tasks
    const researchTasks = await generateCompanyResearchTasks(dealContext);
    
    // Generate competitive advantage tasks
    const competitiveTasks = await generateCompetitiveAdvantageTasks(dealContext);

    // Combine all results
    results.stageTasks = stageRecommendations.stageTasks;
    results.stageStrategies = stageRecommendations.strategies;
    results.fieldCompletionTasks = fieldTasks;
    results.nextStagePreparation = nextStageTasks;
    results.emailActivityTasks = emailTasks;
    results.contactEngagementTasks = contactTasks;
    results.companyResearchTasks = researchTasks;
    results.competitiveAdvantageTasks = competitiveTasks;
    results.stageInsights = stageRecommendations.insights;

    // Log the AI processing
    await logAIAction({
      eventType: 'deal_stage_ai_engine.processed',
      targetType: 'deal_stage_analysis',
      targetId: dealId,
      reason: `Deal Stage AI Engine processed ${dealContext.deal.stage} stage with ${results.stageTasks.length} task suggestions`,
      contextType: 'deal_stages',
      aiTags: ['deal_stages', 'stage_analysis', 'task_suggestions'],
      urgencyScore: 6,
      inputPrompt: `Analyze deal stage ${dealContext.deal.stage} for optimal task suggestions`,
      composedPrompt: `Analyze deal context for stage optimization: ${JSON.stringify(dealContext.summary)}`,
      aiResponse: JSON.stringify(results),
      success: true,
      latencyMs: Date.now() - start,
      tenantId,
      userId
    });

    const latencyMs = Date.now() - start;
    
    return {
      success: true,
      latencyMs,
      stageTasks: results.stageTasks.length,
      stageStrategies: results.stageStrategies.length,
      fieldCompletionTasks: results.fieldCompletionTasks.length,
      nextStagePreparation: results.nextStagePreparation.length,
      emailActivityTasks: results.emailActivityTasks.length,
      contactEngagementTasks: results.contactEngagementTasks.length,
      companyResearchTasks: results.companyResearchTasks.length,
      competitiveAdvantageTasks: results.competitiveAdvantageTasks.length,
      stageInsights: results.stageInsights.length,
      results
    };

  } catch (error) {
    console.error('Error in Deal Stage AI Engine:', error);
    
    // Log the error
    await logAIAction({
      eventType: 'deal_stage_ai_engine.error',
      targetType: 'deal_stage_analysis',
      targetId: logData.targetId || 'error',
      reason: `Deal Stage AI Engine error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      contextType: 'deal_stages',
      aiTags: ['deal_stages', 'error'],
      urgencyScore: 8,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - start
    };
  }
};

// Context gathering functions
async function getDealContext(dealId: string, tenantId: string, userId: string): Promise<any> {
  const context: any = {
    deal: null,
    company: null,
    contacts: [],
    notes: [],
    emails: [],
    activities: [],
    stageForms: {},
    associations: {},
    summary: ''
  };

  try {
    // Get deal data
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (dealDoc.exists) {
      context.deal = { id: dealId, ...dealDoc.data() };
    }

    // Get company data using primary company id when available
    const primaryCompanyId = (context.deal?.associations?.primaryCompanyId)
      || (Array.isArray(context.deal?.associations?.companies) && context.deal.associations.companies.length > 0
            ? (typeof context.deal.associations.companies[0] === 'string' ? context.deal.associations.companies[0] : context.deal.associations.companies[0]?.id)
            : context.deal?.companyId);
    if (primaryCompanyId) {
      const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(primaryCompanyId).get();
      if (companyDoc.exists) {
        context.company = { id: primaryCompanyId, ...companyDoc.data() };
      }
    }

    // Get contacts (associations-first)
    const assocContactIds = Array.isArray(context.deal?.associations?.contacts)
      ? context.deal.associations.contacts.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
      : [];
    const legacyContactIds = Array.isArray(context.deal?.contactIds) ? context.deal.contactIds : [];
    const contactIds = assocContactIds.length > 0 ? assocContactIds : legacyContactIds;
    if (contactIds.length > 0) {
      const contactPromises = contactIds.map(async (contactId: string) => {
        const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
        return contactDoc.exists ? { id: contactId, ...contactDoc.data() } : null;
      });
      context.contacts = (await Promise.all(contactPromises)).filter(Boolean);
    }

    // Get deal notes
    const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).collection('notes')
      .orderBy('createdAt', 'desc')
      .limit(20);
    const notesSnapshot = await notesQuery.get();
    context.notes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get email activity (if available)
    try {
      const emailsQuery = db.collection('tenants').doc(tenantId).collection('emails')
        .where('dealId', '==', dealId)
        .orderBy('sentAt', 'desc')
        .limit(10);
      const emailsSnapshot = await emailsQuery.get();
      context.emails = emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Email activity not available:', error);
    }

    // Get deal activities
    const activitiesQuery = db.collection('tenants').doc(tenantId).collection('activities')
      .where('dealId', '==', dealId)
      .orderBy('createdAt', 'desc')
      .limit(20);
    const activitiesSnapshot = await activitiesQuery.get();
    context.activities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get stage forms data
    if (context.deal?.stageForms) {
      context.stageForms = context.deal.stageForms;
    }

    // Get associations
    context.associations = context.deal?.associations || {};

    context.summary = `Deal: ${context.deal?.name || 'Unknown'}, Stage: ${context.deal?.stage || 'Unknown'}, Company: ${context.company?.name || 'Unknown'}, Contacts: ${context.contacts.length}, Notes: ${context.notes.length}, Emails: ${context.emails.length}`;
    
    return context;
  } catch (error) {
    console.error('Error getting deal context:', error);
    return context;
  }
}

async function analyzeCurrentStage(dealContext: any): Promise<any> {
  const analysis: any = {
    currentStage: dealContext.deal?.stage || 'discovery',
    stageRequirements: {},
    completedFields: {},
    missingFields: {},
    stageProgress: 0,
    nextStage: null,
    stageInsights: []
  };

  try {
    const currentStage = analysis.currentStage;
    
    // Define stage requirements
    const stageRequirements = getStageRequirements(currentStage);
    analysis.stageRequirements = stageRequirements;

    // Analyze completed fields
    const stageForms = dealContext.stageForms[currentStage] || {};
    analysis.completedFields = stageForms;

    // Identify missing fields
    const missingFields: any = {};
    Object.keys(stageRequirements).forEach(field => {
      if (!stageForms[field] || stageForms[field] === '') {
        missingFields[field] = stageRequirements[field];
      }
    });
    analysis.missingFields = missingFields;

    // Calculate stage progress
    const totalFields = Object.keys(stageRequirements).length;
    const completedFields = Object.keys(stageForms).filter(field => 
      stageForms[field] && stageForms[field] !== ''
    ).length;
    analysis.stageProgress = totalFields > 0 ? (completedFields / totalFields) * 100 : 0;

    // Determine next stage
    analysis.nextStage = getNextStage(currentStage);

    // Generate stage insights
    analysis.stageInsights = generateStageInsights(dealContext, analysis);

    return analysis;
  } catch (error) {
    console.error('Error analyzing current stage:', error);
    return analysis;
  }
}

function getStageRequirements(stage: string): any {
  const requirements: any = {
    discovery: {
      'currentStaffCount': 'Current staff count at the company',
      'currentAgencyCount': 'Number of staffing agencies currently used',
      'jobTitlesNeeded': 'Specific job titles they need to fill',
      'satisfactionLevel': 'Satisfaction level with current staffing',
      'shiftsNeeded': 'Shifts they need to cover',
      'currentStruggles': 'Current challenges with staffing',
      'budgetRange': 'Budget range for staffing services',
      'timeline': 'Timeline for implementation',
      'decisionMakers': 'Key decision makers involved'
    },
    qualification: {
      'painPoints': 'Specific pain points identified',
      'budgetConfirmed': 'Budget has been confirmed',
      'decisionProcess': 'Decision-making process',
      'timelineConfirmed': 'Implementation timeline confirmed',
      'stakeholders': 'All stakeholders identified',
      'currentSolutions': 'Current solutions being used',
      'evaluationCriteria': 'Evaluation criteria for vendors',
      'successMetrics': 'Success metrics defined'
    },
    proposal: {
      'requirements': 'Detailed requirements gathered',
      'solutionDesign': 'Solution design completed',
      'pricingStructure': 'Pricing structure defined',
      'implementationPlan': 'Implementation plan created',
      'timeline': 'Detailed timeline established',
      'teamAssigned': 'Implementation team assigned',
      'riskAssessment': 'Risk assessment completed',
      'valueProposition': 'Value proposition refined'
    },
    negotiation: {
      'pricingNegotiated': 'Pricing has been negotiated',
      'termsAgreed': 'Terms and conditions agreed',
      'contractDrafted': 'Contract has been drafted',
      'legalReview': 'Legal review completed',
      'finalApproval': 'Final approval obtained',
      'implementationSchedule': 'Implementation schedule set',
      'successMetrics': 'Success metrics finalized',
      'goLiveDate': 'Go-live date confirmed'
    },
    closing: {
      'contractSigned': 'Contract has been signed',
      'paymentTerms': 'Payment terms finalized',
      'implementationStarted': 'Implementation has started',
      'teamOnboarded': 'Team has been onboarded',
      'successMetrics': 'Success metrics tracking in place',
      'relationshipEstablished': 'Relationship manager assigned',
      'expansionOpportunities': 'Expansion opportunities identified',
      'referralPotential': 'Referral potential assessed'
    }
  };

  return requirements[stage] || {};
}

function getNextStage(currentStage: string): string {
  const stages = ['discovery', 'qualification', 'proposal', 'negotiation', 'closing'];
  const currentIndex = stages.indexOf(currentStage);
  return currentIndex < stages.length - 1 ? stages[currentIndex + 1] : currentStage;
}

function generateStageInsights(dealContext: any, analysis: any): string[] {
  const insights: string[] = [];
  
  try {
    const currentStage = analysis.currentStage;
    const progress = analysis.stageProgress;
    const missingFields = Object.keys(analysis.missingFields);

    // Progress-based insights
    if (progress < 30) {
      insights.push(`Stage is in early phase - focus on gathering basic information`);
    } else if (progress < 70) {
      insights.push(`Stage is progressing well - prioritize remaining key fields`);
    } else if (progress < 100) {
      insights.push(`Stage is nearly complete - finalize remaining details`);
    }

    // Missing field insights
    if (missingFields.length > 0) {
      insights.push(`${missingFields.length} critical fields still need completion`);
    }

    // Stage-specific insights
    switch (currentStage) {
      case 'discovery':
        if (dealContext.contacts.length === 0) {
          insights.push('No contacts identified - need to establish key relationships');
        }
        if (!dealContext.company?.industry) {
          insights.push('Industry information missing - important for tailored approach');
        }
        break;
        
      case 'qualification':
        if (!analysis.completedFields.budgetConfirmed) {
          insights.push('Budget not confirmed - critical for qualification');
        }
        if (!analysis.completedFields.decisionProcess) {
          insights.push('Decision process unclear - need to understand buying process');
        }
        break;
        
      case 'proposal':
        if (!analysis.completedFields.requirements) {
          insights.push('Requirements not fully defined - need detailed specifications');
        }
        if (!analysis.completedFields.pricingStructure) {
          insights.push('Pricing structure not defined - critical for proposal');
        }
        break;
        
      case 'negotiation':
        if (!analysis.completedFields.pricingNegotiated) {
          insights.push('Pricing not negotiated - key milestone for closing');
        }
        if (!analysis.completedFields.contractDrafted) {
          insights.push('Contract not drafted - legal review needed');
        }
        break;
        
      case 'closing':
        if (!analysis.completedFields.contractSigned) {
          insights.push('Contract not signed - final step needed');
        }
        if (!analysis.completedFields.implementationStarted) {
          insights.push('Implementation not started - transition needed');
        }
        break;
    }

    return insights;
  } catch (error) {
    console.error('Error generating stage insights:', error);
    return insights;
  }
}

// AI Generation functions
async function generateStageRecommendations(dealContext: any, stageAnalysis: any): Promise<any> {
  const recommendations: any = {
    stageTasks: [],
    strategies: [],
    insights: stageAnalysis.stageInsights
  };

  try {
    const currentStage = stageAnalysis.currentStage;
    const missingFields = stageAnalysis.missingFields;

    // Generate tasks for missing fields
    Object.entries(missingFields).forEach(([field, description]: [string, any]) => {
      recommendations.stageTasks.push({
        type: 'field_completion',
        title: `Complete ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
        description: `Gather information for: ${description}`,
        priority: 'high',
        category: 'business_generating',
        estimatedDuration: 30,
              associations: {
                deals: [dealContext.deal.id],
                companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                  ? (typeof dealContext.deal.associations.companies[0] === 'string'
                      ? [dealContext.deal.associations.companies[0]]
                      : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                  : (dealContext.deal.associations?.primaryCompanyId ? [dealContext.deal.associations.primaryCompanyId] : (dealContext.deal.companyId ? [dealContext.deal.companyId] : []))
              },
        aiGenerated: true,
        aiPrompt: `Complete missing field: ${field}`,
        fieldName: field,
        fieldDescription: description
      });
    });

    // Generate stage-specific strategies
    switch (currentStage) {
      case 'discovery':
        recommendations.strategies.push({
          type: 'research_strategy',
          title: 'Comprehensive Company Research',
          description: 'Research company structure, decision makers, and current staffing challenges',
          tasks: [
            'Research company website and recent news',
            'Identify key decision makers on LinkedIn',
            'Research current staffing challenges in their industry',
            'Analyze their hiring patterns and needs'
          ]
        });
        break;
        
      case 'qualification':
        recommendations.strategies.push({
          type: 'qualification_strategy',
          title: 'Pain Point Validation',
          description: 'Validate identified pain points and confirm budget availability',
          tasks: [
            'Schedule qualification meeting with key stakeholders',
            'Present pain point analysis and validate',
            'Confirm budget range and decision timeline',
            'Identify all decision makers and their roles'
          ]
        });
        break;
        
      case 'proposal':
        recommendations.strategies.push({
          type: 'proposal_strategy',
          title: 'Solution Design and Presentation',
          description: 'Design tailored solution and create compelling proposal',
          tasks: [
            'Design custom solution based on requirements',
            'Create detailed implementation plan',
            'Develop pricing structure and value proposition',
            'Prepare compelling proposal presentation'
          ]
        });
        break;
        
      case 'negotiation':
        recommendations.strategies.push({
          type: 'negotiation_strategy',
          title: 'Contract Negotiation and Legal Review',
          description: 'Negotiate terms and complete legal review process',
          tasks: [
            'Negotiate pricing and terms',
            'Draft contract with legal team',
            'Address any objections or concerns',
            'Obtain final approvals'
          ]
        });
        break;
        
      case 'closing':
        recommendations.strategies.push({
          type: 'closing_strategy',
          title: 'Contract Execution and Implementation',
          description: 'Execute contract and begin implementation process',
          tasks: [
            'Execute final contract',
            'Begin implementation planning',
            'Onboard client team',
            'Establish success metrics tracking'
          ]
        });
        break;
    }

    return recommendations;
  } catch (error) {
    console.error('Error generating stage recommendations:', error);
    return recommendations;
  }
}

async function generateFieldCompletionTasks(dealContext: any, stageAnalysis: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const missingFields = stageAnalysis.missingFields;

    Object.entries(missingFields).forEach(([field, description]: [string, any]) => {
      // Generate specific tasks based on field type
      switch (field) {
        case 'currentStaffCount':
          tasks.push({
            type: 'research',
            title: 'Research current staff count',
            description: 'Find out how many employees they currently have',
            priority: 'medium',
            category: 'business_generating',
            estimatedDuration: 15,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
            aiGenerated: true,
            aiPrompt: `Research current staff count for ${dealContext.company?.name || 'company'}`
          });
          break;
          
        case 'jobTitlesNeeded':
          tasks.push({
            type: 'meeting',
            title: 'Discuss job titles needed',
            description: 'Schedule meeting to understand specific job titles they need to fill',
            priority: 'high',
            category: 'business_generating',
            estimatedDuration: 45,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : []),
              contacts: dealContext.contacts.map((c: any) => c.id)
            },
            aiGenerated: true,
            aiPrompt: `Schedule meeting to discuss job titles needed`
          });
          break;
          
        case 'budgetRange':
          tasks.push({
            type: 'qualification',
            title: 'Confirm budget range',
            description: 'Discuss and confirm their budget range for staffing services',
            priority: 'high',
            category: 'business_generating',
            estimatedDuration: 30,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
            aiGenerated: true,
            aiPrompt: `Confirm budget range for staffing services`
          });
          break;
          
        default:
          tasks.push({
            type: 'research',
            title: `Complete ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
            description: `Gather information for: ${description}`,
            priority: 'medium',
            category: 'business_generating',
            estimatedDuration: 30,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
            aiGenerated: true,
            aiPrompt: `Complete missing field: ${field}`
          });
      }
    });

    return tasks;
  } catch (error) {
    console.error('Error generating field completion tasks:', error);
    return tasks;
  }
}

async function generateNextStagePreparation(dealContext: any, stageAnalysis: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const currentStage = stageAnalysis.currentStage;
    const nextStage = stageAnalysis.nextStage;

    if (currentStage === nextStage) {
      return tasks; // Already at final stage
    }

    // Generate preparation tasks for next stage
    switch (nextStage) {
      case 'qualification':
        tasks.push({
          type: 'preparation',
          title: 'Prepare qualification meeting',
          description: 'Prepare agenda and materials for qualification meeting',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 60,
          associations: {
            deals: [dealContext.deal.id],
            companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
              ? (typeof dealContext.deal.associations.companies[0] === 'string'
                  ? [dealContext.deal.associations.companies[0]]
                  : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
              : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
          },
          aiGenerated: true,
          aiPrompt: `Prepare for qualification stage`
        });
        break;
        
      case 'proposal':
        tasks.push({
          type: 'preparation',
          title: 'Gather proposal requirements',
          description: 'Collect all requirements needed for proposal development',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 90,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
          aiGenerated: true,
          aiPrompt: `Prepare for proposal stage`
        });
        break;
        
      case 'negotiation':
        tasks.push({
          type: 'preparation',
          title: 'Prepare negotiation strategy',
          description: 'Develop negotiation strategy and pricing approach',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 120,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
          aiGenerated: true,
          aiPrompt: `Prepare for negotiation stage`
        });
        break;
        
      case 'closing':
        tasks.push({
          type: 'preparation',
          title: 'Prepare closing documents',
          description: 'Prepare all documents needed for contract execution',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 60,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])
            },
          aiGenerated: true,
          aiPrompt: `Prepare for closing stage`
        });
        break;
    }

    return tasks;
  } catch (error) {
    console.error('Error generating next stage preparation:', error);
    return tasks;
  }
}

async function generateEmailActivityTasks(dealContext: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const emails = dealContext.emails || [];
    const contacts = dealContext.contacts || [];

    // Analyze recent email activity
    if (emails.length > 0) {
      const recentEmails = emails.slice(0, 5); // Last 5 emails
      
      recentEmails.forEach((email: any) => {
        if (email.sentAt) {
          const daysSinceEmail = Math.floor((Date.now() - new Date(email.sentAt).getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysSinceEmail > 3) {
            tasks.push({
              type: 'follow_up',
              title: `Follow up on email to ${email.to || 'contact'}`,
              description: `Follow up on email sent ${daysSinceEmail} days ago`,
              priority: 'medium',
              category: 'business_generating',
              estimatedDuration: 15,
              associations: {
                deals: [dealContext.deal.id],
                companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                  ? (typeof dealContext.deal.associations.companies[0] === 'string'
                      ? [dealContext.deal.associations.companies[0]]
                      : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                  : (dealContext.deal.associations?.primaryCompanyId ? [dealContext.deal.associations.primaryCompanyId] : (dealContext.deal.companyId ? [dealContext.deal.companyId] : []))
              },
              aiGenerated: true,
              aiPrompt: `Follow up on email activity`
            });
          }
        }
      });
    }

    // Generate email tasks for contacts without recent activity
    contacts.forEach((contact: any) => {
      const contactEmails = emails.filter((email: any) => 
        email.to === contact.email || email.from === contact.email
      );
      
      if (contactEmails.length === 0) {
        tasks.push({
          type: 'email',
          title: `Send introduction email to ${contact.name}`,
          description: `Send initial contact email to ${contact.name}`,
          priority: 'medium',
          category: 'business_generating',
          estimatedDuration: 20,
              associations: {
                deals: [dealContext.deal.id],
                companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                  ? (typeof dealContext.deal.associations.companies[0] === 'string'
                      ? [dealContext.deal.associations.companies[0]]
                      : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                  : (dealContext.deal.associations?.primaryCompanyId ? [dealContext.deal.associations.primaryCompanyId] : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])),
                contacts: [contact.id]
              },
          aiGenerated: true,
          aiPrompt: `Send introduction email to contact`
        });
      }
    });

    return tasks;
  } catch (error) {
    console.error('Error generating email activity tasks:', error);
    return tasks;
  }
}

async function generateContactEngagementTasks(dealContext: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const contacts = dealContext.contacts || [];
    const activities = dealContext.activities || [];

    contacts.forEach((contact: any) => {
      // Check recent activity with this contact
      const contactActivities = activities.filter((activity: any) => 
        activity.contactId === contact.id
      );
      
      const daysSinceLastActivity = contactActivities.length > 0 ? 
        Math.floor((Date.now() - new Date(contactActivities[0].createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 999;
      
      if (daysSinceLastActivity > 7) {
        tasks.push({
          type: 'phone_call',
          title: `Call ${contact.name}`,
          description: `Check in with ${contact.name} - no activity in ${daysSinceLastActivity} days`,
          priority: 'medium',
          category: 'business_generating',
          estimatedDuration: 30,
            associations: {
              deals: [dealContext.deal.id],
              companies: (dealContext.deal.associations?.companies && dealContext.deal.associations.companies.length > 0)
                ? (typeof dealContext.deal.associations.companies[0] === 'string'
                    ? [dealContext.deal.associations.companies[0]]
                    : [dealContext.deal.associations.companies[0]?.id].filter(Boolean))
                : (dealContext.deal.associations?.primaryCompanyId ? [dealContext.deal.associations.primaryCompanyId] : (dealContext.deal.companyId ? [dealContext.deal.companyId] : [])),
              contacts: [contact.id]
            },
          aiGenerated: true,
          aiPrompt: `Engage with contact who hasn't been contacted recently`
        });
      }
    });

    return tasks;
  } catch (error) {
    console.error('Error generating contact engagement tasks:', error);
    return tasks;
  }
}

async function generateCompanyResearchTasks(dealContext: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const company = dealContext.company;
    
    if (!company) {
      return tasks;
    }

    // Check if we have basic company information
    if (!company.industry) {
      tasks.push({
        type: 'research',
        title: 'Research company industry',
        description: 'Research the industry and market position of the company',
        priority: 'medium',
        category: 'business_generating',
        estimatedDuration: 30,
        associations: {
          deals: [dealContext.deal.id],
          companies: [company.id]
        },
        aiGenerated: true,
        aiPrompt: `Research company industry information`
      });
    }

    if (!company.size) {
      tasks.push({
        type: 'research',
        title: 'Research company size',
        description: 'Find out the company size and structure',
        priority: 'medium',
        category: 'business_generating',
        estimatedDuration: 20,
        associations: {
          deals: [dealContext.deal.id],
          companies: [company.id]
        },
        aiGenerated: true,
        aiPrompt: `Research company size and structure`
      });
    }

    // Generate competitive research task
    tasks.push({
      type: 'research',
      title: 'Research competitive landscape',
      description: 'Research competitors and market positioning',
      priority: 'low',
      category: 'business_generating',
      estimatedDuration: 45,
      associations: {
        deals: [dealContext.deal.id],
        companies: [company.id]
      },
      aiGenerated: true,
      aiPrompt: `Research competitive landscape for company`
    });

    return tasks;
  } catch (error) {
    console.error('Error generating company research tasks:', error);
    return tasks;
  }
}

async function generateCompetitiveAdvantageTasks(dealContext: any): Promise<any[]> {
  const tasks: any[] = [];

  try {
    const company = dealContext.company;
    const currentStage = dealContext.deal?.stage;
    
    if (!company) {
      return tasks;
    }

    // Generate tasks based on stage and company context
    switch (currentStage) {
      case 'discovery':
        tasks.push({
          type: 'research',
          title: 'Research current staffing challenges',
          description: 'Research common staffing challenges in their industry',
          priority: 'medium',
          category: 'business_generating',
          estimatedDuration: 30,
          associations: {
            deals: [dealContext.deal.id],
            companies: [company.id]
          },
          aiGenerated: true,
          aiPrompt: `Research industry staffing challenges`
        });
        break;
        
      case 'qualification':
        tasks.push({
          type: 'preparation',
          title: 'Prepare competitive analysis',
          description: 'Prepare analysis of how we compare to their current solutions',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 60,
          associations: {
            deals: [dealContext.deal.id],
            companies: [company.id]
          },
          aiGenerated: true,
          aiPrompt: `Prepare competitive analysis`
        });
        break;
        
      case 'proposal':
        tasks.push({
          type: 'preparation',
          title: 'Prepare value proposition',
          description: 'Prepare compelling value proposition highlighting our advantages',
          priority: 'high',
          category: 'business_generating',
          estimatedDuration: 90,
          associations: {
            deals: [dealContext.deal.id],
            companies: [company.id]
          },
          aiGenerated: true,
          aiPrompt: `Prepare value proposition`
        });
        break;
    }

    return tasks;
  } catch (error) {
    console.error('Error generating competitive advantage tasks:', error);
    return tasks;
  }
} 