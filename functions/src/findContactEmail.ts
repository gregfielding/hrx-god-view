import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export const findContactInfo = onCall(async (request) => {
  try {
    const { firstName, lastName, companyDomain, tenantId, contactId } = request.data;
    
    if (!firstName || !lastName || !companyDomain) {
      throw new Error('Missing required fields: firstName, lastName, companyDomain');
    }

    // Hunter.io API call
    const apiKey = process.env.HUNTER_API_KEY;
    console.log('🔑 Environment variables:', {
      HUNTER_API_KEY: apiKey ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV
    });
    
    if (!apiKey) {
      throw new Error('Hunter.io API key not configured. Please set it as an environment variable HUNTER_API_KEY');
    }

    // Try email finder first
    const emailUrl = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(companyDomain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`;
    
    console.log(`🔍 Searching Hunter.io for: ${firstName} ${lastName} at ${companyDomain}`);
    
    const emailResponse = await fetch(emailUrl);
    const emailData = await emailResponse.json();
    
    console.log(`✅ Hunter.io email response:`, emailData);
    
    // Try domain search for additional info (including phone)
    const domainUrl = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(companyDomain)}&api_key=${apiKey}`;
    const domainResponse = await fetch(domainUrl);
    const domainData = await domainResponse.json();
    
    console.log(`✅ Hunter.io domain response:`, domainData);
    
    const results = {
      success: false,
      email: null,
      phone: null,
      confidence: 0,
      sources: [],
      alternatives: []
    };
    
    // Process email results
    if (emailData.data?.email) {
      results.success = true;
      results.email = emailData.data.email;
      results.confidence = emailData.data.confidence;
      results.sources = emailData.data.sources || [];
      results.alternatives = emailData.data.alternatives || [];
    }
    
    // Process domain search for phone numbers
    if (domainData.data?.emails) {
      const personEmails = domainData.data.emails.filter((email: any) => 
        email.first_name?.toLowerCase() === firstName.toLowerCase() &&
        email.last_name?.toLowerCase() === lastName.toLowerCase()
      );
      
      if (personEmails.length > 0) {
        const person = personEmails[0];
        if (person.phone && !results.phone) {
          results.phone = person.phone;
        }
        if (person.email && !results.email) {
          results.email = person.email;
          results.confidence = person.confidence || 0;
        }
      }
    }
    
    // Update the contact with found information
    if (tenantId && contactId && (results.email || results.phone)) {
      const updateData: any = {
        updatedAt: new Date()
      };
      
      if (results.email) {
        updateData.email = results.email;
      }
      
      if (results.phone) {
        updateData.phone = results.phone;
      }
      
      await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).update(updateData);
      console.log(`✅ Updated contact ${contactId} with:`, updateData);
    }
    
    if (results.success) {
      return results;
    } else {
      return {
        success: false,
        message: 'No contact information found',
        data: { emailData, domainData }
      };
    }
    
  } catch (error: any) {
    console.error('❌ Error finding contact info:', error);
    throw new Error(`Failed to find contact info: ${error.message}`);
  }
}); 