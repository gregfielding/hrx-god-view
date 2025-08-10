# Deal Coach Enhanced Context Specification

**Date:** January 2025  
**Status:** Planning  
**Version:** 1.0

---

## Current State Analysis

The Deal Coach currently gathers basic association data but is **missing critical context** that would make responses much more intelligent and personalized:

### ✅ What's Currently Included:
- Basic deal data (name, stage, revenue, etc.)
- Company data (name, industry, size)
- Contact data (name, title, email, phone)
- Salesperson data (name, role)
- Deal notes (last 20)
- Email activity (last 10)
- Activity logs (last 20)
- Learning data (success patterns)

### ❌ What's Missing (Critical Context):

#### 1. **Company Context**
- Company notes and insights
- Email activity with company contacts
- Tasks associated with company
- AI inferences about company needs
- Tone settings for company communications
- Recent news or updates about company

#### 2. **Location Context**
- Location-specific data and preferences
- Location notes and insights
- Tasks associated with location
- Tone settings for location communications

#### 3. **Contact Context**
- Contact notes and personal insights
- Email history with each contact
- Tasks associated with each contact
- Contact's tone preferences and communication style
- AI inferences about contact's role and influence
- Contact's deal role (decision maker, influencer, etc.)
- Contact's personality profile and preferences

#### 4. **Salesperson Context**
- Salesperson's notes and insights
- Salesperson's performance data
- Tasks assigned to salesperson
- Salesperson's communication style and preferences
- AI inferences about salesperson's strengths

---

## Enhanced Context Gathering Specification

### 1. **Comprehensive Company Context**
```typescript
interface EnhancedCompanyContext {
  // Basic company data
  company: CRMCompany;
  
  // Rich context data
  companyNotes: Note[];
  companyEmails: EmailActivity[];
  companyTasks: Task[];
  companyToneSettings: ToneSettings;
  companyAIInferences: AIInference[];
  companyRecentActivity: Activity[];
  companyNews: NewsItem[];
  
  // Association metadata
  companyAssociations: {
    contacts: Contact[];
    locations: Location[];
    deals: Deal[];
    salespeople: Salesperson[];
  };
}
```

### 2. **Comprehensive Location Context**
```typescript
interface EnhancedLocationContext {
  // Basic location data
  location: Location;
  
  // Rich context data
  locationNotes: Note[];
  locationTasks: Task[];
  locationToneSettings: ToneSettings;
  locationAIInferences: AIInference[];
  locationRecentActivity: Activity[];
  
  // Association metadata
  locationAssociations: {
    companies: Company[];
    contacts: Contact[];
    deals: Deal[];
    salespeople: Salesperson[];
  };
}
```

### 3. **Comprehensive Contact Context**
```typescript
interface EnhancedContactContext {
  // Basic contact data
  contact: CRMContact;
  
  // Rich context data
  contactNotes: Note[];
  contactEmails: EmailActivity[];
  contactTasks: Task[];
  contactToneSettings: ToneSettings;
  contactAIInferences: AIInference[];
  contactRecentActivity: Activity[];
  contactDealRole: DealRole;
  contactPersonality: PersonalityProfile;
  contactPreferences: ContactPreferences;
  
  // Association metadata
  contactAssociations: {
    companies: Company[];
    locations: Location[];
    deals: Deal[];
    salespeople: Salesperson[];
  };
}
```

### 4. **Comprehensive Salesperson Context**
```typescript
interface EnhancedSalespersonContext {
  // Basic salesperson data
  salesperson: Salesperson;
  
  // Rich context data
  salespersonNotes: Note[];
  salespersonTasks: Task[];
  salespersonToneSettings: ToneSettings;
  salespersonAIInferences: AIInference[];
  salespersonPerformance: PerformanceData;
  salespersonPreferences: SalespersonPreferences;
  
  // Association metadata
  salespersonAssociations: {
    companies: Company[];
    locations: Location[];
    deals: Deal[];
    contacts: Contact[];
  };
}
```

---

## Enhanced Deal Coach Context Function

