import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface ContactData {
  id: string;
  // Core Fields
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  companyId?: string;
  locationId?: string;
  source?: string;
  tags?: string[];
  status?: string;
  priorityScore?: number;
  lastContacted?: any;
  createdBy?: string;
  
  // Optional Context Fields
  relationshipNotes?: string;
  contactCadence?: string;
  nextAction?: string;
  nextActionDueDate?: any;
  influencerType?: string;
  buyingPower?: string;
  approvalChainNotes?: string;
  personalityType?: string;
  linkedDeals?: string[];
  linkedTasks?: string[];
  
  // Enriched Fields
  linkedinUrl?: string;
  profilePhoto?: string;
  location?: string;
  companyName?: string;
  education?: string[];
  jobHistory?: any[];
  socialPresence?: string[];
  newsMentions?: any[];
  publicQuotes?: string[];
  personalitySummary?: string;
  inferredSeniority?: string;
  inferredIndustry?: string;
  commonConnections?: any[];
  
  // Metadata
  enriched?: boolean;
  enrichedAt?: any;
  createdAt?: any;
  updatedAt?: any;
  
  // Legacy fields to preserve
  [key: string]: any;
}

interface MigrationResult {
  tenantId: string;
  tenantName: string;
  totalContacts: number;
  contactsMigrated: number;
  contactsSkipped: number;
  errors: string[];
}

