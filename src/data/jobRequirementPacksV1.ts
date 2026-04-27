/**
 * Requirement Pack v1 — scoring rubric schema.
 * Weights: Licenses 30, Experience 25, Education 15, Shift 20, Language 5, Physical 5.
 */
import type { RequirementPackId, RequirementPackV1 } from '../types/jobScore';

export const JOB_REQUIREMENT_PACKS_V1: Record<RequirementPackId, RequirementPackV1> = {
  warehouse_w2: {
    id: 'warehouse_w2',
    name: 'Warehouse (W2)',
    description: 'Typical warehouse / distribution center role',
    version: 1,
    employmentType: 'w2',
    requiredCerts: [],
    requiredExperienceLevels: ['Entry', '0-1'],
    requiredEducationLevels: ['HS'],
    requiredShiftTypes: ['Full Time', 'Part Time', 'Days'],
    requiredLanguages: ['English'],
    physicalPpeTags: [],
    importance: {
      licenses: 'hard',
      experience: 'scored',
      education: 'scored',
      shift: 'scored',
      language: 'scored',
      physical: 'info',
    },
  },
  general_labor_1099: {
    id: 'general_labor_1099',
    name: 'General labor (1099)',
    description: 'Flex / gig general labor',
    version: 1,
    employmentType: 'contractor',
    requiredCerts: [],
    requiredExperienceLevels: [],
    requiredEducationLevels: [],
    requiredShiftTypes: ['Part Time', 'Days', 'Weekends'],
    requiredLanguages: ['English'],
    physicalPpeTags: [],
    importance: {
      licenses: 'info',
      experience: 'scored',
      education: 'info',
      shift: 'scored',
      language: 'scored',
      physical: 'info',
    },
  },
  nursing_w2: {
    id: 'nursing_w2',
    name: 'Nursing (W2)',
    description: 'Nursing / healthcare W2 role',
    version: 1,
    employmentType: 'w2',
    requiredCerts: ['RN', 'BLS'],
    requiredExperienceLevels: ['1-2', '3-5'],
    requiredEducationLevels: ['BA'],
    requiredShiftTypes: ['Full Time', 'Part Time', 'Days', 'Nights'],
    requiredLanguages: ['English'],
    physicalPpeTags: [],
    importance: {
      licenses: 'hard',
      experience: 'scored',
      education: 'hard',
      shift: 'scored',
      language: 'scored',
      physical: 'info',
    },
  },
};

export function getRequirementPackV1(id: RequirementPackId | string | undefined): RequirementPackV1 | null {
  if (!id || typeof id !== 'string') return null;
  const pack = JOB_REQUIREMENT_PACKS_V1[id as RequirementPackId];
  return pack ?? null;
}

export function getRequirementPackIdsV1(): RequirementPackId[] {
  return Object.keys(JOB_REQUIREMENT_PACKS_V1) as RequirementPackId[];
}
