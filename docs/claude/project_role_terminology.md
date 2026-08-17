# role terminology

> Two distinct concepts that briefs sometimes conflate — "Recruiter" is the Firebase Auth security role + per-worker durable relationship; "Onboarding Specialist" is a per-user-group operating-role assignment for welcome calls

The codebase distinguishes two concepts that share surface-level vocabulary:

- **Recruiter** = the Firebase Auth security role (the claim in `roles[tenantId].role`) **and** the per-worker durable relationship (`users.{uid}.primaryRecruiterId`, resolved by `shared/resolveOwnership.ts`). This is unchanged from the historical model.
- **Onboarding Specialist** = a narrow per-user-group operating-role assignment (`userGroup.roles.onboardingSpecialistIds`), responsible only for welcome / onboarding calls. Formerly called "CSA" (Candidate Success Agent); renamed in commit `4525d357`. No tenant-level fallback by design — unassigned is a legitimate operational signal.

**Why:** Earlier drafts had CSA scoped broadly enough to overlap uncomfortably with Recruiter. The simplification (logged in `docs/RECRUITING_ROLE_MODEL.md`'s top-of-doc changelog) split the durable-relationship semantics into Recruiter and kept "Onboarding Specialist" as a narrow specialty.

**How to apply:**
- Don't add `'OnboardingSpecialist'` to the Firebase Auth security-role enum (`functions/src/auth/inviteUser.ts:11`). It's an operating-model assignment, not a security claim.
- Don't touch `shared/resolveOwnership.ts` or `users.{uid}.primaryRecruiterId` when working on Onboarding Specialist features — they're a different concept.
- During the rename transition window, code reads `roles.onboardingSpecialistIds ?? roles.csaIds ?? []`. Don't optimize this fallback out — a future cleanup PR (post two-week soak) removes it.
- Don't repurpose `userGroup.groupManagerIds` — it means admin rights on the group, not role assignment.
