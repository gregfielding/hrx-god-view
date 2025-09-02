import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');

// Cache for decision makers search results
const decisionMakersCache = new Map<string, { data: any; timestamp: number }>();
const DECISION_MAKERS_CACHE_DURATION = 60 * 60 * 1000; // 60 minutes cache (longer since company data doesn't change frequently)

interface DecisionMaker {
  name: string;
  title: string;
  linkedinUrl: string;
  snippet: string;
  relevance: number;
}

interface SearchResult {
  success: boolean;
  decisionMakers: DecisionMaker[];
  totalFound: number;
  message?: string;
}

export const findDecisionMakers = onCall({
  cors: true,
  maxInstances: 3,
  timeoutSeconds: 60,
  memory: '512MiB'
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { companyName, locationKeywords, jobTitleKeywords, seniorityLevel, department } = request.data;

    // Debug logging for incoming parameters
    console.log('🔍 Decision Makers search request:', {
      companyName,
      locationKeywords,
      jobTitleKeywords,
      seniorityLevel,
      department
    });

    // Create cache key based on all parameters
    const cacheKey = `decision_makers_${companyName}_${locationKeywords || 'default'}_${jobTitleKeywords || 'default'}_${seniorityLevel || 'default'}_${department || 'default'}`;
    
    // Check cache first
    const cached = decisionMakersCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < DECISION_MAKERS_CACHE_DURATION) {
      console.log('Decision makers search served from cache for company:', companyName);
      return cached.data;
    }

    // Validate required parameters
    if (!companyName) {
      throw new HttpsError('invalid-argument', 'Company name is required');
    }

    // Validate company name format
    if (typeof companyName !== 'string' || companyName.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'Company name must be a non-empty string');
    }

    // Validate optional parameters
    if (locationKeywords && typeof locationKeywords !== 'string') {
      throw new HttpsError('invalid-argument', 'Location keywords must be a string');
    }
    if (jobTitleKeywords && typeof jobTitleKeywords !== 'string') {
      throw new HttpsError('invalid-argument', 'Job title keywords must be a string');
    }
    if (seniorityLevel && !['entry', 'mid', 'senior', 'executive'].includes(seniorityLevel)) {
      throw new HttpsError('invalid-argument', 'Seniority level must be one of: entry, mid, senior, executive');
    }
    if (department && typeof department !== 'string') {
      throw new HttpsError('invalid-argument', 'Department must be a string');
    }

    const apiKey = serpApiKey.value();
    if (!apiKey) {
      return {
        success: false,
        decisionMakers: [],
        totalFound: 0,
        message: 'SERP API key not configured'
      } as SearchResult;
    }

    // Build search queries with filters
    const searchQueries = buildSearchQueries(companyName, locationKeywords, jobTitleKeywords, seniorityLevel, department);

    console.log('🔍 Executing search queries:', searchQueries);

    const allDecisionMakers: DecisionMaker[] = [];
    const seenUrls = new Set<string>();

    // Process queries with timeout protection
    for (const query of searchQueries) {
      console.log('🔍 Executing query:', query);
      try {
        const url = 'https://serpapi.com/search';
        const params = new URLSearchParams({
          q: query,
          api_key: apiKey,
          engine: 'google',
          num: '5' // Reduced from 10 to 5 to speed up response
        });

        // Add timeout to fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout per request

        const response = await fetch(`${url}?${params}`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error(`SERP API error: ${response.status} ${response.statusText}`);
          continue;
        }

        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`SERP API returned non-JSON response: ${contentType}`);
          continue;
        }

        const responseText = await response.text();
        
        // Validate that the response is actually JSON
        if (!responseText.trim().startsWith('{')) {
          console.error('SERP API returned non-JSON response (likely HTML error page)');
          console.error('Response preview:', responseText.substring(0, 200));
          continue;
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Failed to parse SERP API response as JSON:', parseError);
          console.error('Response preview:', responseText.substring(0, 200));
          continue;
        }

        // Check for SERP API error responses
        if (data.error) {
          console.error(`SERP API error: ${data.error}`);
          continue;
        }

        if (data.organic_results) {
          for (const result of data.organic_results) {
            if (result.link && result.link.includes('linkedin.com/in/') && !seenUrls.has(result.link)) {
              seenUrls.add(result.link);
              
              // Extract name from LinkedIn URL and clean it
              const linkedinPath = result.link.split('linkedin.com/in/')[1];
              let name = 'Unknown';
              
              if (linkedinPath) {
                // Get the base path without query parameters
                const basePath = linkedinPath.split('/')[0];
                
                // Remove common LinkedIn URL suffixes (numbers, IDs, etc.)
                // Pattern: name-123456789 or name-abc123 or name-123-456
                let cleanName = basePath.replace(/-[0-9a-z]{6,}$/i, ''); // Remove trailing alphanumeric IDs
                cleanName = cleanName.replace(/-[0-9]{3,}$/, ''); // Remove trailing numbers
                cleanName = cleanName.replace(/-[a-z]{2,3}$/i, ''); // Remove short suffixes
                
                // Convert to proper case
                name = cleanName.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                
                // If the name is too short or contains numbers, try to extract from snippet
                if (name.length < 3 || /\d/.test(name)) {
                  // Try to extract name from snippet using common patterns
                  const nameMatch = result.snippet.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
                  if (nameMatch) {
                    name = nameMatch[1];
                  }
                }
              }
              
              // Extract title from snippet
              const title = extractTitleFromSnippet(result.snippet, companyName);
              
              const decisionMaker: DecisionMaker = {
                name,
                title,
                linkedinUrl: result.link,
                snippet: result.snippet,
                relevance: calculateRelevance(result.snippet, companyName, title)
              };
              
              allDecisionMakers.push(decisionMaker);
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for query "${query}":`, error);
        continue; // Continue with next query
      }
    }

    // Sort by relevance and remove duplicates
    const uniqueDecisionMakers = allDecisionMakers
      .filter((dm, index, self) => 
        index === self.findIndex(d => d.linkedinUrl === dm.linkedinUrl)
      )
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Reduced from 15 to 10 results

    const result = {
      success: true,
      decisionMakers: uniqueDecisionMakers,
      totalFound: uniqueDecisionMakers.length,
      message: `Found ${uniqueDecisionMakers.length} decision-makers for ${companyName}`
    } as SearchResult;

    // Cache the result
    decisionMakersCache.set(cacheKey, { data: result, timestamp: now });

    return result;

  } catch (error) {
    console.error('Error in findDecisionMakers:', error);
    
    // Provide specific error messages for different failure modes
    if (error instanceof HttpsError) {
      throw error; // Re-throw HttpsErrors as-is
    }
    
    if (error instanceof Error) {
      if (error.message.includes('SERP API key not configured')) {
        throw new HttpsError('failed-precondition', 'SERP API key not configured');
      }
      if (error.message.includes('timeout') || error.message.includes('abort')) {
        throw new HttpsError('deadline-exceeded', 'Search request timed out');
      }
      if (error.message.includes('quota') || error.message.includes('rate limit')) {
        throw new HttpsError('resource-exhausted', 'SERP API rate limit exceeded');
      }
    }
    
    return {
      success: false,
      decisionMakers: [],
      totalFound: 0,
      message: 'Failed to search for decision makers'
    } as SearchResult;
  }
});

// HTTP wrapper (supports direct fetch with proper CORS)
export const findDecisionMakersHttp = onRequest({
  cors: true,
  maxInstances: 3,
  timeoutSeconds: 60,
  memory: '512MiB'
}, async (req, res) => {
  try {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { companyName } = payload || {};

    if (!companyName) {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(400).json({
        success: false,
        decisionMakers: [],
        totalFound: 0,
        message: 'Company name is required'
      });
      return;
    }

    const apiKey = serpApiKey.value();
    if (!apiKey) {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(500).json({
        success: false,
        decisionMakers: [],
        totalFound: 0,
        message: 'SERP API key not configured'
      });
      return;
    }

    // Simplified search queries to reduce API calls and timeout risk
    const searchQueries = [
      `site:linkedin.com/in "${companyName}" ("HR Director" OR "VP of Human Resources" OR "Chief People Officer" OR "HR Manager")`,
      `site:linkedin.com/in "${companyName}" ("VP of Operations" OR "Operations Director" OR "General Manager" OR "CEO" OR "President")`
    ];

    const allDecisionMakers: DecisionMaker[] = [];
    const seenUrls = new Set<string>();

    // Process queries with timeout protection
    for (const query of searchQueries) {
      try {
        const url = 'https://serpapi.com/search';
        const params = new URLSearchParams({
          q: query,
          api_key: apiKey,
          engine: 'google',
          num: '5' // Reduced from 10 to 5 to speed up response
        });

        // Add timeout to fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout per request

        const response = await fetch(`${url}?${params}`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error(`SERP API error: ${response.status} ${response.statusText}`);
          continue;
        }

        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`SERP API returned non-JSON response: ${contentType}`);
          continue;
        }

        const responseText = await response.text();
        
        // Validate that the response is actually JSON
        if (!responseText.trim().startsWith('{')) {
          console.error('SERP API returned non-JSON response (likely HTML error page)');
          console.error('Response preview:', responseText.substring(0, 200));
          continue;
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Failed to parse SERP API response as JSON:', parseError);
          console.error('Response preview:', responseText.substring(0, 200));
          continue;
        }

        // Check for SERP API error responses
        if (data.error) {
          console.error(`SERP API error: ${data.error}`);
          continue;
        }

        if (data.organic_results) {
          for (const result of data.organic_results) {
            if (result.link && result.link.includes('linkedin.com/in/') && !seenUrls.has(result.link)) {
              seenUrls.add(result.link);
              
              // Extract name from LinkedIn URL and clean it
              const linkedinPath = result.link.split('linkedin.com/in/')[1];
              let name = 'Unknown';
              
              if (linkedinPath) {
                // Get the base path without query parameters
                const basePath = linkedinPath.split('/')[0];
                
                // Remove common LinkedIn URL suffixes (numbers, IDs, etc.)
                // Pattern: name-123456789 or name-abc123 or name-123-456
                let cleanName = basePath.replace(/-[0-9a-z]{6,}$/i, ''); // Remove trailing alphanumeric IDs
                cleanName = cleanName.replace(/-[0-9]{3,}$/, ''); // Remove trailing numbers
                cleanName = cleanName.replace(/-[a-z]{2,3}$/i, ''); // Remove short suffixes
                
                // Convert to proper case
                name = cleanName.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                
                // If the name is too short or contains numbers, try to extract from snippet
                if (name.length < 3 || /\d/.test(name)) {
                  // Try to extract name from snippet using common patterns
                  const nameMatch = result.snippet.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
                  if (nameMatch) {
                    name = nameMatch[1];
                  }
                }
              }
              
              // Extract title from snippet
              const title = extractTitleFromSnippet(result.snippet, companyName);
              
              const decisionMaker: DecisionMaker = {
                name,
                title,
                linkedinUrl: result.link,
                snippet: result.snippet,
                relevance: calculateRelevance(result.snippet, companyName, title)
              };
              
              allDecisionMakers.push(decisionMaker);
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for query "${query}":`, error);
        continue; // Continue with next query
      }
    }

    // Sort by relevance and remove duplicates
    const uniqueDecisionMakers = allDecisionMakers
      .filter((dm, index, self) => 
        index === self.findIndex(d => d.linkedinUrl === dm.linkedinUrl)
      )
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Reduced from 15 to 10 results

    const result = {
      success: true,
      decisionMakers: uniqueDecisionMakers,
      totalFound: uniqueDecisionMakers.length,
      message: `Found ${uniqueDecisionMakers.length} decision-makers for ${companyName}`
    };

    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(200).json(result);

  } catch (error) {
    console.error('Error in findDecisionMakersHttp:', error);
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(500).json({
      success: false,
      decisionMakers: [],
      totalFound: 0,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

function extractTitleFromSnippet(snippet: string, companyName: string): string {
  // Common decision-maker titles
  const titles = [
    'HR Director', 'VP of Human Resources', 'Chief People Officer', 'HR Manager',
    'VP of Operations', 'Operations Director', 'General Manager', 'CEO', 'President',
    'Owner', 'Recruiting Manager', 'Talent Acquisition', 'HR Specialist',
    'Operations Manager', 'Plant Manager', 'Facility Manager'
  ];

  const snippetLower = snippet.toLowerCase();

  // Look for titles in the snippet
  for (const title of titles) {
    if (snippetLower.includes(title.toLowerCase())) {
      return title;
    }
  }

  // If no specific title found, try to extract from context
  if (snippetLower.includes('hr') || snippetLower.includes('human resources')) {
    return 'HR Professional';
  }
  if (snippetLower.includes('operations') || snippetLower.includes('operations')) {
    return 'Operations Professional';
  }
  if (snippetLower.includes('manager') || snippetLower.includes('director')) {
    return 'Management';
  }

  return 'Professional';
}

function calculateRelevance(snippet: string, companyName: string, title: string): number {
  let relevance = 0;
  const snippetLower = snippet.toLowerCase();
  const companyLower = companyName.toLowerCase();
  const titleLower = title.toLowerCase();

  // Company name match (highest weight)
  if (snippetLower.includes(companyLower)) {
    relevance += 50;
  }

  // Title relevance
  const highPriorityTitles = ['hr director', 'vp of human resources', 'chief people officer', 'ceo', 'president'];
  const mediumPriorityTitles = ['hr manager', 'operations director', 'general manager', 'recruiting manager'];
  
  if (highPriorityTitles.some(t => titleLower.includes(t))) {
    relevance += 30;
  } else if (mediumPriorityTitles.some(t => titleLower.includes(t))) {
    relevance += 20;
  }

  // Snippet quality indicators
  if (snippetLower.includes('linkedin')) {
    relevance += 10;
  }
  if (snippetLower.includes('experience') || snippetLower.includes('years')) {
    relevance += 5;
  }

  return Math.min(relevance, 100); // Cap at 100
}

// Helper function to build search queries with filters
function buildSearchQueries(
  companyName: string, 
  locationKeywords?: string, 
  jobTitleKeywords?: string, 
  seniorityLevel?: string, 
  department?: string
): string[] {
  const queries: string[] = [];
  
  // Base company filter
  const companyFilter = `site:linkedin.com/in "${companyName}"`;
  
  // Build location filter - split by commas and clean up
  const locations: string[] = [];
  if (locationKeywords?.trim()) {
    // Split by comma and clean up each location
    locations.push(...locationKeywords.split(',').map(loc => loc.trim()).filter(loc => loc.length > 0));
    
    // Also handle common location formats
    const expandedLocations: string[] = [];
    for (const loc of locations) {
      // Handle state abbreviations
      const stateMap: { [key: string]: string } = {
        'ny': 'New York',
        'ca': 'California',
        'tx': 'Texas',
        'fl': 'Florida',
        'il': 'Illinois',
        'pa': 'Pennsylvania',
        'oh': 'Ohio',
        'ga': 'Georgia',
        'nc': 'North Carolina',
        'mi': 'Michigan',
        'nj': 'New Jersey',
        'va': 'Virginia',
        'wa': 'Washington',
        'az': 'Arizona',
        'ma': 'Massachusetts',
        'tn': 'Tennessee',
        'in': 'Indiana',
        'mo': 'Missouri',
        'md': 'Maryland',
        'co': 'Colorado'
      };
      
      const lowerLoc = loc.toLowerCase();
      if (stateMap[lowerLoc]) {
        expandedLocations.push(stateMap[lowerLoc]);
      } else {
        expandedLocations.push(loc);
      }
    }
    
    // Replace locations with expanded versions
    locations.length = 0;
    locations.push(...expandedLocations);
  }
  
  // Build job title filter
  let jobTitleFilter = '';
  if (jobTitleKeywords?.trim()) {
    jobTitleFilter = `"${jobTitleKeywords.trim()}"`;
  } else {
    // Default job titles based on seniority and department
    const defaultTitles = getDefaultTitles(seniorityLevel, department);
    if (defaultTitles.length > 0) {
      jobTitleFilter = `(${defaultTitles.map(title => `"${title}"`).join(' OR ')})`;
    }
  }
  
  // Build location filter string
  let locationFilter = '';
  if (locations.length > 0) {
    // Create OR condition for multiple locations
    locationFilter = `(${locations.map(loc => `"${loc}"`).join(' OR ')})`;
  }
  
  // Build queries with different combinations
  if (locationFilter && jobTitleFilter) {
    // Most specific: company + location + job title
    queries.push(`${companyFilter} ${locationFilter} ${jobTitleFilter}`);
  }
  
  if (locationFilter) {
    // Company + location with default titles
    const defaultTitles = getDefaultTitles(seniorityLevel, department);
    if (defaultTitles.length > 0) {
      queries.push(`${companyFilter} ${locationFilter} (${defaultTitles.map(title => `"${title}"`).join(' OR ')})`);
    }
  }
  
  if (jobTitleFilter) {
    // Company + job title
    queries.push(`${companyFilter} ${jobTitleFilter}`);
  }
  
  // Fallback: company with default titles
  const defaultTitles = getDefaultTitles(seniorityLevel, department);
  if (defaultTitles.length > 0) {
    queries.push(`${companyFilter} (${defaultTitles.map(title => `"${title}"`).join(' OR ')})`);
  }
  
  // If no queries were built, use the original default
  if (queries.length === 0) {
    queries.push(
      `${companyFilter} ("HR Director" OR "VP of Human Resources" OR "Chief People Officer" OR "HR Manager")`,
      `${companyFilter} ("VP of Operations" OR "Operations Director" OR "General Manager" OR "CEO" OR "President")`
    );
  }
  
  // Debug logging
  console.log('🔍 Built search queries:', {
    companyName,
    locationKeywords,
    locations,
    locationFilter,
    jobTitleKeywords,
    jobTitleFilter,
    seniorityLevel,
    department,
    queries
  });
  
  return queries;
}

// Helper function to get default titles based on seniority and department
function getDefaultTitles(seniorityLevel?: string, department?: string): string[] {
  const titles: string[] = [];
  
  // Department-specific titles
  if (department?.toLowerCase().includes('hr') || department?.toLowerCase().includes('human resources')) {
    titles.push('HR Director', 'VP of Human Resources', 'Chief People Officer', 'HR Manager', 'Talent Acquisition Manager');
  } else if (department?.toLowerCase().includes('operations')) {
    titles.push('VP of Operations', 'Operations Director', 'Operations Manager', 'General Manager');
  } else if (department?.toLowerCase().includes('sales')) {
    titles.push('VP of Sales', 'Sales Director', 'Sales Manager', 'Account Executive');
  } else if (department?.toLowerCase().includes('marketing')) {
    titles.push('VP of Marketing', 'Marketing Director', 'Marketing Manager');
  } else if (department?.toLowerCase().includes('finance')) {
    titles.push('CFO', 'VP of Finance', 'Finance Director', 'Controller');
  } else if (department?.toLowerCase().includes('engineering') || department?.toLowerCase().includes('tech')) {
    titles.push('CTO', 'VP of Engineering', 'Engineering Director', 'Technical Manager');
  }
  
  // Seniority-based titles
  if (seniorityLevel === 'executive') {
    titles.push('CEO', 'President', 'Chief Executive Officer', 'Founder', 'Owner');
  } else if (seniorityLevel === 'senior') {
    titles.push('VP', 'Director', 'Senior Manager', 'Head of');
  } else if (seniorityLevel === 'mid') {
    titles.push('Manager', 'Lead', 'Supervisor');
  } else if (seniorityLevel === 'entry') {
    titles.push('Coordinator', 'Specialist', 'Associate');
  }
  
  // If no specific titles found, use general decision-maker titles
  if (titles.length === 0) {
    titles.push('HR Director', 'VP of Human Resources', 'Chief People Officer', 'HR Manager', 'VP of Operations', 'Operations Director', 'General Manager', 'CEO', 'President');
  }
  
  return titles;
} 