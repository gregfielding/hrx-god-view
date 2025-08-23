import { onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface CleanupResult {
  tenantId: string;
  totalContacts: number;
  contactsWithCompanyName: number;
  contactsWithCompanyId: number;
  contactsWithAssociations: number;
  contactsFixed: number;
  errors: string[];
}

// Callable function (preferred)
export const cleanupContactCompanyAssociations = onCall({ 
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (request) => {
  console.log('🔧 cleanupContactCompanyAssociations function called');
  console.log('🔧 Request data:', request.data);
  console.log('🔧 Request auth:', request.auth);
  
  try {
    const { tenantId } = request.data;
    
    if (!tenantId) {
      console.error('❌ tenantId is required but not provided');
      throw new Error('tenantId is required');
    }

    console.log(`🔧 Starting contact company association cleanup for tenant: ${tenantId}`);
    
    const result: CleanupResult = {
      tenantId,
      totalContacts: 0,
      contactsWithCompanyName: 0,
      contactsWithCompanyId: 0,
      contactsWithAssociations: 0,
      contactsFixed: 0,
      errors: []
    };

    // Get all contacts for the tenant
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    if (contactsSnapshot.empty) {
      console.log('No contacts found for tenant');
      return { success: true, result };
    }

    result.totalContacts = contactsSnapshot.docs.length;
    console.log(`📊 Found ${result.totalContacts} contacts to process`);

    // Get all companies for the tenant to build a lookup map
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();
    
    const companyMap = new Map<string, string>(); // companyName -> companyId
    const companyIdMap = new Map<string, any>(); // companyId -> companyData
    
    companiesSnapshot.docs.forEach(doc => {
      const companyData = doc.data();
      const companyName = companyData.companyName || companyData.name || '';
      if (companyName) {
        // Create multiple variations for better matching
        const normalizedName = companyName.toLowerCase().trim();
        companyMap.set(normalizedName, doc.id);
        
        // Also try without common suffixes
        const withoutSuffixes = normalizedName
          .replace(/,?\s*(inc\.?|incorporated|llc|ltd\.?|limited|corp\.?|corporation|co\.?)$/i, '')
          .trim();
        if (withoutSuffixes !== normalizedName) {
          companyMap.set(withoutSuffixes, doc.id);
        }
        
        // Also try without extra spaces
        const withoutExtraSpaces = normalizedName.replace(/\s+/g, ' ');
        if (withoutExtraSpaces !== normalizedName) {
          companyMap.set(withoutExtraSpaces, doc.id);
        }
        
        console.log(`📝 Company mapping: "${companyName}" -> ID: ${doc.id}`);
      }
      companyIdMap.set(doc.id, { id: doc.id, ...companyData });
    });

    console.log(`🏢 Found ${companyMap.size} companies for lookup`);

    // Process each contact
    let batch = db.batch();
    let batchCount = 0;
    const maxBatchSize = 500;

    for (const contactDoc of contactsSnapshot.docs) {
      try {
        const contactData = contactDoc.data();
        const contactId = contactDoc.id;
        let needsUpdate = false;
        const updates: any = {};

        // Count current state
        if (contactData.companyName) result.contactsWithCompanyName++;
        if (contactData.companyId) result.contactsWithCompanyId++;
        if (contactData.associations?.companies?.length > 0) result.contactsWithAssociations++;

        // Case 1: Contact has companyName but no companyId - try to find matching company
        if (contactData.companyName && !contactData.companyId) {
          const normalizedCompanyName = contactData.companyName.toLowerCase().trim();
          let matchingCompanyId = companyMap.get(normalizedCompanyName);
          
          // If no exact match, try variations
          if (!matchingCompanyId) {
            // Try without suffixes
            const withoutSuffixes = normalizedCompanyName
              .replace(/,?\s*(inc\.?|incorporated|llc|ltd\.?|limited|corp\.?|corporation|co\.?)$/i, '')
              .trim();
            matchingCompanyId = companyMap.get(withoutSuffixes);
          }
          
          if (!matchingCompanyId) {
            // Try without extra spaces
            const withoutExtraSpaces = normalizedCompanyName.replace(/\s+/g, ' ');
            matchingCompanyId = companyMap.get(withoutExtraSpaces);
          }
          
          if (matchingCompanyId) {
            console.log(`🔗 Linking contact "${contactData.fullName}" to company "${contactData.companyName}" (ID: ${matchingCompanyId})`);
            
            updates.companyId = matchingCompanyId;
            updates.associations = {
              ...contactData.associations,
              companies: [matchingCompanyId]
            };
            needsUpdate = true;
            result.contactsFixed++;
          } else {
            console.log(`❌ No matching company found for contact "${contactData.fullName}" with company name "${contactData.companyName}"`);
          }
        }

        // Case 2: Contact has companyId but no associations.companies
        if (contactData.companyId && (!contactData.associations?.companies || contactData.associations.companies.length === 0)) {
          console.log(`🔗 Adding company association for contact "${contactData.fullName}" (Company ID: ${contactData.companyId})`);
          
          updates.associations = {
            ...contactData.associations,
            companies: [contactData.companyId]
          };
          needsUpdate = true;
          result.contactsFixed++;
        }

        // Case 3: Contact has associations.companies but no companyId
        if (contactData.associations?.companies?.length > 0 && !contactData.companyId) {
          const primaryCompanyId = contactData.associations.companies[0];
          console.log(`🔗 Setting companyId for contact "${contactData.fullName}" (Company ID: ${primaryCompanyId})`);
          
          updates.companyId = primaryCompanyId;
          needsUpdate = true;
          result.contactsFixed++;
        }

        // Apply updates if needed
        if (needsUpdate) {
          const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
          batch.update(contactRef, {
            ...updates,
            updatedAt: new Date()
          });
          batchCount++;

          // Commit batch if it gets too large
          if (batchCount >= maxBatchSize) {
            await batch.commit();
            console.log(`✅ Committed batch of ${batchCount} updates`);
            batch = db.batch();
            batchCount = 0;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing contact ${contactDoc.id}:`, error);
        result.errors.push(`Contact ${contactDoc.id}: ${error}`);
      }
    }

    // Commit any remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Committed final batch of ${batchCount} updates`);
    }

    console.log(`🎉 Cleanup completed! Fixed ${result.contactsFixed} contacts`);
    console.log('📊 Final results:', result);

    return { success: true, result };
  } catch (error) {
    console.error('❌ Error in cleanup function:', error);
    throw new Error(`Cleanup failed: ${error}`);
  }
});

// HTTP function (backup for CORS issues)
export const cleanupContactCompanyAssociationsHttp = onRequest({ 
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Check for authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('❌ Missing or invalid authorization header');
    res.status(401).json({ error: 'Unauthorized - Missing or invalid authorization header' });
    return;
  }

  try {
    // Verify the Firebase Auth token
    const token = authHeader.split('Bearer ')[1];
    if (!token) {
      console.error('❌ Invalid token format');
      res.status(401).json({ error: 'Unauthorized - Invalid token format' });
      return;
    }
    
    // Verify the token with Firebase Admin SDK
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    console.log('✅ Token verified for user:', decodedToken.uid);
    
    // You can add additional checks here if needed
    // For example, check if the user belongs to the tenant they're trying to access
    
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(401).json({ error: 'Unauthorized - Authentication failed' });
    return;
  }

  console.log('🔧 cleanupContactCompanyAssociationsHttp function called');
  console.log('🔧 Request method:', req.method);
  console.log('🔧 Request body:', req.body);
  
  try {
    const { tenantId } = req.body || req.query;
    
    if (!tenantId) {
      console.error('❌ tenantId is required but not provided');
      res.status(400).json({ error: 'tenantId is required' });
      return;
    }

    console.log(`🔧 Starting contact company association cleanup for tenant: ${tenantId}`);
    
    const result: CleanupResult = {
      tenantId,
      totalContacts: 0,
      contactsWithCompanyName: 0,
      contactsWithCompanyId: 0,
      contactsWithAssociations: 0,
      contactsFixed: 0,
      errors: []
    };

    // Get all contacts for the tenant
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    if (contactsSnapshot.empty) {
      console.log('No contacts found for tenant');
      res.json({ success: true, result });
      return;
    }

    result.totalContacts = contactsSnapshot.docs.length;
    console.log(`📊 Found ${result.totalContacts} contacts to process`);

    // Get all companies for the tenant to build a lookup map
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();
    
    const companyMap = new Map<string, string>(); // companyName -> companyId
    const companyIdMap = new Map<string, any>(); // companyId -> companyData
    
    companiesSnapshot.docs.forEach(doc => {
      const companyData = doc.data();
      const companyName = companyData.companyName || companyData.name || '';
      if (companyName) {
        // Create multiple variations for better matching
        const normalizedName = companyName.toLowerCase().trim();
        companyMap.set(normalizedName, doc.id);
        
        // Also try without common suffixes
        const withoutSuffixes = normalizedName
          .replace(/,?\s*(inc\.?|incorporated|llc|ltd\.?|limited|corp\.?|corporation|co\.?)$/i, '')
          .trim();
        if (withoutSuffixes !== normalizedName) {
          companyMap.set(withoutSuffixes, doc.id);
        }
        
        // Also try without extra spaces
        const withoutExtraSpaces = normalizedName.replace(/\s+/g, ' ');
        if (withoutExtraSpaces !== normalizedName) {
          companyMap.set(withoutExtraSpaces, doc.id);
        }
        
        console.log(`📝 Company mapping: "${companyName}" -> ID: ${doc.id}`);
      }
      companyIdMap.set(doc.id, { id: doc.id, ...companyData });
    });

    console.log(`🏢 Found ${companyMap.size} companies for lookup`);

    // Process each contact
    let batch = db.batch();
    let batchCount = 0;
    const maxBatchSize = 500;

    for (const contactDoc of contactsSnapshot.docs) {
      try {
        const contactData = contactDoc.data();
        const contactId = contactDoc.id;
        let needsUpdate = false;
        const updates: any = {};

        // Count current state
        if (contactData.companyName) result.contactsWithCompanyName++;
        if (contactData.companyId) result.contactsWithCompanyId++;
        if (contactData.associations?.companies?.length > 0) result.contactsWithAssociations++;

        // Case 1: Contact has companyName but no companyId - try to find matching company
        if (contactData.companyName && !contactData.companyId) {
          const normalizedCompanyName = contactData.companyName.toLowerCase().trim();
          let matchingCompanyId = companyMap.get(normalizedCompanyName);
          
          // If no exact match, try variations
          if (!matchingCompanyId) {
            // Try without suffixes
            const withoutSuffixes = normalizedCompanyName
              .replace(/,?\s*(inc\.?|incorporated|llc|ltd\.?|limited|corp\.?|corporation|co\.?)$/i, '')
              .trim();
            matchingCompanyId = companyMap.get(withoutSuffixes);
          }
          
          if (!matchingCompanyId) {
            // Try without extra spaces
            const withoutExtraSpaces = normalizedCompanyName.replace(/\s+/g, ' ');
            matchingCompanyId = companyMap.get(withoutExtraSpaces);
          }
          
          if (matchingCompanyId) {
            console.log(`🔗 Linking contact "${contactData.fullName}" to company "${contactData.companyName}" (ID: ${matchingCompanyId})`);
            
            updates.companyId = matchingCompanyId;
            updates.associations = {
              ...contactData.associations,
              companies: [matchingCompanyId]
            };
            needsUpdate = true;
            result.contactsFixed++;
          } else {
            console.log(`❌ No matching company found for contact "${contactData.fullName}" with company name "${contactData.companyName}"`);
          }
        }

        // Case 2: Contact has companyId but no associations.companies
        if (contactData.companyId && (!contactData.associations?.companies || contactData.associations.companies.length === 0)) {
          console.log(`🔗 Adding company association for contact "${contactData.fullName}" (Company ID: ${contactData.companyId})`);
          
          updates.associations = {
            ...contactData.associations,
            companies: [contactData.companyId]
          };
          needsUpdate = true;
          result.contactsFixed++;
        }

        // Case 3: Contact has associations.companies but no companyId
        if (contactData.associations?.companies?.length > 0 && !contactData.companyId) {
          const primaryCompanyId = contactData.associations.companies[0];
          console.log(`🔗 Setting companyId for contact "${contactData.fullName}" (Company ID: ${primaryCompanyId})`);
          
          updates.companyId = primaryCompanyId;
          needsUpdate = true;
          result.contactsFixed++;
        }

        // Apply updates if needed
        if (needsUpdate) {
          const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
          batch.update(contactRef, {
            ...updates,
            updatedAt: new Date()
          });
          batchCount++;

          // Commit batch if it gets too large
          if (batchCount >= maxBatchSize) {
            await batch.commit();
            console.log(`✅ Committed batch of ${batchCount} updates`);
            batch = db.batch();
            batchCount = 0;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing contact ${contactDoc.id}:`, error);
        result.errors.push(`Contact ${contactDoc.id}: ${error}`);
      }
    }

    // Commit any remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Committed final batch of ${batchCount} updates`);
    }

    console.log(`🎉 Cleanup completed! Fixed ${result.contactsFixed} contacts`);
    console.log('📊 Final results:', result);

    res.json({ success: true, result });
  } catch (error) {
    console.error('❌ Error in cleanup function:', error);
    res.status(500).json({ error: `Cleanup failed: ${error}` });
  }
});
