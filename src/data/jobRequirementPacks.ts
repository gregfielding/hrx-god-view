/**
 * Job requirement packs: must-haves and nice-to-haves per job type.
 * Used by Job Score to compute eligibility and fit. Extensible — add new packs here.
 */
import type { RequirementPack, RequirementPackId } from '../types/jobScore';

export const JOB_REQUIREMENT_PACKS: Record<RequirementPackId, RequirementPack> = {
  warehouse_w2: {
    id: 'warehouse_w2',
    name: 'Warehouse (W2)',
    description: 'Typical warehouse / distribution center role',
    mustHave: [
      { key: 'workEligibility', label: 'Work eligibility', mustHave: true },
      { key: 'availability', label: 'Availability / shift preferences', mustHave: true },
      { key: 'workExperience', label: 'At least one work experience', mustHave: true },
      { key: 'identityBasics', label: 'Name, email, phone', mustHave: true },
    ],
    niceToHave: [
      { key: 'skills', label: 'Skills (3+)', mustHave: false },
      { key: 'resume', label: 'Resume uploaded', mustHave: false },
    ],
  },
  general_labor_1099: {
    id: 'general_labor_1099',
    name: 'General labor (1099)',
    description: 'Flex / gig general labor',
    mustHave: [
      { key: 'workEligibility', label: 'Work eligibility', mustHave: true },
      { key: 'availability', label: 'Availability / shift preferences', mustHave: true },
      { key: 'identityBasics', label: 'Name, email, phone', mustHave: true },
    ],
    niceToHave: [
      { key: 'workExperience', label: 'Work experience', mustHave: false },
      { key: 'skills', label: 'Skills', mustHave: false },
      { key: 'resume', label: 'Resume uploaded', mustHave: false },
    ],
  },
  nursing_w2: {
    id: 'nursing_w2',
    name: 'Nursing (W2)',
    description: 'Nursing / healthcare W2 role',
    mustHave: [
      { key: 'workEligibility', label: 'Work eligibility', mustHave: true },
      { key: 'availability', label: 'Availability / shift preferences', mustHave: true },
      { key: 'workExperience', label: 'At least one work experience', mustHave: true },
      { key: 'certifications', label: 'At least one certification / license', mustHave: true },
      { key: 'identityBasics', label: 'Name, email, phone', mustHave: true },
    ],
    niceToHave: [
      { key: 'skills', label: 'Skills', mustHave: false },
      { key: 'resume', label: 'Resume uploaded', mustHave: false },
      { key: 'education', label: 'Education', mustHave: false },
    ],
  },
};

export function getRequirementPack(id: RequirementPackId | string | undefined): RequirementPack | null {
  if (!id || typeof id !== 'string') return null;
  const pack = JOB_REQUIREMENT_PACKS[id as RequirementPackId];
  return pack ?? null;
}

export function getRequirementPackIds(): RequirementPackId[] {
  return Object.keys(JOB_REQUIREMENT_PACKS) as RequirementPackId[];
}
