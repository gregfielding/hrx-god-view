import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Callable function to create headquarters location from Apollo data
 * This can be called manually if the automatic trigger isn't working
 */
export const createHeadquartersLocation = onCall({
  timeoutSeconds: 60,
  memory: '256MiB'
}, async (request) => {
  try {
    const { tenantId, companyId, testMode = false } = request.data;
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !companyId) {
      throw new Error('tenantId and companyId are required');
    }

    console.log('🔍 Manual headquarters location creation requested', {
      tenantId,
      companyId,
      testMode
    });

    // Get company data to check Apollo firmographics
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companySnap = await companyRef.get();
    
    if (!companySnap.exists) {
      throw new Error('Company not found');
    }
    
    const companyData = companySnap.data();
    console.log('Company data:', {
      companyName: companyData?.companyName,
      hasFirmographics: !!companyData?.firmographics,
      hasApolloData: !!companyData?.firmographics?.apollo,
      apolloKeys: companyData?.firmographics?.apollo ? Object.keys(companyData.firmographics.apollo) : []
    });

    // If in test mode, just return the Apollo data structure
    if (testMode) {
      const apolloData = companyData?.firmographics?.apollo;
      return {
        success: true,
        testMode: true,
        apolloData: apolloData,
        headquartersData: apolloData?.headquarters,
        apolloKeys: apolloData ? Object.keys(apolloData) : [],
        headquartersKeys: apolloData?.headquarters ? Object.keys(apolloData.headquarters) : []
      };
    }

    // Check if headquarters location already exists
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    const headquartersQuery = locationsRef.where('type', '==', 'Headquarters');
    const headquartersSnap = await headquartersQuery.get();
    
    if (!headquartersSnap.empty) {
      console.log('🚫 Headquarters location already exists');
      return {
        success: false,
        message: 'Headquarters location already exists',
        existingLocations: headquartersSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      };
    }

    // Get Apollo headquarters data
    const apolloData = companyData?.firmographics?.apollo;
    if (!apolloData?.headquarters) {
      throw new Error('No Apollo headquarters data found');
    }

    const headquarters = apolloData.headquarters;
    console.log('Apollo headquarters data:', JSON.stringify(headquarters, null, 2));

    // Create headquarters location data
    const locationData = {
      name: 'Headquarters',
      type: 'Headquarters',
      address: headquarters.street_address || headquarters.streetAddress || headquarters.address || '',
      city: headquarters.city || '',
      state: headquarters.state || '',
      zip: headquarters.postal_code || headquarters.postalCode || headquarters.zip || '',
      country: headquarters.country || 'US',
      isActive: true,
      isPrimary: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'manual_creation',
      metadata: {
        apolloData: true,
        createdBy: 'manual',
        companyName: companyData.companyName || companyData.name
      }
    };

    // Create new headquarters location
    await locationsRef.add(locationData);
    
    console.log('✅ Created headquarters location manually', {
      companyId,
      tenantId,
      locationData
    });

    return {
      success: true,
      message: 'Headquarters location created successfully',
      locationData
    };

  } catch (error) {
    console.error('❌ Error creating headquarters location:', error);
    throw new Error(`Failed to create headquarters location: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
