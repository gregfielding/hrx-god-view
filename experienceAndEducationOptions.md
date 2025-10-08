# HRX / C1 Experience & Education Options Specification

## 📘 Overview
This file defines standardized dropdown options for **Experience Required**, **Career Level**, and **Education Required** across HRX and C1 Staffing.

These align with industry standards from Indeed, Monster, and LinkedIn to ensure consistency in:
- Job postings
- Resume parsing
- AI matching
- Worker onboarding

---

## 🧱 Type Definitions

```typescript
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
```

---

## 🎨 Experience Required Options

```typescript
export const experienceOptions = [
  {
    value: 'none',
    label: 'No Experience Required',
    careerLevel: 'Intern',
    description: 'Suitable for training, apprenticeship, or unskilled roles.',
  },
  {
    value: 'entry',
    label: 'Entry-Level (0–1 year)',
    careerLevel: 'Entry-Level',
    description: 'Early career roles or new workers entering the field.',
  },
  {
    value: '1-2',
    label: '1–2 Years',
    careerLevel: 'Associate',
    description: 'Foundational experience, able to work with limited supervision.',
  },
  {
    value: '3-5',
    label: '3–5 Years (Mid-Level)',
    careerLevel: 'Mid-Senior',
    description: 'Proficient workers capable of mentoring or leading small teams.',
  },
  {
    value: '5-7',
    label: '5–7 Years (Advanced)',
    careerLevel: 'Mid-Senior',
    description: 'Seasoned professional or technical lead with supervisory skill.',
  },
  {
    value: '8-10',
    label: '8–10 Years (Senior-Level)',
    careerLevel: 'Manager',
    description: 'Supervisory or senior specialist roles managing teams or projects.',
  },
  {
    value: '10+',
    label: '10+ Years (Expert / Executive)',
    careerLevel: 'Director',
    description: 'Top-level expert, director, or executive role.',
  },
];
```

---

## 🧭 Career Level Reference (Optional Secondary Field)

| Career Level | Typical Experience | Example Roles |
|---------------|--------------------|----------------|
| **Intern** | None | Trainee, apprentice, intern |
| **Entry-Level** | 0–1 year | General labor, junior admin |
| **Associate** | 1–3 years | Skilled trade worker, associate recruiter |
| **Mid-Senior** | 3–7 years | Team lead, foreman, RN |
| **Manager** | 5–10 years | Shift lead, account manager |
| **Director** | 8–12 years | Branch manager, director-level ops |
| **Executive** | 10+ years | VP, senior executive |

---

## 🎓 Education Required Options

```typescript
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
```

---

## 🧩 Example Usage in React / MUI Components

```tsx
import { experienceOptions, educationOptions } from '@/data/experienceOptions';

<Select
  label="Experience Required"
  options={experienceOptions.map((opt) => ({
    label: opt.label,
    value: opt.value,
  }))}
/>

<Select
  label="Education Required"
  options={educationOptions.map((opt) => ({
    label: opt.label,
    value: opt.value,
  }))}
/>
```

---

## 🧠 Integration Notes (for HRX / C1)

- **Firestore Collection:** store as enums:  
  `experience_required`, `education_required`, and optional `career_level`.
- **UI Labeling:**  
  - “Experience Required”  
  - “Education Required”
- **AI / Search Layer:**  
  Map “career_level” to inferred salary bands and match logic.
- **Standardization Goal:**  
  Aligns with Indeed, LinkedIn, and O*NET “Job Zone” expectations.

---

## ✅ Next Steps for Cursor
1. Create a data file:  
   `/src/data/experienceOptions.ts` (including both sections).  
2. Update `JobOrderForm.tsx` to import both arrays.  
3. Add corresponding Firestore fields and validation logic.  
4. Future: integrate with O*NET occupation data to auto-suggest ranges.

---

**End of File**
