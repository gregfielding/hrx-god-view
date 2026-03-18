export type DesiredWorkType = 'full_time' | 'part_time' | 'gig' | 'any';
export type TargetIndustry = 'hospitality' | 'industrial';

export interface OpportunityRequirement {
  id: string;
  label: string;
  impact: number;
  cardTitle: string;
  cardQuestion: string;
  requirementKind: 'certification' | 'availability' | 'experience' | 'gear' | 'preference' | 'identity';
  domain: 'durable_profile' | 'attestation_only' | 'verified_compliance';
  supportsCategories: TargetIndustry[];
  explanation: string;
  unlocksText: string;
  resourceText: string;
  resourceUrl?: string;
  uploadSectionId?: string;
}

export interface IndustryOpportunity {
  industry: TargetIndustry;
  label: string;
  entrySummary: string;
  requirements: OpportunityRequirement[];
}

export const READINESS_OPPORTUNITY_MAP: Record<TargetIndustry, IndustryOpportunity> = {
  hospitality: {
    industry: 'hospitality',
    label: 'Hospitality',
    entrySummary: 'entry-level hospitality shifts',
    requirements: [
      {
        id: 'profile_photo',
        label: 'Profile photo',
        impact: 120,
        cardTitle: 'Add your profile photo',
        cardQuestion: 'Employers are more likely to choose workers with a clear photo.',
        requirementKind: 'identity',
        domain: 'durable_profile',
        supportsCategories: ['hospitality', 'industrial'],
        explanation: 'A clear profile photo helps employers trust who they are selecting for shifts.',
        unlocksText: 'Improves shortlist visibility across shift types.',
        resourceText: 'Upload or replace your photo in profile',
        uploadSectionId: 'readiness-basic-identity',
      },
      {
        id: 'food_handler_cert',
        label: 'Food Handler certification',
        impact: 100,
        cardTitle: 'Food Handler certification',
        cardQuestion: 'Do you currently have a valid Food Handler certification?',
        requirementKind: 'certification',
        domain: 'verified_compliance',
        supportsCategories: ['hospitality'],
        explanation: 'A Food Handler card can unlock more hospitality and food-service shifts.',
        unlocksText: 'Unlocks more hospitality and food-service opportunities.',
        resourceText: 'See where to get Food Handler certified',
        uploadSectionId: 'readiness-certifications',
      },
      {
        id: 'weekend_availability',
        label: 'Weekend availability',
        impact: 70,
        cardTitle: 'Weekend shift availability',
        cardQuestion: 'Are you open to weekend shifts?',
        requirementKind: 'availability',
        domain: 'durable_profile',
        supportsCategories: ['hospitality'],
        explanation: 'Weekend availability typically increases hospitality job match volume.',
        unlocksText: 'Improves access to high-volume weekend shift opportunities.',
        resourceText: 'Update your availability in profile',
        uploadSectionId: 'readiness-availability',
      },
      {
        id: 'hospitality_experience',
        label: 'Hospitality experience',
        impact: 65,
        cardTitle: 'Hospitality work experience',
        cardQuestion: 'Do you have prior hospitality, server, or banquet experience?',
        requirementKind: 'experience',
        domain: 'durable_profile',
        supportsCategories: ['hospitality'],
        explanation: 'Adding hospitality experience helps recruiters shortlist you faster.',
        unlocksText: 'Improves recruiter confidence for front-of-house assignments.',
        resourceText: 'Add hospitality experience in profile',
        uploadSectionId: 'readiness-work-experience',
      },
      {
        id: 'black_uniform_readiness',
        label: 'Black uniform readiness',
        impact: 45,
        cardTitle: 'Uniform readiness',
        cardQuestion: 'Are you ready with black uniform basics and non-slip shoes?',
        requirementKind: 'gear',
        domain: 'attestation_only',
        supportsCategories: ['hospitality'],
        explanation: 'Uniform readiness helps you start quickly when offers come in.',
        unlocksText: 'Reduces start delays for hospitality placements.',
        resourceText: 'Review shift details and uniform expectations',
      },
    ],
  },
  industrial: {
    industry: 'industrial',
    label: 'Industrial',
    entrySummary: 'entry-level industrial shifts',
    requirements: [
      {
        id: 'profile_photo',
        label: 'Profile photo',
        impact: 120,
        cardTitle: 'Add your profile photo',
        cardQuestion: 'Employers are more likely to choose workers with a clear photo.',
        requirementKind: 'identity',
        domain: 'durable_profile',
        supportsCategories: ['hospitality', 'industrial'],
        explanation: 'A clear profile photo helps employers trust who they are selecting for shifts.',
        unlocksText: 'Improves shortlist visibility across shift types.',
        resourceText: 'Upload or replace your photo in profile',
        uploadSectionId: 'readiness-basic-identity',
      },
      {
        id: 'forklift_cert',
        label: 'Forklift certification',
        impact: 100,
        cardTitle: 'Forklift certification',
        cardQuestion: 'Do you currently hold a forklift certification?',
        requirementKind: 'certification',
        domain: 'verified_compliance',
        supportsCategories: ['industrial'],
        explanation: 'Forklift certification can expand access to higher-volume warehouse roles.',
        unlocksText: 'Unlocks additional warehouse and logistics placements.',
        resourceText: 'Add forklift certification in profile',
        uploadSectionId: 'readiness-certifications',
      },
      {
        id: 'steel_toe_boots',
        label: 'Steel-toe boots readiness',
        impact: 75,
        cardTitle: 'Safety gear readiness',
        cardQuestion: 'Do you currently have steel-toe boots for industrial shifts?',
        requirementKind: 'gear',
        domain: 'attestation_only',
        supportsCategories: ['industrial'],
        explanation: 'Being safety-gear ready can accelerate assignment placement.',
        unlocksText: 'Improves placement speed for safety-sensitive roles.',
        resourceText: 'Review industrial readiness requirements',
      },
      {
        id: 'shift_flexibility',
        label: 'Shift flexibility',
        impact: 70,
        cardTitle: 'Shift flexibility',
        cardQuestion: 'Are you open to different shifts, including early or late schedules?',
        requirementKind: 'preference',
        domain: 'durable_profile',
        supportsCategories: ['industrial'],
        explanation: 'Shift flexibility often increases industrial job opportunities.',
        unlocksText: 'Expands matching to more shift schedules.',
        resourceText: 'Update shift preferences in profile',
        uploadSectionId: 'readiness-availability',
      },
      {
        id: 'warehouse_tools',
        label: 'Pallet jack / RF scanner familiarity',
        impact: 60,
        cardTitle: 'Warehouse tools familiarity',
        cardQuestion: 'Are you familiar with pallet jacks or RF scanners?',
        requirementKind: 'experience',
        domain: 'durable_profile',
        supportsCategories: ['industrial'],
        explanation: 'Tool familiarity improves fit for fast-moving warehouse teams.',
        unlocksText: 'Increases fit for warehouse operations roles.',
        resourceText: 'Add relevant skills in profile',
        uploadSectionId: 'readiness-skills',
      },
    ],
  },
};

