import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// 🎯 ENHANCED DEAL CONTEXT SYSTEM
// Provides comprehensive context from all deal associations
// Including notes, email activity, tasks, tone settings, and AI inferences

export interface EnhancedDealContext {
  deal: any;
  company: EnhancedCompanyContext | null;
  locations: EnhancedLocationContext[];
  contacts: EnhancedContactContext[];
  salespeople: EnhancedSalespersonContext[];
  notes: any[];
  emails: any[];
  activities: any[];
  tasks: any[];
  toneSettings: any;
  aiInferences: any;
  learningData: any;
  associations: any;
}

export interface EnhancedCompanyContext {
  company: any;
  companyNotes: any[];
  companyEmails: any[];
  companyTasks: any[];
  companyToneSettings: any;
  companyAIInferences: any[];
  companyRecentActivity: any[];
  companyNews: any[];
  companyAssociations: {
    contacts: any[];
    locations: any[];
    deals: any[];
    salespeople: any[];
  };
}

export interface EnhancedLocationContext {
  location: any;
  locationNotes: any[];
  locationTasks: any[];
  locationToneSettings: any;
  locationAIInferences: any[];
  locationRecentActivity: any[];
  locationAssociations: {
    companies: any[];
    contacts: any[];
    deals: any[];
    salespeople: any[];
  };
}

export interface EnhancedContactContext {
  contact: any;
  contactNotes: any[];
  contactEmails: any[];
  contactTasks: any[];
  contactToneSettings: any;
  contactAIInferences: any[];
  contactRecentActivity: any[];
  contactDealRole: string | null;
  contactPersonality: string | null;
  contactPreferences: any;
  contactAssociations: {
    companies: any[];
    locations: any[];
    deals: any[];
    salespeople: any[];
  };
}

export interface EnhancedSalespersonContext {
  salesperson: any;
  salespersonNotes: any[];
  salespersonTasks: any[];
  salespersonToneSettings: any;
  salespersonAIInferences: any[];
  salespersonPerformance: any;
  salespersonPreferences: any;
  salespersonAssociations: {
    companies: any[];
    locations: any[];
    deals: any[];
    contacts: any[];
  };
}

// 🔍 MAIN ENHANCED CONTEXT GATHERING FUNCTION
export async function getEnhancedDealContext(dealId: string, tenantId: string, userId: string): Promise<EnhancedDealContext> {
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
    console.log(`🔍 Getting enhanced deal context for deal: ${dealId}, tenant: ${tenantId}, user: ${userId}`);

    // 1. Get basic deal data
    const dealDoc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).get();
    if (dealDoc.exists) {
      context.deal = { id: dealId, ...dealDoc.data() };
      console.log(`📊 Deal data loaded: ${context.deal.name} (${context.deal.stage})`);
    }

          // 2. Get basic associations (enhanced associations not available)
      context.associations = { entities: { companies: [], contacts: [], salespeople: [] }, summary: { totalAssociations: 0 } };

    // 3. Get enhanced company context using primary company id when available
    const primaryCompanyId = (context.deal?.associations?.primaryCompanyId)
      || (Array.isArray(context.deal?.associations?.companies) && context.deal.associations.companies.length > 0
            ? (typeof context.deal.associations.companies[0] === 'string' ? context.deal.associations.companies[0] : context.deal.associations.companies[0]?.id)
            : context.deal?.companyId);
    if (primaryCompanyId) {
      console.log(`🏢 Loading enhanced company context for: ${primaryCompanyId}`);
      context.company = await getEnhancedCompanyContext(primaryCompanyId, tenantId);
    }

    // 4. Get enhanced location context from associations
    const locationIds = Array.isArray(context.deal?.associations?.locations)
      ? context.deal.associations.locations.map((l: any) => (typeof l === 'string' ? l : l?.id)).filter(Boolean)
      : [];
    if (locationIds.length > 0) {
      console.log(`📍 Loading enhanced location contexts for: ${locationIds.join(',')}`);
      context.locations = await Promise.all(locationIds.map((lid: string) => getEnhancedLocationContext(lid, tenantId)));
    }

    // 5. Get enhanced contact contexts (associations first, legacy fallback)
    const associatedContactIds = Array.isArray(context.deal?.associations?.contacts)
      ? context.deal.associations.contacts.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
      : [];
    const legacyContactIds = Array.isArray(context.deal?.contactIds) ? context.deal.contactIds : [];
    const contactIds = associatedContactIds.length > 0 ? associatedContactIds : legacyContactIds;
    if (contactIds.length > 0) {
      console.log(`👥 Loading enhanced contact contexts for ${contactIds.length} contacts`);
      context.contacts = await Promise.all(contactIds.map((cid: string) => getEnhancedContactContext(cid, tenantId)));
    }

    // 6. Get enhanced salesperson contexts (associations-based)
    const salespersonIds = Array.isArray(context.deal?.associations?.salespeople)
      ? context.deal.associations.salespeople.map((s: any) => (typeof s === 'string' ? s : s?.id)).filter(Boolean)
      : [];
    if (salespersonIds.length > 0) {
      console.log(`👤 Loading enhanced salesperson contexts for ${salespersonIds.length} salespeople`);
      context.salespeople = await Promise.all(salespersonIds.map((sid: string) => getEnhancedSalespersonContext(sid, tenantId)));
    }

    // 7. Get deal-specific data
    console.log(`📋 Loading deal-specific data`);
    context.notes = await getDealNotes(dealId, tenantId);
    context.emails = await getDealEmails(dealId, tenantId);
    context.activities = await getDealActivities(dealId, tenantId);
    context.tasks = await getDealTasks(dealId, tenantId);
    context.toneSettings = await getDealToneSettings(dealId, tenantId);
    context.aiInferences = await getDealAIInferences(dealId, tenantId);

    // 8. Get learning data
    context.learningData = await getLearningData(tenantId);

    console.log(`✅ Enhanced deal context loaded successfully`);
    console.log(`📊 Summary: ${context.contacts.length} contacts, ${context.salespeople.length} salespeople, ${context.notes.length} notes, ${context.emails.length} emails`);

    return context;
  } catch (error) {
    console.error('❌ Error getting enhanced deal context:', error);
    return context;
  }
}

