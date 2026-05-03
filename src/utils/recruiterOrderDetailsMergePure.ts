/**
 * Pure merge for recruiter order-details shapes (no Firebase).
 * Used by account defaults, per-position overrides, and job order forms.
 *
 * **CRA note:** Do not import implementation from outside `src/` — webpack ModuleScopePlugin blocks it.
 * Cloud Functions mirror: `functions/src/utils/recruiterOrderDetailsMergePure.ts` (keep in sync).
 */

export interface RecruiterOrderDetailsData {
  backgroundCheckPackages?: string[];
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  licensesCerts?: string[];
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  physicalRequirements?: string[];
  ppeRequirements?: string[];
  ppeProvidedBy?: string;
  requirementPackId?: string;
  dressCode?: string[];
  customUniformRequirements?: string;
  decisionMaker?: string;
  hrContactId?: string;
  operationsContactId?: string;
  procurementContactId?: string;
  billingContactId?: string;
  safetyContactId?: string;
  invoiceContactId?: string;
}

export const EMPTY_RECRUITER_ORDER_DETAILS: RecruiterOrderDetailsData = {
  backgroundCheckPackages: [],
  drugScreeningPanels: [],
  additionalScreenings: [],
  licensesCerts: [],
  experienceRequired: '',
  educationRequired: '',
  languagesRequired: [],
  skillsRequired: [],
  physicalRequirements: [],
  ppeRequirements: [],
  ppeProvidedBy: 'company',
  requirementPackId: '',
  dressCode: [],
  customUniformRequirements: '',
  decisionMaker: '',
  hrContactId: '',
  operationsContactId: '',
  procurementContactId: '',
  billingContactId: '',
  safetyContactId: '',
  invoiceContactId: '',
};

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0;
}

function isNonEmptyTrimmedString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Empty-array / empty-string fallthrough — R.16.2c hotfix.
 *
 * Why this exists:
 *   The original merge used `??`, which only treats `null` /
 *   `undefined` as "no override". An explicit `[]` or `''` on the
 *   child account therefore *suppressed* the parent's value, leaving
 *   child-account forms blank even when the parent had real data.
 *
 * @param overrideLayer — wins when non-empty (e.g. child account, location_defaults, per-position row)
 * @param baseLayer — fallback (e.g. parent national account or merged account defaults)
 */
export function mergeRecruiterOrderDetails(
  overrideLayer: RecruiterOrderDetailsData | undefined,
  baseLayer: RecruiterOrderDetailsData | undefined,
): RecruiterOrderDetailsData {
  const arrayPick = (
    overrideValue: string[] | undefined,
    baseValue: string[] | undefined,
  ): string[] => {
    if (isNonEmptyStringArray(overrideValue)) return overrideValue;
    if (isNonEmptyStringArray(baseValue)) return baseValue;
    return [];
  };
  return {
    ...EMPTY_RECRUITER_ORDER_DETAILS,
    ...baseLayer,
    ...overrideLayer,
    backgroundCheckPackages: arrayPick(overrideLayer?.backgroundCheckPackages, baseLayer?.backgroundCheckPackages),
    drugScreeningPanels: arrayPick(overrideLayer?.drugScreeningPanels, baseLayer?.drugScreeningPanels),
    additionalScreenings: arrayPick(overrideLayer?.additionalScreenings, baseLayer?.additionalScreenings),
    licensesCerts: arrayPick(overrideLayer?.licensesCerts, baseLayer?.licensesCerts),
    languagesRequired: arrayPick(overrideLayer?.languagesRequired, baseLayer?.languagesRequired),
    skillsRequired: arrayPick(overrideLayer?.skillsRequired, baseLayer?.skillsRequired),
    physicalRequirements: arrayPick(overrideLayer?.physicalRequirements, baseLayer?.physicalRequirements),
    ppeRequirements: arrayPick(overrideLayer?.ppeRequirements, baseLayer?.ppeRequirements),
    dressCode: arrayPick(overrideLayer?.dressCode, baseLayer?.dressCode),
    customUniformRequirements: isNonEmptyTrimmedString(overrideLayer?.customUniformRequirements)
      ? overrideLayer!.customUniformRequirements
      : isNonEmptyTrimmedString(baseLayer?.customUniformRequirements)
        ? baseLayer!.customUniformRequirements
        : '',
  };
}
