import { Option } from '../fields/FieldTypes';
import { getFieldDef } from '../fields/useFieldDef';
import onetSkills from '../data/onetSkills.json';
import credentialsSeed from '../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';

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


