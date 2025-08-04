import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { OpenAI } from 'openai';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');
const openaiApiKey = defineString('OPENAI_API_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey.value() || '',
});

export const discoverCompanyUrls = onCall(async (request) => {
  try {
    const { companyName, companyId, tenantId } = request.data;

    if (!companyName || !companyId || !tenantId) {
      throw new Error('Missing required parameters: companyName, companyId, tenantId');
    }

    console.log(`Discovering URLs for company: ${companyName}`);

    // Check if we have OpenAI API key for enhanced discovery
    const hasOpenAI = !!process.env.OPENAI_API_KEY;

    // Use multiple strategies to find URLs
    const results = {
      website: null as string | null,
      linkedin: null as string | null,
      indeed: null as string | null,
      facebook: null as string | null,
      confidence: {} as { [key: string]: number }
    };

    // Strategy 1: SERP API Search for Real URLs
    const serpResults = await discoverUrlsWithSerpAPI(companyName);
    if (serpResults && typeof serpResults === 'object' && (serpResults as any).website || (serpResults as any).linkedin || (serpResults as any).indeed || (serpResults as any).facebook) {
      Object.assign(results, serpResults);
    }

    // Strategy 2: AI-Powered URL Discovery (if OpenAI is available)
    if (hasOpenAI) {
      const aiResults = await discoverUrlsWithAI(companyName);
      // Merge AI results, but prefer SERP results
      if (!results.website && aiResults.website) {
        results.website = aiResults.website;
        results.confidence.website = aiResults.confidence?.website || 0.7;
      }
      if (!results.linkedin && aiResults.linkedin) {
        results.linkedin = aiResults.linkedin;
        results.confidence.linkedin = aiResults.confidence?.linkedin || 0.7;
      }
      if (!results.indeed && aiResults.indeed) {
        results.indeed = aiResults.indeed;
        results.confidence.indeed = aiResults.confidence?.indeed || 0.7;
      }
      if (!results.facebook && aiResults.facebook) {
        results.facebook = aiResults.facebook;
        results.confidence.facebook = aiResults.confidence?.facebook || 0.7;
      }
    }

    // Strategy 3: Pattern-based URL Generation (fallback)
    const patternResults = await generateUrlsByPattern(companyName);
    
    // Merge results, preferring AI results over pattern results
    if (!results.website && patternResults.website) {
      results.website = patternResults.website;
      results.confidence.website = 0.6;
    }
    if (!results.linkedin && patternResults.linkedin) {
      results.linkedin = patternResults.linkedin;
      results.confidence.linkedin = 0.6;
    }
    if (!results.indeed && patternResults.indeed) {
      results.indeed = patternResults.indeed;
      results.confidence.indeed = 0.6;
    }
    if (!results.facebook && patternResults.facebook) {
      results.facebook = patternResults.facebook;
      results.confidence.facebook = 0.6;
    }

    // Strategy 3: URL Validation (check if URLs actually exist)
    const validatedResults = await validateUrls(results);
    
    console.log(`URL discovery completed for ${companyName}:`, validatedResults);

    return validatedResults;

  } catch (error) {
    console.error('Error in discoverCompanyUrls:', error);
    throw new Error('Failed to discover company URLs');
  }
});

