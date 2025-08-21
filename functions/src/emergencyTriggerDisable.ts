import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';

// EMERGENCY: Disabled triggers to prevent cascading updates and runaway costs
// These triggers will be re-enabled once the cost issue is resolved

// Disabled: Agency triggers
export const logAgencyCreated = onDocumentCreated('agencies/{agencyId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyUpdated = onDocumentUpdated('agencies/{agencyId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency updated trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency contact triggers
export const logAgencyContactCreated = onDocumentCreated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency contact created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyContactUpdated = onDocumentUpdated('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency contact updated trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyContactDeleted = onDocumentDeleted('agencies/{agencyId}/contacts/{contactId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency contact deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency location triggers
export const logAgencyLocationCreated = onDocumentCreated('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency location created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyLocationUpdated = onDocumentUpdated('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency location updated trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyLocationDeleted = onDocumentDeleted('agencies/{agencyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency location deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency AI settings triggers
export const logAgencyAISettingsUpdated = onDocumentUpdated('agencies/{agencyId}/aiSettings/{settingName}', async (event) => {
  console.log('🚫 EMERGENCY: Agency AI settings updated trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency user group triggers
export const logAgencyUserGroupCreated = onDocumentCreated('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency user group created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyUserGroupUpdated = onDocumentUpdated('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency user group updated trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyUserGroupDeleted = onDocumentDeleted('agencies/{agencyId}/userGroups/{groupId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency user group deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency settings triggers
export const logAgencySettingsUpdated = onDocumentUpdated('agencies/{agencyId}/settings/{settingsId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency settings updated trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency job order triggers
export const logAgencyJobOrderCreated = onDocumentCreated('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyJobOrderUpdated = onDocumentUpdated('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order updated trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyJobOrderDeleted = onDocumentDeleted('agencies/{agencyId}/jobOrders/{jobOrderId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Agency job order shift triggers
export const logAgencyJobOrderShiftCreated = onDocumentCreated('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order shift created trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyJobOrderShiftUpdated = onDocumentUpdated('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order shift updated trigger disabled to prevent cascading updates');
  return;
});

export const logAgencyJobOrderShiftDeleted = onDocumentDeleted('agencies/{agencyId}/jobOrders/{jobOrderId}/shifts/{shiftId}', async (event) => {
  console.log('🚫 EMERGENCY: Agency job order shift deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Customer triggers
export const logCustomerCreated = onDocumentCreated('customers/{customerId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer created trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerUpdated = onDocumentUpdated('customers/{customerId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer updated trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Customer location triggers
export const logCustomerLocationCreated = onDocumentCreated('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer location created trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerLocationUpdated = onDocumentUpdated('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer location updated trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerLocationDeleted = onDocumentDeleted('customers/{customerId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer location deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Customer department triggers
export const logCustomerDepartmentCreated = onDocumentCreated('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer department created trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerDepartmentUpdated = onDocumentUpdated('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer department updated trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerDepartmentDeleted = onDocumentDeleted('customers/{customerId}/departments/{departmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer department deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Customer AI settings triggers
export const logCustomerAISettingsUpdated = onDocumentUpdated('customers/{customerId}/aiSettings/{settingName}', async (event) => {
  console.log('🚫 EMERGENCY: Customer AI settings updated trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Customer AI training triggers
export const logCustomerAITrainingCreated = onDocumentCreated('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer AI training created trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerAITrainingUpdated = onDocumentUpdated('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer AI training updated trigger disabled to prevent cascading updates');
  return;
});

export const logCustomerAITrainingDeleted = onDocumentDeleted('customers/{customerId}/aiTraining/{trainingId}', async (event) => {
  console.log('🚫 EMERGENCY: Customer AI training deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Assignment triggers
export const logAssignmentCreated = onDocumentCreated('assignments/{assignmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Assignment created trigger disabled to prevent cascading updates');
  return;
});

export const logAssignmentUpdated = onDocumentUpdated('assignments/{assignmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Assignment updated trigger disabled to prevent cascading updates');
  return;
});

export const logAssignmentDeleted = onDocumentDeleted('assignments/{assignmentId}', async (event) => {
  console.log('🚫 EMERGENCY: Assignment deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Active salespeople triggers (known infinite loops)
export const updateActiveSalespeopleOnDeal = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  console.log('🚫 EMERGENCY: Active salespeople on deal trigger disabled to prevent infinite loops');
  return;
});

export const updateActiveSalespeopleOnTask = onDocumentUpdated('tenants/{tenantId}/tasks/{taskId}', async (event) => {
  console.log('🚫 EMERGENCY: Active salespeople on task trigger disabled to prevent infinite loops');
  return;
});

// Disabled: Location mirror triggers
export const onCompanyLocationCreated = onDocumentCreated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Company location created trigger disabled to prevent cascading updates');
  return;
});

export const onCompanyLocationUpdated = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Company location updated trigger disabled to prevent cascading updates');
  return;
});

export const onCompanyLocationDeleted = onDocumentDeleted('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Company location deleted trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Apollo integration triggers
export const onCompanyCreatedApollo = onDocumentCreated({ document: 'tenants/{tenantId}/crm_companies/{companyId}', secrets: ['APOLLO_API_KEY'] }, async (event) => {
  console.log('🚫 EMERGENCY: Company created Apollo trigger disabled to prevent cascading updates');
  return;
});

export const onContactCreatedApollo = onDocumentCreated({ document: 'tenants/{tenantId}/crm_contacts/{contactId}', secrets: ['APOLLO_API_KEY'] }, async (event) => {
  console.log('🚫 EMERGENCY: Contact created Apollo trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Company enrichment triggers
export const enrichCompanyOnCreate = onDocumentCreated({ document: 'tenants/{tenantId}/crm_companies/{companyId}', secrets: ['APOLLO_API_KEY'] }, async (event) => {
  console.log('🚫 EMERGENCY: Company enrichment on create trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Deal triggers
export const onDealUpdated = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  console.log('🚫 EMERGENCY: Deal updated trigger disabled to prevent cascading updates');
  return;
});

// Disabled: AI log processing triggers
export const processAILog = onDocumentCreated('ai_logs/{logId}', async (event) => {
  console.log('🚫 EMERGENCY: AI log processing trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Apollo location sync triggers
export const syncApolloHeadquartersLocation = onDocumentUpdated({
  document: 'tenants/{tenantId}/crm_companies/{companyId}',
  secrets: ['APOLLO_API_KEY']
}, async (event) => {
  console.log('🚫 EMERGENCY: Apollo headquarters location sync trigger disabled to prevent cascading updates');
  return;
});

// Disabled: Association snapshot fanout triggers
export const firestoreCompanySnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}', async (event) => {
  console.log('🚫 EMERGENCY: Company snapshot fanout trigger disabled to prevent cascading updates');
  return;
});

export const firestoreContactSnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_contacts/{contactId}', async (event) => {
  console.log('🚫 EMERGENCY: Contact snapshot fanout trigger disabled to prevent cascading updates');
  return;
});

export const firestoreLocationSnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_locations/{locationId}', async (event) => {
  console.log('🚫 EMERGENCY: Location snapshot fanout trigger disabled to prevent cascading updates');
  return;
});

export const firestoreSalespersonSnapshotFanout = onDocumentUpdated('tenants/{tenantId}/crm_salespeople/{salespersonId}', async (event) => {
  console.log('🚫 EMERGENCY: Salesperson snapshot fanout trigger disabled to prevent cascading updates');
  return;
});

// Disabled: AI summary update triggers
export const triggerAISummaryUpdate = onDocumentCreated('tenants/{tenantId}/crm_deals/{dealId}/ai_summaries/{summaryId}', async (event) => {
  console.log('🚫 EMERGENCY: AI summary update trigger disabled to prevent cascading updates');
  return;
});
