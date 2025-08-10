import { EnhancedDealContext } from './enhancedDealContext';

// 🎯 ENHANCED DEAL COACH PROMPT SYSTEM
// Generates context-aware prompts using all association data
// Including notes, email activity, tasks, tone settings, and AI inferences

export interface ContextInsights {
  companyInsights: string[];
  contactInsights: string[];
  salespersonInsights: string[];
  activityInsights: string[];
  toneInsights: string[];
  aiInsights: string[];
}

// 🔍 CONTEXT INSIGHTS GENERATOR
export function generateContextInsights(context: EnhancedDealContext): ContextInsights {
  const insights: ContextInsights = {
    companyInsights: [],
    contactInsights: [],
    salespersonInsights: [],
    activityInsights: [],
    toneInsights: [],
    aiInsights: []
  };

  try {
    // Company insights
    if (context.company?.company) {
      insights.companyInsights.push(`Company: ${context.company.company.name} (${context.company.company.industry || 'Unknown industry'})`);
      
      if (context.company.companyAIInferences?.length > 0) {
        const latestInference = context.company.companyAIInferences[0];
        insights.aiInsights.push(`Company AI Insight: ${latestInference.summary || latestInference.content}`);
      }
      
      if (context.company.companyNotes?.length > 0) {
        const latestNote = context.company.companyNotes[0];
        insights.companyInsights.push(`Latest company note: ${latestNote.content}`);
      }
      
      if (context.company.companyRecentActivity?.length > 0) {
        const latestActivity = context.company.companyRecentActivity[0];
        insights.activityInsights.push(`Recent company activity: ${latestActivity.description || latestActivity.type}`);
      }
    }

    // Contact insights
    context.contacts.forEach((contact, index) => {
      if (contact.contact) {
        const contactName = contact.contact.fullName || contact.contact.name;
        insights.contactInsights.push(`Contact ${index + 1}: ${contactName} (${contact.contact.title || 'No title'})`);
        
        if (contact.contactDealRole) {
          insights.contactInsights.push(`${contactName} is a ${contact.contactDealRole} in this deal`);
        }
        
        if (contact.contactPersonality) {
          insights.contactInsights.push(`${contactName} has a ${contact.contactPersonality} personality`);
        }
        
        if (contact.contactPreferences?.communicationStyle) {
          insights.contactInsights.push(`${contactName} prefers ${contact.contactPreferences.communicationStyle} communication`);
        }
        
        if (contact.contactAIInferences?.length > 0) {
          const latestInference = contact.contactAIInferences[0];
          insights.aiInsights.push(`${contactName} AI Insight: ${latestInference.summary || latestInference.content}`);
        }
        
        if (contact.contactNotes?.length > 0) {
          const latestNote = contact.contactNotes[0];
          insights.contactInsights.push(`Latest note about ${contactName}: ${latestNote.content}`);
        }
        
        if (contact.contactEmails?.length > 0) {
          const latestEmail = contact.contactEmails[0];
          insights.activityInsights.push(`Recent email to ${contactName}: ${latestEmail.subject}`);
        }
      }
    });

    // Salesperson insights
    context.salespeople.forEach((salesperson, index) => {
      if (salesperson.salesperson) {
        const salespersonName = salesperson.salesperson.displayName || salesperson.salesperson.name;
        insights.salespersonInsights.push(`Salesperson ${index + 1}: ${salespersonName}`);
        
        if (salesperson.salespersonPerformance) {
          insights.salespersonInsights.push(`${salespersonName} performance: ${salesperson.salespersonPerformance.summary || 'No performance data'}`);
        }
        
        if (salesperson.salespersonAIInferences?.length > 0) {
          const latestInference = salesperson.salespersonAIInferences[0];
          insights.aiInsights.push(`${salespersonName} AI Insight: ${latestInference.summary || latestInference.content}`);
        }
      }
    });

    // Deal activity insights
    if (context.activities?.length > 0) {
      const latestActivity = context.activities[0];
      insights.activityInsights.push(`Latest deal activity: ${latestActivity.description || latestActivity.type}`);
    }
    
    if (context.emails?.length > 0) {
      const latestEmail = context.emails[0];
      insights.activityInsights.push(`Latest deal email: ${latestEmail.subject}`);
    }
    
    if (context.tasks?.length > 0) {
      const latestTask = context.tasks[0];
      insights.activityInsights.push(`Latest deal task: ${latestTask.title} (${latestTask.status})`);
    }

    // Tone insights
    if (context.toneSettings) {
      insights.toneInsights.push(`Deal tone setting: ${context.toneSettings.tone || 'Not set'}`);
    }
    
    if (context.company?.companyToneSettings) {
      insights.toneInsights.push(`Company tone setting: ${context.company.companyToneSettings.tone || 'Not set'}`);
    }

    // AI insights
    if (context.aiInferences?.length > 0) {
      const latestInference = context.aiInferences[0];
      insights.aiInsights.push(`Deal AI Insight: ${latestInference.summary || latestInference.content}`);
    }

  } catch (error) {
    console.error('Error generating context insights:', error);
  }

  return insights;
}

