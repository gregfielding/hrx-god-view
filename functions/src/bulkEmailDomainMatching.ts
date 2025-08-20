import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

interface MatchingResult {
  contactId: string;
  contactName: string;
  contactEmail: string;
  matchedCompanyId: string;
  matchedCompanyName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export const bulkEmailDomainMatching = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (request) => {
  console.log('🔗 bulkEmailDomainMatching function called');
  
  try {
    const { tenantId, dryRun = true } = request.data;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`🔗 Starting bulk email domain matching for tenant: ${tenantId} (dryRun: ${dryRun})`);
    
    const results: MatchingResult[] = [];
    const errors: string[] = [];

    // Get all contacts
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    // Get all companies
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();
    const companies = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

    console.log(`📊 Processing ${contactsSnapshot.docs.length} contacts against ${companies.length} companies`);

    for (const contactDoc of contactsSnapshot.docs) {
      try {
        const contactData = contactDoc.data();
        const contactId = contactDoc.id;
        const contactName = contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim() || 'Unknown';
        const contactEmail = contactData.email || '';

        // Skip if no email or already has company association
        if (!contactEmail || !contactEmail.includes('@') || contactData.companyId || contactData.companyName) {
          continue;
        }

        const domain = contactEmail.split('@')[1].toLowerCase();
        let bestMatch: any = null;
        let bestConfidence: 'high' | 'medium' | 'low' = 'low';
        let bestReason = '';

        // Find best matching company
        for (const company of companies) {
          const companyName = (company.companyName || company.name || '').toLowerCase();
          const companyDomain = companyName.replace(/[^a-z0-9]/g, '');
          
          // Check website domain match (highest confidence)
          const companyWebsite = (company.website || '').toLowerCase();
          const websiteDomain = companyWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          
          if (websiteDomain === domain) {
            bestMatch = company;
            bestConfidence = 'high';
            bestReason = `Website domain match: ${websiteDomain}`;
            break; // Perfect match, no need to check others
          }
          
          // Check company name pattern match
          const domainMatchesCompany = domain.includes(companyDomain) || companyDomain.includes(domain);
          if (domainMatchesCompany && !bestMatch) {
            bestMatch = company;
            bestConfidence = 'medium';
            bestReason = `Company name pattern match: ${companyDomain} in ${domain}`;
          }
        }

        if (bestMatch) {
          const result: MatchingResult = {
            contactId,
            contactName,
            contactEmail,
            matchedCompanyId: bestMatch.id,
            matchedCompanyName: bestMatch.companyName || bestMatch.name,
            confidence: bestConfidence,
            reason: bestReason
          };
          
          results.push(result);

          // Apply the association if not dry run
          if (!dryRun) {
            // Get current associations to preserve existing data
            const currentAssociations = contactDoc.data()?.associations || {};
            
            await contactDoc.ref.update({
              companyId: bestMatch.id, // Legacy format
              companyName: bestMatch.companyName || bestMatch.name, // Legacy format
              associations: {
                ...currentAssociations,
                companies: [bestMatch.id] // New format
              },
              updatedAt: new Date()
            });
            
            console.log(`✅ Associated ${contactName} (${contactEmail}) with ${bestMatch.companyName || bestMatch.name}`);
          } else {
            console.log(`🔍 Would associate ${contactName} (${contactEmail}) with ${bestMatch.companyName || bestMatch.name} (${bestConfidence} confidence)`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing contact ${contactDoc.id}:`, error);
        errors.push(`Contact ${contactDoc.id}: ${error}`);
      }
    }
    
    const summary = {
      totalContacts: contactsSnapshot.docs.length,
      contactsWithEmail: contactsSnapshot.docs.filter(doc => doc.data().email && doc.data().email.includes('@')).length,
      contactsWithoutCompany: contactsSnapshot.docs.filter(doc => !doc.data().companyId && !doc.data().companyName).length,
      matchesFound: results.length,
      highConfidenceMatches: results.filter(r => r.confidence === 'high').length,
      mediumConfidenceMatches: results.filter(r => r.confidence === 'medium').length,
      lowConfidenceMatches: results.filter(r => r.confidence === 'low').length,
      errors: errors.length
    };

    console.log('\n🎉 Bulk email domain matching completed!');
    console.log(`📊 Summary:`, summary);
    
    return {
      success: true,
      dryRun,
      summary,
      results,
      errors,
      message: `Found ${results.length} potential matches (${dryRun ? 'dry run' : 'applied'})`
    };
    
  } catch (error) {
    console.error('❌ Error during bulk email domain matching:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Bulk email domain matching failed'
    };
  }
});
