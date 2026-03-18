# Recruiter Onboarding SOP (Launch Week)

Internal use only. Keep this workflow simple and consistent during launch week.

## 1) Where to find Onboarding

- Left nav: `Onboarding`
- Route: `/jobs/onboarding`
- Page title: `New Hires / Onboarding`

## 2) How to manually trigger onboarding

Use manual trigger when a worker should be onboarded but no pipeline exists yet.

1. Open `/jobs/onboarding`.
2. In **Trigger onboarding manually**, enter:
   - Worker UID
   - Assignment ID
   - (Optional) Job Order ID
   - (Optional) Entity ID
3. Click **Trigger onboarding**.

## 3) How to read status chips

Row-level chips:

- **Confirmed assignment**: assignment is linked to this onboarding pipeline.
- **No assignment linked**: pipeline exists, but no assignment ID is attached.
- **Onboarding in progress**: pipeline is not complete yet.
- **Onboarding complete**: all tracked steps are complete.
- **Blocked critical step**: at least one critical step is blocked and needs recruiter action.
- **N critical pending**: number of critical steps still not complete.

Step-level chips:

- **Applicability**: `Required`, `Not required`, or `Pending`.
- **Status**: current step state (for example `Not started`, `In progress`, `Blocked`, `Complete`).

## 4) How to update step statuses

1. Find the worker row.
2. In the step list, click **Update** next to the step.
3. Select the new status and save.
4. Confirm row chips refresh (critical pending count should reduce as steps complete).

## 5) If worker is confirmed but onboarding is incomplete

Do not block assignment operations in MVP. Run this sequence:

1. Confirm worker has a linked pipeline (`Confirmed assignment` chip).
2. Prioritize critical steps first: `i9`, `onboarding_forms`, `e_verify`, `background_check`, `drug_screen`.
3. Move blocked steps out of `Blocked` by updating status and assigning follow-up owner.
4. If no pipeline exists, trigger manually immediately.
5. Keep recruiter notes/ops tracking outside this screen as needed until full automation is added.

