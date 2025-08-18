import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { OpenAI } from 'openai';
import * as admin from 'firebase-admin';

// Define config parameters
const openaiApiKey = defineString('OPENAI_API_KEY');
const serpApiKey = defineString('SERP_API_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey.value() || '',
});

interface CompanyExtractionResult {
  companyId: string;
  companyUrl: string;
  extractedData: {
    companyName: string | null;
    industry: string | null;
    description: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
    employeeCount: string | null;
    revenue: string | null;
    founded: string | null;
    tags: string[];
    confidence: number;
  };
  success: boolean;
  error?: string;
}

export const extractCompanyInfoFromUrls = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    const { tenantId, dryRun = false, limit = 50 } = request.data;

    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`Starting company info extraction for tenant: ${tenantId}, dryRun: ${dryRun}, limit: ${limit}`);

    const db = admin.firestore();
    const results: CompanyExtractionResult[] = [];
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    // Get all companies for the tenant that have companyUrl but no companyName
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef
      .where('companyUrl', '!=', null)
      .where('companyUrl', '!=', '')
      .limit(limit)
      .get();

    if (companiesSnapshot.empty) {
      return {
        success: true,
        message: 'No companies found with URLs but missing company names',
        summary: {
          totalProcessed: 0,
          successCount: 0,
          errorCount: 0,
          results: []
        }
      };
    }

    console.log(`Found ${companiesSnapshot.size} companies with URLs but missing company names`);

    // Process each company
    for (const companyDoc of companiesSnapshot.docs) {
      const companyData = companyDoc.data();
      const companyId = companyDoc.id;
      const companyUrl = companyData.companyUrl;

      // Skip if company already has a name
      if (companyData.companyName && companyData.companyName.trim()) {
        console.log(`Skipping ${companyId} - already has company name: ${companyData.companyName}`);
        continue;
      }

      console.log(`Processing company ${companyId} with URL: ${companyUrl}`);
      processedCount++;

      try {
        // Extract company information from URL
        const extractedData = await extractCompanyInfoFromUrl(companyUrl);
        
        const result: CompanyExtractionResult = {
          companyId,
          companyUrl,
          extractedData,
          success: true
        };

        results.push(result);

        // Update the company in Firestore if not dry run
        if (!dryRun && extractedData.companyName) {
          const updateData: any = {
            companyName: extractedData.companyName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };

          // Add other extracted fields if they exist
          if (extractedData.industry) updateData.industry = extractedData.industry;
          if (extractedData.description) updateData.description = extractedData.description;
          if (extractedData.address) updateData.address = extractedData.address;
          if (extractedData.city) updateData.city = extractedData.city;
          if (extractedData.state) updateData.state = extractedData.state;
          if (extractedData.zip) updateData.zip = extractedData.zip;
          if (extractedData.country) updateData.country = extractedData.country;
          if (extractedData.phone) updateData.phone = extractedData.phone;
          if (extractedData.employeeCount) updateData.employeeCount = extractedData.employeeCount;
          if (extractedData.revenue) updateData.revenue = extractedData.revenue;
          if (extractedData.founded) updateData.founded = extractedData.founded;
          if (extractedData.tags && extractedData.tags.length > 0) updateData.tags = extractedData.tags;

          await companyDoc.ref.update(updateData);
          console.log(`✅ Updated company ${companyId} with extracted data`);
        }

        successCount++;
        console.log(`✅ Successfully extracted data for ${companyId}: ${extractedData.companyName}`);

      } catch (error) {
        console.error(`❌ Error processing company ${companyId}:`, error);
        errorCount++;
        
        results.push({
          companyId,
          companyUrl,
          extractedData: {
            companyName: null,
            industry: null,
            description: null,
            address: null,
            city: null,
            state: null,
            zip: null,
            country: null,
            phone: null,
            employeeCount: null,
            revenue: null,
            founded: null,
            tags: [],
            confidence: 0
          },
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const summary = {
      totalProcessed: processedCount,
      successCount,
      errorCount,
      results
    };

    console.log(`Company info extraction completed:`, summary);

    return {
      success: true,
      message: `Processed ${processedCount} companies. ${successCount} successful, ${errorCount} errors.`,
      summary
    };

  } catch (error) {
    console.error('Error in extractCompanyInfoFromUrls:', error);
    throw new Error(`Failed to extract company info: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Extract company information from a URL using multiple strategies
async function extractCompanyInfoFromUrl(url: string) {
  const results = {
    companyName: null as string | null,
    industry: null as string | null,
    description: null as string | null,
    address: null as string | null,
    city: null as string | null,
    state: null as string | null,
    zip: null as string | null,
    country: null as string | null,
    phone: null as string | null,
    employeeCount: null as string | null,
    revenue: null as string | null,
    founded: null as string | null,
    tags: [] as string[],
    confidence: 0
  };

  try {
    // Strategy 1: Extract basic info from URL itself
    const urlInfo = extractInfoFromUrl(url);
    Object.assign(results, urlInfo);

    // Strategy 2: Use SERP API to get company information
    if (serpApiKey.value()) {
      const serpInfo = await getCompanyInfoFromSerp(url);
      Object.assign(results, serpInfo);
    }

    // Strategy 3: Use AI to analyze and enhance the data
    if (openaiApiKey.value()) {
      const aiInfo = await enhanceWithAI(url, results);
      Object.assign(results, aiInfo);
    }

    return results;

  } catch (error) {
    console.error('Error extracting company info from URL:', error);
    return results;
  }
}

// Extract basic information from the URL itself
function extractInfoFromUrl(url: string) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Extract company name from domain
    let companyName = hostname.replace(/^www\./, '').split('.')[0];
    
    // Clean up the company name
    companyName = companyName
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();

    // Generate some basic tags based on domain
    const tags = [];
    if (hostname.includes('logistics')) tags.push('logistics', 'transportation');
    if (hostname.includes('tech')) tags.push('technology');
    if (hostname.includes('health')) tags.push('healthcare');
    if (hostname.includes('finance')) tags.push('financial services');
    if (hostname.includes('consult')) tags.push('consulting');

    return {
      companyName,
      tags,
      confidence: 0.6
    };

  } catch (error) {
    console.error('Error extracting info from URL:', error);
    return {};
  }
}

// Get company information using SERP API
async function getCompanyInfoFromSerp(url: string) {
  try {
    const apiKey = serpApiKey.value();
    if (!apiKey) {
      return {};
    }

    const results: any = {};

    // Extract domain from URL for search
    const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    
    // Search for company information
    const searchQuery = `"${domain}" company information about`;
    const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}&num=5`;
    
    const response = await fetch(searchUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.organic_results && data.organic_results.length > 0) {
        const snippets = data.organic_results.map((result: any) => result.snippet).join(' ');
        results.rawSnippets = snippets;
      }
    }

    return results;

  } catch (error) {
    console.error('Error in SERP search:', error);
    return {};
  }
}

// Use AI to analyze and enhance company information
async function enhanceWithAI(url: string, existingData: any) {
  try {
    const prompt = `
    Analyze this website URL and extract comprehensive company information:

    URL: ${url}
    
    Existing extracted data: ${JSON.stringify(existingData, null, 2)}

    Please extract and return a JSON object with this exact structure:
    {
      "companyName": "Official company name",
      "industry": "Primary industry or business type",
      "description": "Brief company description (2-3 sentences)",
      "address": "Full address if found",
      "city": "City name",
      "state": "State/province name", 
      "zip": "ZIP/postal code",
      "country": "Country name",
      "phone": "Phone number",
      "employeeCount": "Number of employees or size category",
      "revenue": "Revenue information if available",
      "founded": "Year founded if available",
      "tags": ["tag1", "tag2", "tag3"],
      "confidence": 0.8
    }

    Rules:
    - Use the existing data as a starting point
    - Extract the most accurate and complete information possible
    - For company name, prefer official business names over domain names
    - For industry, be specific (e.g., "logistics and supply chain" not just "business")
    - For address, include full street address if available
    - For tags, include relevant business keywords and industry terms
    - Set confidence score based on how clear and specific the information is (0.1-0.9)
    - If information is not available, use null for that field
    - Ensure all text is properly formatted and clean
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 1000,
      temperature: 0.3,
    });

    const aiResponse = response.choices[0]?.message?.content?.trim();
    
    if (!aiResponse) {
      return {};
    }

    try {
      const parsedData = JSON.parse(aiResponse);
      return parsedData;
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return {};
    }

  } catch (error) {
    console.error('Error in AI enhancement:', error);
    return {};
  }
} 