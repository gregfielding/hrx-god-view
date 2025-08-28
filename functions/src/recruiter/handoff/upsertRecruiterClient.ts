import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Recruiter Client upsert schema
const UpsertRecruiterClientSchema = z.object({
  tenantId: z.string().min(1),
  crmCompanyId: z.string().min(1), // Uses CRM company ID as document ID
  clientData: z.object({
    clientTier: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(),
    fulfillmentSLA: z.object({
      days: z.number().int().min(1).max(365)
    }).optional(),
    submittalSLA: z.object({
      hours: z.number().int().min(1).max(168)
    }).optional(),
    preferredChannels: z.array(z.enum(['email', 'sms', 'app', 'phone'])).optional(),
    safetyRequirements: z.array(z.string()).optional(),
    onboardingPacketId: z.string().optional(),
    docTemplates: z.array(z.string()).optional(), // I-9, W-4, NDA, etc.
    eeoTracking: z.boolean().optional(),
    // Additional recruiter-specific fields
  }).partial(),
  createdBy: z.string().optional(),
});

/**
 * Creates/updates recruiter client extension
 * Uses CRM company ID as document ID to maintain canonical reference
 */
export const upsertRecruiterClient = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, crmCompanyId, clientData, createdBy } = UpsertRecruiterClientSchema.parse(request.data);

    console.log(`Upserting recruiter client for CRM company ${crmCompanyId} in tenant ${tenantId}`);

    // First, verify the CRM company exists
    const crmCompanyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(crmCompanyId);
    const crmCompanyDoc = await crmCompanyRef.get();

    if (!crmCompanyDoc.exists) {
      throw new Error(`CRM company ${crmCompanyId} not found. Cannot create recruiter client extension.`);
    }

    const crmCompanyData = crmCompanyDoc.data();
    if (!crmCompanyData) {
      throw new Error(`No data found for CRM company ${crmCompanyId}`);
    }

    // Create/update recruiter client extension
    const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(crmCompanyId);
    const recruiterClientDoc = await recruiterClientRef.get();

    const now = Date.now();
    const userId = createdBy || 'system';

    if (recruiterClientDoc.exists) {
      // Update existing recruiter client
      const existingData = recruiterClientDoc.data();
      if (!existingData) {
        throw new Error(`No data found for existing recruiter client ${crmCompanyId}`);
      }

      // Merge new data with existing data, preserving existing fields
      const updatedData = {
        ...existingData,
        ...clientData,
        updatedAt: now,
        updatedBy: userId,
      };

      await recruiterClientRef.update(updatedData);

      console.log(`Updated existing recruiter client ${crmCompanyId}`);
      return {
        success: true,
        action: 'updated',
        crmCompanyId,
        tenantId,
        data: updatedData
      };
    } else {
      // Create new recruiter client
      const newClientData = {
        ...clientData,
        crmCompanyId, // Reference to canonical CRM company
        tenantId,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
        status: 'active',
        // Set default values for required fields
        clientTier: clientData.clientTier || 'bronze',
        fulfillmentSLA: clientData.fulfillmentSLA || { days: 30 },
        submittalSLA: clientData.submittalSLA || { hours: 24 },
        preferredChannels: clientData.preferredChannels || ['email'],
        safetyRequirements: clientData.safetyRequirements || [],
        docTemplates: clientData.docTemplates || ['I-9', 'W-4'],
        eeoTracking: clientData.eeoTracking ?? true,
        // Initialize empty arrays for tracking
        jobOrderIds: [],
        placementIds: [],
        worksiteIds: [],
        // Metrics
        totalJobOrders: 0,
        activeJobOrders: 0,
        totalPlacements: 0,
        activePlacements: 0,
        totalRevenue: 0,
        satisfactionScore: 0,
      };

      await recruiterClientRef.set(newClientData);

      console.log(`Created new recruiter client ${crmCompanyId}`);
      return {
        success: true,
        action: 'created',
        crmCompanyId,
        tenantId,
        data: newClientData
      };
    }

  } catch (error) {
    console.error('Error upserting recruiter client:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
