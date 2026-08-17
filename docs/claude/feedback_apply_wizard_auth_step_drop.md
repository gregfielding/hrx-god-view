# apply wizard auth step drop

> Apply/signup wizard restores activeStep from localStorage/?step= without checking auth — can drop logged-out workers past account creation

`src/components/apply/Wizard.tsx` restores `activeStep` from `localStorage[stepStorageKey]` or the `?step=` query param **without checking auth state**. Account creation only runs at step 0 (Personal Info). So a logged-out worker who resumes (or lands with a saved/param step) can be dropped PAST step 0 → reaches the final step with no account → dead-ends on `apply.completePersonalInfo` ("complete the Personal Info step before submitting"). Worse when later steps auto-skip (`visibleStepIndices`) so the headshot (step 5) becomes the last visible step and its Submit hits the guard.

**Why:** real production outage 2026-06-16 — multiple workers stuck at the headshot step, unable to sign up.

**How to apply:** an unauthenticated wizard MUST start at the account-creation step. Fix (commit after fd1ed522): (1) `auth.onAuthStateChanged` guard that snaps `activeStep` back to 0 when logged out — gate on the listener so it never resets a genuinely-authenticated resuming worker mid auth-restore; (2) the submit no-account guard routes to the Personal Info step instead of dead-ending. Step order: 0 Personal Info (account created here) → 1 Address → 2 Resume → 3 eVerify → 4 WorkElig → 5 ProfilePicture(headshot) → 6 Skills → … → 12 Requirements. Entity 1099 (C1 Events) skips step 4; `?step=` jump param exists. See [[project_conventions]].
