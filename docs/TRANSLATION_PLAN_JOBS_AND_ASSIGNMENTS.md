# Translation Plan: Job Postings, Jobs Board, and Assignments

This plan covers Spanish (and future) translations for worker-facing job posting, jobs board, and assignment layouts. **Dynamic content** (job titles, company names, descriptions from the database) is not translated by the app; only **UI labels, buttons, and system copy** are.

---

## 1. Job Posting Detail Page (`JobPostingDetail.tsx`)

### 1.1 Hardcoded strings to replace with i18n

| Location / context | Current (EN) | i18n key to use | Notes |
|--------------------|--------------|------------------|-------|
| Section heading | "About this Job" | `jobs.aboutThisJob` | **Add key** |
| Empty description | "No description provided." | `jobs.noDescriptionProvided` | **Add key** |
| Expand/collapse | "Read more" / "Show less" | `jobs.readMore`, `jobs.showLess` | **Add keys** |
| Job type chips | "Gig" / "Career" | `jobs.gig`, `jobs.career` | Already exist in en/es |
| Positions count | "2 positions" / "1 position" | `jobs.positionsCount` | **Add key** e.g. `{count} position(s)` |
| Start date chip (career) | "Estimated Start: 2/23/2026" | `jobs.estimatedStartLabel` with `{date}` | **Add key** |
| Start date chip (gig) | "Starts 2/23/2026" | `jobs.startsLabel` with `{date}` | **Add key** |
| Next shift chip | "Next Shift: 2/23/2026" | `jobs.nextShiftLabel` with `{date}` | **Add key** |
| Application status button | "Application Submitted", "Hired", "Waitlisted", etc. | `jobs.applicationStatus.*` or `applications.status*` | **Add/use keys** for all statuses |
| Helper text (waitlisted/rejected) | "You're on our shortlist..." | `jobs.applicationStatusWaitlistedHelp`, etc. | **Add keys** |
| Back button | "Back to Jobs Board" | `jobs.backToJobsBoard` | Exists; ES = "Volver a Buscar trabajo" for Find Work |

### 1.2 Right-hand “Apply” card

Labels such as "Pay Rate", "Openings", "Type", "Estimated start date", "Complete X steps to apply" already use `t('jobs.payRate')`, `t('jobs.openings')`, etc. **Verify** that every label in that card uses a `jobs.*` key and that the key exists in `es.json`.

---

## 2. Public Jobs Board (`PublicJobsBoard.tsx`)

### 2.1 Filters and view mode

- Search placeholder, "Location", "Job type", "Sort by", "Grid", "Cards", "Feed", "Clear filters" → already use `jobs.*` keys. **Verify** es.json has all of them.

### 2.2 Job cards (list/grid/feed)

- **Status button** (e.g. "Application Submitted", "Aplicar ahora"): `getApplicationStatusButton()` returns hardcoded English labels. **Fix:** use `t('jobs.feed.applicationSubmitted')`, and add keys for Hired, Waitlisted, Not Accepted, Cancelled, Accepted (e.g. `jobs.applicationStatusHired`, …), then use them in the switch.
- **Card body**: Job title, rate, location, shift summary come from API/database (not translated in app). Only the **button label** and any **system labels** (e.g. “Openings”) need i18n.

### 2.3 Feed-specific copy

- "Application Submitted", "Here is another opportunity...", "No more jobs", "View all jobs", "Skip", "Save", "View Details" → already under `jobs.feed.*`. **Verify** es has every key.

### 2.4 Back to Jobs Board

- When shown on jobs board context, use "Find Work" in EN and "Buscar trabajo" in ES (align with nav). Key: `jobs.backToJobsBoard` or a dedicated `jobs.backToFindWork` for C1.

---

## 3. Assignment Layouts

### 3.1 Assignment detail page (`AssignmentDetails.tsx`)

- Uses `t('jobs.payRate')`, `t('jobs.jobPreparation')`, and `assignment.*` keys. **Audit** every user-visible string; ensure each has a key and that `assignment.*` (and any `jobs.*`) are complete in es.json.

### 3.2 Worker assignments list (`c1/workers/assignments.tsx`)

- Tabs, empty state, "Find Work", view mode (List/Cards) use `assignments.*`. **Verify** es has: `assignments.title`, `assignments.subtitle`, `assignments.tabUpcoming`, `assignments.tabPast`, `assignments.findWork`, `assignments.viewList`, `assignments.viewCards`, `assignments.emptyNoUpcomingTitle`, `assignments.emptyNoPastTitle`, `assignments.emptyNoPastSubtext`, `assignments.cancelShift`, `assignments.cancelShiftConfirm`, `assignments.cancelShiftError`.

