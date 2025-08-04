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
  contactsWithoutNames: number;
  contactsDeleted: number;
  contactsToDelete: ContactData[];
}

export const removeContactsWithoutNames = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    const { tenantId, dryRun = true } = request.data || {};
    
    console.log('Starting contact cleanup process...');
    console.log('Dry run mode:', dryRun);

    if (tenantId) {
      // Process specific tenant
      return await processTenant(tenantId, dryRun);
    } else {
      // Process all tenants
      return await processAllTenants(dryRun);
    }

  } catch (error) {
    console.error('Error in removeContactsWithoutNames:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

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
          contactsWithoutNames: 0,
          contactsDeleted: 0,
          contactsToDelete: []
        }
      };
    }

    const contacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ContactData[];

    // Filter contacts without names or with invalid names (like email addresses)
    const contactsWithoutNames = contacts.filter(contact => {
      const firstName = (contact.firstName || '').trim();
      const fullName = (contact.fullName || '').trim();
      const lastName = (contact.lastName || '').trim();
      
      // Check if any name field has actual content
      const hasFirstName = firstName.length > 0;
      const hasFullName = fullName.length > 0;
      const hasLastName = lastName.length > 0;
      
      // Check if the "name" is actually an email address or other non-name content
      const isEmailAddress = (str: string) => {
        return str.includes('@') && str.includes('.');
      };
      
      const isNonNameContent = (str: string) => {
        // Check for email addresses, phone numbers, or other non-name patterns
        return isEmailAddress(str) || 
               /^\d+$/.test(str) || // Only numbers
               /^\+?\d+$/.test(str) || // Phone numbers with optional + prefix
               /^\d{10,}$/.test(str) || // Phone numbers with 10+ digits
               /^\+?\d{10,}$/.test(str) || // Phone numbers with + and 10+ digits
               /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(str) || // Email regex
               str.toLowerCase().includes('postmaster') ||
               str.toLowerCase().includes('noreply') ||
               str.toLowerCase().includes('no-reply') ||
               str.toLowerCase().includes('donotreply');
      };
      
      // Contact has no valid name if:
      // 1. All name fields are empty, OR
      // 2. The only "name" content is actually an email address or other non-name content, OR
      // 3. Any name field contains a phone number or other non-name content
      const hasNoValidName = (!hasFirstName && !hasFullName && !hasLastName) ||
                            (hasFullName && isNonNameContent(fullName) && !hasFirstName && !hasLastName) ||
                            (hasFirstName && isNonNameContent(firstName) && !hasFullName && !hasLastName) ||
                            (hasLastName && isNonNameContent(lastName) && !hasFullName && !hasFirstName) ||
                            // Also check if any name field contains non-name content (even if other fields exist)
                            (hasFullName && isNonNameContent(fullName)) ||
                            (hasFirstName && isNonNameContent(firstName)) ||
                            (hasLastName && isNonNameContent(lastName));
      
      return hasNoValidName;
    });

    console.log(`Found ${contactsWithoutNames.length} contacts without names out of ${contacts.length} total`);

    if (dryRun) {
      return {
        success: true,
        message: `Dry run completed for ${tenantName}`,
        result: {
          tenantId,
          tenantName,
          totalContacts: contacts.length,
          contactsWithoutNames: contactsWithoutNames.length,
          contactsDeleted: 0,
          contactsToDelete: contactsWithoutNames
        }
      };
    }

    // Actually delete the contacts
    let deletedCount = 0;
    const batch = db.batch();
    
    for (const contact of contactsWithoutNames) {
      const contactRef = db.collection(`tenants/${tenantId}/crm_contacts`).doc(contact.id);
      batch.delete(contactRef);
      deletedCount++;
    }

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`Deleted ${deletedCount} contacts from tenant ${tenantName}`);
    }

    return {
      success: true,
      message: `Successfully processed ${tenantName}`,
      result: {
        tenantId,
        tenantName,
        totalContacts: contacts.length,
        contactsWithoutNames: contactsWithoutNames.length,
        contactsDeleted: deletedCount,
        contactsToDelete: contactsWithoutNames
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
    let totalContactsWithoutNames = 0;
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
          totalContactsWithoutNames += removalResult.contactsWithoutNames;
          totalContactsDeleted += removalResult.contactsDeleted;
        } else {
          console.error(`Failed to process tenant ${tenantId}:`, result.error);
          results.push({
            tenantId,
            tenantName: tenantData.name || 'Unknown Tenant',
            totalContacts: 0,
            contactsWithoutNames: 0,
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
          contactsWithoutNames: 0,
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
        totalContactsWithoutNames,
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