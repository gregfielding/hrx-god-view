# Worker profile photos — where they come from, why uploads died, what changed (2026-09-06)

Greg 2026-09-06: "we aren't getting many profile pic uploads recently… a
worker adding a profile pic should improve their Tier… if they don't have an
image it should be one of their action items on the homepage." All four fixes
below shipped the same day (web + functions + Flutter).

## Where a worker photo lives

| Writer | Storage path | Firestore fields on `users/{uid}` |
|---|---|---|
| Web apply wizard headshot step (`src/components/apply/steps/ProfilePictureStep.tsx`) | `profile-pictures/{timestamp}-{filename}` (flat, unauthenticated write allowed) | `avatar` |
| Web profile page (`WorkerBasicIdentityCard.tsx`, `JobReadinessFeed.tsx`) | `avatars/{uid}.jpg` (overwrite) | `avatar`, `workerProfile.photoUrl` |
| Flutter (`headshot_capture_screen.dart`, `profile_edit_screens.dart`) | `profile-pictures/{uid}/{ts}.ext` | `avatar`, `workerProfile.photoUrl`, `photoUrl` |
| Staff (`UserProfileHeader.tsx`) | `avatars/{uid}.jpg` | `avatar` |

Readers must coalesce all three fields (`workerProfile.photoUrl ?? avatar ??
photoUrl`, plus the literal dotted key `'workerProfile.photoUrl'` on old
docs). `shared/workerTierScoring.ts#hasWorkerProfilePhoto` is the canonical
predicate. The Cloud Vision verifier (`functions/src/avatar/`) keys on
`avatar` only, and the accept-shift headshot gate has been "any photo passes"
since 2026-04-24.

Counting uploads: `gcloud storage ls --json 'gs://hrx1-d3beb.firebasestorage.app/profile-pictures/**'`
(and `avatars/**`) → `metadata.timeCreated`. Probe scripts:
`functions/.scratch/probe_avatars*.ts`, `probe_funnel.ts` (gitignored).

## What happened (the drop)

| Month | wizard uploads (`profile-pictures/`) | profile-page uploads (`avatars/`) |
|---|---|---|
| 2026-06 | 1,733 | 203 |
| 2026-07 | 1,076 | 181 |
| 2026-08 | 419 | 85 |
| 2026-09-01..06 | **0** | 50 |

- **2026-08-25** `fdcbf5e3` + `1c6d58c6` + `06f59956`: on the headshot step the
  nav's primary button became "Skip for now" and Take/Upload were shrunk.
  Daily wizard uploads went ~40 → ~15.
- **2026-08-29** `53d39d71`: the headshot step (5) was removed from the
  wizard step list for every flow ("lives on in the Work Profile checklist"
  — no such checklist is mounted on web, and the Flutter completeness meter
  has no photo item). Wizard uploads → 0 from 08-30. Applications kept
  coming (30–45/day in September), so this was the UI, not traffic.
- **2026-08-23** `21b2bca2` (worker-app P0, Greg): `add_profile_photo` joined
  `PROFILE_NAG_IDS` and was stripped from the Home action-items snapshot;
  Flutter followed on 08-29 when Action Items V2 defaulted on. The item was
  still being BUILT server-side, then discarded.
- **Since 2026-04 → fixed 2026-09-04** `7119bb8d`: the Flutter nested path had
  no `storage.rules` match → every app upload permission-denied, hidden by a
  bare `catch (_)` in both Flutter upload screens.

## What shipped 2026-09-06

1. **Photo nudge is back on Home and sticky** — server
   `workerDashboardActionItemsModel.ts#buildStickyProfileItems` emits
   `add_profile_photo` outside the DOB/phone early-return gates; contract
   `sourceVersion` 1→2 plus `WORKER_DASHBOARD_ACTION_ITEMS_HOME_STICKY_IDS`
   (`src/shared/workerDashboardActionItemsV1.ts`,
   `functions/src/readiness/workerDashboardActionItemsTypes.ts`, Flutter
   `kWorkerDashboardActionItemsHomeStickyIds`). Web hook + Flutter provider
   render top-3 by priority THEN append sticky items, so the photo card is
   never squeezed out by work items. Recompute now rewrites when
   `sourceVersion` differs even if `inputsHash` matches; one-off backfill
   `functions/.scratch/backfill_action_items_photo.ts` ran after deploy.
   Dismiss still works (`workerProfile.dashboard.dismissedActionItems`).
