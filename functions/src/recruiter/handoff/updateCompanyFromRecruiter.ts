import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Update company schema
const UpdateCompanyFromRecruiterSchema = z.object({
  tenantId: z.string().min(1),
  crmCompanyId: z.string().min(1),
  companyUpdates: z.object({
    name: z.string().optional(),
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
    // Additional fields that can be updated
  }).partial(),
  updatedBy: z.string().optional(),
});

/**
 * Updates canonical CRM company from recruiter
 * Implements write-through editing to maintain data consistency
 */
export const updateCompanyFromRecruiter = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const { tenantId, crmCompanyId, companyUpdates, updatedBy } = UpdateCompanyFromRecruiterSchema.parse(request.data);

    console.log(`Updating CRM company ${crmCompanyId} from recruiter in tenant ${tenantId}`);

    // Verify the CRM company exists
    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(crmCompanyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
      throw new Error(`CRM company ${crmCompanyId} not found`);
    }

    const existingData = companyDoc.data();
    if (!existingData) {
      throw new Error(`No data found for CRM company ${crmCompanyId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';

    // Merge updates with existing data
    const updatedData: any = {
      ...existingData,
      ...companyUpdates,
      updatedAt: now,
      updatedBy: userId,
    };

    // Update search keywords if name or industry changed
    if (companyUpdates.name || companyUpdates.industry) {
      const newKeywords = [
        companyUpdates.name?.toLowerCase() || existingData.name?.toLowerCase(),
        companyUpdates.website?.toLowerCase() || existingData.website?.toLowerCase(),
        companyUpdates.industry?.toLowerCase() || existingData.industry?.toLowerCase(),
      ].filter(Boolean) as string[];
      
      updatedData.searchKeywords = newKeywords;
    }

    // Update the CRM company
    await companyRef.update(updatedData);

    // Create an event to notify other systems of the update
    const updateEvent = {
      type: 'company.updated',
      tenantId,
      entityType: 'crm_company',
      entityId: crmCompanyId,
      source: 'recruiter',
      dedupeKey: `company_update:${crmCompanyId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['company', 'update', 'recruiter', crmCompanyId],
      payload: {
        updatedFields: Object.keys(companyUpdates),
        previousData: existingData,
        newData: updatedData,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(updateEvent);

    console.log(`Successfully updated CRM company ${crmCompanyId} from recruiter`);

    return {
      success: true,
      action: 'updated',
      crmCompanyId,
      tenantId,
      updatedFields: Object.keys(companyUpdates),
      data: updatedData
    };

  } catch (error) {
    console.error('Error updating company from recruiter:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