export const migrateContactSchema = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    const { tenantId, dryRun = true } = request.data || {};
    
    console.log('Starting contact schema migration...');
    console.log('Dry run mode:', dryRun);

    if (tenantId) {
      // Process specific tenant
      return await processTenant(tenantId, dryRun);
    } else {
      // Process all tenants
      return await processAllTenants(dryRun);
    }

  } catch (error) {
    console.error('Error in migrateContactSchema:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

function normalizeContactData(contact: ContactData): ContactData {
  const normalized: ContactData = {
    // Core Fields - preserve existing data
    fullName: contact.fullName || '',
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    email: contact.email || '',
    phone: contact.phone || contact.workPhone || contact.mobilePhone || '',
    title: contact.title || contact.jobTitle || '',
    department: contact.department || '',
    companyId: contact.companyId || '',
    locationId: contact.locationId || '',
    source: contact.source || contact.leadSource || 'manual',
    tags: contact.tags || [],
    status: contact.status || 'active',
    priorityScore: contact.priorityScore || calculatePriorityScore(contact),
    lastContacted: contact.lastContacted || contact.lastContactedTime || null,
    createdBy: contact.createdBy || contact.salesOwnerRef || '',
    
    // Optional Context Fields - initialize if not present
    relationshipNotes: contact.relationshipNotes || contact.notes || '',
    contactCadence: contact.contactCadence || 'monthly',
    nextAction: contact.nextAction || '',
    nextActionDueDate: contact.nextActionDueDate || null,
    influencerType: contact.influencerType || inferInfluencerType(contact),
    buyingPower: contact.buyingPower || inferBuyingPower(contact),
    approvalChainNotes: contact.approvalChainNotes || '',
    personalityType: contact.personalityType || '',
    linkedDeals: contact.linkedDeals || [],
    linkedTasks: contact.linkedTasks || [],
    
    // Enriched Fields - preserve existing enriched data
    linkedinUrl: contact.linkedinUrl || '',
    profilePhoto: contact.profilePhoto || '',
    location: contact.location || formatLocation(contact),
    companyName: contact.companyName || '',
    education: contact.education || [],
    jobHistory: contact.jobHistory || [],
    socialPresence: contact.socialPresence || [],
    newsMentions: contact.newsMentions || [],
    publicQuotes: contact.publicQuotes || [],
    personalitySummary: contact.personalitySummary || '',
    inferredSeniority: contact.inferredSeniority || inferSeniority(contact),
    inferredIndustry: contact.inferredIndustry || '',
    commonConnections: contact.commonConnections || [],
    
    // Metadata
    enriched: contact.enriched || false,
    enrichedAt: contact.enrichedAt || null,
    createdAt: contact.createdAt || new Date(),
    updatedAt: new Date(),
    
    // Preserve legacy fields for backward compatibility (including id)
    ...contact
  };
  
  return normalized;
}

function calculatePriorityScore(contact: ContactData): number {
  let score = 0;
  
  // Basic info (0-20 points)
  if (contact.fullName) score += 5;
  if (contact.email) score += 5;
  if (contact.phone) score += 5;
  if (contact.title) score += 5;
  
  // Professional info (0-30 points)
  if (contact.linkedinUrl) score += 10;
  if (contact.companyName) score += 5;
  if (contact.location) score += 5;
  if (contact.jobHistory && contact.jobHistory.length > 0) score += 10;
  
  // Engagement info (0-25 points)
  if (contact.lastContacted) score += 10;
  if (contact.relationshipNotes) score += 5;
  if (contact.tags && contact.tags.length > 0) score += 5;
  if (contact.status === 'active') score += 5;
  
  // Seniority bonus (0-25 points)
  const seniority = inferSeniority(contact);
  switch (seniority) {
    case 'exec': score += 25; break;
    case 'director': score += 20; break;
    case 'manager': score += 15; break;
    case 'ic': score += 10; break;
    default: score += 5;
  }
  
  return Math.min(score, 100); // Cap at 100
}

function inferInfluencerType(contact: ContactData): string {
  const title = (contact.title || '').toLowerCase();
  
  if (title.includes('ceo') || title.includes('president') || title.includes('founder')) {
    return 'decision-maker';
  }
  if (title.includes('director') || title.includes('manager') || title.includes('lead')) {
    return 'influencer';
  }
  if (title.includes('assistant') || title.includes('coordinator') || title.includes('receptionist')) {
    return 'gatekeeper';
  }
  if (title.includes('hr') || title.includes('human resources')) {
    return 'stakeholder';
  }
  
  return 'contact';
}

function inferBuyingPower(contact: ContactData): string {
  const seniority = inferSeniority(contact);
  
  if (seniority === 'exec') return 'high';
  if (seniority === 'director') return 'high';
  if (seniority === 'manager') return 'medium';
  
  return 'low';
}

function inferSeniority(contact: ContactData): string {
  const title = (contact.title || '').toLowerCase();
  
  if (title.includes('ceo') || title.includes('president') || title.includes('founder') || 
      title.includes('chief') || title.includes('vp') || title.includes('vice president')) {
    return 'exec';
  }
  if (title.includes('director') || title.includes('head of')) {
    return 'director';
  }
  if (title.includes('manager') || title.includes('lead') || title.includes('supervisor')) {
    return 'manager';
  }
  
  return 'ic';
}

function formatLocation(contact: ContactData): string {
  const parts = [];
  if (contact.city) parts.push(contact.city);
  if (contact.state) parts.push(contact.state);
  if (contact.country) parts.push(contact.country);
  
  return parts.length > 0 ? parts.join(', ') : '';
}

async function processTenant(tenantId: string, dryRun: boolean): Promise<any> {
  try {
    console.log(`Processing tenant: ${tenantId}`);
    
    // Get tenant info
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return {
        success: false,
        error: `Tenant ${tenantId} not found`
      };
    }
    
    const tenantName = tenantDoc.data()?.name || 'Unknown Tenant';
    
    // Get all contacts for this tenant
    const contactsSnapshot = await db.collection(`tenants/${tenantId}/crm_contacts`).get();
    
    if (contactsSnapshot.empty) {
      return {
        success: true,
        message: `No contacts found for tenant ${tenantName}`,
        result: {
          tenantId,
          tenantName,
          totalContacts: 0,
          contactsMigrated: 0,
          contactsSkipped: 0,
          errors: []
        }
      };
    }

    const contacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ContactData[];

    console.log(`Found ${contacts.length} contacts for tenant ${tenantName}`);

    let migratedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const batch = db.batch();

    for (const contact of contacts) {
      try {
        const normalizedContact = normalizeContactData(contact);
        
        // Check if migration is needed - look for missing new schema fields
        const needsMigration = !contact.priorityScore || 
                              !contact.influencerType || 
                              !contact.buyingPower ||
                              !contact.inferredSeniority ||
                              !contact.contactCadence ||
                              !contact.department ||
                              !contact.source ||
                              !contact.tags ||
                              !contact.relationshipNotes;
        
        if (needsMigration) {
          if (!dryRun) {
            const contactRef = db.collection(`tenants/${tenantId}/crm_contacts`).doc(contact.id);
            batch.update(contactRef, {
              priorityScore: normalizedContact.priorityScore,
              influencerType: normalizedContact.influencerType,
              buyingPower: normalizedContact.buyingPower,
              inferredSeniority: normalizedContact.inferredSeniority,
              contactCadence: normalizedContact.contactCadence,
              department: normalizedContact.department,
              source: normalizedContact.source,
              tags: normalizedContact.tags,
              relationshipNotes: normalizedContact.relationshipNotes,
              title: normalizedContact.title, // Map jobTitle to title
              phone: normalizedContact.phone, // Consolidate phone fields
              lastContacted: normalizedContact.lastContacted,
              createdBy: normalizedContact.createdBy,
              updatedAt: new Date()
            });
          }
          migratedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        const errorMsg = `Error processing contact ${contact.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    if (!dryRun && migratedCount > 0) {
      await batch.commit();
      console.log(`Migrated ${migratedCount} contacts for tenant ${tenantName}`);
    }

    return {
      success: true,
      message: `Successfully processed ${tenantName}`,
      result: {
        tenantId,
        tenantName,
        totalContacts: contacts.length,
        contactsMigrated: migratedCount,
        contactsSkipped: skippedCount,
        errors
      }
    };

  } catch (error) {
    console.error(`Error processing tenant ${tenantId}:`, error);
    return {
      success: false,
      error: `Failed to process tenant ${tenantId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

async function processAllTenants(dryRun: boolean): Promise<any> {
  try {
    console.log('Processing all tenants...');
    
    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();
    
    if (tenantsSnapshot.empty) {
      return {
        success: true,
        message: 'No tenants found',
        results: []
      };
    }

    const results: MigrationResult[] = [];
    let totalContactsProcessed = 0;
    let totalContactsMigrated = 0;
    let totalContactsSkipped = 0;
    let totalErrors = 0;

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      
      try {
        const result = await processTenant(tenantId, dryRun);
        
        if (result.success) {
          const migrationResult = result.result as MigrationResult;
          results.push(migrationResult);
          
          totalContactsProcessed += migrationResult.totalContacts;
          totalContactsMigrated += migrationResult.contactsMigrated;
          totalContactsSkipped += migrationResult.contactsSkipped;
          totalErrors += migrationResult.errors.length;
        } else {
          console.error(`Failed to process tenant ${tenantId}:`, result.error);
          results.push({
            tenantId,
            tenantName: tenantData.name || 'Unknown Tenant',
            totalContacts: 0,
            contactsMigrated: 0,
            contactsSkipped: 0,
            errors: [result.error]
          });
        }
      } catch (error) {
        console.error(`Error processing tenant ${tenantId}:`, error);
        results.push({
          tenantId,
          tenantName: tenantData.name || 'Unknown Tenant',
          totalContacts: 0,
          contactsMigrated: 0,
          contactsSkipped: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error']
        });
      }
    }

    return {
      success: true,
      message: `Processed ${tenantsSnapshot.size} tenants`,
      summary: {
        totalTenants: tenantsSnapshot.size,
        totalContactsProcessed,
        totalContactsMigrated,
        totalContactsSkipped,
        totalErrors,
        dryRun
      },
      results
    };

  } catch (error) {
    console.error('Error processing all tenants:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
} 