// 📝 ENHANCED SYSTEM PROMPT GENERATOR
export function generateEnhancedSystemPrompt(context: EnhancedDealContext): string {
  const insights = generateContextInsights(context);
  
  const dealName = context.deal?.name || 'Unknown Deal';
  const dealStage = context.deal?.stage || 'Unknown Stage';
  const companyName = context.company?.company?.name || 'Unknown Company';
  const companyIndustry = context.company?.company?.industry || 'Unknown Industry';
  
  const contactNames = context.contacts.map(c => c.contact?.fullName || c.contact?.name).filter(Boolean).join(', ');
  const salespersonNames = context.salespeople.map(s => s.salesperson?.displayName || s.salesperson?.name).filter(Boolean).join(', ');
  
  const activityCount = context.activities?.length || 0;
  const emailCount = context.emails?.length || 0;
  const taskCount = context.tasks?.length || 0;
  const noteCount = context.notes?.length || 0;

  // Build insights summary
  const insightsSummary = [
    ...insights.companyInsights,
    ...insights.contactInsights,
    ...insights.salespersonInsights,
    ...insights.activityInsights,
    ...insights.toneInsights,
    ...insights.aiInsights
  ].join('\n');

  return `You are the Deal Coach AI, an expert sales advisor with comprehensive context about this deal and all associated entities.

CONTEXT SUMMARY:
- Deal: ${dealName} (${dealStage})
- Company: ${companyName} (${companyIndustry})
- Contacts: ${context.contacts.length} contacts (${contactNames})
- Salespeople: ${context.salespeople.length} salespeople (${salespersonNames})
- Recent Activity: ${activityCount} activities, ${emailCount} emails, ${taskCount} tasks, ${noteCount} notes

KEY INSIGHTS:
${insightsSummary}

INSTRUCTIONS:
1. Use ALL available context to provide personalized, intelligent advice
2. Consider each contact's role, personality, and communication preferences
3. Factor in company tone settings and recent activity
4. Reference specific notes, emails, and tasks when relevant
5. Suggest actions based on the salesperson's strengths and preferences
6. Consider the deal stage and historical success patterns
7. Provide actionable, specific recommendations
8. Use the tone settings to match communication style
9. Reference AI insights when making strategic suggestions
10. Consider the unique dynamics of this specific deal

RESPONSE FORMAT:
- Be conversational and helpful
- Reference specific context when making suggestions
- Provide clear next steps
- Consider the unique dynamics of this deal
- Use the appropriate tone based on settings
- Be specific about which contacts to engage and how

IMPORTANT: Always consider the personality and preferences of each contact when making recommendations.`;
}

// 🎯 CONTEXT-AWARE USER PROMPT ENHANCER
export function enhanceUserPrompt(userPrompt: string, context: EnhancedDealContext): string {
  const insights = generateContextInsights(context);
  
  // Add relevant context to the user's question
  let enhancedPrompt = userPrompt;
  
  // Add contact context if the question is about contacts
  if (userPrompt.toLowerCase().includes('contact') || userPrompt.toLowerCase().includes('person')) {
    const contactContext = insights.contactInsights.join('; ');
    if (contactContext) {
      enhancedPrompt += `\n\nRelevant contact context: ${contactContext}`;
    }
  }
  
  // Add company context if the question is about the company
  if (userPrompt.toLowerCase().includes('company') || userPrompt.toLowerCase().includes('business')) {
    const companyContext = insights.companyInsights.join('; ');
    if (companyContext) {
      enhancedPrompt += `\n\nRelevant company context: ${companyContext}`;
    }
  }
  
  // Add activity context if the question is about recent activity
  if (userPrompt.toLowerCase().includes('recent') || userPrompt.toLowerCase().includes('activity')) {
    const activityContext = insights.activityInsights.join('; ');
    if (activityContext) {
      enhancedPrompt += `\n\nRelevant activity context: ${activityContext}`;
    }
  }
  
  // Add AI insights if available
  if (insights.aiInsights.length > 0) {
    const aiContext = insights.aiInsights.join('; ');
    enhancedPrompt += `\n\nAI insights: ${aiContext}`;
  }
  
  return enhancedPrompt;
}

