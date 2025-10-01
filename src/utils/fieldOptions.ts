import { Option } from '../fields/FieldTypes';
import { getFieldDef } from '../fields/useFieldDef';

type CompanyDefaults = {
  backgroundPackages?: Array<{ title: string; description?: string }>;
  screeningPanels?: Array<{ title: string; description?: string }>;
  uniformRequirements?: Array<{ title: string; description?: string }>;
  ppe?: Array<{ title: string; description?: string }>;
  licenses?: Array<{ title: string; description?: string }>;
  certifications?: Array<{ title: string; description?: string }>;
  experienceLevels?: Array<{ title: string; description?: string }>;
  educationLevels?: Array<{ title: string; description?: string }>;
  physicalRequirements?: Array<{ title: string; description?: string }>;
  languages?: Array<{ title: string; description?: string }>;
  skills?: Array<{ title: string; description?: string }>;
};

const toOptions = (items?: Array<{ title: string }>): Option[] =>
  (items || []).map(item => ({ value: item.title, label: item.title }));

export const getOptionsForField = (
  fieldId: string,
  companyDefaults?: CompanyDefaults
): Option[] => {
  const def = getFieldDef(fieldId);
  if (!def) return [];

  // Prefer dynamic company defaults when configured
  if (def.optionsSource === 'companyDefaults' && companyDefaults) {
    switch (fieldId) {
      case 'backgroundCheckPackages':
        return toOptions(companyDefaults.backgroundPackages);
      case 'drugScreeningPanels':
        return toOptions(companyDefaults.screeningPanels);
      case 'uniformRequirement':
        return toOptions(companyDefaults.uniformRequirements);
      case 'ppe':
        return toOptions(companyDefaults.ppe);
      case 'requiredLicenses':
        return toOptions(companyDefaults.licenses);
      case 'requiredCertifications':
        return toOptions(companyDefaults.certifications);
      case 'experienceLevels':
        return toOptions(companyDefaults.experienceLevels);
      case 'educationLevels':
        return toOptions(companyDefaults.educationLevels);
      case 'physicalRequirements':
        return toOptions(companyDefaults.physicalRequirements);
      case 'languages':
        return toOptions(companyDefaults.languages);
      case 'skills':
        return toOptions(companyDefaults.skills);
      default:
        break;
    }
  }

  // Fallback to static registry options if provided
  if (Array.isArray(def.options)) return def.options;

  return [];
};


