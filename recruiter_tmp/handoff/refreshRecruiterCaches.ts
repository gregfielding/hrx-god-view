import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Cache refresh schema
const RefreshRecruiterCachesSchema = z.object({
  tenantId: z.string().min(1),
  entityType: z.enum(['company', 'contact', 'deal']).optional(),
  entityId: z.string().optional(),
  forceRefresh: z.boolean().optional(),
  updatedBy: z.string().optional(),
});

/**
 * Refreshes recruiter caches after CRM updates
 * Ensures recruiter views stay in sync with canonical CRM data
 */
export const refreshRecruiterCaches = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, entityType, entityId, forceRefresh, updatedBy } = RefreshRecruiterCachesSchema.parse(request.data);

    console.log(`Refreshing recruiter caches for tenant ${tenantId}${entityType ? `, entity: ${entityType}/${entityId}` : ''}`);

    const now = Date.now();
    const userId = updatedBy || 'system';
    const refreshResults = {
      companiesRefreshed: 0,
      contactsRefreshed: 0,
      dealsRefreshed: 0,
      errors: [] as string[],
    };

    // Refresh company caches
    if (!entityType || entityType === 'company') {
      try {
        const companiesRefreshed = await refreshCompanyCaches(tenantId, entityId, now, userId);
        refreshResults.companiesRefreshed = companiesRefreshed;
      } catch (error) {
        const errorMsg = `Error refreshing company caches: ${error instanceof Error ? error.message : 'Unknown error'}`;
        refreshResults.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Refresh contact caches
    if (!entityType || entityType === 'contact') {
      try {
        const contactsRefreshed = await refreshContactCaches(tenantId, entityId, now, userId);
        refreshResults.contactsRefreshed = contactsRefreshed;
      } catch (error) {
        const errorMsg = `Error refreshing contact caches: ${error instanceof Error ? error.message : 'Unknown error'}`;
        refreshResults.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Refresh deal caches
    if (!entityType || entityType === 'deal') {
      try {
        const dealsRefreshed = await refreshDealCaches(tenantId, entityId, now, userId);
        refreshResults.dealsRefreshed = dealsRefreshed;
      } catch (error) {
        const errorMsg = `Error refreshing deal caches: ${error instanceof Error ? error.message : 'Unknown error'}`;
        refreshResults.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Create cache refresh event
    const refreshEvent = {
      type: 'cache.refreshed',
      tenantId,
      entityType: entityType || 'all',
      entityId: entityId || 'all',
      source: 'recruiter',
      dedupeKey: `cache_refresh:${tenantId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['cache', 'refresh', 'recruiter', tenantId],
      payload: {
        refreshResults,
        entityType,
        entityId,
        forceRefresh,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(refreshEvent);

    console.log(`Cache refresh completed for tenant ${tenantId}:`, refreshResults);

    return {
      success: true,
      refreshResults,
      tenantId,
      entityType,
      entityId,
    };

  } catch (error) {
    console.error('Error refreshing recruiter caches:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Refresh company caches
 */
async function refreshCompanyCaches(tenantId: string, companyId?: string, timestamp?: number, userId?: string): Promise<number> {
  const now = timestamp || Date.now();
  const user = userId || 'system';
  let refreshedCount = 0;

  if (companyId) {
    // Refresh specific company
    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId);
    const companyDoc = await companyRef.get();

    if (companyDoc.exists) {
      const companyData = companyDoc.data();
      if (companyData) {
        // Update recruiter client cache if it exists
        const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(companyId);
        const recruiterClientDoc = await recruiterClientRef.get();

        if (recruiterClientDoc.exists) {
          const recruiterClientData = recruiterClientDoc.data();
          if (recruiterClientData) {
            // Update cache with latest company data
            await recruiterClientRef.update({
              companyCache: {
                name: companyData.name,
                website: companyData.website,
                industry: companyData.industry,
                address: companyData.address,
                city: companyData.city,
                state: companyData.state,
                phone: companyData.phone,
                email: companyData.email,
                billingEmail: companyData.billingEmail,
                billingAddress: companyData.billingAddress,
                paymentTerms: companyData.paymentTerms,
                taxId: companyData.taxId,
                lastCached: now,
              },
              updatedAt: now,
              updatedBy: user,
            });
            refreshedCount++;
          }
        }
      }
    }
  } else {
    // Refresh all companies
    const companiesSnapshot = await db
      .collection('tenants').doc(tenantId).collection('crm_companies')
      .get();

    const batch = db.batch();
    for (const doc of companiesSnapshot.docs) {
      const companyData = doc.data();
      const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(doc.id);
      const recruiterClientDoc = await recruiterClientRef.get();

      if (recruiterClientDoc.exists) {
        batch.update(recruiterClientRef, {
          companyCache: {
            name: companyData.name,
            website: companyData.website,
            industry: companyData.industry,
            address: companyData.address,
            city: companyData.city,
            state: companyData.state,
            phone: companyData.phone,
            email: companyData.email,
            billingEmail: companyData.billingEmail,
            billingAddress: companyData.billingAddress,
            paymentTerms: companyData.paymentTerms,
            taxId: companyData.taxId,
            lastCached: now,
          },
          updatedAt: now,
          updatedBy: user,
        });
        refreshedCount++;
      }
    }

    if (refreshedCount > 0) {
      await batch.commit();
    }
  }

  return refreshedCount;
}

/**
 * Refresh contact caches
 */
async function refreshContactCaches(tenantId: string, contactId?: string, timestamp?: number, userId?: string): Promise<number> {
  const now = timestamp || Date.now();
  const user = userId || 'system';
  let refreshedCount = 0;

  if (contactId) {
    // Refresh specific contact
    const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
    const contactDoc = await contactRef.get();

    if (contactDoc.exists) {
      const contactData = contactDoc.data();
      if (contactData && contactData.companyId) {
        // Update recruiter client contact cache
        const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(contactData.companyId);
        const recruiterClientDoc = await recruiterClientRef.get();

        if (recruiterClientDoc.exists) {
          const recruiterClientData = recruiterClientDoc.data();
          if (recruiterClientData) {
            // Update contact cache
            const contactCache = recruiterClientData.contactCache || {};
            contactCache[contactId] = {
              firstName: contactData.firstName,
              lastName: contactData.lastName,
              email: contactData.email,
              phone: contactData.phone,
              title: contactData.title,
              department: contactData.department,
              role: contactData.role,
              isPrimary: contactData.isPrimary,
              lastCached: now,
            };

            await recruiterClientRef.update({
              contactCache,
              updatedAt: now,
              updatedBy: user,
            });
            refreshedCount++;
          }
        }
      }
    }
  } else {
    // Refresh all contacts
    const contactsSnapshot = await db
      .collection('tenants').doc(tenantId).collection('crm_contacts')
      .get();

    // Group contacts by company
    const contactsByCompany: { [companyId: string]: any[] } = {};
    contactsSnapshot.docs.forEach(doc => {
      const contactData = doc.data();
      if (contactData.companyId) {
        if (!contactsByCompany[contactData.companyId]) {
          contactsByCompany[contactData.companyId] = [];
        }
        contactsByCompany[contactData.companyId].push({
          id: doc.id,
          ...contactData,
        });
      }
    });

    // Update each company's contact cache
    const batch = db.batch();
    for (const [companyId, contacts] of Object.entries(contactsByCompany)) {
      const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(companyId);
      const recruiterClientDoc = await recruiterClientRef.get();

      if (recruiterClientDoc.exists) {
        const contactCache: { [contactId: string]: any } = {};
        contacts.forEach(contact => {
          contactCache[contact.id] = {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            title: contact.title,
            department: contact.department,
            role: contact.role,
            isPrimary: contact.isPrimary,
            lastCached: now,
          };
        });

        batch.update(recruiterClientRef, {
          contactCache,
          updatedAt: now,
          updatedBy: user,
        });
        refreshedCount++;
      }
    }

    if (refreshedCount > 0) {
      await batch.commit();
    }
  }

  return refreshedCount;
}

/**
 * Refresh deal caches
 */
async function refreshDealCaches(tenantId: string, dealId?: string, timestamp?: number, userId?: string): Promise<number> {
  const now = timestamp || Date.now();
  const user = userId || 'system';
  let refreshedCount = 0;

  if (dealId) {
    // Refresh specific deal
    const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
    const dealDoc = await dealRef.get();

    if (dealDoc.exists) {
      const dealData = dealDoc.data();
      if (dealData && dealData.companyId) {
        // Update recruiter client deal cache
        const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(dealData.companyId);
        const recruiterClientDoc = await recruiterClientRef.get();

        if (recruiterClientDoc.exists) {
          const recruiterClientData = recruiterClientDoc.data();
          if (recruiterClientData) {
            // Update deal cache
            const dealCache = recruiterClientData.dealCache || {};
            dealCache[dealId] = {
              name: dealData.name,
              stage: dealData.stage,
              amount: dealData.amount,
              closeDate: dealData.closeDate,
              ownerId: dealData.ownerId,
              readyForRecruiter: dealData.readyForRecruiter,
              lastCached: now,
            };

            await recruiterClientRef.update({
              dealCache,
              updatedAt: now,
              updatedBy: user,
            });
            refreshedCount++;
          }
        }
      }
    }
  } else {
    // Refresh all deals
    const dealsSnapshot = await db
      .collection('tenants').doc(tenantId).collection('crm_deals')
      .get();

    // Group deals by company
    const dealsByCompany: { [companyId: string]: any[] } = {};
    dealsSnapshot.docs.forEach(doc => {
      const dealData = doc.data();
      if (dealData.companyId) {
        if (!dealsByCompany[dealData.companyId]) {
          dealsByCompany[dealData.companyId] = [];
        }
        dealsByCompany[dealData.companyId].push({
          id: doc.id,
          ...dealData,
        });
      }
    });

    // Update each company's deal cache
    const batch = db.batch();
    for (const [companyId, deals] of Object.entries(dealsByCompany)) {
      const recruiterClientRef = db.collection('tenants').doc(tenantId).collection('recruiter_clients').doc(companyId);
      const recruiterClientDoc = await recruiterClientRef.get();

      if (recruiterClientDoc.exists) {
        const dealCache: { [dealId: string]: any } = {};
        deals.forEach(deal => {
          dealCache[deal.id] = {
            name: deal.name,
            stage: deal.stage,
            amount: deal.amount,
            closeDate: deal.closeDate,
            ownerId: deal.ownerId,
            readyForRecruiter: deal.readyForRecruiter,
            lastCached: now,
          };
        });

        batch.update(recruiterClientRef, {
          dealCache,
          updatedAt: now,
          updatedBy: user,
        });
        refreshedCount++;
      }
    }

    if (refreshedCount > 0) {
      await batch.commit();
    }
  }

  return refreshedCount;
}