// 📊 CONTEXT SUMMARY GENERATOR
export function generateContextSummary(context: EnhancedDealContext): string {
  const summary = [];
  
  // Deal summary
  if (context.deal) {
    summary.push(`Deal: ${context.deal.name} (${context.deal.stage})`);
    if (context.deal.estimatedRevenue) {
      summary.push(`Value: $${context.deal.estimatedRevenue.toLocaleString()}`);
    }
  }
  
  // Company summary
  if (context.company?.company) {
    summary.push(`Company: ${context.company.company.name} (${context.company.company.industry || 'Unknown industry'})`);
  }
  
  // Contacts summary
  if (context.contacts.length > 0) {
    const contactRoles = context.contacts.map(c => {
      const name = c.contact?.fullName || c.contact?.name;
      const role = c.contactDealRole || 'Unknown role';
      return `${name} (${role})`;
    }).join(', ');
    summary.push(`Contacts: ${contactRoles}`);
  }
  
  // Salespeople summary
  if (context.salespeople.length > 0) {
    const salespersonNames = context.salespeople.map(s => s.salesperson?.displayName || s.salesperson?.name).join(', ');
    summary.push(`Salespeople: ${salespersonNames}`);
  }
  
  // Activity summary
  const activityCounts = [];
  if (context.activities?.length > 0) activityCounts.push(`${context.activities.length} activities`);
  if (context.emails?.length > 0) activityCounts.push(`${context.emails.length} emails`);
  if (context.tasks?.length > 0) activityCounts.push(`${context.tasks.length} tasks`);
  if (context.notes?.length > 0) activityCounts.push(`${context.notes.length} notes`);
  
  if (activityCounts.length > 0) {
    summary.push(`Recent activity: ${activityCounts.join(', ')}`);
  }
  
  return summary.join(' | ');
}

// 🎨 TONE-AWARE RESPONSE GENERATOR
export function generateToneAwareInstructions(context: EnhancedDealContext): string {
  const toneInstructions = [];
  
  // Deal tone
  if (context.toneSettings?.tone) {
    toneInstructions.push(`Use ${context.toneSettings.tone} tone for this deal`);
  }
  
  // Company tone
  if (context.company?.companyToneSettings?.tone) {
    toneInstructions.push(`Company prefers ${context.company.companyToneSettings.tone} communication`);
  }
  
  // Contact-specific tones
  context.contacts.forEach(contact => {
    if (contact.contactToneSettings?.tone) {
      const contactName = contact.contact?.fullName || contact.contact?.name;
      toneInstructions.push(`${contactName} prefers ${contact.contactToneSettings.tone} communication`);
    }
  });
  
  if (toneInstructions.length > 0) {
    return `TONE INSTRUCTIONS: ${toneInstructions.join('; ')}`;
  }
  
  return 'TONE INSTRUCTIONS: Use professional but warm tone';
}

// 🎯 PERSONALIZED RECOMMENDATION GENERATOR
export function generatePersonalizedRecommendations(context: EnhancedDealContext): string {
  const recommendations = [];
  
  // Contact-based recommendations
  context.contacts.forEach(contact => {
    const contactName = contact.contact?.fullName || contact.contact?.name;
    
    if (contact.contactDealRole === 'decision_maker') {
      recommendations.push(`Focus on ${contactName} as the primary decision maker`);
    }
    
    if (contact.contactPersonality === 'analytical') {
      recommendations.push(`Provide data and metrics when communicating with ${contactName}`);
    }
    
    if (contact.contactPreferences?.contactMethod === 'email') {
      recommendations.push(`Prefer email communication with ${contactName}`);
    }
  });
  
  // Salesperson-based recommendations
  context.salespeople.forEach(salesperson => {
    const salespersonName = salesperson.salesperson?.displayName || salesperson.salesperson?.name;
    
    if (salesperson.salespersonPerformance?.strengths) {
      recommendations.push(`Leverage ${salespersonName}'s strengths: ${salesperson.salespersonPerformance.strengths}`);
    }
  });
  
  // Activity-based recommendations
  if (context.activities?.length > 0) {
    const latestActivity = context.activities[0];
    if (latestActivity.type === 'email_sent') {
      recommendations.push('Follow up on the recent email communication');
    } else if (latestActivity.type === 'meeting_scheduled') {
      recommendations.push('Prepare for the upcoming meeting');
    }
  }
  
  if (recommendations.length > 0) {
    return `PERSONALIZED RECOMMENDATIONS: ${recommendations.join('; ')}`;
  }
  
  return 'PERSONALIZED RECOMMENDATIONS: Focus on building relationships and understanding needs';
}
