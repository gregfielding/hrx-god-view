import { Option } from '../fields/FieldTypes';
import { getFieldDef } from '../fields/useFieldDef';
import onetSkills from '../data/onetSkills.json';
import credentialsSeed from '../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';
import { COMMON_LANGUAGES } from '../data/commonLanguages';

type CompanyDefaults = {
  backgroundPackages?: Array<{ title: string; description?: string }>;
  screeningPanels?: Array<{ title: string; description?: string }>;
  additionalScreenings?: Array<{ title: string; description?: string }>;
  uniformRequirements?: Array<{ title: string; description?: string }>;
  ppe?: Array<{ title: string; description?: string }>;
  licensesCerts?: Array<{ title: string; description?: string }>;
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

  // Handle different options sources
  if (def.optionsSource === 'onetSkills') {
    switch (fieldId) {
      case 'skills':
        return onetSkills.map(skill => ({ value: skill.name, label: skill.name }));
      default:
        break;
    }
  }

  if (def.optionsSource === 'credentialsSeed') {
    switch (fieldId) {
      case 'licensesCerts':
        return credentialsSeed
          .filter(cred => cred.is_active)
          .map(cred => ({ 
            value: cred.name, 
            label: `${cred.name} (${cred.type})` 
          }));
      default:
        break;
    }
  }

  if (def.optionsSource === 'experienceOptions') {
    switch (fieldId) {
      case 'experienceLevel':
      case 'experienceLevels':
        return experienceOptions.map(exp => ({ 
          value: exp.value, 
          label: exp.label 
        }));
      default:
        break;
    }
  }

  if (def.optionsSource === 'educationOptions') {
    switch (fieldId) {
      case 'educationLevels':
        return educationOptions.map(edu => ({ 
          value: edu.value, 
          label: edu.label 
        }));
      default:
        break;
    }
  }
  
  // Handle standardized screening options
  if (def.optionsSource === 'companyDefaults' && companyDefaults) {
    switch (fieldId) {
      case 'backgroundCheckPackages':
        // Use standardized options instead of company defaults
        return backgroundCheckOptions.map(option => ({ 
          value: option.value, 
          label: option.label 
        }));
      case 'drugScreeningPanels':
        // Use standardized options instead of company defaults
        return drugScreeningOptions.map(option => ({ 
          value: option.value, 
          label: option.label 
        }));
      case 'additionalScreenings':
        // Use standardized options instead of company defaults
        return additionalScreeningOptions.map(option => ({ 
          value: option.value, 
          label: option.label 
        }));
      case 'uniformRequirement':
        return toOptions(companyDefaults.uniformRequirements);
      case 'ppe':
        return toOptions(companyDefaults.ppe);
      case 'licensesCerts':
        return toOptions(companyDefaults.licensesCerts);
      case 'experienceLevels':
        return toOptions(companyDefaults.experienceLevels);
      case 'educationLevels':
        return toOptions(companyDefaults.educationLevels);
      case 'physicalRequirements':
        return toOptions(companyDefaults.physicalRequirements);
      case 'languages':
        // Prefer tenant-curated `companyDefaults.languages` when populated;
        // fall back to the static seed list so the dropdown is never empty
        // (the Field Registry entry has `optionsSource: 'companyDefaults'`
        // and tenants don't currently populate this slot — see
        // `src/data/commonLanguages.ts` header for the 2026-05-05 fix
        // context). Recruiters can still type custom values: both call
        // sites use `freeSolo`.
        return Array.isArray(companyDefaults.languages) && companyDefaults.languages.length > 0
          ? toOptions(companyDefaults.languages)
          : COMMON_LANGUAGES.map((name) => ({ value: name, label: name }));
      case 'skills':
        return toOptions(companyDefaults.skills);
      default:
        break;
    }
  }

  // Fallback to static registry options if provided
  if (Array.isArray(def.options)) return def.options;

  // Last-resort static fallbacks for fields whose registry entry declares
  // `optionsSource: 'companyDefaults'` but no companyDefaults blob was
  // supplied at the call site. Without this, the `Languages Required`
  // Autocomplete renders "No options" everywhere because tenants don't
  // currently populate `tenants/{tid}/companyDefaults.languages`. Same
  // intent as the in-companyDefaults branch above; centralising here so
  // callers that pass `undefined` get the same UX as those passing `{}`.
  if (fieldId === 'languages') {
    return COMMON_LANGUAGES.map((name) => ({ value: name, label: name }));
  }

  return [];
};


