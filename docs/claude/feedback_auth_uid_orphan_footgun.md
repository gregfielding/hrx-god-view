# auth uid orphan footgun

> Four signup entry points create fresh Auth UIDs instead of reusing the existing Firestore UID when a doc with the same email already exists — bulk-import / migration work must explicitly reuse Firestore UIDs to avoid orphaning user docs

When a worker has an existing Firestore `users/{uid}` doc and then self-services signup (apply Wizard, Auth dialog, profile form, invite), the signup path calls `admin.auth().createUser({ email, ... })` **without** a `uid` argument, which mints a brand-new Auth UID. The Firestore doc keyed by the *old* UID is then orphaned — the new Auth user has no matching Firestore doc, and the old Firestore doc has no signed-in human.

**Why:** Burned us during the BI.0 Tempworks emergency migration. One confirmed orphan (`s1rKlhmC...` against migration doc UID `U6IFEStl...`) required manual relinking; at scale this would have been catastrophic. The four entry points that have this gap:

- `src/Wizard.tsx:1582`
- `src/AuthDialog.tsx:347` (verify path — may have drifted)
- `src/OnboardingProfileForm.tsx:161` (verify path)
- `functions/src/auth/inviteUser.ts`

**How to apply:**
- Any new bulk-import / migration code MUST pass `uid: firestoreUid` to `admin.auth().createUser({ uid, email, ... })`. The pattern is in `functions/.scratch/createAuthForMigrants.ts` from the BI.0 work.
- Likewise, anything that calls `runStartOnCallEmploymentFlow({ uid, ... })` must pass the existing Firestore UID — calling without it and letting downstream code mint an Auth UID has the same orphan effect.
- If you find yourself touching one of the four signup entry points for any reason (especially BI.1 or future migration features), proactively flag the orphan-creation gap and offer to fix it as a separate PR — don't bundle silently into unrelated work.
- Don't trust grep for this pattern; the call may be one layer deep through a helper. Trace the actual `createUser` call.
