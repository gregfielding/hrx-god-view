import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { OpenAI } from 'openai';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');
const openaiApiKey = defineString('OPENAI_API_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey.value() || '',
});

export const enhanceCompanyWithSerp = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    const { companyName, companyId, tenantId } = request.data;

    if (!companyName || !companyId || !tenantId) {
      throw new Error('Missing required parameters: companyName, companyId, tenantId');
    }

    console.log(`Enhancing company with SERP: ${companyName}`);

    const enhancedData: any = {};

    // Strategy 1: SERP API for company information
    const serpData = await getCompanyInfoFromSerp(companyName);
    Object.assign(enhancedData, serpData);

    // Strategy 2: AI processing of SERP results
    if (openaiApiKey.value()) {
      const aiEnhancedData = await processWithAI(companyName, serpData);
      Object.assign(enhancedData, aiEnhancedData);
    }

    console.log(`Company enhancement completed for ${companyName}:`, enhancedData);

    return {
      success: true,
      data: enhancedData,
      message: 'Company enhanced successfully with SERP data'
    };

  } catch (error) {
    console.error('Error in enhanceCompanyWithSerp:', error);
    throw new Error('Failed to enhance company with SERP');
  }
});

// Get company information using SERP API
const getCompanyInfoFromSerp = async (companyName: string) => {
  try {
    const apiKey = serpApiKey.value();
    if (!apiKey) {
      console.log('SERP API key not configured for company enhancement');
      return {};
    }

    const results: any = {};

    // Search for company headquarters/address
    try {
      const addressQuery = `"${companyName}" headquarters address location`;
      const addressUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(addressQuery)}&api_key=${apiKey}&num=5`;
      
      const addressResponse = await fetch(addressUrl);
      if (addressResponse.ok) {
        const addressData = await addressResponse.json();
        if (addressData.organic_results && addressData.organic_results.length > 0) {
          const addressSnippets = addressData.organic_results.map((result: any) => result.snippet).join(' ');
          results.addressSnippets = addressSnippets;
        }
      }
    } catch (error) {
      console.error('Error searching for address:', error);
    }

    // Search for company industry and business information
    try {
      const industryQuery = `"${companyName}" industry business type company profile`;
      const industryUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(industryQuery)}&api_key=${apiKey}&num=5`;
      
      const industryResponse = await fetch(industryUrl);
      if (industryResponse.ok) {
        const industryData = await industryResponse.json();
        if (industryData.organic_results && industryData.organic_results.length > 0) {
          const industrySnippets = industryData.organic_results.map((result: any) => result.snippet).join(' ');
          results.industrySnippets = industrySnippets;
        }
      }
    } catch (error) {
      console.error('Error searching for industry:', error);
    }

    // Search for company size and employee count
    try {
      const sizeQuery = `"${companyName}" employee count company size revenue`;
      const sizeUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(sizeQuery)}&api_key=${apiKey}&num=5`;
      
      const sizeResponse = await fetch(sizeUrl);
      if (sizeResponse.ok) {
        const sizeData = await sizeResponse.json();
        if (sizeData.organic_results && sizeData.organic_results.length > 0) {
          const sizeSnippets = sizeData.organic_results.map((result: any) => result.snippet).join(' ');
          results.sizeSnippets = sizeSnippets;
        }
      }
    } catch (error) {
      console.error('Error searching for company size:', error);
    }

    // Search for company description/about
    try {
      const aboutQuery = `"${companyName}" about us company description`;
      const aboutUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(aboutQuery)}&api_key=${apiKey}&num=3`;
      
      const aboutResponse = await fetch(aboutUrl);
      if (aboutResponse.ok) {
        const aboutData = await aboutResponse.json();
        if (aboutData.organic_results && aboutData.organic_results.length > 0) {
          const aboutSnippets = aboutData.organic_results.map((result: any) => result.snippet).join(' ');
          results.aboutSnippets = aboutSnippets;
        }
      }
    } catch (error) {
      console.error('Error searching for company about:', error);
    }

    return results;

  } catch (error) {
    console.error('Error in SERP company info search:', error);
    return {};
  }
};

// Process SERP results with AI
const processWithAI = async (companyName: string, serpData: any) => {
  try {
    const prompt = `
    Analyze the following search results about "${companyName}" and extract structured information:

    ADDRESS INFORMATION:
    ${serpData.addressSnippets || 'No address information found'}

    INDUSTRY INFORMATION:
    ${serpData.industrySnippets || 'No industry information found'}

    COMPANY SIZE INFORMATION:
    ${serpData.sizeSnippets || 'No size information found'}

    COMPANY DESCRIPTION:
    ${serpData.aboutSnippets || 'No description found'}

    Please extract and return a JSON object with this exact structure:
    {
      "headquartersAddress": "Full address if found, or null",
      "headquartersCity": "City name if found, or null", 
      "headquartersState": "State name if found, or null",
      "headquartersZip": "ZIP code if found, or null",
      "industry": "Primary industry if found, or null",
      "companySize": "Employee count or size category if found, or null",
      "revenue": "Revenue information if found, or null",
      "description": "Brief company description (2-3 sentences), or null",
      "tags": ["tag1", "tag2", "tag3"],
      "confidence": {
        "address": 0.8,
        "industry": 0.7,
        "size": 0.6,
        "description": 0.8
      }
    }

    Rules:
    - Only include information that is clearly about this specific company
    - For address, prefer headquarters/office addresses over generic mentions
    - For industry, choose the most specific industry mentioned
    - For size, look for employee counts, revenue ranges, or size categories
    - For tags, include relevant business keywords
    - Set confidence scores based on how clear and specific the information is
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 800,
      temperature: 0.3,
    });

    const aiResponse = response.choices[0]?.message?.content?.trim();
    
    try {
      const parsedData = JSON.parse(aiResponse || '{}');
      return parsedData;
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return {};
    }

  } catch (error) {
    console.error('Error in AI processing:', error);
    return {};
  }
}; 