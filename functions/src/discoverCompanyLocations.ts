import { onCall } from 'firebase-functions/v2/https';
import { OpenAI } from 'openai';
import * as admin from 'firebase-admin';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const discoverCompanyLocations = onCall(async (request) => {
  try {
    const { companyName, companyId, tenantId, industry, headquartersCity, existingLocations } = request.data;

    if (!companyName || !companyId || !tenantId) {
      throw new Error('Missing required parameters: companyName, companyId, tenantId');
    }

    console.log(`Discovering locations for company: ${companyName}`);

    // Check if we have OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI API key not configured, returning basic location suggestions');
      return {
        locations: generateBasicLocations(companyName, headquartersCity, industry)
      };
    }

    // Get recent news articles to extract location mentions
    const newsLocations = await extractLocationsFromNews(companyName);
    
    // Generate AI-powered location suggestions
    const aiLocations = await generateAILocationSuggestions(
      companyName, 
      industry, 
      headquartersCity, 
      existingLocations,
      newsLocations
    );

    // Combine and deduplicate locations
    const allLocations = [...aiLocations, ...newsLocations];
    const uniqueLocations = deduplicateLocations(allLocations);

    console.log(`Discovered ${uniqueLocations.length} unique locations for ${companyName}`);

    return { locations: uniqueLocations };

  } catch (error) {
    console.error('Error in discoverCompanyLocations:', error);
    throw new Error('Failed to discover company locations');
  }
});

// Generate basic location suggestions when AI is not available
const generateBasicLocations = (companyName: string, headquartersCity?: string, industry?: string): any[] => {
  const locations = [];
  
  // Add headquarters if available
  if (headquartersCity) {
    locations.push({
      name: 'Headquarters',
      address: `${companyName} Headquarters`,
      city: headquartersCity,
      state: getStateFromCity(headquartersCity),
      zipCode: '00000',
      country: 'USA',
      type: 'Office',
      confidence: 0.9,
      source: 'Company Data'
    });
  }

  // Add industry-specific locations
  if (industry) {
    const industryLower = industry.toLowerCase();
    
    if (industryLower.includes('manufacturing') || industryLower.includes('industrial')) {
      locations.push({
        name: 'Manufacturing Plant',
        address: `${companyName} Manufacturing Facility`,
        city: headquartersCity || 'Various Locations',
        state: headquartersCity ? getStateFromCity(headquartersCity) : 'Various',
        zipCode: '00000',
        country: 'USA',
        type: 'Manufacturing',
        confidence: 0.7,
        source: 'Industry Analysis'
      });
    }
    
    if (industryLower.includes('retail') || industryLower.includes('consumer')) {
      locations.push({
        name: 'Retail Store',
        address: `${companyName} Retail Location`,
        city: headquartersCity || 'Various Locations',
        state: headquartersCity ? getStateFromCity(headquartersCity) : 'Various',
        zipCode: '00000',
        country: 'USA',
        type: 'Retail',
        confidence: 0.6,
        source: 'Industry Analysis'
      });
    }
    
    if (industryLower.includes('warehouse') || industryLower.includes('logistics')) {
      locations.push({
        name: 'Distribution Center',
        address: `${companyName} Distribution Facility`,
        city: headquartersCity || 'Various Locations',
        state: headquartersCity ? getStateFromCity(headquartersCity) : 'Various',
        zipCode: '00000',
        country: 'USA',
        type: 'Distribution',
        confidence: 0.7,
        source: 'Industry Analysis'
      });
    }
  }

  return locations;
};

