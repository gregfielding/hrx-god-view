import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getApolloKey, getOpenAIKey } from './utils/secrets';
import { apolloCompanyByDomain, apolloPeopleSearch, apolloContactEnrichment } from './utils/apollo';
import { logAIAction } from './utils/aiLogging';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface ProspectingFilters {
  locations?: string[];
  industries?: string[];
  companySizes?: string[];
  exclusions?: string[];
  minStaffingFit?: number;
  minCallPriority?: number;
}

interface ParsedPrompt {
  roles: string[];
  locations: string[];
  industries: string[];
  listSize: number;
  exclusions?: { companies?: string[]; domains?: string[] };
  intent: 'find_contacts' | 'find_companies' | 'mixed';
}

interface ProspectingResult {
  id: string;
  contact: {
    firstName: string;
    lastName: string;
    title: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
  };
  company: {
    name: string;
    domain?: string;
    location?: string;
    industry?: string;
    size?: string;
  };
  scores: {
    staffingFit: number;
    callPriority: number;
    rationale: string;
  };
  opener: string;
  status: 'new' | 'added_to_crm' | 'in_sequence' | 'called' | 'emailed' | 'dismissed';
  signals?: {
    jobPostings?: number;
    funding?: string;
    growth?: string;
    news?: string[];
  };
}

interface ProspectingSummary {
  totalResults: number;
  hotProspects: number;
  goodProspects: number;
  unclearProspects: number;
  companiesFound: number;
}

// Deep sanitization to remove undefined values for Firestore
function deepSanitize(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize).filter(item => item !== null);
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = deepSanitize(value);
      }
    }
    return sanitized;
  }
  
  return obj;
}

function extractJsonObject(text: string): any | undefined {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = text.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  return undefined;
}

