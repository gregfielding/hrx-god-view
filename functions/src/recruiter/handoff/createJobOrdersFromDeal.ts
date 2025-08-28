import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Job Order creation schema
const CreateJobOrdersFromDealSchema = z.object({
  tenantId: z.string().min(1),
  dealId: z.string().min(1),
  crmCompanyId: z.string().min(1),
  jobOrders: z.array(z.object({
    title: z.string().min(1),
    roleCategory: z.string().optional(),
    openings: z.number().int().min(1),
    startDate: z.string(), // ISO date string
    endDate: z.string().optional(), // ISO date string
    location: z.string().optional(),
    payRate: z.number().positive().optional(),
    billRate: z.number().positive().optional(),
    markup: z.number().positive().optional(),
    shifts: z.array(z.object({
      label: z.string(),
      start: z.string(), // HH:mm format
      end: z.string(), // HH:mm format
      days: z.array(z.number()) // 0-6 for Sunday-Saturday
    })).optional(),
    backgroundCheck: z.object({
      required: z.boolean(),
      pkg: z.string().optional()
    }).optional(),
    drugTest: z.object({
      required: z.boolean(),
      panel: z.string().optional()
    }).optional(),
    certifications: z.array(z.string()).optional(),
    language: z.array(z.string()).optional(),
    minExperience: z.number().optional(),
    notes: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    targetFillDate: z.string().optional(), // ISO date string
    autoPostToJobsBoard: z.boolean().optional(),
    submittalLimit: z.number().int().min(1).optional(),
    internalOnly: z.boolean().optional(),
  })),
  recruiterOwnerId: z.string().optional(),
  createdBy: z.string().optional(),
});

/**
 * Creates job orders from deal information
 * Supports multiple job orders per deal (multi-role opportunities)
 */
export const createJobOrdersFromDeal = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, dealId, crmCompanyId, jobOrders, recruiterOwnerId, createdBy } = CreateJobOrdersFromDealSchema.parse(request.data);

    console.log(`Creating ${jobOrders.length} job orders from deal ${dealId} for company ${crmCompanyId}`);

    // Verify the deal exists
    const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
    const dealDoc = await dealRef.get();

    if (!dealDoc.exists) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const dealData = dealDoc.data();
    if (!dealData) {
      throw new Error(`No data found for deal ${dealId}`);
    }

    // Verify the CRM company exists
    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(crmCompanyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
      throw new Error(`CRM company ${crmCompanyId} not found`);
    }

    const now = Date.now();
    const userId = createdBy || 'system';
    const createdJobOrders = [];

    // Create job orders in a batch
    const batch = db.batch();

    for (const jobOrderData of jobOrders) {
      const jobOrderId = db.collection('tenants').doc(tenantId).collection('recruiter_jobOrders').doc().id;
      const jobOrderRef = db.collection('tenants').doc(tenantId).collection('recruiter_jobOrders').doc(jobOrderId);

      const newJobOrder = {
        id: jobOrderId,
        tenantId,
        crmCompanyId, // Reference to canonical CRM company
        crmDealId: dealId, // Reference to source deal
        title: jobOrderData.title,
        roleCategory: jobOrderData.roleCategory || 'general',
        openings: jobOrderData.openings,
        remainingOpenings: jobOrderData.openings, // Initially equal to total openings
        startDate: jobOrderData.startDate,
        endDate: jobOrderData.endDate,
        location: jobOrderData.location || dealData.location || '',
        payRate: jobOrderData.payRate || 0,
        billRate: jobOrderData.billRate || 0,
        markup: jobOrderData.markup || 0,
        shifts: jobOrderData.shifts || [],
        backgroundCheck: jobOrderData.backgroundCheck || { required: false },
        drugTest: jobOrderData.drugTest || { required: false },
        certifications: jobOrderData.certifications || [],
        language: jobOrderData.language || [],
        minExperience: jobOrderData.minExperience || 0,
        notes: jobOrderData.notes || '',
        priority: jobOrderData.priority || 'medium',
        urgencyScore: 50, // Default score, can be calculated based on priority and timeline
        targetFillDate: jobOrderData.targetFillDate,
        recruiterOwnerId: recruiterOwnerId || dealData.ownerId || '',
        teamIds: [],
        autoPostToJobsBoard: jobOrderData.autoPostToJobsBoard || false,
        submittalLimit: jobOrderData.submittalLimit || 5,
        maxVendors: 1, // Default to single vendor
        internalOnly: jobOrderData.internalOnly || false,
        allowOverfill: false,
        // Metrics (initialize to zero)
        metrics: {
          submittals: 0,
          interviews: 0,
          offers: 0,
          placements: 0,
          timeToFirstSubmittalHrs: null,
          timeToFillDays: null,
          jobAgingDays: 0,
        },
        status: 'open',
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
        // Search keywords for efficient querying
        searchKeywords: [
          jobOrderData.title.toLowerCase(),
          jobOrderData.roleCategory?.toLowerCase(),
          jobOrderData.location?.toLowerCase(),
          ...(jobOrderData.certifications || []).map(cert => cert.toLowerCase()),
          ...(jobOrderData.language || []).map(lang => lang.toLowerCase()),
        ].filter(Boolean) as string[],
      };

      batch.set(jobOrderRef, newJobOrder);
      createdJobOrders.push(newJobOrder);

      console.log(`Prepared job order ${jobOrderId}: ${jobOrderData.title}`);
    }

    // Commit the batch
    await batch.commit();

    // Update the recruiter client with new job order IDs
    const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(crmCompanyId);
    const recruiterClientDoc = await recruiterClientRef.get();

    if (recruiterClientDoc.exists) {
      const clientData = recruiterClientDoc.data();
      if (clientData) {
        const newJobOrderIds = createdJobOrders.map(jo => jo.id);
        await recruiterClientRef.update({
          jobOrderIds: [...(clientData.jobOrderIds || []), ...newJobOrderIds],
          totalJobOrders: (clientData.totalJobOrders || 0) + createdJobOrders.length,
          activeJobOrders: (clientData.activeJobOrders || 0) + createdJobOrders.length,
          updatedAt: now,
          updatedBy: userId,
        });
      }
    }

    console.log(`Successfully created ${createdJobOrders.length} job orders from deal ${dealId}`);

    return {
      success: true,
      jobOrdersCreated: createdJobOrders.length,
      jobOrderIds: createdJobOrders.map(jo => jo.id),
      dealId,
      crmCompanyId,
      tenantId
    };

  } catch (error) {
    console.error('Error creating job orders from deal:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