// SERP API-powered URL Discovery
const discoverUrlsWithSerpAPI = async (companyName: string) => {
  try {
    const apiKey = serpApiKey.value();
    if (!apiKey) {
      console.log('SERP API key not configured for URL discovery');
      return {};
    }

    const results = {
      website: null as string | null,
      linkedin: null as string | null,
      indeed: null as string | null,
      facebook: null as string | null,
      confidence: {} as { [key: string]: number }
    };

    // Search for company website
    try {
      const websiteQuery = `"${companyName}" official website`;
      const websiteUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(websiteQuery)}&api_key=${apiKey}&num=5`;
      
      const websiteResponse = await fetch(websiteUrl);
      if (websiteResponse.ok) {
        const websiteData = await websiteResponse.json();
        if (websiteData.organic_results && websiteData.organic_results.length > 0) {
          const topResult = websiteData.organic_results[0];
          if (topResult.link && !topResult.link.includes('linkedin.com') && !topResult.link.includes('facebook.com') && !topResult.link.includes('indeed.com')) {
            results.website = topResult.link;
            results.confidence.website = 0.9;
          }
        }
      }
    } catch (error) {
      console.error('Error searching for website:', error);
    }

    // Search for LinkedIn company page
    try {
      const linkedinQuery = `site:linkedin.com/company "${companyName}"`;
      const linkedinUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(linkedinQuery)}&api_key=${apiKey}&num=3`;
      
      const linkedinResponse = await fetch(linkedinUrl);
      if (linkedinResponse.ok) {
        const linkedinData = await linkedinResponse.json();
        if (linkedinData.organic_results && linkedinData.organic_results.length > 0) {
          const linkedinResult = linkedinData.organic_results.find((result: any) => 
            result.link && result.link.includes('linkedin.com/company/')
          );
          if (linkedinResult) {
            results.linkedin = linkedinResult.link;
            results.confidence.linkedin = 0.9;
          }
        }
      }
    } catch (error) {
      console.error('Error searching for LinkedIn:', error);
    }

    // Search for Indeed company page
    try {
      const indeedQuery = `site:indeed.com/cmp "${companyName}"`;
      const indeedUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(indeedQuery)}&api_key=${apiKey}&num=3`;
      
      const indeedResponse = await fetch(indeedUrl);
      if (indeedResponse.ok) {
        const indeedData = await indeedResponse.json();
        if (indeedData.organic_results && indeedData.organic_results.length > 0) {
          const indeedResult = indeedData.organic_results.find((result: any) => 
            result.link && result.link.includes('indeed.com/cmp/')
          );
          if (indeedResult) {
            results.indeed = indeedResult.link;
            results.confidence.indeed = 0.9;
          }
        }
      }
    } catch (error) {
      console.error('Error searching for Indeed:', error);
    }

    // Search for Facebook business page
    try {
      const facebookQuery = `site:facebook.com "${companyName}" business page`;
      const facebookUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(facebookQuery)}&api_key=${apiKey}&num=3`;
      
      const facebookResponse = await fetch(facebookUrl);
      if (facebookResponse.ok) {
        const facebookData = await facebookResponse.json();
        if (facebookData.organic_results && facebookData.organic_results.length > 0) {
          const facebookResult = facebookData.organic_results.find((result: any) => 
            result.link && result.link.includes('facebook.com/') && !result.link.includes('/posts/')
          );
          if (facebookResult) {
            results.facebook = facebookResult.link;
            results.confidence.facebook = 0.8;
          }
        }
      }
    } catch (error) {
      console.error('Error searching for Facebook:', error);
    }

    console.log(`SERP API found URLs for ${companyName}:`, results);
    return results;

  } catch (error) {
    console.error('Error in SERP API URL discovery:', error);
    return {};
  }
};