// Parse natural language prompt into structured filters
async function parsePrompt(prompt: string, tenantId: string): Promise<ParsedPrompt> {
  const openai = require('openai');
  const apiKey = await getOpenAIKey(tenantId);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  const client = new openai.OpenAI({ apiKey });

  const systemPrompt = `You are an AI assistant that parses natural language prospecting requests into structured data. Extract the following information:

- roles: Job titles or roles to search for
- locations: Geographic locations (cities, states, regions)
- industries: Industry sectors
- listSize: Number of results requested (default 50)
- exclusions: Companies or domains to exclude
- intent: Whether the user wants to find contacts, companies, or both

Return a JSON object with these fields.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 500
  });

  try {
    const raw = response.choices[0].message.content;
    const parsed = extractJsonObject(raw) || {};
    return {
      roles: parsed.roles || [],
      locations: parsed.locations || [],
      industries: parsed.industries || [],
      listSize: parsed.listSize || 50,
      exclusions: parsed.exclusions || {},
      intent: parsed.intent || 'find_contacts'
    };
  } catch (error) {
    console.error('Error parsing prompt:', error);
    // Fallback parsing
    return {
      roles: [],
      locations: [],
      industries: [],
      listSize: 50,
      exclusions: {},
      intent: 'find_contacts'
    };
  }
}

// Score prospects based on staffing fit and call priority
async function scoreProspects(contacts: any[], tenantId: string): Promise<ProspectingResult[]> {
  const openai = require('openai');
  const apiKey = await getOpenAIKey(tenantId);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  const client = new openai.OpenAI({ apiKey });

  const results: ProspectingResult[] = [];
  const BATCH_SIZE = 5; // Process 5 contacts at a time
  const MAX_CONTACTS = 25; // Limit total contacts to prevent timeout

  // Limit contacts to prevent timeout
  const limitedContacts = contacts.slice(0, MAX_CONTACTS);
  console.log(`Processing ${limitedContacts.length} contacts in batches of ${BATCH_SIZE}`);

  // Process in batches
  for (let i = 0; i < limitedContacts.length; i += BATCH_SIZE) {
    const batch = limitedContacts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(limitedContacts.length/BATCH_SIZE)}`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (contact) => {
      const scoringPrompt = `Score this prospect for a staffing agency:

Contact: ${contact.name}
Title: ${contact.title}
Department: ${contact.department || 'Unknown'}
Seniority: ${contact.seniority || 'Unknown'}

Rate from 0-100:
1. Staffing Fit: How likely is this company to need temporary staffing services?
2. Call Priority: How urgent/high-priority should this contact be for outreach?

Provide rationale and a personalized opening line for outreach.

Return JSON: {
  "staffingFit": number,
  "callPriority": number,
  "rationale": "string",
  "opener": "string"
}`;

      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: scoringPrompt }
          ],
          temperature: 0.3,
          max_tokens: 300
        });

        const raw = response.choices[0].message.content;
        const scoring = extractJsonObject(raw) || {};

        // Extract name parts
        const nameParts = contact.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        return {
          id: contact.id || `prospect_${Date.now()}_${Math.random()}`,
          contact: {
            firstName,
            lastName,
            title: contact.title || '',
            ...(contact.email && { email: contact.email }),
            ...(contact.phone && { phone: contact.phone }),
            ...(contact.linkedinUrl && { linkedinUrl: contact.linkedinUrl })
          },
          company: {
            name: contact.organization?.name || 'Unknown Company',
            ...(contact.organization?.domain && { domain: contact.organization.domain }),
            ...(contact.organization?.location && { location: contact.organization.location }),
            ...(contact.organization?.industry && { industry: contact.organization.industry }),
            ...(contact.organization?.employeeCount && { size: `${contact.organization.employeeCount} employees` })
          },
          scores: {
            staffingFit: scoring.staffingFit || 50,
            callPriority: scoring.callPriority || 50,
            rationale: scoring.rationale || 'No rationale provided'
          },
          opener: scoring.opener || 'Hi, I hope this message finds you well.',
          status: 'new' as const
        };
      } catch (error) {
        console.error('Error scoring prospect:', error);
        // Fallback scoring
        const nameParts = contact.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        return {
          id: contact.id || `prospect_${Date.now()}_${Math.random()}`,
          contact: {
            firstName,
            lastName,
            title: contact.title || '',
            ...(contact.email && { email: contact.email }),
            ...(contact.phone && { phone: contact.phone }),
            ...(contact.linkedinUrl && { linkedinUrl: contact.linkedinUrl })
          },
          company: {
            name: contact.organization?.name || 'Unknown Company',
            ...(contact.organization?.domain && { domain: contact.organization.domain }),
            ...(contact.organization?.location && { location: contact.organization.location }),
            ...(contact.organization?.industry && { industry: contact.organization.industry }),
            ...(contact.organization?.employeeCount && { size: `${contact.organization.employeeCount} employees` })
          },
          scores: {
            staffingFit: 50,
            callPriority: 50,
            rationale: 'Default scoring applied'
          },
          opener: 'Hi, I hope this message finds you well.',
          status: 'new' as const
        };
      }
    });

    // Wait for batch to complete
    try {
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      console.log(`Completed batch ${Math.floor(i/BATCH_SIZE) + 1}, total results: ${results.length}`);
    } catch (error) {
      console.error('Error processing batch:', error);
      // Continue with next batch even if this one fails
    }

    // Add small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < limitedContacts.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

// Deduplicate against existing CRM contacts
async function deduplicateResults(results: ProspectingResult[], tenantId: string): Promise<ProspectingResult[]> {
  const existingContacts = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('contacts')
    .get();

  const existingEmails = new Set();
  const existingPhones = new Set();

  existingContacts.docs.forEach(doc => {
    const data = doc.data();
    if (data.email) existingEmails.add(data.email.toLowerCase());
    if (data.phone) existingPhones.add(data.phone.replace(/\D/g, ''));
  });

  return results.filter(result => {
    if (result.contact.email && existingEmails.has(result.contact.email.toLowerCase())) {
      return false;
    }
    if (result.contact.phone && existingPhones.has(result.contact.phone.replace(/\D/g, ''))) {
      return false;
    }
    return true;
  });
}

