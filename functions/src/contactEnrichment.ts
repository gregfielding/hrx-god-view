import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logEnrichmentEvent } from './utils/logging';
import { createContactAILog } from './utils/aiLogging';
import { getApolloKey } from './utils/secrets';
import { apolloContactEnrichment, apolloCompanyByDomain, ApolloContactEnrichment } from './utils/apollo';

// Utility function to remove undefined values from objects (Firestore doesn't allow undefined)
function removeUndefinedValues(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item)).filter(item => item !== null);
  }
  
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeUndefinedValues(value);
      if (cleanedValue !== null) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }
  
  return obj;
}

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type Mode = 'full' | 'metadata' | 'apollo-only';

// Removed OpenAI initialization - using Apollo-only approach

// Secrets used by enrichment pipeline (Apollo optional augmentation)
const APOLLO_API_KEY = defineSecret('APOLLO_API_KEY');

interface ContactEnrichment {
  businessSummary?: string;
  professionalSummary?: string;
  inferredSeniority?: string;
  inferredIndustry?: string;
  keySkills?: string[];
  professionalInterests?: string[];
  communicationStyle?: string;
  influenceLevel?: string;
  recommendedApproach?: string;
  potentialPainPoints?: string[];
  networkingOpportunities?: string[];
  socialProfiles?: Array<{
    platform: string;
    url: string;
    title: string;
  }>;
  newsMentions?: Array<{
    title: string;
    snippet: string;
    link: string;
    date: string;
  }>;
  jobHistory?: Array<{
    title: string;
    company: string;
    duration: string;
    description: string;
  }>;
  education?: Array<{
    degree: string;
    institution: string;
    year: string;
  }>;
}

// Removed GPT enrichment function - using Apollo-only approach

