const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export async function extractCompanyNameFromUrl(url: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured - skipping company name extraction');
    return null;
  }

  try {
    const prompt = `Given this website URL, extract the company name. Return only the company name, nothing else. If you can't determine a clear company name, return "Unknown Company".

URL: ${url}

Company name:`;

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const companyName = data.choices[0].message.content.trim();
    
    // Clean up the response
    const cleanName = companyName.replace(/^["']|["']$/g, '').trim();
    
    return cleanName === 'Unknown Company' ? null : cleanName;
  } catch (error) {
    console.error('Error extracting company name from URL:', error);
    return null;
  }
}

export async function enhanceCompanyData(
  companies: any[], 
  onProgress?: (current: number, total: number, message: string) => void
): Promise<any[]> {
  const enhancedCompanies = [...companies];
  let enhancedCount = 0;
  const companiesNeedingNames = companies.filter(company => 
    !company['Name'] || !company['Name'].trim()
  );

  for (let i = 0; i < enhancedCompanies.length; i++) {
    const company = enhancedCompanies[i];
    const hasName = company['Name'] && company['Name'].trim();
    const hasWebsite = company['Website'] && company['Website'].trim();

    // If company has no name but has a website, try to extract the name
    if (!hasName && hasWebsite) {
      const progressMessage = `Extracting company name from: ${company['Website']}`;
      onProgress?.(i + 1, companiesNeedingNames.length, progressMessage);
      
      console.log(`Extracting company name for: ${company['Website']}`);
      const extractedName = await extractCompanyNameFromUrl(company['Website']);
      
      if (extractedName) {
        company['Name'] = extractedName;
        enhancedCount++;
        console.log(`Enhanced company name: ${extractedName} from ${company['Website']}`);
      } else {
        console.log(`Could not extract company name from: ${company['Website']}`);
      }
    }
  }

  console.log(`Enhanced ${enhancedCount} companies with extracted names`);
  return enhancedCompanies;
} 