2. **Headshot step back in JOB applications** (`Wizard.tsx`
   `visibleStepIndices`: 5 inserted before 6 when `jobId`; generic signup
   stays short). Take Photo is `contained/large`, Upload `outlined`, and the
   nav's Skip is a `text` button until a photo exists (then it reads Next).
   Flutter apply already had this hierarchy (FilledButton Take headshot +
   TextButton Skip) — parity holds.
3. **Scoring** — `hasProfilePhoto` reads all photo fields (was `avatar`
   only). Profile completion (25-pt tier factor + recruiter profile score)
   now gives **5 pts for a photo** and dropped the "updated within 30 days"
   5-pt bonus; changed in lockstep in `shared/workerTierScoring.ts` (3
   mirrors), `src/utils/applicantScoring.ts`, and
   `functions/src/calculateApplicantFitScore.ts`. A photo is therefore worth
   5 (photo factor) + ~1.25 (25 × 5/100) tier points.
4. **Flutter error surfacing** — both upload screens catch
   `FirebaseException` first and show `(code)` in the message + `debugPrint`.
   Ships in 1.0.1 (1.0.0 is in store review).

## Accept-shift headshot gate — re-armed 2026-09-06 (Greg: "make the headshot gate real")

History: Phase 4 required `avatarVerification.status === 'approved'`; Vision
false positives stranded legit workers → relaxed 2026-04-24 (`c6ea0fb4`, any
avatar passes) → pulled from `respondToAssignment` entirely 2026-06-07 because
the SMS one-click accept link surfaced a bare error with no way to add a photo.

Policy now (`functions/src/avatar/headshotAcceptGate.ts#evaluateHeadshotGate`,
pure + tested):

| worker doc | result |
|---|---|
| no photo in any of the 4 fields | BLOCK `HEADSHOT_MISSING` |
| current photo rejected for `no_face` / `multiple_faces` / `inappropriate` / `manual_override` | BLOCK `HEADSHOT_REJECTED` (+reason) |
| rejected for `face_too_small` / `too_blurry` / `too_dark` | allow (Home nudge + profile pill carry the retake ask) |
| approved / pending / error / no record / record for an older photo | allow |
| no photo BUT a prior confirmed/active/ended assignment, before **2026-09-21** | allow (`grace_period`) — Greg 2026-09-06, because 54 of the 121 active-crew workers had no photo when the gate went live; `HEADSHOT_GATE_GRACE_ENDS_AT_MS`, one indexed `assignments` query only when the answer would otherwise be MISSING. Delete the clause after the date. |

It never blocks on our own pipeline — only on "no photo" or "plainly not a
headshot". Data at re-arm: 5,246 C1 photos, 92% approved, 8% rejected (185
face_too_small, 126 no_face, 16 multiple_faces, 11 too_dark, 1 too_blurry);
the 924 never-verified photos were backfilled with
`functions/.scratch/backfill_avatar_verification.ts` (local Vision via ADC,
~$1.40). Recruiter-on-behalf `confirmAssignmentForWorker` stays ungated; Phase
5 recruiter approve (`avatarVerification.status='approved'`) is the override.

Client UX that makes it safe to re-arm: web `AssignmentDetails` (the SMS
`?intent=accept` landing) renders `src/components/worker/HeadshotGateCard.tsx`
— take/upload inline, writes `avatars/{uid}.jpg` + `avatar` +
`workerProfile.photoUrl`, then re-fires the accept. `JobPostingDetail` still
uses the older confirm-dialog → profile-page path. Flutter:
`headshot_gate_bottom_sheet.dart` → `HeadshotCaptureScreen` (unchanged, parity
holds). ☠️ Any new surface that calls `respondToAssignment(accept)` must handle
the `failed-precondition` + `details.code = HEADSHOT_*` error with a photo
CTA, or we recreate the June dead end.

## Footguns

- ☠️ A Home-feed rule change needs the `sourceVersion` bump or existing
  snapshots never refresh (the hash only fingerprints inputs).
- ☠️ `buildProfileItems` early-returns on the DOB and phone gates; anything
  that must always surface has to be built outside it (see sticky builder).
- Wizard step 5 stays skippable on purpose (no hiring-gate value); the
  lever is CTA hierarchy, not a hard gate — the 08-25 "make Skip the loud
  button" sizing is what halved uploads.
- The `profile-pictures/{timestamp}-{filename}` flat path has no uid; counting
  per-worker uploads needs the user doc's `avatar` URL, not Storage.
