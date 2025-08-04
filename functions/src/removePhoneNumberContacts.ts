import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface ContactData {
  id: string;
  firstName?: string;
  fullName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  [key: string]: any;
}

interface RemovalResult {
  tenantId: string;
  tenantName: string;
  totalContacts: number;
  phoneNumberContacts: number;
  contactsDeleted: number;
  contactsToDelete: ContactData[];
}

export const removePhoneNumberContacts = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    const { tenantId, dryRun = true } = request.data || {};
    
    console.log('Starting phone number contact cleanup process...');
    console.log('Dry run mode:', dryRun);

    if (tenantId) {
      // Process specific tenant
      return await processTenant(tenantId, dryRun);
    } else {
      // Process all tenants
      return await processAllTenants(dryRun);
    }

  } catch (error) {
    console.error('Error in removePhoneNumberContacts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

function isPhoneNumber(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  
  // Clean the string to remove any non-digit and non-plus characters
  const cleanStr = str.replace(/[^\d+]/g, '');
  
  // Check various phone number patterns
  const phonePatterns = [
    /^\d{10,}$/, // 10+ digits
    /^\+?\d{10,}$/, // + and 10+ digits
    /^\d{3}-\d{3}-\d{4}$/, // XXX-XXX-XXXX
    /^\d{3}\.\d{3}\.\d{4}$/, // XXX.XXX.XXXX
    /^\d{3}\s\d{3}\s\d{4}$/, // XXX XXX XXXX
    /^\+1-\d{3}-\d{3}-\d{4}$/, // +1-XXX-XXX-XXXX
    /^\+1\s\d{3}\s\d{3}\s\d{4}$/, // +1 XXX XXX XXXX
  ];
  
  return phonePatterns.some(pattern => pattern.test(cleanStr)) || 
         /^\d{10,}$/.test(cleanStr) || // 10+ digits
         /^\+?\d{10,}$/.test(cleanStr); // + and 10+ digits
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
          phoneNumberContacts: 0,
          contactsDeleted: 0,
          contactsToDelete: []
        }
      };
    }

    const contacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ContactData[];

    // Filter contacts with phone numbers in name fields
    const contactsWithPhoneNumbers = contacts.filter(contact => {
      const firstName = (contact.firstName || '').trim();
      const fullName = (contact.fullName || '').trim();
      const lastName = (contact.lastName || '').trim();
      
      // Check if any name field contains a phone number
      return isPhoneNumber(firstName) || isPhoneNumber(fullName) || isPhoneNumber(lastName);
    });

    console.log(`Found ${contactsWithPhoneNumbers.length} contacts with phone numbers in names out of ${contacts.length} total`);

    if (dryRun) {
      return {
        success: true,
        message: `Dry run completed for ${tenantName}`,
        result: {
          tenantId,
          tenantName,
          totalContacts: contacts.length,
          phoneNumberContacts: contactsWithPhoneNumbers.length,
          contactsDeleted: 0,
          contactsToDelete: contactsWithPhoneNumbers
        }
      };
    }

    // Actually delete the contacts
    let deletedCount = 0;
    const batch = db.batch();
    
    for (const contact of contactsWithPhoneNumbers) {
      const contactRef = db.collection(`tenants/${tenantId}/crm_contacts`).doc(contact.id);
      batch.delete(contactRef);
      deletedCount++;
    }

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`Deleted ${deletedCount} contacts with phone numbers in names from tenant ${tenantName}`);
    }

    return {
      success: true,
      message: `Successfully processed ${tenantName}`,
      result: {
        tenantId,
        tenantName,
        totalContacts: contacts.length,
        phoneNumberContacts: contactsWithPhoneNumbers.length,
        contactsDeleted: deletedCount,
        contactsToDelete: contactsWithPhoneNumbers
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
    let totalPhoneNumberContacts = 0;
    let totalContactsDeleted = 0;

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      
      try {
        const result = await processTenant(tenantId, dryRun);
        
        if (result.success) {
          const removalResult = result.result as RemovalResult;
          results.push(removalResult);
          
          totalContactsProcessed += removalResult.totalContacts;
          totalPhoneNumberContacts += removalResult.phoneNumberContacts;
          totalContactsDeleted += removalResult.contactsDeleted;
        } else {
          console.error(`Failed to process tenant ${tenantId}:`, result.error);
          results.push({
            tenantId,
            tenantName: tenantData.name || 'Unknown Tenant',
            totalContacts: 0,
            phoneNumberContacts: 0,
            contactsDeleted: 0,
            contactsToDelete: []
          });
        }
      } catch (error) {
        console.error(`Error processing tenant ${tenantId}:`, error);
        results.push({
          tenantId,
          tenantName: tenantData.name || 'Unknown Tenant',
          totalContacts: 0,
          phoneNumberContacts: 0,
          contactsDeleted: 0,
          contactsToDelete: []
        });
      }
    }

    return {
      success: true,
      message: `Processed ${tenantsSnapshot.size} tenants`,
      summary: {
        totalTenants: tenantsSnapshot.size,
        totalContactsProcessed,
        totalPhoneNumberContacts,
        totalContactsDeleted,
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