# Worker UI — Interaction System

**Scope:** C1 worker view (securityLevel 0–4). Progressive enhancement only; no removal of existing UI or flows.

**Goals:** Responsive feedback, mobile-friendly interactions, consistent toasts and loading, clear success states.

**Admin separation:** All interaction enhancements (card press, gestures, bottom sheets, heavy animation) apply to worker UI only. Admin/recruiter interfaces do not inherit these; they remain optimized for dense data and power-user workflows.

---

## 1. Button press animation (150ms scale feedback)

- **Standard:** On press/active state, apply `transform: scale(0.98)` with `transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Implementation:** Theme override on `MuiButton` and `MuiIconButton`: `'&:active': { transform: 'scale(0.98)' }` with the easing above.
- **Touch:** Same feedback on touch (active state). No delay; 150ms feels responsive.

---

## 2. Card hover and tap interactions

- **Hover (desktop):** Slight shadow lift and border darkening (worker theme). Transition 120ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Tap / active (mobile + desktop):** On press, `transform: scale(0.985)` with 150ms transition so cards feel more tactile.
- **Implementation:** Theme `MuiCard`: `'&:active': { transform: 'scale(0.985)' }`. `MuiCardActionArea`: `:active` background; minHeight 44 for tap target.

---

## 3. Toast notification system (success, error, warning, info)

- **API:** `useWorkerToast()` → `showToast(message, severity?, options?)`, plus `success`, `error`, `warning`, `info`. Severity: `'success' | 'error' | 'warning' | 'info'`.
- **Stacking:** Up to 3 visible toasts; new toasts push older ones upward; oldest auto-dismisses first; additional toasts queue until a slot opens.
- **Placement:** Bottom-center on mobile; top-right on desktop.
- **Entrance:** Fade + slide up 120ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Styling:** Alert variant filled; success (green), error (red), warning (amber), info (blue). Max width on large screens.
- **Rules:** No toasts for every keystroke; use for save confirmations, errors, and important notices.

---

## 4. Bottom sheet drawers for mobile interactions

- **Component:** `WorkerBottomSheet` — MUI `Drawer` `anchor="bottom"`, rounded top corners (20px), drag handle, min height 40vh, swipe-down to close.
- **Animation:** 180ms translateY(100%) → 0; backdrop fade 180ms. Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Use bottom sheets for:** Job details, filters, notifications, quick actions, secondary information.
- **Do NOT use bottom sheets for:** Destructive confirmations, legal agreements, critical decision prompts — use modals for those.
- **Rules:** Bottom sheet = progressive disclosure; critical confirmations use modals.

---

## 5. Modal usage rules (only for confirmations)

- **Use modals only for:** Confirmations (e.g. “Cancel assignment?”, “Delete?”), critical decisions that require explicit Accept/Cancel.
- **Do not use modals for:** General content display, long forms, or non-blocking info. Use inline expansion, bottom sheets, or toasts instead.
- **Implementation:** No code change required; follow this rule when adding new flows. Existing dialogs remain.

---

## 6. Skeleton loading states

- **Standard:** MUI `Skeleton` with worker theme: neutral background, **shimmer animation** (1.6s infinite linear), border radius 12. Match the shape of final UI elements.
- **Where:** Card placeholders, list rows, profile sections while data loads. Same structure as final content where possible (avoid layout shift).
- **Duration:** Show skeleton until first meaningful data arrives; then transition to content (optional short fade).

---

## 7. Page transition animations (140ms fade/slide)

- **Standard:** Route changes: 140ms fade + short slide (opacity 0→1, translateY 8px→0). Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Implementation:** `WorkerPageTransition` wraps the worker outlet; key by `location.pathname` so each route change animates.

---

## 8. Motion consistency

- **Press feedback:** 150ms.
- **Page transitions:** 140ms.
- **Bottom sheets:** 180ms.
- **Hover states:** 120ms.
- **Easing:** `cubic-bezier(0.2, 0.8, 0.2, 1)` for all of the above.
- Motion should be subtle and consistent across the worker UI.

---

## 9. Loading states for async actions

- **Button loading:** When a button triggers an async action, use `WorkerLoadingButton` with `loading` prop: replace label with spinner, disable button, maintain size (minWidth when loading). Example flow: “Apply Now” → spinner → success toast.
- **Page loading:** If page content requires async fetch, show skeleton placeholders that match the final layout.
- **Inline loading:** For background saves or updates, show small inline indicators (e.g. “Saving…” or a small spinner) without blocking the UI.

---

## 10. Tap target standards

- **Minimum height:** 44px for buttons, icon buttons, tappable cards (e.g. `CardActionArea`), navigation items, form inputs.
- **Implementation:** Worker theme enforces minHeight 44 on `MuiButton`, `MuiIconButton`, `MuiListItemButton`, `MuiCardActionArea`, and minHeight 44 on outlined inputs. Ensure spacing supports touch accessibility.

---

## 11. Success state reinforcement

- **Component:** `WorkerSuccessState` for persistent completion (e.g. profile saved, document uploaded, onboarding complete).
- **Visual:** Green success color, CheckCircle icon, optional subtext. Smooth fade-in 120ms. No celebratory animations.
- **Use toasts for:** Transient success (e.g. “Saved”). Use inline success state for section-level “complete” feedback.

---

## 12. Future gesture support (prepared, not active)

The system is structured so the following can be added later without breaking changes:

- **Swipe-to-dismiss** for notifications (e.g. in AppBar dropdown or list).
- **Pull-to-refresh** on lists (e.g. assignments, documents).
- **Card long-press** for contextual actions.

Do not activate these behaviors yet. When adding them, keep them worker-scoped and use the same motion timing (150ms / 180ms) and easing.

---

## 13. Notification swipe-to-dismiss (optional, when implemented)

- **Standard:** In notification list (e.g. AppBar dropdown), list items can support swipe-to-dismiss. Optional; enhance with touch handlers where list is visible.
- **Fallback:** Tap/click to open or dismiss remains. Swipe is additive for mobile.

---

## Implementation notes

- All interactions are additive. Existing buttons, cards, and flows are unchanged in structure.
- Theme overrides live in `workerTheme.tsx`. Toast, bottom sheet, loading button, and success state are worker-specific components/contexts.
- Page transition wraps the main content outlet in `C1WorkerLayout`.
- Admin UI does not use worker theme; it uses the admin theme with no card press, bottom sheets, or worker-specific animations.
