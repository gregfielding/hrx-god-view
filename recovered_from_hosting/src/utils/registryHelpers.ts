import { getFieldDef } from '../fields/useFieldDef';

export const getRegistryPath = (fieldId: string): string | undefined => {
  const def = getFieldDef(fieldId);
  return def?.path;
};

export const setDeep = (obj: any, path: string, value: any) => {
  if (!path) return;
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof curr[key] !== 'object' || curr[key] === null) {
      curr[key] = {};
    }
    curr = curr[key];
  }
  curr[parts[parts.length - 1]] = value;
};

// Map UI/local form field ids to canonical registry ids
const FIELD_ID_ALIASES: Record<string, string> = {
  // Qualification
  mustHaveRequirements: 'mustHave',
  mustAvoidRequirements: 'mustAvoid',
  expectedPayRate: 'expectedAveragePayRate',
  expectedMarkup: 'expectedAverageMarkup',
  // Discovery
  currentSatisfactionLevel: 'satisfactionLevel',
  // Scoping - shift policies
  disciplinePolicy: 'discipline',
  attendancePolicy: 'attendance',
  overtimePolicy: 'overtime',
  callOffPolicy: 'callOff',
  noShowPolicy: 'noCallNoShow',
  injuryHandlingPolicy: 'injuryReporting',
  // Scoping - compliance
  backgroundCheckRequired: 'backgroundCheck',
  drugScreenRequired: 'drugScreen',
  ppeRequirements: 'ppe',
  dressCode: 'uniformRequirement',
  experienceRequired: 'experienceLevels',
  educationRequired: 'educationLevels',
  languagesRequired: 'languages',
  skillsRequired: 'skills',
  // Invoicing
  invoiceDeliveryMethod: 'deliveryMethod',
  invoiceFrequency: 'frequency',
  // Verbal Agreement
  verbalAgreementDate: 'verbalDate',
  verbalAgreementMethod: 'method',
};

export const getRegistryIdForField = (fieldId: string): string => {
  return FIELD_ID_ALIASES[fieldId] || fieldId;
};


