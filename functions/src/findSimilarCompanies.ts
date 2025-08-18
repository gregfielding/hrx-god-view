import { onCall } from 'firebase-functions/v2/https';
import { OpenAI } from 'openai';
import { defineString } from 'firebase-functions/params';

const openaiApiKey = defineString('OPENAI_API_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey.value(),
});

interface FindSimilarCompaniesData {
  companyName: string;
  industry?: string;
  location?: string;
  tenantId: string;
}

interface SimilarCompany {
  name: string;
  industry?: string;
  description?: string;
  headquarters?: string;
  employeeCount?: string;
  revenue?: string;
  website?: string;
  linkedinUrl?: string;
  phone?: string;
  email?: string;
  founded?: string;
}

export const findSimilarCompanies = onCall<FindSimilarCompaniesData>({
  region: 'us-central1',
  timeoutSeconds: 30,
  memory: '256MiB',
}, async (request) => {
  try {
    const { companyName, industry, location } = request.data;

    if (!companyName) {
      throw new Error('Company name is required');
    }

    console.log('Calling OpenAI API...');

    const prompt = `Generate 3 fictional but realistic companies similar to "${companyName}"${industry ? ` in the ${industry} industry` : ''}${location ? ` located in ${location}` : ''}. 

Return ONLY a valid JSON array with this exact structure for each company:
{
  "name": "Company Name",
  "industry": "Industry",
  "description": "Brief description",
  "headquarters": "City, State",
  "employeeCount": "50-100 employees",
  "revenue": "$10M-$50M",
  "website": "www.companyname.com",
  "linkedinUrl": "www.linkedin.com/company/companyname",
  "phone": "555-123-4567",
  "email": "info@companyname.com",
  "founded": "2000"
}

Do not include any additional fields. Keep descriptions brief. Use only fictional company names.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content: 'You are a business data generator. Create fictional but realistic company information in valid JSON format. Return only valid JSON without any explanatory text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 800, // Reduced to prevent truncation
    });

    console.log('OpenAI API call completed');

    const responseText = completion.choices[0]?.message?.content?.trim();
    
    if (!responseText) {
      throw new Error('No response from AI');
    }

    console.log('Parsing AI response...');

    // Try to parse the JSON response
    let companies: SimilarCompany[] = [];
    
    try {
      // Clean up the response text
      let cleanedText = responseText;
      
      // Remove any markdown formatting
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/```json\n?/, '').replace(/```\n?/, '');
      }
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/```\n?/, '').replace(/```\n?/, '');
      }
      
      // Try to find JSON array in the response
      const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
      
      companies = JSON.parse(cleanedText);
      
      // Validate the structure
      if (!Array.isArray(companies)) {
        throw new Error('Response is not an array');
      }
      
      // Ensure each company has required fields
      companies = companies.map(company => ({
        name: company.name || 'Unknown Company',
        industry: company.industry || 'Unknown Industry',
        description: company.description || 'No description available',
        headquarters: company.headquarters || 'Unknown Location',
        employeeCount: company.employeeCount || 'Unknown',
        revenue: company.revenue || 'Unknown',
        website: company.website || 'www.example.com',
        linkedinUrl: company.linkedinUrl || 'www.linkedin.com/company/example',
        phone: company.phone || '555-123-4567',
        email: company.email || 'info@example.com',
        founded: company.founded || '2000'
      }));
      
    } catch (parseError) {
      console.log('Error parsing AI response:', parseError);
      console.log('Response text:', responseText);
      
      // Fallback: Generate simple companies manually
      companies = [
        {
          name: `${companyName} Partners`,
          industry: industry || 'Business Services',
          description: `Similar business to ${companyName}`,
          headquarters: location || 'Unknown Location',
          employeeCount: '50-100 employees',
          revenue: '$10M-$50M',
          website: 'www.example-partners.com',
          linkedinUrl: 'www.linkedin.com/company/example-partners',
          phone: '555-123-4567',
          email: 'info@example-partners.com',
          founded: '2000'
        },
        {
          name: `${companyName} Solutions`,
          industry: industry || 'Technology',
          description: `Technology solutions provider similar to ${companyName}`,
          headquarters: location || 'Tech City, CA',
          employeeCount: '50-100 employees',
          revenue: '$10M-$50M',
          website: 'www.example-solutions.com',
          linkedinUrl: 'www.linkedin.com/company/example-solutions',
          phone: '555-123-4567',
          email: 'info@example-solutions.com',
          founded: '2000'
        },
        {
          name: `${companyName} Group`,
          industry: industry || 'Consulting',
          description: `Consulting services similar to ${companyName}`,
          headquarters: location || 'Business District, NY',
          employeeCount: '50-100 employees',
          revenue: '$10M-$50M',
          website: 'www.example-group.com',
          linkedinUrl: 'www.linkedin.com/company/example-group',
          phone: '555-123-4567',
          email: 'info@example-group.com',
          founded: '2000'
        }
      ];
    }

    console.log(`Successfully generated ${companies.length} similar companies`);
    
    return {
      success: true,
      companies: companies
    };

  } catch (error) {
    console.error('Error in findSimilarCompanies:', error);
    
    // Return a helpful error message
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to find similar companies',
      companies: []
    };
  }
}); 