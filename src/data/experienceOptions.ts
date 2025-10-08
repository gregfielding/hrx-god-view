// Experience Level enum
export type ExperienceLevel =
  | 'none'
  | 'entry'
  | '1-2'
  | '3-5'
  | '5-7'
  | '8-10'
  | '10+';

// Career Level mapping for AI/job-level filters
export type CareerLevel =
  | 'Intern'
  | 'Entry-Level'
  | 'Associate'
  | 'Mid-Senior'
  | 'Manager'
  | 'Director'
  | 'Executive';

// Education Level enum
export type EducationLevel =
  | 'none'
  | 'highschool'
  | 'ged'
  | 'trade'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctorate';

// Experience Required Options
export const experienceOptions = [
  {
    value: 'none',
    label: 'No Experience Required',
    careerLevel: 'Intern' as CareerLevel,
    description: 'Suitable for training, apprenticeship, or unskilled roles.',
  },
  {
    value: 'entry',
    label: 'Entry-Level (0–1 year)',
    careerLevel: 'Entry-Level' as CareerLevel,
    description: 'Early career roles or new workers entering the field.',
  },
  {
    value: '1-2',
    label: '1–2 Years',
    careerLevel: 'Associate' as CareerLevel,
    description: 'Foundational experience, able to work with limited supervision.',
  },
  {
    value: '3-5',
    label: '3–5 Years (Mid-Level)',
    careerLevel: 'Mid-Senior' as CareerLevel,
    description: 'Proficient workers capable of mentoring or leading small teams.',
  },
  {
    value: '5-7',
    label: '5–7 Years (Advanced)',
    careerLevel: 'Mid-Senior' as CareerLevel,
    description: 'Seasoned professional or technical lead with supervisory skill.',
  },
  {
    value: '8-10',
    label: '8–10 Years (Senior-Level)',
    careerLevel: 'Manager' as CareerLevel,
    description: 'Supervisory or senior specialist roles managing teams or projects.',
  },
  {
    value: '10+',
    label: '10+ Years (Expert / Executive)',
    careerLevel: 'Director' as CareerLevel,
    description: 'Top-level expert, director, or executive role.',
  },
];

// Education Required Options
export const educationOptions = [
  {
    value: 'none',
    label: 'No Education Requirement',
    description: 'No formal education or training required.',
  },
  {
    value: 'highschool',
    label: 'High School Diploma',
    description: 'Standard requirement for most entry-level and industrial jobs.',
  },
  {
    value: 'ged',
    label: 'GED Equivalent',
    description: 'Alternative high school equivalency certification.',
  },
  {
    value: 'trade',
    label: 'Trade School / Vocational Certification',
    description: 'Technical training in a specialized field (e.g., HVAC, CNA, CDL).',
  },
  {
    value: 'associate',
    label: "Associate's Degree",
    description: 'Typically 2-year college degree in a technical or administrative field.',
  },
  {
    value: 'bachelor',
    label: "Bachelor's Degree",
    description: '4-year degree required for many professional or management roles.',
  },
  {
    value: 'master',
    label: "Master's Degree",
    description: 'Graduate-level education for advanced leadership or specialized roles.',
  },
  {
    value: 'doctorate',
    label: 'Doctorate / PhD',
    description: 'Highest academic credential for research or executive positions.',
  },
];