export async function runContactEnrichment(
  tenantId: string,
  contactId: string,
  opts: { mode?: Mode; force?: boolean } = {}
): Promise<void> {
  const mode: Mode = opts.mode || 'apollo-only'; // Default to apollo-only
  
  const contactRef = db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`);
  const snap = await contactRef.get();
  if (!snap.exists) return;
  const contact = snap.data() as any;

  const contactName = contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
  const contactEmail = contact.email;
  const contactCompany = contact.companyName;
  
  console.log(`Starting contact enrichment for ${contactName} (${contactId}) in mode: ${mode}`);

  // Apollo augmentation (optional, additive)
  let apolloData: ApolloContactEnrichment | null = null;
  let apolloCompanyData: any = null;
  
  try {
    // Enable by default unless explicitly disabled
    const enableApollo = (process.env.ENABLE_APOLLO || 'true').toLowerCase() !== 'false';
    if (enableApollo) {
      const apolloKey = await getApolloKey(tenantId);
      
      if (apolloKey) {
        console.log('Fetching Apollo contact data...');
        
        // Try to enrich contact with Apollo
        const enrichmentParams: any = {};
        
        // Priority order: email (most reliable), then name, then first_name + last_name
        if (contactEmail) {
          enrichmentParams.email = contactEmail;
        }
        
        // Use full name if available (Apollo docs say this is preferred)
        if (contact.fullName && contact.fullName.trim()) {
          enrichmentParams.name = contact.fullName.trim();
        } else if (contact.firstName || contact.lastName) {
          // Fallback to first_name + last_name if no full name
          if (contact.firstName) {
            enrichmentParams.first_name = contact.firstName.trim();
          }
          if (contact.lastName) {
            enrichmentParams.last_name = contact.lastName.trim();
          }
        }
        
        // Add organization name if we have company info (helps with matching)
        if (contactCompany) {
          enrichmentParams.organization_name = contactCompany;
        }
        
        // Add domain if we have company info (helps with matching)
        if (contactCompany) {
          // Extract domain from company name for better matching
          const domain = contactCompany.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
          enrichmentParams.domain = domain;
        }
        
        // Add job title if available
        if (contact.jobTitle || contact.title) {
          enrichmentParams.title = contact.jobTitle || contact.title;
        }
        
        // Add phone number if available
        if (contact.phone || contact.workPhone || contact.mobilePhone) {
          enrichmentParams.phone = contact.phone || contact.workPhone || contact.mobilePhone;
        }
        
        // Add LinkedIn URL if available
        if (contact.linkedInUrl) {
          enrichmentParams.linkedin_url = contact.linkedInUrl;
        }
        
        // Add location information if available
        if (contact.city) {
          enrichmentParams.city = contact.city;
        }
        if (contact.state) {
          enrichmentParams.state = contact.state;
        }
        if (contact.country) {
          enrichmentParams.country = contact.country;
        }
        
        // Don't reveal personal emails/phone by default to save credits
        enrichmentParams.reveal_personal_emails = false;
        enrichmentParams.reveal_phone_number = false;
        
        apolloData = await apolloContactEnrichment(enrichmentParams, apolloKey);
        
        if (apolloData) {
          // If we got company data from Apollo, also enrich the company
          if (apolloData.organization && apolloData.organization.primary_domain) {
            console.log('Enriching company data from Apollo contact...');
            apolloCompanyData = await apolloCompanyByDomain(apolloData.organization.primary_domain, apolloKey);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Apollo augmentation failed', (e as Error).message);
  }

  // Apollo-only mode - no GPT analysis
  console.log('Apollo-only mode: Using Apollo data only');
  const parsed: ContactEnrichment = {
    professionalSummary: '',
    keySkills: [],
    professionalInterests: [],
    communicationStyle: '',
    influenceLevel: '',
    recommendedApproach: '',
    potentialPainPoints: [],
    networkingOpportunities: [],
    socialProfiles: [],
    newsMentions: [],
    jobHistory: [],
    education: []
  };
  const model = 'apollo-only';
  const usage = { prompt: 0, completion: 0, total: 0 };

  // Prepare Apollo data for storage - clean undefined values before saving to Firestore
  const apolloEnrichment = apolloData ? {
    person: removeUndefinedValues(apolloData),
    company: apolloCompanyData ? removeUndefinedValues(apolloCompanyData) : null,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp()
  } : null;

  // Map Apollo data to contact fields - Focus on the most important data
  const apolloUpdates: any = {};
  
  if (apolloData) {
    console.log('🔍 Mapping Apollo data to contact fields...');
    // Map core personal information (always update if Apollo has better data)
    if (apolloData.first_name) {
      apolloUpdates.firstName = apolloData.first_name;
    }
    if (apolloData.last_name) {
      apolloUpdates.lastName = apolloData.last_name;
    }
    if (apolloData.name) {
      apolloUpdates.fullName = apolloData.name;
    }
    if (apolloData.email) {
      apolloUpdates.email = apolloData.email;
    }
    if (apolloData.linkedin_url) {
      apolloUpdates.linkedInUrl = apolloData.linkedin_url;
    }
    if (apolloData.twitter_url) {
      apolloUpdates.twitterUrl = apolloData.twitter_url;
    }
    if (apolloData.facebook_url) {
      apolloUpdates.facebookUrl = apolloData.facebook_url;
    }
    if (apolloData.github_url) {
      apolloUpdates.githubUrl = apolloData.github_url;
    }
    // Avatar logic: exactly like companies - save LinkedIn URL to avatar field
    if (apolloData.photo_url) {
      apolloUpdates.avatar = apolloData.photo_url;
      console.log('✅ Using Apollo photo_url as avatar:', apolloData.photo_url);
    } else if (apolloData.linkedin_url) {
      apolloUpdates.avatar = apolloData.linkedin_url;
      console.log('✅ Using Apollo linkedin_url as avatar:', apolloData.linkedin_url);
    }
    // Map professional headline to dedicated field
    if (apolloData.headline) {
      apolloUpdates.headline = apolloData.headline;
    }
    
    // Map title to both jobTitle and headline if headline is not available
    if (apolloData.title) {
      apolloUpdates.jobTitle = apolloData.title;
      // If no headline is available, use the title as a headline
      if (!apolloData.headline) {
        apolloUpdates.headline = apolloData.title;
      }
    }
    
    // Map location data
    if (apolloData.city) {
      apolloUpdates.city = apolloData.city;
    }
    if (apolloData.state) {
      apolloUpdates.state = apolloData.state;
    }
    if (apolloData.country) {
      apolloUpdates.country = apolloData.country;
    }
    if (apolloData.street_address) {
      apolloUpdates.address = apolloData.street_address;
    }
    if (apolloData.postal_code) {
      apolloUpdates.zipcode = apolloData.postal_code;
    }
    if (apolloData.formatted_address) {
      apolloUpdates.formattedAddress = apolloData.formatted_address;
    }
    if (apolloData.time_zone) {
      apolloUpdates.timeZone = apolloData.time_zone;
    }
    
    // Map employment history
    if (apolloData.employment_history && apolloData.employment_history.length > 0) {
      apolloUpdates.jobHistory = apolloData.employment_history.map((job: any) => ({
        title: job.title || '',
        company: job.organization_name || '',
        duration: `${job.start_date || ''} - ${job.current ? 'Present' : job.end_date || ''}`,
        description: ''
      }));
    }
    
    // Map social profiles
    const socialProfiles = [];
    if (apolloData.linkedin_url) {
      socialProfiles.push({
        platform: 'LinkedIn',
        url: apolloData.linkedin_url,
        title: 'LinkedIn Profile'
      });
    }
    if (apolloData.twitter_url) {
      socialProfiles.push({
        platform: 'Twitter',
        url: apolloData.twitter_url,
        title: 'Twitter Profile'
      });
    }
    if (apolloData.github_url) {
      socialProfiles.push({
        platform: 'GitHub',
        url: apolloData.github_url,
        title: 'GitHub Profile'
      });
    }
    if (apolloData.facebook_url) {
      socialProfiles.push({
        platform: 'Facebook',
        url: apolloData.facebook_url,
        title: 'Facebook Profile'
      });
    }
    
    if (socialProfiles.length > 0) {
      apolloUpdates.socialProfiles = socialProfiles;
    }
    
    // Map professional insights
    if (apolloData.seniority) {
      // Normalize seniority values to match UI expectations
      const normalizedSeniority = (() => {
        const seniority = apolloData.seniority.toLowerCase();
        if (seniority.includes('c-level') || seniority.includes('ceo') || seniority.includes('cto') || seniority.includes('cfo') || seniority.includes('executive')) {
          return 'C-Level';
        } else if (seniority.includes('senior') || seniority.includes('lead') || seniority.includes('principal')) {
          return 'Senior';
        } else if (seniority.includes('manager') || seniority.includes('director') || seniority.includes('head')) {
          return 'Mid-Level';
        } else if (seniority.includes('junior') || seniority.includes('associate') || seniority.includes('entry')) {
          return 'Junior';
        } else {
          // Return the original value if no match found
          return apolloData.seniority;
        }
      })();
      apolloUpdates.inferredSeniority = normalizedSeniority;
    }
    if (apolloData.departments && apolloData.departments.length > 0) {
      apolloUpdates.inferredIndustry = apolloData.departments[0];
    }
    
    // Map company information if available
    if (apolloData.organization) {
      if (apolloData.organization.name && !contact.companyName) {
        apolloUpdates.companyName = apolloData.organization.name;
      }
      if (apolloData.organization.website_url && !contact.website) {
        apolloUpdates.website = apolloData.organization.website_url;
      }
    }
    
    console.log('🔍 Apollo updates to be applied:', apolloUpdates);
  }

  // Versioned write
  const versionDoc = contactRef.collection('ai_enrichments').doc();
  await versionDoc.set({
    ...parsed,
    model,
    tokenUsage: usage,
    apolloEnrichment,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Upsert latest snapshot and bookkeeping - clean undefined values before saving
  await contactRef.set(
    {
      aiEnrichment: parsed,
      apolloEnrichment,
      enrichmentVersion: admin.firestore.FieldValue.increment(1),
      lastEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
      enriched: true,
      enrichedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...removeUndefinedValues(apolloUpdates)
    },
    { merge: true }
  );

  await createContactAILog(
    'contactEnrichment.success',
    contactId,
    'Contact enrichment completed',
    tenantId,
    'system',
    { apolloData: !!apolloData, mode },
    undefined
  );
  
  console.log(`Contact enrichment completed for ${contactName}`);
}



export const enrichContactOnDemand = onCall({ 
  secrets: [APOLLO_API_KEY],
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB'
}, async (request) => {
  const { tenantId, contactId, mode, force } = (request.data || {}) as { tenantId: string; contactId: string; mode?: Mode; force?: boolean };
  if (!request.auth?.uid) throw new Error('Auth required');
  if (!tenantId || !contactId) throw new Error('tenantId and contactId required');
  const desiredMode: Mode = (mode as Mode) || 'apollo-only';
  
  try {
    console.log('enrichContactOnDemand:start', { tenantId, contactId, mode: desiredMode, force: !!force });
    
    // Resolve key from env or Firestore
    // Apollo-only mode - no OpenAI key needed
    console.log('enrichContactOnDemand:apollo_only_mode');
    
    await runContactEnrichment(tenantId, contactId, { mode: desiredMode, force: !!force });
    console.log('enrichContactOnDemand:success', { tenantId, contactId });
    
    return { 
      status: 'ok',
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
  } catch (e: any) {
    console.error('enrichContactOnDemand failed', { tenantId, contactId, error: e?.message });
    return { status: 'error', message: e?.message || 'Internal error' };
  }
});
