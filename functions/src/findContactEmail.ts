import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

const db = getFirestore();

export const findContactEmail = onCall(async (request) => {
  try {
    const { firstName, lastName, companyDomain, tenantId, contactId } = request.data;
    
    if (!firstName || !lastName || !companyDomain) {
      throw new Error('Missing required fields: firstName, lastName, companyDomain');
    }

    // Hunter.io API call
    const hunterApiKey = functions.config().hunter?.api_key;
    if (!hunterApiKey) {
      throw new Error('Hunter.io API key not configured. Please set it with: firebase functions:config:set hunter.api_key="YOUR_API_KEY"');
    }

    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(companyDomain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${hunterApiKey}`;
    
    console.log(`🔍 Searching Hunter.io for: ${firstName} ${lastName} at ${companyDomain}`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ Hunter.io response:`, data);
    
    if (data.data?.email) {
      // Get the best email (highest confidence)
      const bestEmail = data.data.email;
      const confidence = data.data.confidence;
      
      // Update the contact with the found email
      if (tenantId && contactId) {
        await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).update({
          email: bestEmail,
          updatedAt: new Date()
        });
        console.log(`✅ Updated contact ${contactId} with email: ${bestEmail} (${confidence}% confidence)`);
      }
      
      return {
        success: true,
        email: bestEmail,
        confidence: confidence,
        sources: data.data.sources,
        alternatives: data.data.alternatives || [] // Other possible emails
      };
    } else {
      return {
        success: false,
        message: 'No email found',
        data: data
      };
    }
    
  } catch (error: any) {
    console.error('❌ Error finding contact email:', error);
    throw new Error(`Failed to find contact email: ${error.message}`);
  }
}); 