// Main prospecting function
export const runProspecting = onCall(
  {
    maxInstances: 5, // Reduce concurrent instances
    cors: true,
    timeoutSeconds: 300, // Increase to 5 minutes
    memory: '2GiB', // Increase memory
  },
  async (request) => {
    const { prompt, filters, tenantId } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId) {
      throw new Error('Unauthorized');
    }

    try {
      // Log the prospecting request
      await logAIAction({
        eventType: 'prospecting.search_started',
        targetType: 'prospecting',
        targetId: `search_${Date.now()}`,
        reason: 'Prospecting search initiated',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'search'],
        urgencyScore: 3,
        tenantId,
        userId: uid,
        metadata: { prompt, filters }
      });

      // Parse the prompt
      const parsed = await parsePrompt(prompt, tenantId);

      // Build Apollo search parameters
      const searchParams: any = {
        titles: parsed.roles,
        limit: Math.min(parsed.listSize * 4, 200), // Request even more contacts to filter from
        locations: parsed.locations // Add location filtering
      };

      // Add location filter if available
      if (parsed.locations.length > 0) {
        // For now, we'll use the first location as a general filter
        // Apollo API doesn't have direct location filtering in the people search
        console.log('Location filter applied:', parsed.locations[0]);
      }

      // Get Apollo API key
      const apolloApiKey = await getApolloKey(tenantId);
      if (!apolloApiKey) {
        throw new HttpsError('failed-precondition', 'Apollo API key not configured');
      }

      // Search Apollo for contacts
      console.log('🔍 Calling Apollo People Search with params:', searchParams);
      const apolloResults = await apolloPeopleSearch(searchParams, apolloApiKey);
      console.log('📊 Apollo API returned:', apolloResults.length, 'contacts');
      console.log('📋 Sample Apollo result:', JSON.stringify(apolloResults[0], null, 2));

      if (!apolloResults || apolloResults.length === 0) {
        throw new Error('No results from Apollo');
      }

      // Enrich contacts that don't have emails/phones
      console.log('🔍 Enriching contacts with missing contact info...');
      const enrichedResults = await Promise.all(
        apolloResults.map(async (contact) => {
          // If contact already has real email or phone, skip enrichment
          const hasRealEmail = contact.email && 
            contact.email !== 'email_not_unlocked@domain.com' && 
            contact.email !== 'email_not_unlocked@company.com';
          const hasPhone = contact.phone && contact.phone.trim() !== '';
          
          if (hasRealEmail && hasPhone) {
            return contact;
          }
          
          // Try to enrich the contact
          try {
            const enriched = await apolloContactEnrichment({
              first_name: contact.name.split(' ')[0],
              last_name: contact.name.split(' ').slice(1).join(' '),
              title: contact.title,
              domain: contact.organization?.domain,
              organization_name: contact.organization?.name,
              reveal_personal_emails: true,
              reveal_phone_number: true
            }, apolloApiKey);
            
            if (enriched) {
              console.log(`✅ Enriched contact ${contact.name}:`, {
                original_email: contact.email,
                enriched_email: enriched.email,
                original_phone: contact.phone,
                enriched_phone: enriched.phone
              });
              
              return {
                ...contact,
                email: enriched.email || contact.email,
                phone: enriched.phone || enriched.phone_number || contact.phone,
                linkedinUrl: enriched.linkedin_url || contact.linkedinUrl
              };
            }
          } catch (error) {
            console.log(`⚠️ Failed to enrich contact ${contact.name}:`, error.message);
          }
          
          return contact;
        })
      );
      
      console.log(`📊 Enrichment complete. Processing ${enrichedResults.length} contacts...`);

      // Score the prospects
      const scoredResults = await scoreProspects(enrichedResults, tenantId);

      // Apply filters
      let filteredResults = scoredResults;

      if (filters?.minStaffingFit) {
        filteredResults = filteredResults.filter(r => r.scores.staffingFit >= filters.minStaffingFit);
      }

      if (filters?.minCallPriority) {
        filteredResults = filteredResults.filter(r => r.scores.callPriority >= filters.minCallPriority);
      }

      if (filters?.locations?.length) {
        filteredResults = filteredResults.filter(r => 
          r.company.location && filters.locations!.some(loc => 
            r.company.location!.toLowerCase().includes(loc.toLowerCase())
          )
        );
      }

      if (filters?.industries?.length) {
        filteredResults = filteredResults.filter(r => 
          r.company.industry && filters.industries!.some(ind => 
            r.company.industry!.toLowerCase().includes(ind.toLowerCase())
          )
        );
      }

      // Deduplicate against CRM
      const deduplicatedResults = await deduplicateResults(filteredResults, tenantId);

      // Calculate summary
      const companiesFound = new Set(deduplicatedResults.map(r => r.company.name)).size;
      const hotProspects = deduplicatedResults.filter(r => r.scores.staffingFit >= 80).length;
      const goodProspects = deduplicatedResults.filter(r => r.scores.staffingFit >= 60 && r.scores.staffingFit < 80).length;
      const unclearProspects = deduplicatedResults.filter(r => r.scores.staffingFit < 60).length;

      const summary: ProspectingSummary = {
        totalResults: deduplicatedResults.length,
        hotProspects,
        goodProspects,
        unclearProspects,
        companiesFound
      };

      // Store the prospecting run
      const runRef = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('prospecting_runs')
        .add({
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: uid,
          originalPrompt: prompt,
          parsed,
          filters,
          results: deepSanitize(deduplicatedResults), // Sanitize to remove undefined values
          summary,
          counts: {
            results: deduplicatedResults.length,
            hot: hotProspects,
            good: goodProspects,
            unclear: unclearProspects
          }
        });

      // Log successful completion
      await logAIAction({
        eventType: 'prospecting.search_completed',
        targetType: 'prospecting',
        targetId: runRef.id,
        reason: 'Prospecting search completed successfully',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'search', 'completed'],
        urgencyScore: 3,
        tenantId,
        userId: uid,
        metadata: { 
          resultCount: deduplicatedResults.length,
          companiesFound,
          runId: runRef.id
        }
      });

      return {
        results: deduplicatedResults,
        summary,
        runId: runRef.id
      };

    } catch (error: any) {
      console.error('Error in prospecting search:', error);
      
      await logAIAction({
        eventType: 'prospecting.search_error',
        targetType: 'prospecting',
        targetId: `error_${Date.now()}`,
        reason: 'Prospecting search failed',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'search', 'error'],
        urgencyScore: 5,
        tenantId,
        userId: uid,
        errorMessage: error.message,
        metadata: { prompt },
        success: false
      });

      // Preserve explicit HttpsError codes (e.g., failed-precondition for missing Apollo key)
      if (error?.code && typeof error.code === 'string') {
        throw new HttpsError(error.code as any, error.message || 'Prospecting search failed');
      }
      throw new HttpsError('internal', `Prospecting search failed: ${error?.message || 'Unknown error'}`);
    }
  }
);

