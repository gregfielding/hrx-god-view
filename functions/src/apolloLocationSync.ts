import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

// FIXED VERSION - WITH PROPER SAFEGUARDS
export const syncApolloHeadquartersLocation = onDocumentUpdated({
  document: 'tenants/{tenantId}/crm_companies/{companyId}',
  region: 'us-central1'
}, async (event) => {
  const { tenantId, companyId } = event.params;
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  
  if (!beforeData || !afterData) {
    logger.info('Document created or deleted, skipping location sync');
    return;
  }

  // Check if Apollo data was added or updated
  const beforeApollo = beforeData.firmographics?.apollo;
  const afterApollo = afterData.firmographics?.apollo;
  
  // Only proceed if Apollo data was actually added or changed
  if (!afterApollo) {
    logger.info('No Apollo data in after state, skipping location sync');
    return;
  }
  
  // Check if Apollo data actually changed (to prevent infinite loops)
  if (beforeApollo && JSON.stringify(beforeApollo) === JSON.stringify(afterApollo)) {
    logger.info('Apollo data unchanged, skipping location sync');
    return;
  }
  
  logger.info('Apollo location sync triggered - new Apollo data detected', { 
    tenantId, 
    companyId, 
    hasBeforeApollo: !!beforeApollo, 
    hasAfterApollo: !!afterApollo,
    beforeApolloKeys: beforeApollo ? Object.keys(beforeApollo) : [],
    afterApolloKeys: afterApollo ? Object.keys(afterApollo) : []
  });
  
  // Check if headquarters data exists and we should create a location
  const headquarters = afterApollo.headquarters;
  if (!headquarters) {
    logger.info('No headquarters data in Apollo response, skipping location creation');
    return;
  }

  try {
    const { street_address, city, state, postal_code, country } = headquarters;
    
    logger.info('Processing headquarters data', { 
      street_address, 
      city, 
      state, 
      postal_code, 
      country 
    });
    
    // Only proceed if we have complete address data
    if (!city || !state) {
      logger.info('Incomplete Apollo address data, skipping headquarters location creation');
      return;
    }

    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    
    // Check if headquarters already exists - PROTECT AGAINST DUPLICATES
    const headquartersQuery = locationsRef.where('type', '==', 'Headquarters');
    const headquartersSnap = await headquartersQuery.get();
    
    if (!headquartersSnap.empty) {
      const existingLocations = headquartersSnap.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        address: doc.data().address
      }));
      logger.info('🚫 Headquarters location already exists - PROTECTING EXISTING DATA', { 
        existingCount: existingLocations.length,
        existingLocations: existingLocations
      });
      return;
    }
    
    logger.info('✅ No existing headquarters found - safe to create new one');
    
    // Additional check: Look for any existing locations with similar address to prevent duplicates
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
      logger.info('🚫 Found existing location with similar address - preventing duplicate', {
        newAddress: newAddress,
        existingLocation: {
          name: similarLocation.name,
          address: similarLocation.address,
          city: similarLocation.city,
          state: similarLocation.state
        }
      });
      return;
    }
    
    // Create headquarters location data
    const locationData = {
      name: afterData.companyName || afterData.name || 'Headquarters',
      address: street_address,
      city: city,
      state: state,
      zipCode: postal_code || '',
      country: country || 'USA',
      type: 'Headquarters',
      coordinates: null, // Could be enhanced with geocoding later
      discoveredBy: 'Apollo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contactCount: 0,
      dealCount: 0,
      salespersonCount: 0
    };
    
    logger.info('Creating headquarters location', { 
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
    logger.info('✅ Created headquarters location from Apollo data', { companyId, tenantId });
    
  } catch (error) {
    logger.error('Error creating headquarters location from Apollo data:', error);
  }
});
