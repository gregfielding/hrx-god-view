import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const getLocationAssociations = onCall(async (request) => {
  try {
    const { tenantId, locationId, companyId } = request.data;
    
    if (!tenantId || !locationId || !companyId) {
      throw new Error('Missing required parameters: tenantId, locationId, companyId');
    }

    console.log(`Fetching associations for location ${locationId} in company ${companyId}, tenant ${tenantId}`);

    const db = admin.firestore();
    
    // Get associated contacts
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsQuery = contactsRef.where('companyId', '==', companyId).where('locationId', '==', locationId);
    const contactsSnap = await contactsQuery.get();
    const contacts = contactsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get associated deals
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const dealsQuery = dealsRef.where('companyId', '==', companyId).where('locationId', '==', locationId);
    const dealsSnap = await dealsQuery.get();
    const deals = dealsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get associated salespeople (placeholder for future implementation)
    const salespeople: any[] = [];

    console.log(`Found ${contacts.length} contacts, ${deals.length} deals, ${salespeople.length} salespeople for location ${locationId}`);
    
    return {
      contacts,
      deals,
      salespeople,
      summary: {
        contactCount: contacts.length,
        dealCount: deals.length,
        salespersonCount: salespeople.length
      }
    };

  } catch (error) {
    console.error('Error in getLocationAssociations:', error);
    throw new Error('Failed to get location associations');
  }
}); 