import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');

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
  maxInstances: 10
}, async (request) => {
  try {
    const { companyName } = request.data;

    if (!companyName) {
      return {
        success: false,
        decisionMakers: [],
        totalFound: 0,
        message: 'Company name is required'
      } as SearchResult;
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

    // Search queries for different types of decision-makers
    const searchQueries = [
      `site:linkedin.com/in "${companyName}" ("HR Director" OR "VP of Human Resources" OR "Chief People Officer")`,
      `site:linkedin.com/in "${companyName}" ("VP of Operations" OR "Operations Director" OR "General Manager")`,
      `site:linkedin.com/in "${companyName}" ("CEO" OR "President" OR "Owner")`,
      `site:linkedin.com/in "${companyName}" ("Recruiting Manager" OR "Talent Acquisition" OR "HR Manager")`
    ];

    const allDecisionMakers: DecisionMaker[] = [];
    const seenUrls = new Set<string>();

    for (const query of searchQueries) {
      try {
        const url = 'https://serpapi.com/search';
        const params = new URLSearchParams({
          q: query,
          api_key: apiKey,
          engine: 'google',
          num: '10' // Get up to 10 results per query
        });

        const response = await fetch(`${url}?${params}`);
        const data = await response.json();

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
      .slice(0, 15); // Limit to top 15 results

    return {
      success: true,
      decisionMakers: uniqueDecisionMakers,
      totalFound: uniqueDecisionMakers.length,
      message: `Found ${uniqueDecisionMakers.length} decision-makers for ${companyName}`
    } as SearchResult;

  } catch (error) {
    console.error('Error in findDecisionMakers:', error);
    return {
      success: false,
      decisionMakers: [],
      totalFound: 0,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    } as SearchResult;
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