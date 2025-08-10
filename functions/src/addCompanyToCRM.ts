import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

interface AddCompanyToCRMData {
  companyData: {
    companyName: string;
    industry?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    website?: string;
    linkedinUrl?: string;
    phone?: string;
    email?: string;
    description?: string;
    employeeCount?: string;
    revenue?: string;
    founded?: string;
    headquarters?: string;
    subsidiaries?: string[];
    competitors?: string[];
    technologies?: string[];
    socialMedia?: {
      facebook?: string;
      twitter?: string;
      instagram?: string;
    };
    news?: string[];
    logo?: string;
  };
  tenantId: string;
  salespersonId: string;
}

export const addCompanyToCRM = onCall<AddCompanyToCRMData>(async (request) => {
  try {
    const { companyData, tenantId, salespersonId } = request.data;

    if (!companyData.companyName) {
      throw new Error('Company name is required');
    }

    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    if (!salespersonId) {
      throw new Error('Salesperson ID is required');
    }

    // Check if company already exists
    const companiesRef = db.collection(`tenants/${tenantId}/crm_companies`);
    const existingCompanyQuery = await companiesRef
      .where('companyName', '==', companyData.companyName)
      .limit(1)
      .get();

    if (!existingCompanyQuery.empty) {
      throw new Error(`Company "${companyData.companyName}" already exists in CRM`);
    }

    // Create the company document
    const companyDoc = {
      companyName: companyData.companyName,
      name: companyData.companyName, // For backward compatibility
      industry: companyData.industry || '',
      address: companyData.address || '',
      city: companyData.city || '',
      state: companyData.state || '',
      zip: companyData.zip || '',
      website: companyData.website || '',
      linkedinUrl: companyData.linkedinUrl || '',
      phone: companyData.phone || '',
      email: companyData.email || '',
      description: companyData.description || '',
      employeeCount: companyData.employeeCount || '',
      revenue: companyData.revenue || '',
      founded: companyData.founded || '',
      headquarters: companyData.headquarters || '',
      subsidiaries: companyData.subsidiaries || [],
      competitors: companyData.competitors || [],
      technologies: companyData.technologies || [],
      socialMedia: companyData.socialMedia || {},
      news: companyData.news || [],
      logo: companyData.logo || '',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      // Add the salesperson as an associated salesperson
      associations: {
        salespeople: [salespersonId]
      },
      // Add source information
      source: 'AI Similar Companies',
      addedBy: salespersonId,
      addedAt: new Date()
    };

    // Add the company to Firestore
    const newCompanyRef = await companiesRef.add(companyDoc);
    const newCompanyId = newCompanyRef.id;

    // Update the company document with its ID
    await newCompanyRef.update({
      id: newCompanyId
    });

    // Log the action
    console.log(`Company "${companyData.companyName}" added to CRM by salesperson ${salespersonId}`);

    return {
      success: true,
      companyId: newCompanyId,
      message: `Successfully added ${companyData.companyName} to CRM`
    };

  } catch (error) {
    console.error('Error in addCompanyToCRM:', error);
    throw new Error(`Failed to add company to CRM: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}); 