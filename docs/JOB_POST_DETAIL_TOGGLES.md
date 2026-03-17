# Job Post Detail Page — Visibility Toggles & Layout

This document summarizes the **backend visibility toggles** used on the C1 worker-facing Job Post Detail page (`JobPostingDetail.tsx`) and how the layout respects them.

## Toggles (source of truth)

| Toggle | Controls | When OFF |
|--------|----------|----------|
| `showPayRate` | Pay rate in hero, quick facts, sidebar | Pay not shown |
| `showWorkersNeeded` | Workers needed count (hero, quick facts, sidebar) | Count hidden |
| `showBackgroundChecks` | Background check chips / requirements section | Section/category hidden |
| `showDrugScreening` | Drug screening chips / requirements section | Section/category hidden |
| `showAdditionalScreenings` | Additional screenings requirements | Category hidden |
| `showSkills` | Skills chips (quick facts) and requirements category | Hidden |
| `showLicensesCerts` | Licenses/certs chips and requirements category | Hidden |
| `showExperience` | Experience chips and requirements category | Hidden |
| `showEducation` | Education chips and requirements category | Hidden |
| `showLanguages` | Languages requirements category | Hidden |
| `showPhysicalRequirements` | Physical requirements category | Hidden |
| `showUniformRequirements` | Uniform requirements category | Hidden |
| `showRequiredPpe` | PPE requirements category | Hidden |
| `showCustomUniformRequirements` | Custom uniform text block | Hidden |
| `eVerifyRequired` | E-Verify badge / requirements mention | E-Verify not shown |

**Gig vs Career**

- For **Gig** jobs with **dynamic shifts**: pay and workers-needed are often shown per shift in the Available Shifts section; hero/sidebar may hide job-level pay/workers to avoid duplication.
- For **Career** (or Gig without shifts): job-level pay and workers needed use the toggles above.

## Layout mapping (worker decision hierarchy)

1. **Back navigation** — Always present.
2. **Hero header card** — Job title, company, pay (when toggle + data), location (city/state/zip), job type, next shift or start date, workers needed (when toggle). Copy Link is secondary (icon).
3. **Quick Facts strip** — Chips for: pay (gig with shifts), workers needed (gig with shifts), location, E-Verify, background check, drug screening, skills, licenses/certs, experience, education. Each chip only renders when the corresponding toggle is ON and data exists.
4. **About this Job** — Description (cleaned of markdown clutter); Read more on mobile when long.
5. **Location** — Renders only when address data exists. Shows address, Get Directions, optional distance (when location permission granted), optional “Use my location” CTA, and map embed.
6. **Assignment Info + Schedule** — Shown when worker is in accept/decline mode (unchanged).
7. **Available Shifts** — Gig only. First upcoming shift labeled “Next available shift”; all status buttons (Apply, Applied, Accept, Decline, Past) preserved.
8. **Requirements** — Single card; categories (Background, Drug, Licenses, Skills, etc.) only appear when the corresponding toggle is ON and the array has items. No empty shells when toggled off.
9. **Sidebar** — Same toggles for pay, workers needed, start date, etc. Shown for non-gig or gig without shifts.

## Implementation notes

- If a toggle is OFF or data is empty, the corresponding UI block is not rendered (no empty shells).
- Layout is single-column on small screens; grid switches to two columns on `md` only when sidebar is shown (non-gig or gig without shifts).
- All existing routes, buttons, status states, and application/assignment flows are unchanged.
