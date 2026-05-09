# Onboarding Specialist rename — Cursor brief

> **Scope:** Rename the CSA (Candidate Success Agent) role to **Onboarding Specialist** throughout the codebase. Narrow the role to user-group scope only (drop the tenant-level fallback). Update the multi-select dropdown on the User Group Details tab. Single PR, mechanical-but-thorough.
>
> **Out of scope (explicit):** Layout changes to `/staff-onboarding` (`src/pages/StaffOnboardingCenter.tsx`). Only update string labels there if they're part of the rename; do not refactor the page. We'll revisit that surface separately.

---

## 1. Why

The original `RECRUITING_ROLE_MODEL.md` defined CSA broadly (welcome calls + ongoing support + first-shift follow-up + onboarding unblockers) and that scope overlapped uncomfortably with the existing Recruiter role. We've decided:

- **Recruiter** absorbs the durable per-worker relationship work that the broad CSA was sharing with it. No code change for this — `primaryRecruiterId` stays as-is.
- **Onboarding Specialist** narrows the CSA name to one specific function: making welcome / onboarding calls. Per-user-group only. No tenant-level fallback.
- **Scheduler** stays unchanged from the doc, applicable to accounts that opt in (implicit — non-empty `account.roles.schedulerIds`).
- **HRX Systems Operator** and **Payroll Coordinator** stay tenant-level, unchanged.

The rename is the immediate work. The doc rewrite is bundled in. Everything downstream (Scheduler triggers, Job Order header chip, etc.) is for a separate future PR.

---

## 2. The rename surface

### 2.1 Schema fields

| Old | New |
|-----|-----|
| `userGroup.roles.csaIds: string[]` | `userGroup.roles.onboardingSpecialistIds: string[]` |
| `tenants/{tid}/settings/roleDefaults.csaFallbackIds` | **delete** — no fallback for this role |

### 2.2 Resolver — `src/shared/resolveRole.ts` (and the duplicate at `shared/resolveRole.ts` if both exist)

- `RecruitingRole` enum: rename `'candidate_success_agent'` → `'onboarding_specialist'`.
- `ResolveRoleUserGroup.csaIds` → `onboardingSpecialistIds`.
- `ResolveRoleTenantDefaults`: delete `csaFallbackIds` field.
- Resolver branch for the role: collapse from two-tier (groups → fallback) to one-tier (groups → unassigned). Specifically, after the `for (const g of ordered)` loop, when no group has any IDs, return `emptyResult()` directly — no fallback step.
- Update file-level docstring and inline comments.

### 2.3 Action queue (mechanical rename, `git mv` for history preservation)

| Old path | New path |
|----------|----------|
| `src/utils/csaActionQueue/` | `src/utils/onboardingSpecialistActionQueue/` |
| `src/utils/csaActionQueue/buildCsaActionItems.ts` | `src/utils/onboardingSpecialistActionQueue/buildOnboardingSpecialistActionItems.ts` |
| `src/utils/csaActionQueue/__tests__/buildCsaActionItems.e7.test.ts` | `src/utils/onboardingSpecialistActionQueue/__tests__/buildOnboardingSpecialistActionItems.e7.test.ts` |
| `src/types/csaActionQueue.ts` | `src/types/onboardingSpecialistActionQueue.ts` |
| `src/hooks/useCsaActionQueueItems.ts` | `src/hooks/useOnboardingSpecialistActionQueueItems.ts` |
| `src/components/staffOnboarding/CsaActionQueue.tsx` | `src/components/staffOnboarding/OnboardingSpecialistActionQueue.tsx` |
| `src/components/staffOnboarding/__tests__/CsaActionQueue.e7.test.tsx` | `src/components/staffOnboarding/__tests__/OnboardingSpecialistActionQueue.e7.test.tsx` |

Inside those files, rename:

