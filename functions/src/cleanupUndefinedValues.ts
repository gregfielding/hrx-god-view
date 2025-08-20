import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

// Function to recursively remove undefined values from an object
function removeUndefinedValues(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item)).filter(item => item !== null);
  }
  
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      const cleanedValue = removeUndefinedValues(value);
      if (cleanedValue !== null) {
        cleaned[key] = cleanedValue;
      }
    }
  }
  
  return cleaned;
}

// Function to check if an object has undefined values
function hasUndefinedValues(obj: any, path: string = ''): boolean {
  if (obj === undefined) {
    console.log(`Found undefined at path: ${path}`);
    return true;
  }
  
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  
  if (Array.isArray(obj)) {
    return obj.some((item, index) => hasUndefinedValues(item, `${path}[${index}]`));
  }
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (hasUndefinedValues(value, currentPath)) {
      return true;
    }
  }
  
  return false;
}

// Function to specifically check for urls.linkedin undefined values
function hasUrlsLinkedinUndefined(obj: any): boolean {
  if (obj && typeof obj === 'object' && obj.urls && typeof obj.urls === 'object') {
    if (obj.urls.linkedin === undefined) {
      console.log('Found urls.linkedin with undefined value');
      return true;
    }
  }
  return false;
}

export const cleanupUndefinedValues = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (request) => {
  console.log('🧹 cleanupUndefinedValues function called');
  
  try {
    const { tenantId } = request.data;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`🧹 Starting cleanup of undefined values for tenant: ${tenantId}`);
    
    const results = {
      companiesFixed: 0,
      contactsFixed: 0,
      dealsFixed: 0,
      errors: [] as string[]
    };

    // Clean up companies
    console.log('\n🏢 Cleaning up companies...');
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();
    
    for (const companyDoc of companiesSnapshot.docs) {
      try {
        const companyData = companyDoc.data();
        const companyName = companyData.companyName || companyData.name || 'Unknown';
        
        if (hasUndefinedValues(companyData) || hasUrlsLinkedinUndefined(companyData)) {
          console.log(`  🔧 Found undefined values in company: ${companyName}`);
          
          const cleanedData = removeUndefinedValues(companyData);
          
          // Specifically handle urls.linkedin undefined
          if (cleanedData.urls && cleanedData.urls.linkedin === undefined) {
            delete cleanedData.urls.linkedin;
            if (Object.keys(cleanedData.urls).length === 0) {
              delete cleanedData.urls;
            }
          }
          
          // Only update if there are changes
          const hasChanges = JSON.stringify(cleanedData) !== JSON.stringify(companyData);
          if (hasChanges) {
            await companyDoc.ref.update(cleanedData);
            results.companiesFixed++;
            console.log(`  ✅ Fixed company: ${companyName}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error fixing company ${companyDoc.id}:`, error);
        results.errors.push(`Company ${companyDoc.id}: ${error}`);
      }
    }
    
    // Clean up contacts
    console.log('\n👥 Cleaning up contacts...');
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    for (const contactDoc of contactsSnapshot.docs) {
      try {
        const contactData = contactDoc.data();
        const contactName = contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim() || 'Unknown';
        
        if (hasUndefinedValues(contactData) || hasUrlsLinkedinUndefined(contactData)) {
          console.log(`  🔧 Found undefined values in contact: ${contactName}`);
          
          const cleanedData = removeUndefinedValues(contactData);
          
          // Specifically handle urls.linkedin undefined
          if (cleanedData.urls && cleanedData.urls.linkedin === undefined) {
            delete cleanedData.urls.linkedin;
            if (Object.keys(cleanedData.urls).length === 0) {
              delete cleanedData.urls;
            }
          }
          
          // Only update if there are changes
          const hasChanges = JSON.stringify(cleanedData) !== JSON.stringify(contactData);
          if (hasChanges) {
            await contactDoc.ref.update(cleanedData);
            results.contactsFixed++;
            console.log(`  ✅ Fixed contact: ${contactName}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error fixing contact ${contactDoc.id}:`, error);
        results.errors.push(`Contact ${contactDoc.id}: ${error}`);
      }
    }
    
    // Clean up deals
    console.log('\n💼 Cleaning up deals...');
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const dealsSnapshot = await dealsRef.get();
    
    for (const dealDoc of dealsSnapshot.docs) {
      try {
        const dealData = dealDoc.data();
        const dealName = dealData.name || dealData.title || 'Unknown';
        
        if (hasUndefinedValues(dealData) || hasUrlsLinkedinUndefined(dealData)) {
          console.log(`  🔧 Found undefined values in deal: ${dealName}`);
          
          const cleanedData = removeUndefinedValues(dealData);
          
          // Specifically handle urls.linkedin undefined
          if (cleanedData.urls && cleanedData.urls.linkedin === undefined) {
            delete cleanedData.urls.linkedin;
            if (Object.keys(cleanedData.urls).length === 0) {
              delete cleanedData.urls;
            }
          }
          
          // Only update if there are changes
          const hasChanges = JSON.stringify(cleanedData) !== JSON.stringify(dealData);
          if (hasChanges) {
            await dealDoc.ref.update(cleanedData);
            results.dealsFixed++;
            console.log(`  ✅ Fixed deal: ${dealName}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error fixing deal ${dealDoc.id}:`, error);
        results.errors.push(`Deal ${dealDoc.id}: ${error}`);
      }
    }
    
    console.log('\n🎉 Cleanup completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Companies fixed: ${results.companiesFixed}`);
    console.log(`   - Contacts fixed: ${results.contactsFixed}`);
    console.log(`   - Deals fixed: ${results.dealsFixed}`);
    
    return {
      success: true,
      results,
      message: `Cleanup completed: ${results.companiesFixed} companies, ${results.contactsFixed} contacts, ${results.dealsFixed} deals fixed`
    };
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Cleanup failed'
    };
  }
});