// 🏢 ENHANCED COMPANY CONTEXT
export async function getEnhancedCompanyContext(companyId: string, tenantId: string): Promise<EnhancedCompanyContext> {
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
    try {
      const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('notes')
        .orderBy('createdAt', 'desc')
        .limit(20);
      const notesSnapshot = await notesQuery.get();
      context.companyNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch company notes:', error);
    }

    // Get company emails
    try {
      const emailsQuery = db.collection('tenants').doc(tenantId).collection('emails')
        .where('companyId', '==', companyId)
        .orderBy('sentAt', 'desc')
        .limit(10);
      const emailsSnapshot = await emailsQuery.get();
      context.companyEmails = emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch company emails:', error);
    }

    // Get company tasks
    try {
      const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('associations.companies', 'array-contains', companyId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const tasksSnapshot = await tasksQuery.get();
      context.companyTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch company tasks:', error);
    }

    // Get company tone settings
    try {
      const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(companyId).get();
      if (toneDoc.exists) {
        context.companyToneSettings = toneDoc.data();
      }
    } catch (error) {
      console.warn('Could not fetch company tone settings:', error);
    }

    // Get company AI inferences
    try {
      const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
        .where('entityId', '==', companyId)
        .where('entityType', '==', 'company')
        .orderBy('createdAt', 'desc')
        .limit(5);
      const aiSnapshot = await aiQuery.get();
      context.companyAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch company AI inferences:', error);
    }

    // Get company recent activity
    try {
      const activityQuery = db.collection('tenants').doc(tenantId).collection('activities')
        .where('companyId', '==', companyId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const activitySnapshot = await activityQuery.get();
      context.companyRecentActivity = activitySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch company recent activity:', error);
    }

    return context;
  } catch (error) {
    console.error('Error getting enhanced company context:', error);
    return context;
  }
}

// 📍 ENHANCED LOCATION CONTEXT
export async function getEnhancedLocationContext(locationId: string, tenantId: string): Promise<EnhancedLocationContext> {
  const context: EnhancedLocationContext = {
    location: null,
    locationNotes: [],
    locationTasks: [],
    locationToneSettings: {},
    locationAIInferences: [],
    locationRecentActivity: [],
    locationAssociations: { companies: [], contacts: [], deals: [], salespeople: [] }
  };

  try {
    // Get location data
    const locationDoc = await db.collection('tenants').doc(tenantId).collection('locations').doc(locationId).get();
    if (locationDoc.exists) {
      context.location = { id: locationId, ...locationDoc.data() };
    }

    // Get location notes
    try {
      const notesQuery = db.collection('tenants').doc(tenantId).collection('locations').doc(locationId).collection('notes')
        .orderBy('createdAt', 'desc')
        .limit(20);
      const notesSnapshot = await notesQuery.get();
      context.locationNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch location notes:', error);
    }

    // Get location tasks
    try {
      const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('associations.locations', 'array-contains', locationId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const tasksSnapshot = await tasksQuery.get();
      context.locationTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch location tasks:', error);
    }

    // Get location tone settings
    try {
      const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(locationId).get();
      if (toneDoc.exists) {
        context.locationToneSettings = toneDoc.data();
      }
    } catch (error) {
      console.warn('Could not fetch location tone settings:', error);
    }

    // Get location AI inferences
    try {
      const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
        .where('entityId', '==', locationId)
        .where('entityType', '==', 'location')
        .orderBy('createdAt', 'desc')
        .limit(5);
      const aiSnapshot = await aiQuery.get();
      context.locationAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch location AI inferences:', error);
    }

    return context;
  } catch (error) {
    console.error('Error getting enhanced location context:', error);
    return context;
  }
}

// 👥 ENHANCED CONTACT CONTEXT
export async function getEnhancedContactContext(contactId: string, tenantId: string): Promise<EnhancedContactContext> {
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
    try {
      const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).collection('notes')
        .orderBy('createdAt', 'desc')
        .limit(20);
      const notesSnapshot = await notesQuery.get();
      context.contactNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch contact notes:', error);
    }

    // Get contact emails
    try {
      const emailsQuery = db.collection('tenants').doc(tenantId).collection('emails')
        .where('contactId', '==', contactId)
        .orderBy('sentAt', 'desc')
        .limit(10);
      const emailsSnapshot = await emailsQuery.get();
      context.contactEmails = emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch contact emails:', error);
    }

    // Get contact tasks
    try {
      const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('associations.contacts', 'array-contains', contactId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const tasksSnapshot = await tasksQuery.get();
      context.contactTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch contact tasks:', error);
    }

    // Get contact tone settings
    try {
      const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(contactId).get();
      if (toneDoc.exists) {
        context.contactToneSettings = toneDoc.data();
      }
    } catch (error) {
      console.warn('Could not fetch contact tone settings:', error);
    }

    // Get contact AI inferences
    try {
      const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
        .where('entityId', '==', contactId)
        .where('entityType', '==', 'contact')
        .orderBy('createdAt', 'desc')
        .limit(5);
      const aiSnapshot = await aiQuery.get();
      context.contactAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch contact AI inferences:', error);
    }

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

// 👤 ENHANCED SALESPERSON CONTEXT
export async function getEnhancedSalespersonContext(salespersonId: string, tenantId: string): Promise<EnhancedSalespersonContext> {
  const context: EnhancedSalespersonContext = {
    salesperson: null,
    salespersonNotes: [],
    salespersonTasks: [],
    salespersonToneSettings: {},
    salespersonAIInferences: [],
    salespersonPerformance: {},
    salespersonPreferences: {},
    salespersonAssociations: { companies: [], locations: [], deals: [], contacts: [] }
  };

  try {
    // Get salesperson data
    const salespersonDoc = await db.collection('tenants').doc(tenantId).collection('users').doc(salespersonId).get();
    if (salespersonDoc.exists) {
      context.salesperson = { id: salespersonId, ...salespersonDoc.data() };
    }

    // Get salesperson notes
    try {
      const notesQuery = db.collection('tenants').doc(tenantId).collection('users').doc(salespersonId).collection('notes')
        .orderBy('createdAt', 'desc')
        .limit(20);
      const notesSnapshot = await notesQuery.get();
      context.salespersonNotes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch salesperson notes:', error);
    }

    // Get salesperson tasks
    try {
      const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
        .where('assignedTo', '==', salespersonId)
        .orderBy('createdAt', 'desc')
        .limit(10);
      const tasksSnapshot = await tasksQuery.get();
      context.salespersonTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch salesperson tasks:', error);
    }

    // Get salesperson tone settings
    try {
      const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(salespersonId).get();
      if (toneDoc.exists) {
        context.salespersonToneSettings = toneDoc.data();
      }
    } catch (error) {
      console.warn('Could not fetch salesperson tone settings:', error);
    }

    // Get salesperson AI inferences
    try {
      const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
        .where('entityId', '==', salespersonId)
        .where('entityType', '==', 'salesperson')
        .orderBy('createdAt', 'desc')
        .limit(5);
      const aiSnapshot = await aiQuery.get();
      context.salespersonAIInferences = aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Could not fetch salesperson AI inferences:', error);
    }

    // Get salesperson performance data
    try {
      const performanceDoc = await db.collection('tenants').doc(tenantId).collection('salesperson_performance').doc(salespersonId).get();
      if (performanceDoc.exists) {
        context.salespersonPerformance = performanceDoc.data();
      }
    } catch (error) {
      console.warn('Could not fetch salesperson performance:', error);
    }

    return context;
  } catch (error) {
    console.error('Error getting enhanced salesperson context:', error);
    return context;
  }
}

// 📋 HELPER FUNCTIONS FOR DEAL-SPECIFIC DATA
async function getDealNotes(dealId: string, tenantId: string): Promise<any[]> {
  try {
    const notesQuery = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId).collection('notes')
      .orderBy('createdAt', 'desc')
      .limit(20);
    const notesSnapshot = await notesQuery.get();
    return notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Could not fetch deal notes:', error);
    return [];
  }
}

async function getDealEmails(dealId: string, tenantId: string): Promise<any[]> {
  try {
    const emailsQuery = db.collection('tenants').doc(tenantId).collection('email_logs')
      .where('dealId', '==', dealId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const emailsSnapshot = await emailsQuery.get();
    return emailsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Could not fetch deal emails from email_logs, falling back to emails:', error);
    try {
      const fallback = db.collection('tenants').doc(tenantId).collection('emails')
        .where('dealId', '==', dealId)
        .orderBy('sentAt', 'desc')
        .limit(10);
      const snap = await fallback.get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e2) {
      console.warn('Fallback emails fetch also failed:', e2);
      return [];
    }
  }
}

async function getDealActivities(dealId: string, tenantId: string): Promise<any[]> {
  try {
    const activitiesQuery = db.collection('tenants').doc(tenantId).collection('activities')
      .where('dealId', '==', dealId)
      .orderBy('createdAt', 'desc')
      .limit(20);
    const activitiesSnapshot = await activitiesQuery.get();
    return activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Could not fetch deal activities:', error);
    return [];
  }
}

async function getDealTasks(dealId: string, tenantId: string): Promise<any[]> {
  try {
    const tasksQuery = db.collection('tenants').doc(tenantId).collection('tasks')
      .where('associations.deals', 'array-contains', dealId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const tasksSnapshot = await tasksQuery.get();
    return tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Could not fetch deal tasks:', error);
    return [];
  }
}

async function getDealToneSettings(dealId: string, tenantId: string): Promise<any> {
  try {
    const toneDoc = await db.collection('tenants').doc(tenantId).collection('tone_settings').doc(dealId).get();
    if (toneDoc.exists) {
      return toneDoc.data();
    }
    return {};
  } catch (error) {
    console.warn('Could not fetch deal tone settings:', error);
    return {};
  }
}

async function getDealAIInferences(dealId: string, tenantId: string): Promise<any> {
  try {
    const aiQuery = db.collection('tenants').doc(tenantId).collection('ai_inferences')
      .where('entityId', '==', dealId)
      .where('entityType', '==', 'deal')
      .orderBy('createdAt', 'desc')
      .limit(5);
    const aiSnapshot = await aiQuery.get();
    return aiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Could not fetch deal AI inferences:', error);
    return [];
  }
}

async function getLearningData(tenantId: string): Promise<any> {
  try {
    const learningRef = db.collection('tenants').doc(tenantId).collection('ai_learning').doc('learning_data');
    const learningSnap = await learningRef.get();
    if (learningSnap.exists) {
      return learningSnap.data();
    }
    return {
      successfulPatterns: [],
      failedPatterns: [],
      salespersonPerformance: {},
      stageSuccessRates: {},
      commonObjections: [],
      effectiveQuestions: []
    };
  } catch (error) {
    console.warn('Could not fetch learning data:', error);
    return {
      successfulPatterns: [],
      failedPatterns: [],
      salespersonPerformance: {},
      stageSuccessRates: {},
      commonObjections: [],
      effectiveQuestions: []
    };
  }
}
