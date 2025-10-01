// Phase 1 mapping: read current Deal shape and output flat Job Order fields.

type MappingResult = {
  flat: Record<string, any>;
  initialSnapshot: Record<string, any>;
};

export function mapDealToJobOrder(deal: any): MappingResult {
  const stageData = deal?.stageData || {};
  const discovery = stageData.discovery || {};
  const qualification = stageData.qualification || {};
  const scoping = stageData.scoping || {};

  // Company/location prefer top-level fields that exist in Deals
  const companyEntry = Array.isArray(deal.associations?.companies) && deal.associations.companies.length > 0
    ? deal.associations.companies[0]
    : null;
  const companyId = deal.companyId || (typeof companyEntry === 'string' ? companyEntry : (companyEntry?.id || ''));
  const companyName = deal.companyName || (typeof companyEntry === 'string' ? '' : (companyEntry?.snapshot?.companyName || companyEntry?.snapshot?.name || companyEntry?.name || ''));

  const locationEntry = Array.isArray(deal.associations?.locations) && deal.associations.locations.length > 0
    ? deal.associations.locations[0]
    : null;
  const worksiteId = typeof locationEntry === 'string' ? locationEntry : (locationEntry?.id || '');
  const worksiteName = typeof locationEntry === 'string' ? '' : (locationEntry?.snapshot?.nickname || locationEntry?.snapshot?.name || locationEntry?.nickname || locationEntry?.name || '');

  const jobTitles: string[] = discovery.jobTitles || [];
  const jobTitle = Array.isArray(jobTitles) && jobTitles.length > 0 ? jobTitles[0] : (deal.jobTitle || '');

  // Extract contact role IDs from scoping stage data
  const contactRoles = scoping.contactRoles || {};
  const hrContactId = contactRoles.hr?.id || '';
  const operationsContactId = contactRoles.operations?.id || '';
  const procurementContactId = contactRoles.procurement?.id || '';
  const billingContactId = contactRoles.billing?.id || '';
  const safetyContactId = contactRoles.safety?.id || '';
  const invoiceContactId = contactRoles.invoice?.id || '';
  
  // Extract decision maker from qualification stage data
  const decisionMaker = qualification.decisionMaker?.id || '';

  // Calculate billRate from payRate and markup
  const payRate = toNumberSafe(qualification.expectedAveragePayRate);
  const markup = toNumberSafe(qualification.expectedAverageMarkup);
  const billRate = payRate && markup ? payRate * (1 + markup / 100) : null;

  const flat: Record<string, any> = {
    jobTitle,
    startDate: toISODate(qualification.expectedStartDate) || null,
    payRate,
    markup,
    billRate,
    workersNeeded: toNumberSafe(qualification.staffPlacementTimeline?.starting),
    estimatedRevenue: toNumberSafe(deal.estimatedRevenue),
    notes: deal.notes || '',
    // Only include experienceLevel if it has a value
    ...(qualification.experienceLevel && { experienceLevel: qualification.experienceLevel }),
    priority: coerceSelect((deal as any).priority, ['low','medium','high'], 'low'),
    shiftType: coerceSelect((deal as any).shiftType, ['day','swing','night'], 'day'),
    companyId, companyName, worksiteId, worksiteName,
    // Contact role IDs
    hrContactId,
    decisionMaker,
    operationsContactId,
    procurementContactId,
    billingContactId,
    safetyContactId,
    invoiceContactId,
  };

  // Minimal snapshot: fields we consider "as-won" from the deal
  const initialSnapshot: Record<string, any> = {
    jobTitle,
    startDate: flat.startDate,
    payRate: flat.payRate,
    markup: flat.markup,
    billRate: flat.billRate,
    // Only include experienceLevel if it exists in flat
    ...(flat.experienceLevel && { experienceLevel: flat.experienceLevel }),
    // Contact role IDs
    hrContactId,
    decisionMaker,
    operationsContactId,
    procurementContactId,
    billingContactId,
    safetyContactId,
    invoiceContactId,
  };

  return { flat, initialSnapshot };
}

// Helpers (Phase 2 defensive normalization)
export function toNumberSafe(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

export function toISODate(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

export function coerceSelect<T extends string>(value: any, allowed: T[], fallback: T): T {
  if (typeof value === 'string') {
    const norm = value.toLowerCase();
    const match = allowed.find(a => a.toLowerCase() === norm);
    return (match as T) || fallback;
  }
  return fallback;
}


