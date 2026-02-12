# HRX / C1 — Job Readiness (Worker Profile) Refactor Spec

## Route
`/c1/workers/profile`

## Objective
Refactor the existing Qualifications/Profile page into a worker-first **Job Readiness** experience.

This page must:
- Feel lighter, clearer, and more motivational than admin views.
- Preserve all existing logic and data wiring.
- Not modify or impact admin routes or admin views.
- Match the visual language of the new Worker Dashboard and Assignments pages.

---

# Design Direction

Tone: Hybrid (Professional + Subtle Progress Cues)  
Voice: Slightly motivational (“Unlock more shifts”)  
Audience: Light industrial / hospitality workers  

This page is the engine behind placement velocity.

Workers should feel:
- Guided
- Progressing
- In control

Not:
- Managed
- Audited
- Data-entering for HR

---

# Implementation Strategy

## Phase 1 — Layout & UX Refactor Only

- Keep all existing profile logic intact.
- Reorganize UI structure.
- Add readiness hero section.
- Convert modules into Accordion layout.
- Reduce visual density.
- Add placeholder readiness scoring (static).

## Phase 2 — Real Completion Logic (Later)

- Calculate readiness % dynamically.
- Generate unlock prompts dynamically.
- Tie to Dashboard + Alerts.

Do NOT implement scoring logic yet.

---

# Page Structure

## 1️⃣ Readiness Hero Section

Top card layout:

Left side:
⭐ Job Readiness  
72% Complete

Right side:
LinearProgress bar

Below progress bar:
“You're eligible for 14 roles.  
Add 2 more items to unlock 6 additional shifts.”

### v1
Use static values:

const readinessPercent = 72;

Add TODO comment:

// TODO v2: derive from profile fields:
// - availability
// - work experience count
// - certifications
// - bio length
// - skills count

---

## 2️⃣ Unlock Prompts Section

Below hero card.

Render 2–3 outlined Alerts:

🔓 Add availability → Unlock 4 more shifts  
🔓 Add a certification → Qualify for higher-paying roles  
🔓 Add work experience → Increase your match rate  

v1: static.  
v2: conditional based on missing fields.

Use:
- MUI Stack
- Alert variant="outlined"

---

## 3️⃣ Accordion Modules (Reordered)

Replace vertical dense layout with Accordion structure.

Order must be:

1. Availability & Preferences  
2. Work Experience  
3. Certifications  
4. Skills  
5. Bio  
6. Education  
7. Languages  

### Important
Availability moves to the top — it drives placement.

---

# Refactor Rules

Cursor must:

- Reuse existing components/forms inside each section.
- Wrap each section in MUI Accordion.
- Remove excessive nested gray containers.
- Reduce box shadows.
- Increase vertical spacing.
- Keep admin views untouched.

If worker profile shares components with admin:
- Create worker-specific wrapper components.
- Do NOT modify admin component styling directly.

---

# Layout Spec

Page wrapper:

Container maxWidth="md"
Stack spacing={4} py={2}

Accordion:
- Minimal elevation
- Subtle border
- No heavy background fill

Headings:
- Slightly larger than previous implementation.
- Add short subtext below section titles.

---

# Visual Cleanup Requirements

Remove:
- Excess gray boxes
- Over-segmentation
- Dense field stacking

Add:
- More white space (32px rhythm)
- Clear section headers
- Cleaner spacing hierarchy
- Fewer edit icons
- Clear CTAs where relevant

Workers see direction.  
Admins see records.

---

# Acceptance Criteria

- `/c1/workers/profile` renders new layout.
- Readiness hero visible.
- Accordion modules functioning.
- Existing forms still work.
- No admin views changed.
- Build succeeds.

---

# Cursor Build Order

1. Refactor layout only.
2. Add readiness hero with static percentage.
3. Convert modules to Accordion.
4. Reduce density.
5. Add TODO blocks for readiness scoring.
6. Verify no admin regression.

---

# Important Structural Check

Before implementing:

Cursor must determine:

Does `/c1/workers/profile` reuse the same component as `/users/:id` (admin profile)?

If YES:
- Create worker-specific wrapper layout.
- Do not modify admin presentation layer.

If NO:
- Refactor directly within worker namespace.

Leave a comment at the top of the file noting which structure was found.

---

# Future Completion Logic (Reference Only — Not Yet)

Possible scoring model:

Availability filled → 20%  
1+ Work Experience → 20%  
1+ Certification → 15%  
Skills ≥ 5 → 15%  
Bio length ≥ 120 chars → 10%  
Education filled → 10%  
Languages ≥ 1 → 10%  

Do not implement yet.

---

# Final Principle

Admin sees records.  
Worker sees progress.

This refactor must:
- Feel lighter
- Feel intentional
- Feel motivating
- Feel professional

Do not break admin.
Only refactor worker namespace.
