import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Callable function to sync Apollo headquarters location
 * This replaces the Firestore trigger to prevent excessive invocations
 * Only runs when explicitly called from the frontend
 */
export const syncApolloHeadquartersLocationCallable = onCall({
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { tenantId, companyId } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new Error('Authentication required');
    }
    
    if (!tenantId || !companyId) {
      throw new Error('tenantId and companyId are required');
    }

    console.log('🔍 Apollo headquarters sync requested', {
      tenantId,
      companyId,
      requestedBy: request.auth.uid
    });

    // Get company data to check Apollo firmographics
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companySnap = await companyRef.get();
    
    if (!companySnap.exists) {
      throw new Error('Company not found');
    }
    
    const companyData = companySnap.data();
    
    // Check if Apollo data exists
    const apolloData = companyData?.firmographics?.apollo;
    if (!apolloData) {
      return {
        success: false,
        message: 'No Apollo data found for this company',
        hasFirmographics: !!companyData?.firmographics,
        hasApolloData: false
      };
    }

    // Check if headquarters data exists
    const headquarters = apolloData.headquarters;
    if (!headquarters) {
      return {
        success: false,
        message: 'No headquarters data in Apollo response',
        hasApolloData: true,
        apolloKeys: Object.keys(apolloData),
        hasHeadquarters: false
      };
    }

    const { street_address, city, state, postal_code, country } = headquarters;
    
    // Validate required fields
    if (!city || !state) {
      return {
        success: false,
        message: 'Incomplete Apollo address data - missing city or state',
        headquarters: {
          street_address,
          city,
          state,
          postal_code,
          country
        }
      };
    }

    console.log('Processing Apollo headquarters data', { 
      street_address, 
      city, 
      state, 
      postal_code, 
      country 
    });

    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    
    // Check if headquarters location already exists
    const headquartersQuery = locationsRef.where('type', '==', 'Headquarters');
    const headquartersSnap = await headquartersQuery.get();
    
    if (!headquartersSnap.empty) {
      const existingLocations = headquartersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('🚫 Headquarters location already exists', { 
        existingCount: existingLocations.length,
        existingLocations: existingLocations
      });
      
      return {
        success: false,
        message: 'Headquarters location already exists',
        existingLocations: existingLocations
      };
    }
    
    // Check for similar existing locations to prevent duplicates
    const allLocationsQuery = locationsRef.get();
    const allLocationsSnap = await allLocationsQuery;
    const existingLocations = allLocationsSnap.docs.map(doc => doc.data());
    
    // Check if any existing location has a similar address
    const newAddress = `${street_address}, ${city}, ${state}`.toLowerCase();
    const similarLocation = existingLocations.find(loc => {
      const existingAddress = `${loc.address || ''}, ${loc.city || ''}, ${loc.state || ''}`.toLowerCase();
      return existingAddress.includes(city.toLowerCase()) && existingAddress.includes(state.toLowerCase());
    });
    
    if (similarLocation) {
      console.log('🚫 Found existing location with similar address', {
        newAddress: newAddress,
        existingLocation: {
          name: similarLocation.name,
          address: similarLocation.address,
          city: similarLocation.city,
          state: similarLocation.state
        }
      });
      
      return {
        success: false,
        message: 'Found existing location with similar address',
        newAddress: newAddress,
        existingLocation: similarLocation
      };
    }
    
    // Create headquarters location data
    const locationData = {
      name: companyData.companyName || companyData.name || 'Headquarters',
      address: street_address,
      city: city,
      state: state,
      zipCode: postal_code || '',
      country: country || 'USA',
      type: 'Headquarters',
      coordinates: null, // Could be enhanced with geocoding later
      discoveredBy: 'Apollo',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      contactCount: 0,
      dealCount: 0,
      salespersonCount: 0,
      _processedBy: 'syncApolloHeadquartersLocationCallable',
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    console.log('Creating headquarters location', { 
      name: locationData.name,
      address: locationData.address,
      city: locationData.city,
      state: locationData.state
    });
    
    const cleanLocationData = Object.fromEntries(
      Object.entries(locationData).filter(([, v]) => v !== undefined && v !== null)
    );
    
    // Create new headquarters location
    await locationsRef.add(cleanLocationData);
    
    console.log('✅ Created headquarters location from Apollo data', { companyId, tenantId });
    
    return {
      success: true,
      message: 'Headquarters location created successfully',
      locationData: cleanLocationData,
      companyName: companyData.companyName || companyData.name
    };
    
  } catch (error) {
    console.error('Error in syncApolloHeadquartersLocationCallable:', error);
    throw new Error(`Apollo headquarters sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