// Extract locations from recent news articles
const extractLocationsFromNews = async (companyName: string): Promise<any[]> => {
  try {
    const db = admin.firestore();
    
    // Get recent news articles for this company
    const newsRef = db.collection('tenants').doc('global').collection('crm_companies').doc('global').collection('newsArticles').doc('latest');
    const newsDoc = await newsRef.get();
    
    if (!newsDoc.exists) {
      return [];
    }

    const newsData = newsDoc.data();
    const articles = newsData?.articles || [];
    
    // Filter articles for this company
    const companyArticles = articles.filter((article: any) => 
      article.title.toLowerCase().includes(companyName.toLowerCase()) ||
      article.summary.toLowerCase().includes(companyName.toLowerCase())
    );

    if (companyArticles.length === 0) {
      return [];
    }

    // Use AI to extract locations from news content
    const prompt = `
    Analyze these news articles about ${companyName} and extract any mentioned business locations, offices, facilities, or addresses.
    
    Articles:
    ${companyArticles.map((article: any) => `${article.title}: ${article.summary}`).join('\n\n')}
    
    Return a JSON array of locations with this structure:
    [
      {
        "name": "Location name (e.g., 'New Office', 'Manufacturing Plant')",
        "address": "Full address if mentioned",
        "city": "City name",
        "state": "State abbreviation",
        "zipCode": "ZIP code if mentioned, otherwise '00000'",
        "country": "Country (default to 'USA')",
        "type": "Location type (Office, Manufacturing, Warehouse, Retail, etc.)",
        "confidence": 0.8,
        "source": "News Article"
      }
    ]
    
    Only include locations that are clearly mentioned in the articles. If no specific locations are mentioned, return an empty array.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) return [];

    try {
      const locations = JSON.parse(response);
      return Array.isArray(locations) ? locations : [];
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return [];
    }

  } catch (error) {
    console.error('Error extracting locations from news:', error);
    return [];
  }
};

// Generate AI-powered location suggestions
const generateAILocationSuggestions = async (
  companyName: string,
  industry?: string,
  headquartersCity?: string,
  existingLocations: string[] = [],
  newsLocations: any[] = []
): Promise<any[]> => {
  try {
    const prompt = `
    Based on the company information below, suggest potential business locations for ${companyName}.
    
    Company Information:
    - Name: ${companyName}
    - Industry: ${industry || 'Not specified'}
    - Headquarters: ${headquartersCity || 'Not specified'}
    - Existing Locations: ${existingLocations.join(', ') || 'None'}
    - Recent News Locations: ${newsLocations.map(loc => `${loc.name} in ${loc.city}`).join(', ') || 'None'}
    
    Consider:
    1. Industry-specific location needs (manufacturing plants, retail stores, offices, warehouses)
    2. Geographic expansion patterns
    3. Common business locations for this type of company
    4. Major business hubs and markets
    
    Return a JSON array of suggested locations with this structure:
    [
      {
        "name": "Descriptive location name",
        "address": "Typical address format for this location type",
        "city": "City name",
        "state": "State abbreviation",
        "zipCode": "00000",
        "country": "USA",
        "type": "Location type (Office, Manufacturing, Warehouse, Retail, Distribution, Branch)",
        "confidence": 0.6,
        "source": "AI Analysis"
      }
    ]
    
    Suggest 3-5 realistic locations that would make sense for this company. Focus on major cities and business centers.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) return [];

    try {
      const locations = JSON.parse(response);
      return Array.isArray(locations) ? locations : [];
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return [];
    }

  } catch (error) {
    console.error('Error generating AI location suggestions:', error);
    return [];
  }
};