// AI-Powered URL Discovery using OpenAI
const discoverUrlsWithAI = async (companyName: string) => {
  try {
    const prompt = `
    Given the company name "${companyName}", help me find their most likely URLs for:
    1. Official website
    2. LinkedIn company page
    3. Indeed company page
    4. Facebook business page

    Consider:
    - Common URL patterns for businesses
    - Industry-specific naming conventions
    - Company size and type
    - Geographic location if relevant
    - Common abbreviations and acronyms

    Return a JSON object with this exact structure:
    {
      "website": "https://example.com or null",
      "linkedin": "https://linkedin.com/company/example or null",
      "indeed": "https://www.indeed.com/cmp/example or null", 
      "facebook": "https://www.facebook.com/example or null",
      "confidence": {
        "website": 0.8,
        "linkedin": 0.7,
        "indeed": 0.6,
        "facebook": 0.5
      }
    }

    IMPORTANT: All URLs must include the full protocol (https://). Do not return URLs without protocols.
    Only include URLs that are very likely to be correct. Use null for uncertain URLs.
    Confidence scores should be between 0.1 and 0.9, where 0.9 is very confident.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) return {};

    try {
      const aiResults = JSON.parse(response);
      return aiResults;
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return {};
    }

  } catch (error) {
    console.error('Error in AI URL discovery:', error);
    return {};
  }
};

// Pattern-based URL Generation
const generateUrlsByPattern = async (companyName: string) => {
  const words = companyName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hyphenatedName = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  // Remove common business suffixes
  const filteredWords = words.filter(word => 
    !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services', 'group', 'holdings'].includes(word)
  );

  const results = {
    website: null as string | null,
    linkedin: null as string | null,
    indeed: null as string | null,
    facebook: null as string | null
  };

  // Website patterns
  const websitePatterns = [
    `https://${cleanName}.com`,
    `https://${filteredWords.join('')}.com`,
    `https://${words[0]}.com`,
    `https://${words.map(w => w.charAt(0)).join('')}.com`,
    `https://${words[0]}${words[words.length - 1]}.com`
  ];

  // LinkedIn patterns
  const linkedinPatterns = [
    `https://linkedin.com/company/${cleanName}`,
    `https://linkedin.com/company/${filteredWords.join('')}`,
    `https://linkedin.com/company/${words[0]}`,
    `https://linkedin.com/company/${words.map(w => w.charAt(0)).join('')}`,
    `https://linkedin.com/company/${words[0]}${words[words.length - 1]}`
  ];

  // Indeed patterns
  const indeedPatterns = [
    `https://www.indeed.com/cmp/${hyphenatedName}`,
    `https://www.indeed.com/cmp/${filteredWords.join('-')}`,
    `https://www.indeed.com/cmp/${words[0]}`,
    `https://www.indeed.com/cmp/${words.map(w => w.charAt(0)).join('')}`,
    `https://www.indeed.com/cmp/${words[0]}${words[words.length - 1]}`
  ];

  // Facebook patterns
  const facebookPatterns = [
    `https://www.facebook.com/${cleanName}`,
    `https://www.facebook.com/${filteredWords.join('')}`,
    `https://www.facebook.com/${words[0]}`,
    `https://www.facebook.com/${words.map(w => w.charAt(0)).join('')}`,
    `https://www.facebook.com/${words[0]}${words[words.length - 1]}`
  ];

      // Select the most likely pattern for each platform and ensure proper protocols
    results.website = websitePatterns[0];
    results.linkedin = linkedinPatterns[0];
    results.indeed = indeedPatterns[0];
    results.facebook = facebookPatterns[0];

    // Ensure all URLs have proper protocols
    if (results.website && !results.website.startsWith('http')) {
      results.website = 'https://' + results.website;
    }
    if (results.linkedin && !results.linkedin.startsWith('http')) {
      results.linkedin = 'https://' + results.linkedin;
    }
    if (results.indeed && !results.indeed.startsWith('http')) {
      results.indeed = 'https://' + results.indeed;
    }
    if (results.facebook && !results.facebook.startsWith('http')) {
      results.facebook = 'https://' + results.facebook;
    }

  return results;
};

// URL Validation - Check if URLs actually exist
const validateUrls = async (results: any) => {
  const validatedResults = { ...results };
  
  // Validate website
  if (validatedResults.website) {
    try {
      const response = await fetch(validatedResults.website, { 
        method: 'HEAD', 
        mode: 'no-cors',
        cache: 'no-cache'
      });
      if (!response.ok) {
        validatedResults.website = null;
        validatedResults.confidence.website = 0;
      }
    } catch (error) {
      validatedResults.website = null;
      validatedResults.confidence.website = 0;
    }
  }

  // For social media URLs, we can't easily validate them without proper APIs
  // So we'll keep them but mark confidence as lower
  if (validatedResults.linkedin && validatedResults.confidence.linkedin > 0.7) {
    validatedResults.confidence.linkedin = 0.7;
  }
  if (validatedResults.indeed && validatedResults.confidence.indeed > 0.6) {
    validatedResults.confidence.indeed = 0.6;
  }
  if (validatedResults.facebook && validatedResults.confidence.facebook > 0.5) {
    validatedResults.confidence.facebook = 0.5;
  }

  return validatedResults;
};



 