import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// CRM Company upsert schema
const UpsertCrmCompanySchema = z.object({
  tenantId: z.string().min(1),
  companyId: z.string().min(1),
  companyData: z.object({
    name: z.string().min(1),
    website: z.string().optional(),
    industry: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    billingEmail: z.string().optional(),
    billingAddress: z.string().optional(),
    paymentTerms: z.string().optional(),
    taxId: z.string().optional(),
    // Additional fields as needed
  }).partial(),
  createdBy: z.string().optional(),
});

/**
 * Ensures CRM company exists and is complete
 * Creates or updates company in CRM collection
 */
export const upsertCrmCompany = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, companyId, companyData, createdBy } = UpsertCrmCompanySchema.parse(request.data);

    console.log(`Upserting CRM company ${companyId} in tenant ${tenantId}`);

    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId);
    const companyDoc = await companyRef.get();

    const now = Date.now();
    const userId = createdBy || 'system';

    if (companyDoc.exists) {
      // Update existing company
      const existingData = companyDoc.data();
      if (!existingData) {
        throw new Error(`No data found for existing company ${companyId}`);
      }

      // Merge new data with existing data, preserving existing fields
      const updatedData = {
        ...existingData,
        ...companyData,
        updatedAt: now,
        updatedBy: userId,
      };

      await companyRef.update(updatedData);

      console.log(`Updated existing CRM company ${companyId}`);
      return {
        success: true,
        action: 'updated',
        companyId,
        tenantId,
        data: updatedData
      };
    } else {
      // Create new company
      const newCompanyData = {
        ...companyData,
        id: companyId,
        tenantId,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
        status: 'active',
        // Set default values for required fields
        name: companyData.name || 'Unknown Company',
        searchKeywords: [
          companyData.name?.toLowerCase(),
          companyData.website?.toLowerCase(),
          companyData.industry?.toLowerCase()
        ].filter(Boolean) as string[],
      };

      await companyRef.set(newCompanyData);

      console.log(`Created new CRM company ${companyId}`);
      return {
        success: true,
        action: 'created',
        companyId,
        tenantId,
        data: newCompanyData
      };
    }

  } catch (error) {
    console.error('Error upserting CRM company:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
