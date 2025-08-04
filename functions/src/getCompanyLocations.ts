import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const getCompanyLocations = onCall(async (request) => {
  try {
    const { tenantId, companyId } = request.data;
    
    if (!tenantId || !companyId) {
      throw new Error('Missing required parameters: tenantId, companyId');
    }

    console.log(`Fetching locations for company ${companyId} in tenant ${tenantId}`);

    const db = admin.firestore();
    const locationsRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('locations');
    const locationsSnap = await locationsRef.get();
    
    const locationsData = locationsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Found ${locationsData.length} locations for company ${companyId}`);
    return { locations: locationsData };

  } catch (error) {
    console.error('Error in getCompanyLocations:', error);
    throw new Error('Failed to get company locations');
  }
}); 