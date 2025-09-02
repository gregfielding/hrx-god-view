import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Guardrail validation schema
const GuardrailValidationSchema = z.object({
  tenantId: z.string().min(1),
  dealId: z.string().min(1),
});

// Guardrail result interface
interface HandoffGuardrails {
  msaAccepted: boolean;           // Master Service Agreement signed
  creditApproved: boolean;        // Credit check passed
  billingProfileComplete: boolean; // Billing information complete
  primaryContactSet: boolean;     // Primary contact assigned
  worksiteCaptured: boolean;      // Worksite information provided
  allRequirementsMet: boolean;    // All guardrails passed
  missingRequirements: string[];  // List of missing requirements
}

/**
 * Validates handoff guardrails for a CRM deal
 * Checks MSA, credit, billing, contacts, and worksite requirements
 */
export const validateHandoffGuardrails = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    // Validate input
    const { tenantId, dealId } = GuardrailValidationSchema.parse(request.data);

    console.log(`Validating handoff guardrails for deal ${dealId} in tenant ${tenantId}`);

    // Get the deal data
    const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
    const dealDoc = await dealRef.get();

    if (!dealDoc.exists) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const dealData = dealDoc.data();
    if (!dealData) {
      throw new Error(`No data found for deal ${dealId}`);
    }

    // Initialize guardrail checks
    const guardrails: HandoffGuardrails = {
      msaAccepted: false,
      creditApproved: false,
      billingProfileComplete: false,
      primaryContactSet: false,
      worksiteCaptured: false,
      allRequirementsMet: false,
      missingRequirements: []
    };

    // Check MSA acceptance
    guardrails.msaAccepted = dealData.msaAccepted === true || 
                            dealData.contractSigned === true ||
                            dealData.agreementStatus === 'signed';

    // Check credit approval
    guardrails.creditApproved = dealData.creditApproved === true || 
                               dealData.creditStatus === 'approved' ||
                               dealData.financialApproval === true;

    // Check billing profile completeness
    guardrails.billingProfileComplete = await checkBillingProfileComplete(tenantId, dealData.companyId);

    // Check primary contact assignment
    guardrails.primaryContactSet = await checkPrimaryContactSet(tenantId, dealData.companyId);

    // Check worksite information
    guardrails.worksiteCaptured = await checkWorksiteCaptured(tenantId, dealData.companyId);

    // Determine if all requirements are met
    guardrails.allRequirementsMet = guardrails.msaAccepted && 
                                   guardrails.creditApproved && 
                                   guardrails.billingProfileComplete && 
                                   guardrails.primaryContactSet && 
                                   guardrails.worksiteCaptured;

    // Build list of missing requirements
    if (!guardrails.msaAccepted) guardrails.missingRequirements.push('MSA not accepted');
    if (!guardrails.creditApproved) guardrails.missingRequirements.push('Credit not approved');
    if (!guardrails.billingProfileComplete) guardrails.missingRequirements.push('Billing profile incomplete');
    if (!guardrails.primaryContactSet) guardrails.missingRequirements.push('Primary contact not set');
    if (!guardrails.worksiteCaptured) guardrails.missingRequirements.push('Worksite information missing');

    console.log(`Guardrail validation complete for deal ${dealId}:`, {
      allRequirementsMet: guardrails.allRequirementsMet,
      missingRequirements: guardrails.missingRequirements
    });

    return {
      success: true,
      guardrails,
      dealId,
      tenantId
    };

  } catch (error) {
    console.error('Error validating handoff guardrails:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      guardrails: null
    };
  }
});

/**
 * Checks if billing profile is complete for a company
 */
async function checkBillingProfileComplete(tenantId: string, companyId: string): Promise<boolean> {
  try {
    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
      return false;
    }

    const companyData = companyDoc.data();
    if (!companyData) {
      return false;
    }

    // Check for required billing fields
    const hasBillingEmail = companyData.billingEmail || companyData.invoicingEmail;
    const hasBillingAddress = companyData.billingAddress || companyData.address;
    const hasPaymentTerms = companyData.paymentTerms || companyData.netTerms;
    const hasTaxId = companyData.taxId || companyData.ein;

    return !!(hasBillingEmail && hasBillingAddress && hasPaymentTerms && hasTaxId);
  } catch (error) {
    console.error('Error checking billing profile:', error);
    return false;
  }
}

/**
 * Checks if primary contact is set for a company
 */
async function checkPrimaryContactSet(tenantId: string, companyId: string): Promise<boolean> {
  try {
    // Check for primary contact in company contacts
    const contactsQuery = await db
      .collection('tenants').doc(tenantId).collection('crm_contacts')
      .where('companyId', '==', companyId)
      .where('isPrimary', '==', true)
      .limit(1)
      .get();

    if (!contactsQuery.empty) {
      return true;
    }

    // Alternative: check for any contacts with primary role
    const primaryContactsQuery = await db
      .collection('tenants').doc(tenantId).collection('crm_contacts')
      .where('companyId', '==', companyId)
      .where('role', 'in', ['primary', 'decision_maker', 'owner'])
      .limit(1)
      .get();

    return !primaryContactsQuery.empty;
  } catch (error) {
    console.error('Error checking primary contact:', error);
    return false;
  }
}

/**
 * Checks if worksite information is captured for a company
 */
async function checkWorksiteCaptured(tenantId: string, companyId: string): Promise<boolean> {
  try {
    // Check for worksite information in company data
    const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
      return false;
    }

    const companyData = companyDoc.data();
    if (!companyData) {
      return false;
    }

    // Check for worksite-related fields
    const hasAddress = companyData.address || companyData.worksiteAddress;
    const hasLocation = companyData.location || companyData.city;
    const hasWorksiteInfo = companyData.worksiteInfo || companyData.worksiteDetails;

    return !!(hasAddress && hasLocation) || !!hasWorksiteInfo;
  } catch (error) {
    console.error('Error checking worksite information:', error);
    return false;
  }
}
