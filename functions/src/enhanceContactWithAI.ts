import { onCall } from 'firebase-functions/v2/https';
import { OpenAI } from 'openai';
import * as admin from 'firebase-admin';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const enhanceContactWithAI = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    const { contactId, tenantId, contactData } = request.data;

    if (!contactId || !tenantId) {
      throw new Error('Missing required parameters: contactId, tenantId');
    }

    console.log(`Enhancing contact: ${contactId} for tenant: ${tenantId}`);

    const db = admin.firestore();
    const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
    
    // Get current contact data if not provided
    let currentContact = contactData;
    if (!currentContact) {
      const contactDoc = await contactRef.get();
      if (!contactDoc.exists) {
        throw new Error('Contact not found');
      }
      currentContact = contactDoc.data();
    }

    const enhancedData: any = {
      enriched: true,
      enrichedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // 1. Extract searchable information
    const searchTerms = [];
    if (currentContact.fullName) searchTerms.push(currentContact.fullName);
    if (currentContact.firstName && currentContact.lastName) {
      searchTerms.push(`${currentContact.firstName} ${currentContact.lastName}`);
    }
    if (currentContact.email) searchTerms.push(currentContact.email);
    if (currentContact.jobTitle) searchTerms.push(currentContact.jobTitle);
    if (currentContact.companyName) searchTerms.push(currentContact.companyName);

    const searchQuery = searchTerms.join(' ');

    // 2. Use SERP API to find social profiles and company information
    const serpResults = await searchContactWithSerp(searchQuery, currentContact);
    Object.assign(enhancedData, serpResults);

    // 3. Use OpenAI to analyze and enhance the data
    if (process.env.OPENAI_API_KEY) {
      const aiEnhancedData = await enhanceWithOpenAI(currentContact, serpResults);
      Object.assign(enhancedData, aiEnhancedData);
    }

    // 4. Find LinkedIn profile if not already present
    if (!currentContact.linkedInUrl && !enhancedData.linkedInUrl) {
      const linkedInUrl = await findLinkedInProfile(currentContact);
      if (linkedInUrl) {
        enhancedData.linkedInUrl = linkedInUrl;
      }
    }

    // 5. Generate professional avatar if LinkedIn URL is found and no avatar exists
    if ((enhancedData.linkedInUrl || currentContact.linkedInUrl) && !currentContact.avatar) {
      try {
        const linkedInUrl = enhancedData.linkedInUrl || currentContact.linkedInUrl;
        // Use DiceBear API to generate a professional-looking avatar
        const contactName = currentContact.fullName || `${currentContact.firstName || ''} ${currentContact.lastName || ''}`.trim();
        if (contactName) {
          const encodedName = encodeURIComponent(contactName);
          const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodedName}&backgroundColor=1976d2&textColor=ffffff&fontSize=40&fontWeight=600&size=200`;
          enhancedData.avatar = avatarUrl;
        }
      } catch (avatarError) {
        console.log('Avatar generation failed, continuing without avatar:', avatarError);
      }
    }

    // 5. Find company information
    if (currentContact.companyName && !currentContact.companyId) {
      const companyInfo = await findCompanyInformation(currentContact.companyName, tenantId);
      if (companyInfo) {
        enhancedData.companyId = companyInfo.companyId;
        enhancedData.companyName = companyInfo.companyName;
      }
    }

    // 6. Generate professional summary
    if (!currentContact.notes && enhancedData.jobHistory) {
      const summary = await generateProfessionalSummary(currentContact, enhancedData);
      if (summary) {
        enhancedData.notes = summary;
      }
    }

    // 7. Update the contact in Firestore
    await contactRef.update(enhancedData);

    console.log(`Contact enhancement completed for ${currentContact.fullName}:`, enhancedData);

    return {
      success: true,
      data: enhancedData,
      message: 'Contact enhanced successfully with AI'
    };

  } catch (error) {
    console.error('Error in enhanceContactWithAI:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to enhance contact: ${errorMessage}`);
  }
});