// Save a prospecting search
export const saveProspectingSearch = onCall(
  {
    maxInstances: 10,
    cors: true,
  },
  async (request) => {
    const { name, prompt, filters, visibility, tenantId } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId) {
      throw new Error('Unauthorized');
    }

    try {
      const parsed = await parsePrompt(prompt, tenantId);

      const searchRef = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('prospecting_saved_searches')
        .add({
          name,
          prompt,
          parsed,
          filters,
          createdByUid: uid,
          visibility: visibility || 'private',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

      await logAIAction({
        eventType: 'prospecting.search_saved',
        targetType: 'prospecting',
        targetId: searchRef.id,
        reason: 'Prospecting search saved',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'search', 'saved'],
        urgencyScore: 2,
        tenantId,
        userId: uid,
        metadata: { name, visibility }
      });

      return { searchId: searchRef.id };

    } catch (error) {
      console.error('Error saving prospecting search:', error);
      throw new Error(`Failed to save search: ${error.message}`);
    }
  }
);

// Add prospects to CRM
export const addProspectsToCRM = onCall(
  {
    maxInstances: 10,
    cors: true,
  },
  async (request) => {
    const { resultIds, tenantId } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId || !resultIds?.length) {
      throw new Error('Unauthorized or invalid data');
    }

    try {
      // Get the prospecting results
      const runsSnapshot = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('prospecting_runs')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      let allResults: ProspectingResult[] = [];
      runsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.results) {
          allResults = allResults.concat(data.results);
        }
      });

      const selectedResults = allResults.filter(r => resultIds.includes(r.id));

      if (selectedResults.length === 0) {
        throw new Error('No results found');
      }

      const batch = db.batch();
      const addedContacts: string[] = [];
      const addedCompanies: string[] = [];

      for (const result of selectedResults) {
        // Check if company exists
        let companyId: string;
        const companyQuery = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('companies')
          .where('name', '==', result.company.name)
          .limit(1)
          .get();

        if (companyQuery.empty) {
          // Create new company
          const companyRef = db
            .collection('tenants')
            .doc(tenantId)
            .collection('companies')
            .doc();

          batch.set(companyRef, deepSanitize({
            name: result.company.name,
            domain: result.company.domain,
            location: result.company.location,
            industry: result.company.industry,
            size: result.company.size,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdByUid: uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }));

          companyId = companyRef.id;
          addedCompanies.push(companyId);
        } else {
          companyId = companyQuery.docs[0].id;
        }

        // Create contact
        const contactRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('contacts')
          .doc();

        batch.set(contactRef, deepSanitize({
          firstName: result.contact.firstName,
          lastName: result.contact.lastName,
          email: result.contact.email,
          phone: result.contact.phone,
          jobTitle: result.contact.title,
          companyId,
          companyName: result.company.name,
          linkedinUrl: result.contact.linkedinUrl,
          leadSource: 'Prospecting Hub',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }));

        addedContacts.push(contactRef.id);
      }

      await batch.commit();

      await logAIAction({
        eventType: 'prospecting.prospects_added_to_crm',
        targetType: 'prospecting',
        targetId: `batch_${Date.now()}`,
        reason: 'Prospects added to CRM',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'crm', 'contacts'],
        urgencyScore: 4,
        tenantId,
        userId: uid,
        metadata: { 
          contactCount: addedContacts.length,
          companyCount: addedCompanies.length,
          resultIds
        }
      });

      return {
        addedContacts,
        addedCompanies,
        message: `Added ${addedContacts.length} contacts and ${addedCompanies.length} companies to CRM`
      };

    } catch (error) {
      console.error('Error adding prospects to CRM:', error);
      throw new Error(`Failed to add to CRM: ${error.message}`);
    }
  }
);

