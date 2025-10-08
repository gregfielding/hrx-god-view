# HRX / C1 Education Options Specification

## 📘 Overview
This file defines standardized dropdown options for **Education Required** to align with Indeed, Monster, LinkedIn, and O*NET conventions. Use this as the single source of truth for HRX/C1 job posting forms, resume parsing, and AI matching.

---

## 🏷️ UI Label
**Education Required**

---

## 🧱 Type Definition (TS)
```typescript
export type EducationLevel =
  | 'none'          // No Education Requirement
  | 'highschool'    // High School Diploma / GED
  | 'trade'         // Trade School / Vocational Certificate
  | 'somecollege'   // Some College Coursework
  | 'associate'     // Associate’s Degree
  | 'bachelor'      // Bachelor’s Degree
  | 'master'        // Master’s Degree
  | 'doctorate';    // Doctorate / Professional Degree (PhD, MD, JD)
```
Rationale: Mirrors the ranges used by major job boards; adds “trade” (Monster/ESCO), “some college” (LinkedIn), and “doctorate/professional” (Indeed/Monster).

---

## 🎨 Dropdown Options (Display Order)

```typescript
export const educationOptions = [
  {
    value: 'none',
    label: 'No Education Requirement',
    description: 'No formal education or training required for this position.'
  },
  {
    value: 'highschool',
    label: 'High School Diploma / GED',
    description: 'Standard requirement for most general and industrial roles.'
  },
  {
    value: 'trade',
    label: 'Trade School / Vocational Certificate',
    description: 'Technical certification or postsecondary vocational program (e.g., HVAC, CDL, CNA).'
  },
  {
    value: 'somecollege',
    label: 'Some College Coursework',
    description: 'Completed partial college-level studies without a degree.'
  },
  {
    value: 'associate',
    label: 'Associate’s Degree',
    description: 'Typically a 2-year college degree in a technical or business field.'
  },
  {
    value: 'bachelor',
    label: 'Bachelor’s Degree',
    description: '4-year undergraduate degree required for many professional roles.'
  },
  {
    value: 'master',
    label: 'Master’s Degree',
    description: 'Graduate-level degree for specialized or leadership positions.'
  },
  {
    value: 'doctorate',
    label: 'Doctorate / Professional Degree (PhD, MD, JD)',
    description: 'Highest academic or professional credential.'
  }
];
```

---

## 🧩 Example Usage (React)
```tsx
import { educationOptions } from '@/data/educationOptions';

<Select
  label="Education Required"
  options={educationOptions.map(o => ({ label: o.label, value: o.value }))}
/>
```

---

## 🔗 Integration Notes
- **Firestore fields:** `education_required: EducationLevel`
- **Validation:** Require this field for jobs that specify education; allow `'none'` for general labor roles.
- **Search buckets:** group `none|highschool|trade|somecollege` as *non-degree*; `associate|bachelor|master|doctorate` as *degree*.
- **i18n:** Keep internal values stable; translate only the `label` and `description`.

---

## ✅ QA Checklist
- [ ] Dropdown shows 8 options in the exact order above.
- [ ] Values persist as enums in Firestore.
- [ ] Filters work for *degree vs non-degree* groupings.
- [ ] Legacy UI labels (“High School / GED”, “Associates”) are mapped to new labels.
- [ ] Unit test ensures no option duplication and correct sort order.

---

**End of File**