async function searchContactWithSerp(searchQuery: string, contact: any) {
  const serpApiKey = process.env.SERP_API_KEY;
  if (!serpApiKey) {
    console.log('SERP API key not configured, skipping SERP search');
    return {};
  }

  try {
    const results: any = {
      socialProfiles: [],
      jobHistory: [],
      education: [],
      newsMentions: [],
      publicQuotes: []
    };

    // Search for LinkedIn profile
    const linkedInSearch = await fetch(`https://serpapi.com/search.json?engine=google&q="${searchQuery}" linkedin profile&api_key=${serpApiKey}`);
    const linkedInData = await linkedInSearch.json();
    
    if (linkedInData.organic_results) {
      const linkedInResult = linkedInData.organic_results.find((result: any) => 
        result.link && result.link.includes('linkedin.com/in/')
      );
      if (linkedInResult) {
        results.linkedInUrl = linkedInResult.link;
        results.socialProfiles.push({
          platform: 'LinkedIn',
          url: linkedInResult.link,
          title: linkedInResult.title
        });
      }
    }

    // Search for Twitter/X profile
    const twitterSearch = await fetch(`https://serpapi.com/search.json?engine=google&q="${searchQuery}" twitter&api_key=${serpApiKey}`);
    const twitterData = await twitterSearch.json();
    
    if (twitterData.organic_results) {
      const twitterResult = twitterData.organic_results.find((result: any) => 
        result.link && (result.link.includes('twitter.com/') || result.link.includes('x.com/'))
      );
      if (twitterResult) {
        results.twitterUrl = twitterResult.link;
        results.socialProfiles.push({
          platform: 'Twitter',
          url: twitterResult.link,
          title: twitterResult.title
        });
      }
    }

    // Search for recent news mentions
    const newsSearch = await fetch(`https://serpapi.com/search.json?engine=google&q="${searchQuery}" news&tbm=nws&api_key=${serpApiKey}`);
    const newsData = await newsSearch.json();
    
    if (newsData.news_results) {
      results.newsMentions = newsData.news_results.slice(0, 5).map((news: any) => ({
        title: news.title,
        snippet: news.snippet,
        link: news.link,
        date: news.date
      }));
    }

    // Search for company information
    if (contact.companyName) {
      const companySearch = await fetch(`https://serpapi.com/search.json?engine=google&q="${contact.companyName}" company information&api_key=${serpApiKey}`);
      const companyData = await companySearch.json();
      
      if (companyData.organic_results) {
        const companyResult = companyData.organic_results[0];
        if (companyResult) {
          results.companyInfo = {
            name: contact.companyName,
            description: companyResult.snippet,
            website: companyResult.link
          };
        }
      }
    }

    return results;

  } catch (error) {
    console.error('Error in SERP search:', error);
    return {};
  }
}

async function enhanceWithOpenAI(contact: any, serpResults: any) {
  if (!process.env.OPENAI_API_KEY) {
    return {};
  }

  try {
    const prompt = `Analyze this contact information and provide enhanced insights:

Contact: ${contact.fullName || `${contact.firstName} ${contact.lastName}`}
Email: ${contact.email || 'Not provided'}
Job Title: ${contact.jobTitle || 'Not provided'}
Company: ${contact.companyName || 'Not provided'}

Social Profiles Found: ${JSON.stringify(serpResults.socialProfiles || [])}
News Mentions: ${JSON.stringify(serpResults.newsMentions || [])}

Please provide:
1. Professional summary (2-3 sentences)
2. Inferred seniority level (entry, mid-level, senior, executive, c-level)
3. Inferred industry based on job title and company
4. Key skills and expertise areas
5. Professional interests and focus areas
6. Communication style preferences
7. Decision-making influence level (low, medium, high)
8. Recommended contact approach
9. Potential pain points or challenges they might face
10. Networking opportunities or common interests

Format the response as JSON with these fields:
{
  "professionalSummary": "...",
  "inferredSeniority": "...",
  "inferredIndustry": "...",
  "keySkills": ["skill1", "skill2"],
  "professionalInterests": ["interest1", "interest2"],
  "communicationStyle": "...",
  "influenceLevel": "...",
  "recommendedApproach": "...",
  "potentialPainPoints": ["point1", "point2"],
  "networkingOpportunities": ["opportunity1", "opportunity2"]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }],
    });

    const response = completion.choices[0]?.message?.content;
    if (response) {
      try {
        return JSON.parse(response);
      } catch (parseError) {
        console.error('Error parsing OpenAI response:', parseError);
        return {};
      }
    }

    return {};

  } catch (error) {
    console.error('Error in OpenAI enhancement:', error);
    return {};
  }
}

async function findLinkedInProfile(contact: any) {
  const serpApiKey = process.env.SERP_API_KEY;
  if (!serpApiKey) return null;

  try {
    const searchQuery = `${contact.fullName || `${contact.firstName} ${contact.lastName}`} ${contact.companyName || ''} linkedin`;
    const response = await fetch(`https://serpapi.com/search.json?engine=google&q="${searchQuery}"&api_key=${serpApiKey}`);
    const data = await response.json();
    
    if (data.organic_results) {
      const linkedInResult = data.organic_results.find((result: any) => 
        result.link && result.link.includes('linkedin.com/in/')
      );
      return linkedInResult ? linkedInResult.link : null;
    }
    
    return null;
  } catch (error) {
    console.error('Error finding LinkedIn profile:', error);
    return null;
  }
}

async function findCompanyInformation(companyName: string, tenantId: string) {
  const db = admin.firestore();
  
  try {
    // Search for existing company in the tenant's CRM
    const companiesSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_companies')
      .where('companyName', '==', companyName)
      .limit(1)
      .get();
    
    if (!companiesSnapshot.empty) {
      const companyDoc = companiesSnapshot.docs[0];
      return {
        companyId: companyDoc.id,
        companyName: companyDoc.data().companyName
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error finding company information:', error);
    return null;
  }
}

async function generateProfessionalSummary(contact: any, enhancedData: any) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const prompt = `Create a professional summary for this contact:

Name: ${contact.fullName || `${contact.firstName} ${contact.lastName}`}
Job Title: ${contact.jobTitle || 'Not provided'}
Company: ${contact.companyName || 'Not provided'}
Email: ${contact.email || 'Not provided'}

Additional Information:
${JSON.stringify(enhancedData, null, 2)}

Create a concise, professional summary (2-3 sentences) that captures their role, expertise, and professional background.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }],
    });

    return completion.choices[0]?.message?.content || null;

  } catch (error) {
    console.error('Error generating professional summary:', error);
    return null;
  }
} 