// Create call list from prospects
export const createCallList = onCall(
  {
    maxInstances: 10,
    cors: true,
  },
  async (request) => {
    const { resultIds, tenantId, assignTo } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId || !resultIds?.length) {
      throw new Error('Unauthorized or invalid data');
    }

    try {
      // Get the prospecting results
      const runsSnapshot = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('prospecting_runs')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      let allResults: ProspectingResult[] = [];
      runsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.results) {
          allResults = allResults.concat(data.results);
        }
      });

      const selectedResults = allResults.filter(r => resultIds.includes(r.id));

      if (selectedResults.length === 0) {
        throw new Error('No results found');
      }

      const batch = db.batch();
      const createdTasks: string[] = [];

      for (const result of selectedResults) {
        const taskRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('tasks')
          .doc();

        batch.set(taskRef, {
          title: `Call ${result.contact.firstName} ${result.contact.lastName} at ${result.company.name}`,
          description: `Prospect: ${result.contact.firstName} ${result.contact.lastName}\nTitle: ${result.contact.title}\nCompany: ${result.company.name}\n\nSuggested Opener: ${result.opener}\n\nStaffing Fit: ${result.scores.staffingFit}%\nCall Priority: ${result.scores.callPriority}%\n\nRationale: ${result.scores.rationale}`,
          type: 'call',
          priority: result.scores.callPriority >= 80 ? 'high' : result.scores.callPriority >= 60 ? 'medium' : 'low',
          status: 'pending',
          assignedTo: assignTo || uid,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'Prospecting Hub',
          prospectData: {
            contactName: `${result.contact.firstName} ${result.contact.lastName}`,
            title: result.contact.title,
            company: result.company.name,
            phone: result.contact.phone,
            email: result.contact.email,
            opener: result.opener,
            staffingFit: result.scores.staffingFit,
            callPriority: result.scores.callPriority
          }
        });

        createdTasks.push(taskRef.id);
      }

      await batch.commit();

      await logAIAction({
        eventType: 'prospecting.call_list_created',
        targetType: 'prospecting',
        targetId: `calllist_${Date.now()}`,
        reason: 'Call list created from prospects',
        contextType: 'prospecting',
        aiTags: ['prospecting', 'tasks', 'calls'],
        urgencyScore: 4,
        tenantId,
        userId: uid,
        metadata: { 
          taskCount: createdTasks.length,
          resultIds
        }
      });

      return {
        createdTasks,
        message: `Created ${createdTasks.length} call tasks`
      };

    } catch (error) {
      console.error('Error creating call list:', error);
      throw new Error(`Failed to create call list: ${error.message}`);
    }
  }
);
