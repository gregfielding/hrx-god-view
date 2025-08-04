import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface ContactData {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  workPhone?: string;
  mobilePhone?: string;
  jobTitle?: string;
  title?: string;
  companyId?: string;
  companyName?: string;
  status?: string;
  tags?: string[];
  notes?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  linkedInUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  website?: string;
  birthday?: string;
  lastContactedTime?: any;
  lastContactedMode?: string;
  leadSource?: string;
  leadStatus?: string;
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  createdAt?: any;
  updatedAt?: any;
}

interface DuplicateGroup {
  normalizedName: string;
  contacts: ContactData[];
  contactsToKeep: ContactData[];
  contactsToDelete: ContactData[];
}

interface RemovalResult {
  tenantId: string;
  tenantName: string;
  totalContacts: number;
  duplicateGroups: number;
  contactsToDelete: number;
  contactsToKeep: number;
  duplicateGroupsDetails: DuplicateGroup[];
}

export const removeDuplicateContacts = onCall({
  cors: true,
  maxInstances: 1,
  memory: '1GiB'
}, async (request) => {
  try {
    const { tenantId, dryRun = true } = request.data || {};
    
    console.log('Starting duplicate contact removal process...');
    console.log('Dry run mode:', dryRun);

    if (tenantId) {
      // Process specific tenant
      return await processTenant(tenantId, dryRun);
    } else {
      // Process all tenants
      return await processAllTenants(dryRun);
    }

  } catch (error) {
    console.error('Error in removeDuplicateContacts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

function normalizeContactName(contact: ContactData): string {
  // Get the best available name
  let name = '';
  if (contact.fullName) {
    name = contact.fullName;
  } else if (contact.firstName && contact.lastName) {
    name = `${contact.firstName} ${contact.lastName}`;
  } else if (contact.firstName) {
    name = contact.firstName;
  } else if (contact.lastName) {
    name = contact.lastName;
  }
  
  // Normalize the name (lowercase, remove extra spaces, etc.)
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s]/g, ''); // Remove special characters except spaces
}

function calculateContactCompleteness(contact: ContactData): number {
  let score = 0;
  
  // Basic information (10 points)
  if (contact.fullName || (contact.firstName && contact.lastName)) score += 3;
  if (contact.email) score += 2;
  if (contact.phone || contact.workPhone || contact.mobilePhone) score += 2;
  if (contact.jobTitle || contact.title) score += 2;
  if (contact.companyId || contact.companyName) score += 1;
  
  // Contact details (5 points)
  if (contact.address) score += 1;
  if (contact.city) score += 1;
  if (contact.state) score += 1;
  if (contact.zipcode) score += 1;
  if (contact.country) score += 1;
  
  // Professional information (5 points)
  if (contact.linkedInUrl) score += 2;
  if (contact.website) score += 1;
  if (contact.notes) score += 1;
  if (contact.tags && contact.tags.length > 0) score += 1;
  
  // Additional details (3 points)
  if (contact.birthday) score += 1;
  if (contact.lastContactedTime) score += 1;
  if (contact.leadSource) score += 1;
  
  // Metadata (2 points)
  if (contact.createdAt) score += 1;
  if (contact.updatedAt) score += 1;
  
  return score;
}

function findDuplicateContacts(contacts: ContactData[]): DuplicateGroup[] {
  const contactGroups = new Map<string, ContactData[]>();
  
  // Group contacts by normalized name
  contacts.forEach(contact => {
    const normalizedName = normalizeContactName(contact);
    if (normalizedName) {
      if (!contactGroups.has(normalizedName)) {
        contactGroups.set(normalizedName, []);
      }
      contactGroups.get(normalizedName)!.push(contact);
    }
  });
  
  // Filter groups that have duplicates (more than 1 contact)
  const duplicateGroups: DuplicateGroup[] = [];
  
  contactGroups.forEach((groupContacts, normalizedName) => {
    if (groupContacts.length > 1) {
      // Calculate completeness scores
      const contactsWithScores = groupContacts.map(contact => ({
        ...contact,
        completenessScore: calculateContactCompleteness(contact)
      }));
      
      // Sort by completeness score (highest first), then by creation date (oldest first)
      contactsWithScores.sort((a, b) => {
        if (b.completenessScore !== a.completenessScore) {
          return b.completenessScore - a.completenessScore;
        }
        // If scores are similar (within 2 points), keep the oldest
        if (Math.abs(b.completenessScore - a.completenessScore) <= 2) {
          const aCreated = a.createdAt?.toDate?.() || a.createdAt || new Date(0);
          const bCreated = b.createdAt?.toDate?.() || b.createdAt || new Date(0);
          return aCreated.getTime() - bCreated.getTime();
        }
        return b.completenessScore - a.completenessScore;
      });
      
      // Keep the first contact (highest score or oldest if similar)
      const contactToKeep = contactsWithScores[0];
      const contactsToDelete = contactsWithScores.slice(1);
      
      duplicateGroups.push({
        normalizedName,
        contacts: groupContacts,
        contactsToKeep: [contactToKeep],
        contactsToDelete: contactsToDelete
      });
    }
  });
  
  return duplicateGroups;
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
          duplicateGroups: 0,
          contactsToDelete: 0,
          contactsToKeep: 0,
          duplicateGroupsDetails: []
        }
      };
    }

    const contacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ContactData[];

    console.log(`Found ${contacts.length} contacts for tenant ${tenantName}`);

    // Find duplicate contacts
    const duplicateGroups = findDuplicateContacts(contacts);
    
    const totalContactsToDelete = duplicateGroups.reduce((sum, group) => sum + group.contactsToDelete.length, 0);
    const totalContactsToKeep = duplicateGroups.reduce((sum, group) => sum + group.contactsToKeep.length, 0);

    console.log(`Found ${duplicateGroups.length} duplicate groups with ${totalContactsToDelete} contacts to delete`);

    if (dryRun) {
      return {
        success: true,
        message: `Dry run completed for ${tenantName}`,
        result: {
          tenantId,
          tenantName,
          totalContacts: contacts.length,
          duplicateGroups: duplicateGroups.length,
          contactsToDelete: totalContactsToDelete,
          contactsToKeep: totalContactsToKeep,
          duplicateGroupsDetails: duplicateGroups
        }
      };
    }

    // Actually delete the duplicate contacts
    let deletedCount = 0;
    const batch = db.batch();
    
    for (const group of duplicateGroups) {
      for (const contact of group.contactsToDelete) {
        const contactRef = db.collection(`tenants/${tenantId}/crm_contacts`).doc(contact.id);
        batch.delete(contactRef);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`Deleted ${deletedCount} duplicate contacts from tenant ${tenantName}`);
    }

    return {
      success: true,
      message: `Successfully processed ${tenantName}`,
      result: {
        tenantId,
        tenantName,
        totalContacts: contacts.length,
        duplicateGroups: duplicateGroups.length,
        contactsToDelete: totalContactsToDelete,
        contactsToKeep: totalContactsToKeep,
        duplicateGroupsDetails: duplicateGroups
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

    const results: RemovalResult[] = [];
    let totalContactsProcessed = 0;
    let totalDuplicateGroups = 0;
    let totalContactsToDelete = 0;
    let totalContactsToKeep = 0;

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      
      try {
        const result = await processTenant(tenantId, dryRun);
        
        if (result.success) {
          const removalResult = result.result as RemovalResult;
          results.push(removalResult);
          
          totalContactsProcessed += removalResult.totalContacts;
          totalDuplicateGroups += removalResult.duplicateGroups;
          totalContactsToDelete += removalResult.contactsToDelete;
          totalContactsToKeep += removalResult.contactsToKeep;
        } else {
          console.error(`Failed to process tenant ${tenantId}:`, result.error);
          results.push({
            tenantId,
            tenantName: tenantData.name || 'Unknown Tenant',
            totalContacts: 0,
            duplicateGroups: 0,
            contactsToDelete: 0,
            contactsToKeep: 0,
            duplicateGroupsDetails: []
          });
        }
      } catch (error) {
        console.error(`Error processing tenant ${tenantId}:`, error);
        results.push({
          tenantId,
          tenantName: tenantData.name || 'Unknown Tenant',
          totalContacts: 0,
          duplicateGroups: 0,
          contactsToDelete: 0,
          contactsToKeep: 0,
          duplicateGroupsDetails: []
        });
      }
    }

    return {
      success: true,
      message: `Processed ${tenantsSnapshot.size} tenants`,
      summary: {
        totalTenants: tenantsSnapshot.size,
        totalContactsProcessed,
        totalDuplicateGroups,
        totalContactsToDelete,
        totalContactsToKeep,
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