// Deduplicate locations based on address and city
const deduplicateLocations = (locations: any[]): any[] => {
  const seen = new Set();
  return locations.filter(location => {
    const key = `${location.city}-${location.state}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

// Helper function to get state from city (basic mapping)
const getStateFromCity = (city: string): string => {
  const cityStateMap: { [key: string]: string } = {
    'new york': 'NY',
    'los angeles': 'CA',
    'chicago': 'IL',
    'houston': 'TX',
    'phoenix': 'AZ',
    'philadelphia': 'PA',
    'san antonio': 'TX',
    'san diego': 'CA',
    'dallas': 'TX',
    'san jose': 'CA',
    'austin': 'TX',
    'jacksonville': 'FL',
    'fort worth': 'TX',
    'columbus': 'OH',
    'charlotte': 'NC',
    'san francisco': 'CA',
    'indianapolis': 'IN',
    'seattle': 'WA',
    'denver': 'CO',
    'washington': 'DC',
    'boston': 'MA',
    'el paso': 'TX',
    'nashville': 'TN',
    'detroit': 'MI',
    'oklahoma city': 'OK',
    'portland': 'OR',
    'las vegas': 'NV',
    'memphis': 'TN',
    'louisville': 'KY',
    'baltimore': 'MD',
    'milwaukee': 'WI',
    'albuquerque': 'NM',
    'tucson': 'AZ',
    'fresno': 'CA',
    'sacramento': 'CA',
    'atlanta': 'GA',
    'kansas city': 'MO',
    'long beach': 'CA',
    'colorado springs': 'CO',
    'raleigh': 'NC',
    'miami': 'FL',
    'virginia beach': 'VA',
    'omaha': 'NE',
    'oakland': 'CA',
    'minneapolis': 'MN',
    'tulsa': 'OK',
    'arlington': 'TX',
    'tampa': 'FL',
    'new orleans': 'LA',
    'wichita': 'KS',
    'cleveland': 'OH',
    'bakersfield': 'CA',
    'aurora': 'CO',
    'anaheim': 'CA',
    'honolulu': 'HI',
    'santa ana': 'CA',
    'corpus christi': 'TX',
    'riverside': 'CA',
    'lexington': 'KY',
    'stockton': 'CA',
    'henderson': 'NV',
    'saint paul': 'MN',
    'st. louis': 'MO',
    'cincinnati': 'OH',
    'pittsburgh': 'PA',
    'greensboro': 'NC',
    'anchorage': 'AK',
    'plano': 'TX',
    'orlando': 'FL',
    'newark': 'NJ',
    'durham': 'NC',
    'chandler': 'AZ',
    'laredo': 'TX',
    'chula vista': 'CA',
    'lubbock': 'TX',
    'garland': 'TX',
    'glendale': 'AZ',

    'hialeah': 'FL',
    'fremont': 'CA',
    'boise': 'ID',
    'richmond': 'VA',
    'baton rouge': 'LA',
    'spokane': 'WA',
    'des moines': 'IA',
    'tacoma': 'WA',
    'san bernardino': 'CA',
    'modesto': 'CA',
    'fontana': 'CA',
    'oxnard': 'CA',
    'moreno valley': 'CA',
    'fayetteville': 'NC',
    'huntington beach': 'CA',
    'yonkers': 'NY',

    'montgomery': 'AL',

    'akron': 'OH',
    'little rock': 'AR',
    'augusta': 'GA',
    'grand rapids': 'MI',
    'shreveport': 'LA',
    'salt lake city': 'UT',
    'huntsville': 'AL',
    'mobile': 'AL',
    'tallahassee': 'FL',
    'grand prairie': 'TX',
    'overland park': 'KS',
    'knoxville': 'TN',
    'worcester': 'MA',
    'brownsville': 'TX',
    'newport news': 'VA',
    'santa clarita': 'CA',
    'port st. lucie': 'FL',
    'providence': 'RI',
    'fort lauderdale': 'FL',
    'chattanooga': 'TN',
    'tempe': 'AZ',
    'oceanside': 'CA',
    'garden grove': 'CA',
    'rancho cucamonga': 'CA',
    'cape coral': 'FL',
    'santa rosa': 'CA',
    'vancouver': 'WA',
    'sioux falls': 'SD',
    'springfield': 'MO',
    'peoria': 'AZ',
    'pembroke pines': 'FL',
    'elk grove': 'CA',
    'salem': 'OR',
    'lancaster': 'CA',
    'corona': 'CA',
    'eugene': 'OR',
    'palmdale': 'CA',
    'salinas': 'CA',

    'pasadena': 'TX',
    'fort collins': 'CO',
    'hayward': 'CA',
    'pomona': 'CA',
    'cary': 'NC',
    'rockford': 'IL',
    'alexandria': 'VA',
    'escondido': 'CA',
    'mckinney': 'TX',

    'joliet': 'IL',
    'sunnyvale': 'CA',
    'torrance': 'CA',
    'bridgeport': 'CT',
    'lakewood': 'CO',
    'hollywood': 'FL',
    'paterson': 'NJ',
    'naperville': 'IL',
    'syracuse': 'NY',
    'mesa': 'AZ',
    'dayton': 'OH',
    'savannah': 'GA',
    'clarksville': 'TN',
    'orange': 'CA',

    'fullerton': 'CA',
    'killeen': 'TX',
    'frisco': 'TX',
    'huntington': 'WV',
    'evansville': 'IN',
    'redmond': 'WA',
  };

  const cityLower = city.toLowerCase();
  return cityStateMap[cityLower] || 'Unknown';
}; 