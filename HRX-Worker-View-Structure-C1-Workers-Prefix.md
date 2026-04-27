# HRX Worker View Outline — `/c1/workers/*` Prefix (Placeholder Build Spec)

## Objective

Introduce a dedicated worker namespace under:

    /c1/workers/*

This must NOT impact existing admin routes or change existing worker URLs that are already in production.

Existing routes that must remain unchanged:
- /c1/applications  (My Applications table — already built)
- /c1/jobs-board    (Jobs Board — cannot change URL)

This phase builds placeholder structure only. No UI redesign yet.

---

## 1. Worker Route Architecture

### New Worker Routes

- /c1/workers
- /c1/workers/dashboard
- /c1/workers/assignments
- /c1/workers/profile
- /c1/workers/documents
- /c1/workers/support

Behavior:
- /c1/workers → redirect to /c1/workers/dashboard

### Existing Routes (Do Not Modify)

- /dashboard (Admin)
- /users/:id (Admin)
- /c1/applications (Worker-facing — keep as-is)
- /c1/jobs-board (Worker-facing — keep as-is)

---

## 2. Folder / File Structure (Create Placeholders)

Create the following structure:

src/
  layouts/
    C1WorkerLayout.tsx
  auth/
    WorkerRoute.tsx
  components/
    worker/
      WorkerNav.tsx
      WorkerHeader.tsx
      WorkerQuickActions.tsx
      cards/
        NextShiftCard.tsx
        MissingDocsBanner.tsx
        WorkerStatusCards.tsx
  pages/
    c1/
      workers/
        index.tsx
        dashboard.tsx
        assignments.tsx
        profile.tsx
        documents.tsx
        support.tsx

All files should compile with minimal placeholder content.

---

## 3. Worker Layout Requirements

C1WorkerLayout.tsx should:

- Use MUI AppBar + Drawer (or simple sidebar)
- Contain WorkerNav
- Render children inside Container
- Be visually separate from Admin layout
- Not modify Admin layout code

---

## 4. WorkerRoute Guard

Create WorkerRoute.tsx that:

- Uses existing auth context (useAuth or equivalent)
- Allows access only if role is Worker or Applicant
- Redirects unauthorized users to /dashboard
- Wraps all /c1/workers/* routes

Do not modify existing ProtectedRoute logic for admins.

---

## 5. Router Wiring

In the main router file:

Add:

/c1/workers → redirect to /c1/workers/dashboard

Wrap these routes with WorkerRoute + C1WorkerLayout:

/c1/workers/dashboard
/c1/workers/assignments
/c1/workers/profile
/c1/workers/documents
/c1/workers/support

Do not touch admin routes.

---

## 6. Placeholder Page Expectations

index.tsx
- Redirect to /c1/workers/dashboard

dashboard.tsx
- Title: "Worker Dashboard"
- Render:
    MissingDocsBanner
    NextShiftCard
    WorkerQuickActions

assignments.tsx
- Title: "My Assignments"
- Placeholder text only

profile.tsx
- Title: "My Profile"
- Render basic user info from auth context

documents.tsx
- Title: "My Documents"
- Placeholder for work eligibility and uploads

support.tsx
- Title: "Support"
- Placeholder text

---

## 7. WorkerNav Requirements

WorkerNav must include links to:

- /c1/workers/dashboard
- /c1/workers/assignments
- /c1/applications (existing — do not change)
- /c1/jobs-board (existing — do not change)
- /c1/workers/profile
- /c1/workers/documents
- /c1/workers/support

---

## 8. Post-Login Redirect Logic

Modify login success logic:

If role is Worker or Applicant:
    Redirect to /c1/workers/dashboard

Else:
    Redirect to /dashboard

---

## 9. Safety Checklist

- Do not modify admin pages.
- Do not change existing /c1/applications URL.
- Do not change existing /c1/jobs-board URL.
- Only add new worker-prefixed routes.
- Keep shared components reusable where possible.

---

## 10. Cursor Implementation Tasks

1. Create all placeholder files.
2. Implement WorkerRoute guard.
3. Add worker route wiring.
4. Add post-login redirect rule.
5. Ensure build compiles without errors.

Once placeholders are stable, we will implement real UI logic in phases.