- Type `CsaActionItem` → `OnboardingSpecialistActionItem`
- Function `buildCsaActionItems` → `buildOnboardingSpecialistActionItems`
- Function `csaActionItemMatchesSearch` → `onboardingSpecialistActionItemMatchesSearch`
- Hook `useCsaActionQueueItems` → `useOnboardingSpecialistActionQueueItems`
- Component `CsaActionQueue` → `OnboardingSpecialistActionQueue`
- Update all imports across the codebase to match (`grep -r "csaActionQueue"` and `grep -r "CsaAction"` to find them).

### 2.4 User-facing labels

- `src/pages/RecruiterUserGroupDetails.tsx` (around line 425+) — the existing CSA dropdown becomes the Onboarding Specialist dropdown. Specifically:
  - Update the field label from "Candidate Success Agents" (or whatever the current copy says) to **"Onboarding Specialists"**.
  - Update placeholder text accordingly.
  - Update the `initialCsaIds` prop name and internal state to `initialOnboardingSpecialistIds` / `onboardingSpecialistIds`.
  - Read `group.roles?.onboardingSpecialistIds ?? group.roles?.csaIds ?? []` (defensive read during transition; legacy field as fallback).
  - Write only `'roles.onboardingSpecialistIds': ids`. Do not write `csaIds`.

- `src/pages/AgencyProfile/components/UserGroupDetails.tsx` (around lines 220–226 and 381) — same treatment:
  - Read `data?.roles?.onboardingSpecialistIds ?? data?.roles?.csaIds ?? []`.
  - Write `'roles.onboardingSpecialistIds': ids`.
  - Update the autocomplete label (around line 1208) from "Candidate Success Agents" / "CSAs" to "Onboarding Specialists" / "Select Onboarding Specialists".
  - Update inline comments referencing `roles.csaIds` to point at the new field.

- Any other user-facing string that says "CSA", "Candidate Success Agent", "Candidate Success Agents" — replace with "Onboarding Specialist" / "Onboarding Specialists". Search both `src/` and `functions/src/`. Skip strings inside test fixtures that intentionally test legacy data shapes.

### 2.5 Cloud Functions (`functions/src/`)

- `functions/src/recruiting/onUserGroupRolesOrMembersChange.ts` — the trigger that watches `userGroup.roles.csaIds`. Update to watch `roles.onboardingSpecialistIds` (preferred) AND `roles.csaIds` (legacy fallback) during the transition window. The defensive read pattern: `const ids = data?.roles?.onboardingSpecialistIds ?? data?.roles?.csaIds ?? []`.
- `functions/src/types/actionItemOwnership.ts` — rename type members and string identifiers.
- `functions/src/workforce/setAccountWorkforceStatus.ts` — rename references in the gate-logic comment block. The functional behavior of the gate doesn't change in this PR (that's a different ticket); just update the names.

### 2.6 Doc rewrite — `docs/RECRUITING_ROLE_MODEL.md`

Rewrite §2.1 (was "Candidate Success Agent (CSA)") as **§2.1 Onboarding Specialist** with the narrowed scope: "Mission: make welcome / onboarding calls to new workers in their group. Scope: per user group. No durable per-worker ownership — that's the Recruiter."

Update §3.1 (resolution tiers): collapse to one tier (groups → unassigned). Drop the tenant-default fallback line.

Update §4.1 (User Group schema additions): change `csaIds` to `onboardingSpecialistIds`.

Update §4.3 (tenant `roleDefaults`): drop the `csaFallbackIds` line.

Update §5.1 (Owner block on user profile header): the CSA label change is no longer relevant — the header continues to show Recruiter. Replace the §5.1 prescription with: "No change — the user profile header continues to show the Recruiter (`primaryRecruiterId`)."

Update §6 (migration plan): drop Phase 1 entirely. Phase 2 simplifies to "add `userGroup.roles.onboardingSpecialistIds` and `account.roles.schedulerIds` only". Other phases stay similar.