### Implementation Specification
```typescript
async function getEnhancedDealContext(dealId: string, tenantId: string, userId: string): Promise<EnhancedDealContext> {
  const context: EnhancedDealContext = {
    deal: null,
    company: null,
    locations: [],
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

  try {
    // 1. Get basic deal data
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (dealDoc.exists) {
      context.deal = { id: dealId, ...dealDoc.data() };
    }

    // 2. Get unified associations
    const { createUnifiedAssociationService } = await import('./unifiedAssociationService');
    const associationService = createUnifiedAssociationService(tenantId, userId);
    const associationResult = await associationService.getEntityAssociations('deal', dealId);
    
    context.associations = associationResult;

    // 3. Get enhanced company context
    if (context.deal?.companyId) {
      context.company = await getEnhancedCompanyContext(context.deal.companyId, tenantId);
    }

    // 4. Get enhanced location context
    if (context.deal?.locationId) {
      context.locations = [await getEnhancedLocationContext(context.deal.locationId, tenantId)];
    }

    // 5. Get enhanced contact contexts
    if (context.deal?.contactIds?.length > 0) {
      const contactPromises = context.deal.contactIds.map(async (contactId: string) => {
        return await getEnhancedContactContext(contactId, tenantId);
      });
      context.contacts = await Promise.all(contactPromises);
    }

    // 6. Get enhanced salesperson contexts
    if (context.deal?.salespeopleIds?.length > 0) {
      const salespersonPromises = context.deal.salespeopleIds.map(async (salespersonId: string) => {
        return await getEnhancedSalespersonContext(salespersonId, tenantId);
      });
      context.salespeople = await Promise.all(salespersonPromises);
    }

    // 7. Get deal-specific data
    context.notes = await getDealNotes(dealId, tenantId);
    context.emails = await getDealEmails(dealId, tenantId);
    context.activities = await getDealActivities(dealId, tenantId);
    context.tasks = await getDealTasks(dealId, tenantId);
    context.toneSettings = await getDealToneSettings(dealId, tenantId);
    context.aiInferences = await getDealAIInferences(dealId, tenantId);

    // 8. Get learning data
    context.learningData = await getLearningData(tenantId);

    return context;
  } catch (error) {
    console.error('Error getting enhanced deal context:', error);
    return context;
  }
}
```

### Helper Functions
```typescript
async function getEnhancedCompanyContext(companyId: string, tenantId: string): Promise<EnhancedCompanyContext> {
  const context: EnhancedCompanyContext = {
    company: null,
    companyNotes: [],
    companyEmails: [],
    companyTasks: [],
    companyToneSettings: {},
    companyAIInferences: [],
    companyRecentActivity: [],
    companyNews: [],
    companyAssociations: { contacts: [], locations: [], deals: [], salespeople: [] }
  };

  try {
    // Get company data
    const companyDoc = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();
    if (companyDoc.exists) {
      context.company = { id: companyId, ...companyDoc.data() };
    }

    // Get company notes
    const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('notes')
      .orderBy('createdAt', 'desc')
      .limit(20);
    const notesSnapshot = await notesQuery.get();
    context.companyNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get company emails
    const emailsQuery = db.collection('tenants').doc(tenantId).collection('emails')
      .where('companyId', '==', companyId)
      .orderBy('sentAt', 'desc')
      .limit(10);
    const emailsSnapshot = await emailsQuery.get();
    context.companyEmails = emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get company tasks
    const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('associations.companies', 'array-contains', companyId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const tasksSnapshot = await tasksQuery.get();
    context.companyTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get company tone settings
    const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(companyId).get();
    if (toneDoc.exists) {
      context.companyToneSettings = toneDoc.data();
    }

    // Get company AI inferences
    const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
      .where('entityId', '==', companyId)
      .where('entityType', '==', 'company')
      .orderBy('createdAt', 'desc')
      .limit(5);
    const aiSnapshot = await aiQuery.get();
    context.companyAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get company recent activity
    const activityQuery = db.collection('tenants').doc(tenantId).collection('activities')
      .where('companyId', '==', companyId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const activitySnapshot = await activityQuery.get();
    context.companyRecentActivity = activitySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return context;
  } catch (error) {
    console.error('Error getting enhanced company context:', error);
    return context;
  }
}

async function getEnhancedContactContext(contactId: string, tenantId: string): Promise<EnhancedContactContext> {
  const context: EnhancedContactContext = {
    contact: null,
    contactNotes: [],
    contactEmails: [],
    contactTasks: [],
    contactToneSettings: {},
    contactAIInferences: [],
    contactRecentActivity: [],
    contactDealRole: null,
    contactPersonality: null,
    contactPreferences: {},
    contactAssociations: { companies: [], locations: [], deals: [], salespeople: [] }
  };

  try {
    // Get contact data
    const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
    if (contactDoc.exists) {
      context.contact = { id: contactId, ...contactDoc.data() };
    }

    // Get contact notes
    const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).collection('notes')
      .orderBy('createdAt', 'desc')
      .limit(20);
    const notesSnapshot = await notesQuery.get();
    context.contactNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get contact emails
    const emailsQuery = db.collection('tenants').doc(tenantId).collection('emails')
      .where('contactId', '==', contactId)
      .orderBy('sentAt', 'desc')
      .limit(10);
    const emailsSnapshot = await emailsQuery.get();
    context.contactEmails = emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get contact tasks
    const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('associations.contacts', 'array-contains', contactId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const tasksSnapshot = await tasksQuery.get();
    context.contactTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get contact tone settings
    const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(contactId).get();
    if (toneDoc.exists) {
      context.contactToneSettings = toneDoc.data();
    }

    // Get contact AI inferences
    const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
      .where('entityId', '==', contactId)
      .where('entityType', '==', 'contact')
      .orderBy('createdAt', 'desc')
      .limit(5);
    const aiSnapshot = await aiQuery.get();
    context.contactAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get contact deal role and personality
    if (context.contact?.contactProfile) {
      context.contactDealRole = context.contact.contactProfile.dealRole;
      context.contactPersonality = context.contact.contactProfile.personality;
      context.contactPreferences = {
        contactMethod: context.contact.contactProfile.contactMethod,
        communicationStyle: context.contact.contactProfile.communicationStyle,
        preferredContactTime: context.contact.contactProfile.preferredContactTime
      };
    }

    return context;
  } catch (error) {
    console.error('Error getting enhanced contact context:', error);
    return context;
  }
}
```