### 3.3 Worker assignment card (`WorkerAssignmentCard.tsx`)

- "View Details", "Cancel Shift" → `assignments.viewDetails`, `assignments.cancelShift`. **Verify** es.

---

## 4. i18n key checklist (en + es)

### 4.1 New keys to add (jobs)

- `jobs.aboutThisJob` — "About this Job" / "Acerca de este puesto"
- `jobs.noDescriptionProvided` — "No description provided." / "No hay descripción."
- `jobs.readMore` — "Read more" / "Leer más"
- `jobs.showLess` — "Show less" / "Ver menos"
- `jobs.positionsCount` — "{count} position" (singular) and optionally "positions" for plural, or one key with count placeholder
- `jobs.estimatedStartLabel` — "Estimated Start: {date}" / "Inicio estimado: {date}"
- `jobs.startsLabel` — "Starts {date}" / "Inicia {date}"
- `jobs.nextShiftLabel` — "Next Shift: {date}" / "Próximo turno: {date}"
- Application status labels (if not reusing applications.*):
  - `jobs.applicationStatusSubmitted` — "Application Submitted" / "Solicitud enviada"
  - `jobs.applicationStatusHired` — "Hired" / "Contratado"
  - `jobs.applicationStatusWaitlisted` — "Waitlisted" / "Lista de espera"
  - `jobs.applicationStatusNotAccepted` — "Not Accepted" / "No aceptado"
  - `jobs.applicationStatusCancelled` — "Cancelled" / "Cancelado"
  - `jobs.applicationStatusAccepted` — "Accepted" / "Aceptado"
- Helper text:
  - `jobs.applicationStatusWaitlistedHelp` — waitlisted message
  - `jobs.applicationStatusRejectedHelp` — rejected message

### 4.2 Keys to verify in es.json

- All of `jobs.*` used in JobPostingDetail and PublicJobsBoard (search for `t('jobs.` in those files and ensure es has the same key).
- All of `assignments.*` and `assignment.*` used in assignment pages and cards.
- `jobs.backToJobsBoard` — for C1/worker context, ES can be "Volver a Buscar trabajo".

### 4.3 Nav / Find Work

- Nav item "Find Work" is already `nav.findWork` (EN: "Find Work", ES: "Buscar trabajo"). Jobs board title when in C1 route uses `nav.findWork`. No change needed if already wired.

---

## 5. Implementation order

1. **Add missing keys** to `public/i18n/locales/en.json` and `public/i18n/locales/es.json` (and mirror in `i18n/locales/`) for jobs and assignments.
2. **JobPostingDetail.tsx**: Replace every hardcoded string listed in §1.1 with `t('jobs.xxx')` and fix status button/helper text to use i18n.
3. **PublicJobsBoard.tsx**: Replace status button labels in `getApplicationStatusButton()` with `t('jobs.applicationStatusX')` (or shared keys).
4. **Assignment pages**: Quick audit — ensure no remaining hardcoded EN; add any missing es keys.
5. **Smoke test**: Switch language to ES and click through Jobs Board → Job detail → Apply card; Assignments list → Assignment detail; confirm all labels and buttons are in Spanish.

---

## 6. Out of scope (for this plan)

- **Translating job content** (titles, descriptions, company names) — these come from the database; translation would require localized content or a separate translation pipeline.
- **Date/number formatting** — use locale in `Intl` (e.g. `toLocaleDateString(locale)`) so dates and numbers follow the selected language.
- **Recruiter/admin UI** — this plan focuses on worker-facing job and assignment layouts only.

---

## 7. Files to touch

| File | Action |
|------|--------|
| `public/i18n/locales/en.json` | Add new `jobs.*` keys |
| `public/i18n/locales/es.json` | Add same keys with Spanish values |
| `i18n/locales/en.json` | Mirror new keys |
| `i18n/locales/es.json` | Mirror new keys |
| `src/pages/JobPostingDetail.tsx` | Replace hardcoded strings with `t()` |
| `src/pages/PublicJobsBoard.tsx` | Use `t()` for status button labels in `getApplicationStatusButton()` |
| `src/pages/AssignmentDetails.tsx` | Audit and add any missing `t()` / es keys |
| `src/pages/c1/workers/assignments.tsx` | Verify all strings use i18n |
| `src/components/worker/assignments/WorkerAssignmentCard.tsx` | Verify i18n |

Once these are done, job posting and assignment layouts will be fully driven by i18n for both EN and ES.
