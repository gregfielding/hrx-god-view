import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Update contact schema
const UpdateContactFromRecruiterSchema = z.object({
  tenantId: z.string().min(1),
  crmContactId: z.string().min(1),
  contactUpdates: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    department: z.string().optional(),
    role: z.string().optional(),
    isPrimary: z.boolean().optional(),
    notes: z.string().optional(),
    // Additional fields that can be updated
  }).partial(),
  updatedBy: z.string().optional(),
});

/**
 * Updates canonical CRM contact from recruiter
 * Implements write-through editing to maintain data consistency
 */
export const updateContactFromRecruiter = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const { tenantId, crmContactId, contactUpdates, updatedBy } = UpdateContactFromRecruiterSchema.parse(request.data);

    console.log(`Updating CRM contact ${crmContactId} from recruiter in tenant ${tenantId}`);

    // Verify the CRM contact exists
    const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(crmContactId);
    const contactDoc = await contactRef.get();

    if (!contactDoc.exists) {
      throw new Error(`CRM contact ${crmContactId} not found`);
    }

    const existingData = contactDoc.data();
    if (!existingData) {
      throw new Error(`No data found for CRM contact ${crmContactId}`);
    }

    const now = Date.now();
    const userId = updatedBy || 'system';

    // Merge updates with existing data
    const updatedData: any = {
      ...existingData,
      ...contactUpdates,
      updatedAt: now,
      updatedBy: userId,
    };

    // Update search keywords if name or title changed
    if (contactUpdates.firstName || contactUpdates.lastName || contactUpdates.title) {
      const newKeywords = [
        contactUpdates.firstName?.toLowerCase() || existingData.firstName?.toLowerCase(),
        contactUpdates.lastName?.toLowerCase() || existingData.lastName?.toLowerCase(),
        contactUpdates.title?.toLowerCase() || existingData.title?.toLowerCase(),
        contactUpdates.department?.toLowerCase() || existingData.department?.toLowerCase(),
        contactUpdates.email?.toLowerCase() || existingData.email?.toLowerCase(),
      ].filter(Boolean) as string[];
      
      updatedData.searchKeywords = newKeywords;
    }

    // Handle primary contact logic
    if (contactUpdates.isPrimary === true) {
      // If this contact is being set as primary, unset other primary contacts for the same company
      if (existingData.companyId) {
        const otherPrimaryContacts = await db
          .collection('tenants').doc(tenantId).collection('crm_contacts')
          .where('companyId', '==', existingData.companyId)
          .where('isPrimary', '==', true)
          .get();

        const batch = db.batch();
        otherPrimaryContacts.docs.forEach(doc => {
          if (doc.id !== crmContactId) {
            batch.update(doc.ref, {
              isPrimary: false,
              updatedAt: now,
              updatedBy: userId,
            });
          }
        });
        await batch.commit();
      }
    }

    // Update the CRM contact
    await contactRef.update(updatedData);

    // Create an event to notify other systems of the update
    const updateEvent = {
      type: 'contact.updated',
      tenantId,
      entityType: 'crm_contact',
      entityId: crmContactId,
      source: 'recruiter',
      dedupeKey: `contact_update:${crmContactId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['contact', 'update', 'recruiter', crmContactId],
      payload: {
        updatedFields: Object.keys(contactUpdates),
        previousData: existingData,
        newData: updatedData,
        companyId: existingData.companyId,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(updateEvent);

    console.log(`Successfully updated CRM contact ${crmContactId} from recruiter`);

    return {
      success: true,
      action: 'updated',
      crmContactId,
      tenantId,
      updatedFields: Object.keys(contactUpdates),
      data: updatedData
    };

  } catch (error) {
    console.error('Error updating contact from recruiter:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