---

## Enhanced Deal Coach Prompt

### Context-Aware System Prompt
```typescript
const enhancedSystemPrompt = `You are the Deal Coach AI, an expert sales advisor with comprehensive context about this deal and all associated entities.

CONTEXT SUMMARY:
- Deal: ${context.deal?.name} (${context.deal?.stage})
- Company: ${context.company?.company?.name} (${context.company?.company?.industry})
- Contacts: ${context.contacts.length} contacts (${context.contacts.map(c => c.contact?.fullName).join(', ')})
- Salespeople: ${context.salespeople.length} salespeople (${context.salespeople.map(s => s.salesperson?.displayName).join(', ')})
- Recent Activity: ${context.activities.length} activities, ${context.emails.length} emails, ${context.tasks.length} tasks

KEY INSIGHTS:
${generateContextInsights(context)}

INSTRUCTIONS:
1. Use ALL available context to provide personalized, intelligent advice
2. Consider each contact's role, personality, and communication preferences
3. Factor in company tone settings and recent activity
4. Reference specific notes, emails, and tasks when relevant
5. Suggest actions based on the salesperson's strengths and preferences
6. Consider the deal stage and historical success patterns
7. Provide actionable, specific recommendations

RESPONSE FORMAT:
- Be conversational and helpful
- Reference specific context when making suggestions
- Provide clear next steps
- Consider the unique dynamics of this deal`;
```

### Context Insights Generator
```typescript
function generateContextInsights(context: EnhancedDealContext): string {
  const insights = [];
  
  // Company insights
  if (context.company?.companyAIInferences?.length > 0) {
    insights.push(`Company AI Insights: ${context.company.companyAIInferences[0]?.summary}`);
  }
  
  // Contact insights
  context.contacts.forEach(contact => {
    if (contact.contactDealRole) {
      insights.push(`${contact.contact?.fullName} is a ${contact.contactDealRole} with ${contact.contactPersonality} personality`);
    }
    if (contact.contactAIInferences?.length > 0) {
      insights.push(`${contact.contact?.fullName} insights: ${contact.contactAIInferences[0]?.summary}`);
    }
  });
  
  // Salesperson insights
  context.salespeople.forEach(salesperson => {
    if (salesperson.salespersonPerformance) {
      insights.push(`${salesperson.salesperson?.displayName} performance: ${salesperson.salespersonPerformance.summary}`);
    }
  });
  
  // Recent activity insights
  if (context.activities?.length > 0) {
    insights.push(`Recent activity: ${context.activities[0]?.description}`);
  }
  
  return insights.join('\n');
}
```

---

## Implementation Benefits

### 1. **Personalized Responses**
- Consider each contact's personality and preferences
- Factor in company tone settings
- Reference specific notes and recent activity

### 2. **Intelligent Recommendations**
- Use AI inferences about company needs
- Consider contact roles and influence levels
- Factor in salesperson strengths and performance

### 3. **Context-Aware Actions**
- Suggest tasks based on contact preferences
- Recommend communication approaches based on tone settings
- Reference specific emails and notes in responses

### 4. **Enhanced Learning**
- Track which context elements lead to successful outcomes
- Improve AI inferences based on deal outcomes
- Build better patterns for future deals

---

## Migration Strategy

### Phase 1: Foundation (Week 1)
- [ ] Implement enhanced context gathering functions
- [ ] Add helper functions for each entity type
- [ ] Update Deal Coach to use enhanced context
- [ ] Test with sample deals

### Phase 2: Integration (Week 2)
- [ ] Integrate with unified association service
- [ ] Add AI inference collection
- [ ] Implement tone settings integration
- [ ] Add performance tracking

### Phase 3: Enhancement (Week 3)
- [ ] Add learning data integration
- [ ] Implement context-aware prompts
- [ ] Add response quality tracking
- [ ] Optimize performance

---

**Last Updated:** January 2025  
**Next Review:** TBD