Add a short changelog note at the top of the doc explaining that the model was simplified from four record-scoped roles to two record-scoped roles (Recruiter + Scheduler) plus one narrow specialty (Onboarding Specialist) plus the two tenant-level roles.

---

## 3. Firestore data migration

A small one-shot script copies existing `userGroup.roles.csaIds` to `userGroup.roles.onboardingSpecialistIds` for every user group document.

- Location: `functions/.scratch/migrateCsaToOnboardingSpecialist.ts`
- Pattern: mirror `createAuthForMigrants.ts` shape — `--dry-run` default, `--write` for the actual migration, structured JSON output to `.scratch/`.
- Behavior:
  - Iterate `tenants/{tid}/userGroups/{gid}` collection groups (or wherever user group docs live — verify path before running).
  - For each doc: if `roles.csaIds` exists and is a non-empty array, AND `roles.onboardingSpecialistIds` is missing or empty, set `roles.onboardingSpecialistIds = roles.csaIds`.
  - Do **not** delete `roles.csaIds` in this run. Code reads both during the transition window. A separate cleanup script can drop the legacy field after two weeks.
- Run order:
  1. Deploy code changes (which read both fields).
  2. Run migration script with `--dry-run` to preview.
  3. Run with `--write`.
  4. Two-week soak.
  5. Separate cleanup PR drops the legacy `csaIds` reads from code.

---

## 4. Files that don't change

- `src/contexts/AuthContext.tsx`, `src/guards/RequireRoles.tsx`, `src/utils/routeProtection.tsx`, `functions/src/auth/inviteUser.ts` — security-role layer (Firebase Auth claims still include `'Recruiter'`), untouched.
- `shared/resolveOwnership.ts` — legacy resolver for `primaryRecruiterId`, untouched. Recruiter resolution is unchanged.
- `src/pages/StaffOnboardingCenter.tsx` — the `/staff-onboarding` layout. Update string labels only (CSA → Onboarding Specialist) where they appear in the file. **Do not refactor the layout.** That's a separate ticket.

---

## 5. Definition of done

- Schema field on user groups is `roles.onboardingSpecialistIds`. Both editors (RecruiterUserGroupDetails and AgencyProfile/UserGroupDetails) write it.
- Both editors read the new field with defensive fallback to legacy `roles.csaIds` for one transition window.
- `resolveRole.ts` exports the role identifier `'onboarding_specialist'`, has a one-tier walk (groups → unassigned), and has no `csaFallbackIds` reference.
- Action queue files renamed via `git mv`; all imports updated; tests rename-aligned and passing.
- All user-facing strings in `src/` and `functions/src/` say "Onboarding Specialist(s)" — `grep -ri "csa\|candidate success agent"` returns only legacy/test/doc-history hits.
- Migration script committed in `functions/.scratch/migrateCsaToOnboardingSpecialist.ts` and verified with `--dry-run` against staging.
- `npx tsc --noEmit` clean across `src/` and `functions/src/`.
- `npm test` (or whatever the unit-test command is) passes.
- `docs/RECRUITING_ROLE_MODEL.md` rewritten reflecting the new model (per §2.6 above).

---

## 6. Notes for whoever picks this up

- The `git mv` for the action queue rename touches a lot of imports. Batch them as a single commit so the diff reads as a rename, not 30 unrelated file edits.
- The defensive read pattern (`onboardingSpecialistIds ?? csaIds ?? []`) is a deliberate transition affordance — don't optimize it out. After the post-migration soak, a follow-up PR drops the legacy fallback.
- If you find a CSA reference in a place that this brief didn't anticipate (some shared helper, a Slack-routing module, a workflow doc), update it the same way: defensive read, write new field only, label says Onboarding Specialist. Then add a note to the PR description so the next person knows the rename surface was wider than this brief expected.
- Don't touch `recruiter` references unrelated to CSA — those are the security role / generic recruiter ownership references and they stay.
