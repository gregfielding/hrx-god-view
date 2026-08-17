# ts1 phase4 state

# TS.1 Phase 4 (Everee timesheet sync) — state of play as of 2026-05-22

Resume context for the Everee batch submission pipeline. All
infrastructure is deployed; we're waiting on operational validation
before greenlighting production payroll runs.

## What's shipped + deployed

**Slices 1–7 all complete and live in production:**

- **Slice 1**: HTTP client w/ 429 retry (`evereeHttp.ts`) — PR #9
- **Slice 2**: Worked-shifts + payables wrappers — PR #10
- **Slice 3**: Work-location + pay-code provisioning — PR #11
- **Slice 4**: Firestore rules — PR #12
- **Slice 5**: Webhook handlers — PR #13
- **Slice 5.5**: Denormalized `shiftId` + `accountId` on entries — PR #15
- **Slice 6a**: Pure payload composition (`composeTimesheetBatchPayloads.ts`) — PR #17
- **Slice 6b**: Orchestrator (`submitTimesheetBatch` callable + worker + finalize) — PR #18
- **Slice 6b hotfix**: work-location wire shape + externalWorkerId resolver — PR #26
- **Submit-to-Everee button** (recruiter UI on TotalsHeader) — PR #25 (Cursor)
- **Slice 7**: Reconciler cron (`reconcileTimesheetBatchesCron`, every 15 min) — PR #27 ⚠️ open

**Adjacent supporting work also shipped this period:**
- Recent Pay card on user profile (#22, #23 — handles `/api/v2/payments`
  + `/api/v2/payables` merged, dual-key filter, multi-entity selector)
- User-group bulk-invite from Indeed CSV (#24)
- Indeed Flex inbound email pipeline Slices 1–4 (PRs #7, #19–21)

## What's blocking the first real prod submission

**Greg-side action items:**

1. **Merge PR #27** (Slice 7 reconciler) — already deployed; PR captures source
2. **Complete sandbox Gregory Fielding's Everee onboarding** — sandbox
   worker stuck at `lifecycleStatus: ONBOARDING`. Until ACTIVE, every
   worked-shift POST gets rejected ("Invalid workers comp code X for CA"
   — misleading error, the real cause is incomplete onboarding). Open
   the sandbox Everee embed for Gregory + complete the W-2 flow → then
   re-run the smoke and it'll go all the way through to a real
   workedShiftId on sandbox
3. **First real prod batch submission** — recruiter approves a real
   entry on a fully-onboarded production worker, clicks Submit-to-
   Everee in `/timesheets`, watch the chain process

## Sandbox infrastructure left in place (reusable)

- `tenants/BCiP2bQ9CgVOCTfV6MhD/entities/c1_sandbox_smoke` — HRX entity
  pointed at Everee tenant 2320 (sandbox), workerType=W2
- `tenants/.../everee_workers/c1_sandbox_smoke__TWXMM1mOJHepmk80Qsx128w9AiS2`
  — linkage for Gregory Fielding (sandbox)
- Smoke runner: `functions/.scratch/invokeSlice6bSmoke.ts` (mints
  admin auth token → invokes deployed callable → returns status)

Synthetic JO / shift / assignment / entry / batch were cleaned up
after the smoke; only the entity + linkage remain for re-use.

## Smoke run procedure (when sandbox worker is onboarded)

```sh
cd functions && set -a && source .env.hrx1-d3beb && set +a && \
  FIREBASE_WEB_API_KEY="<FIREBASE_WEB_API_KEY — public, from src/firebase.ts>" \
  PATH="$HOME/.nvm/versions/node/v20.19.3/bin:$PATH" \
  GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud-claude/service-account.json \
  npx ts-node .scratch/invokeSlice6bSmoke.ts
```

First needs a synthetic JO/shift/assignment/entry/batch re-created
(the smoke deletes them after). Re-create via the same script pattern
used in the May 2026 session (see chat transcript for the exact
Firestore writes — `jo_sandbox_smoke_001` etc.).

## Watching the reconciler cron

```sh
gcloud functions logs read reconcileTimesheetBatchesCron \
  --gen2 --region us-central1 --project hrx1-d3beb --limit 10
```

Should be a no-op (sweep_complete with all zeros) until real batches
flow + something gets stuck.

## What's deferred

- **Indeed Flex Slices 5+ (apply paths)** — Slice 4's `/shifts/log` is
  dry-run-only. Building actual create/update/cancel paths needs
  recruiter approval state machine (per the "always queue for human"
  policy locked in for v1)
- **Per-row "Open in Everee" link** on the Recent Pay card (blocked
  on confirming Everee's admin URL pattern for a specific payment id)
- **Deduction breakdown** on pay statements (blocked on locating a
  richer Everee statement endpoint than `/api/v2/payments`)
