# Worker Action Items V2 — Cursor brief (hrx-god-view: backend + web)

> **Scope:** Move the worker home "Action Items" derivation from the client into a server-written Firestore snapshot, then switch the web dashboard to read that snapshot. After this lands, adding a new action-item ID is a backend-only change; web (and Flutter) just render what's in the snapshot.
>
> **You are working in:** `hrx-god-view/`
>
> **Out of scope here:** Flutter changes — those are in a separate brief (`c1_app/docs/WORKER_ACTION_ITEMS_V2_FLUTTER_CURSOR_BRIEF.md`).

---

## 0. Why this exists

Today the same business logic lives twice:

- Web client: `src/utils/workerDashboardActionItems.ts` (TypeScript, browser).
- Flutter client: `c1_app/lib/features/dashboard/domain/profile_completion_actions_resolver.dart` + `screening_action_items_resolver.dart` (Dart, on-device).

Parity is enforced by the contract doc `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md`. As of writing, Flutter is missing 6 of the 17 contract IDs because the contract is enforced manually.

Pattern to copy: per-assignment readiness already does this correctly via `tenants/{tenantId}/assignments/{assignmentId}.readinessSnapshotV1`. Server computes, both clients render. We are doing the same for the worker home stack.

---

## 1. Target shape

Persist the snapshot at:

```
users/{uid}.workerDashboardActionItemsV1
```

Field shape (TypeScript):

```ts
type WorkerDashboardActionItemId =
  | 'confirm_date_of_birth'
  | 'verify_phone_number'
  | 'add_tax_identity_last4'
  | 'confirm_home_address'
  | 'add_profile_photo'
  | 'add_emergency_contact'
  | 'sms_opt_in'
  | 're_enable_sms_notifications'
  | 'assignment_confirmation_required'
  | 'complete_tempworks_onboarding'
  | 'background_check_action_required'
  | 'background_check_issue_requires_action'
  | 'drug_screen_schedule_required'
  | 'drug_screen_reschedule_required'
  | 'everify_action_required'
  | 'worker_ai_prescreen_interview'
  | 'worker_ai_prescreen_complete_profile';

type WorkerDashboardPriorityTier = 'blocking' | 'important' | 'recommended' | 'snoozable';

type WorkerDashboardActionPrimaryKind =
  | 'navigate'
  | 'enable_sms'
  | 'assignment_accept'
  | 'tempworks_open';

type WorkerDashboardActionSecondaryKind =
  | 'dismiss_firestore'
  | 'snooze_sms'
  | 'assignment_decline';

interface WorkerDashboardActionItemV1 {
  id: WorkerDashboardActionItemId;
  category: WorkerDashboardPriorityTier;
  /** i18n keys, NOT pre-translated strings — clients localize. */
  titleKey: string;
  descriptionKey: string;
  primaryLabelKey: string;
  primaryKind: WorkerDashboardActionPrimaryKind;
  /** Web route. Flutter maps this to its equivalent via `app_routes.dart`. */
  href?: string;
  secondaryLabelKey?: string;
  secondaryKind?: WorkerDashboardActionSecondaryKind;
  /** Lower wins after dedupe. Server applies the contract score table and writes priority numerically here. */
  priorityScore: number;
  /** Diagnostics — recruiter-only / debug; never shown in worker UI. */
  sourceReason: string;
  qaEvaluatedFields: Record<string, unknown>;
}

interface WorkerDashboardActionItemsSnapshotV1 {
  /** Bump if the shape or semantics change. */
  sourceVersion: 1;
  /** Full contract list, sorted by `priorityScore` desc. Clients slice 3 for the home card. */
  items: WorkerDashboardActionItemV1[];
  /** Inputs the snapshot was computed from. Used for change detection / debugging. */
  inputsHash: string;
  /** Server timestamp on every write. */
  updatedAt: FirebaseFirestore.Timestamp;
}
```

Persist the **full sorted list** — not a top-3 slice. The 3-cap is a presentation rule and stays on the clients, so a future "View all" page can render the rest with no extra read.

---

## 2. Where this code lives

Pattern to follow: the existing `readiness/homeSnapshotModel.ts` + `readiness/homeSnapshotTrigger.ts` pair (computes a different snapshot today, but the trigger style is the same).

Create:

| File | Purpose |
|------|---------|
| `functions/src/readiness/workerDashboardActionItemsModel.ts` | Pure: takes the inputs, returns `WorkerDashboardActionItemsSnapshotV1`. No I/O. |
| `functions/src/readiness/workerDashboardActionItemsLoadContext.ts` | Loads the inputs from Firestore (admin SDK). |
| `functions/src/readiness/workerDashboardActionItemsRecompute.ts` | Composes loader + model + Firestore write. Idempotent (skip write if `inputsHash` unchanged). |
| `functions/src/readiness/workerDashboardActionItemsTriggers.ts` | Cloud Functions: trigger fan-outs. |

Export the new functions from `functions/src/index.ts` next to the existing `syncHrxReadinessSnapshotV1` exports.

### 2.1 Pure model — `workerDashboardActionItemsModel.ts`

Port the **logic** of `src/utils/workerDashboardActionItems.ts` (and its dependencies in `src/utils/workerProfileActionItemFacts.ts`, `src/utils/workerComplianceActionDerivers.ts`, `src/utils/workerJobRequirementSignals.ts`, `src/utils/workerAiPrescreenDashboardActions.ts`) into a server module that takes a structured input bag and returns the snapshot.

Important: do **not** simply re-export the web modules. The web ones use Firestore client SDK shapes; the server uses admin SDK shapes. Port logic, not types.

Inputs the model needs:

- `userDoc: Record<string, unknown>` — the `users/{uid}` document.
- `pendingAssignments: Array<{ assignmentId: string; startAtMs: number }>` — assignments needing worker confirmation, computed by the loader.
- `tempworks: { required: boolean; recruiterVerified: boolean; started: boolean; onboardingUrl?: string }` — read from `userDoc.onboarding.tempworks*` per contract §3 TempWorks.
- `compliance: { everifyWorkerAction: boolean; drugScheduleRequired: boolean; drugRescheduleRequired: boolean; backgroundIssueAction: boolean; backgroundApplicantAction: boolean }` — same flags `deriveWorkerComplianceSignals` produces, but computed server-side.
- `prescreen: { interviewItems: WorkerDashboardActionItemV1[] }` — the two AI prescreen items, derived from applications + `users/{uid}/interviews`.
- `dismissals: Set<string>` — read `userDoc.workerProfile.dashboard.dismissedActionItems` (treats `true` and `'true'` as dismissed, web parity).
- **Do NOT include SMS snooze.** That's local-only state on each client and stays out of the snapshot.

The model emits the full sorted list using the score table from the contract:

```
920 assignment_confirmation_required
900 everify_action_required
880 drug_screen_reschedule_required
860 background_check_issue_requires_action
800 complete_tempworks_onboarding
720 background_check_action_required
700 drug_screen_schedule_required
650 confirm_date_of_birth
640 verify_phone_number
610 add_tax_identity_last4
600 confirm_home_address
590 re_enable_sms_notifications
550 worker_ai_prescreen_interview
545 worker_ai_prescreen_complete_profile
400 add_profile_photo
390 add_emergency_contact
100 sms_opt_in
```

Profile Section 1 gating still applies *before* scoring: if DOB invalid → only `confirm_date_of_birth`; else if phone gate fires → only `verify_phone_number`. Then merge job + remaining profile candidates and sort by score.

### 2.2 Loader — `workerDashboardActionItemsLoadContext.ts`

Reads the bag the model needs. Kept separate so the model stays pure-and-testable.

```ts
async function loadWorkerDashboardActionItemsContext(
  uid: string,
  tenantId: string,
): Promise<WorkerDashboardActionItemsContext>;
```

Inside it does the same queries the web `dashboard.tsx` does today, but with the admin SDK:

- `users/{uid}` (the user doc).
- `tenants/{tenantId}/assignments` where `userId == uid` and `assignmentDocNeedsWorkerConfirmation(data)` (port that helper from `src/utils/workerJobRequirementSignals.ts`).
- `backgroundChecks` where `candidateId == uid` and `tenantId == tenantId`, capped at 25.
- `tenants/{tenantId}/everify_cases` where `userId == uid`, capped at 25.
- AI prescreen: applications where `userId == uid` *or* `candidateId == uid`, plus `users/{uid}/interviews` (port from `src/hooks/useWorkerAiPrescreenSurfaceSignals.ts` + `src/utils/workerAiPrescreenDashboardActions.ts`).

Tenant scope: the home dashboard today defaults to `C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD'`. Snapshot the *worker's* tenant. If a worker has multiple tenants (rare on this product), produce one snapshot per tenant under `users/{uid}.workerDashboardActionItemsV1.byTenant.{tenantId}` instead — discuss with Greg before going down that path.

### 2.3 Recompute helper — `workerDashboardActionItemsRecompute.ts`

```ts
export async function recomputeWorkerDashboardActionItemsForUser(
  uid: string,
  tenantId: string,
  reason: string,
): Promise<{ wrote: boolean; snapshot: WorkerDashboardActionItemsSnapshotV1 }>;
```

Idempotent:

1. Load context.
2. Build snapshot via pure model.
3. Compute `inputsHash` (stable JSON.stringify of the input bag, excluding timestamps).
4. Read existing `users/{uid}.workerDashboardActionItemsV1.inputsHash`.
5. If unchanged → return `{ wrote: false, snapshot }`.
6. Else `set({ workerDashboardActionItemsV1: snapshot }, { merge: true })`.

Log `{ uid, tenantId, reason, itemCount, wrote }` at info.

### 2.4 Triggers — `workerDashboardActionItemsTriggers.ts`

Mirror the existing `hrxReadinessSnapshotOn*` set. Each trigger is `onDocumentWritten`, `region: 'us-central1'`, `maxInstances: 5`, `retry: false`, `memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY`.

| Trigger | Document | Recompute condition |
|---------|----------|---------------------|
| `syncWorkerDashboardActionItemsOnUserWrite` | `users/{uid}` | Any of the predicate-input fields changed (DOB, phone, address, last4SSN, photo, emergencyContact, smsOptIn, smsBlockedSystem, smsSystemUnavailable, notificationSettings.smsUnavailable, workerProfile.dashboard.dismissedActionItems, onboarding.tempworks*, workEligibilityAttestation). Also gate on `isC1WorkerScope(after)` like `homeSnapshotTrigger.ts`. |
| `syncWorkerDashboardActionItemsOnAssignmentWrite` | `tenants/{tenantId}/assignments/{assignmentId}` | When `assignmentDocNeedsWorkerConfirmation` flips, or `confirmedAt` / `declinedAt` is written, or `status` changes. Recompute for `userId` on the doc. |
| `syncWorkerDashboardActionItemsOnBackgroundCheckWrite` | `backgroundChecks/{id}` | On any write where `candidateId` is set. Recompute for that candidate + `tenantId`. |
| `syncWorkerDashboardActionItemsOnEverifyCaseWrite` | `tenants/{tenantId}/everify_cases/{caseId}` | Recompute for `userId` on the doc. |
| `syncWorkerDashboardActionItemsOnApplicationWrite` | `applications/{id}` | When `workerAiPrescreenReminderSentAt` / `workerAiPrescreenReminderLastOutcome` change, recompute for `userId` (or `candidateId`). |
| `syncWorkerDashboardActionItemsOnInterviewWrite` | `users/{uid}/interviews/{id}` | When a worker AI prescreen interview is created/updated, recompute. |

Reuse `recomputeWorkerDashboardActionItemsForUser` from §2.3 in each.

Also expose a callable `syncWorkerDashboardActionItemsV1` that takes `{ uid, tenantId }` for the recruiter "force refresh" affordance and tests, mirroring `syncHrxReadinessSnapshotV1`.

### 2.5 Index registration

In `functions/src/index.ts`, export the six triggers + the callable next to the existing `syncHrxReadinessSnapshotV1` block.

### 2.6 Tests (required, not optional)

Create `functions/src/readiness/__tests__/workerDashboardActionItemsModel.test.ts`. Port the relevant golden tests from:

- `src/utils/userActionItems/__tests__/deriveActionItemsV1.certEngine.test.ts`
- `src/utils/userActionItems/rules/__tests__/entityOnboardingRules.workerType.test.ts`
- `src/utils/userActionItems/__tests__/entitySignalsFromEmploymentDocs.ra2.test.ts`

Plus parity tests against the web `buildWorkerDashboardActionItems` for representative cases:

- DOB gate alone.
- Phone gate alone.
- Pending assignment + missing photo → assignment wins.
- Drug schedule + verify phone → score order.
- Both AI prescreen branches.
- Dismissed `add_profile_photo` is excluded.

---

## 3. Web client switch

After the snapshot lands and is being written for live workers in staging, switch the web client to read it.

### 3.1 New hook

Create `src/hooks/useWorkerDashboardActionItemsV1.ts`:

```ts
export function useWorkerDashboardActionItemsV1(uid: string | null): {
  items: WorkerDashboardActionItemV1[] | null;
  loading: boolean;
};
```

Subscribes to `users/{uid}` (already done elsewhere) and reads `workerDashboardActionItemsV1.items`. Returns `null` while the snapshot is missing (worker hasn't been touched since rollout) so the page can fall back.

### 3.2 Apply client-only personalization

The hook returns the raw snapshot. In the dashboard page (or a small adapter), apply:

1. **SMS snooze filter.** Read `localStorage` key `worker_sms_warning_dismiss_until_{uid}`; if `Date.now() < value`, drop `sms_opt_in` from items.
2. **Cap to 3** for the home card. Persist the full list in the snapshot for "View all".

### 3.3 Page wiring — `src/pages/c1/workers/dashboard.tsx`

Behind a feature flag (`REACT_APP_WORKER_DASHBOARD_ACTION_ITEMS_V2 === 'true'`):

- Replace the `useMemo(() => buildWorkerDashboardActionItems({...}), [...])` call with the new hook + personalization adapter.
- Remove the `getDoc(users/{uid})` round trip at the top of the page (it's still needed for upcoming assignments, but not for action items — keep that call, just stop feeding `userDoc` into the action-items builder).
- Remove `useWorkerAiPrescreenSurfaceSignals(...)` — server now derives those items.
- Keep `refreshAfterDashboardAction`. After a worker action that mutates Firestore (e.g., enable SMS, dismiss photo, accept assignment), the trigger will recompute and push a new snapshot; the local `getDoc` re-read can stay as a tactile-feedback nudge until the trigger lands.

### 3.4 Don't delete the legacy builder yet

Keep `src/utils/workerDashboardActionItems.ts` for one release after V2 ships, behind the feature flag's `false` branch. After two weeks of stable telemetry, delete the file and its unit tests.

### 3.5 Telemetry

Add to `dashboard.tsx`:

```ts
console.debug('[WorkerDashboardActionItemsV2]', {
  uid,
  source: snapshot ? 'snapshot' : 'fallback',
  itemCount: items.length,
});
```

…and a counter in the existing analytics framework so we can compare V1 vs V2 item counts during rollout.

---

## 4. Rollout sequence

1. Land §2 (backend) behind no flag — it just writes a snapshot nobody reads. Verify writes in staging on representative workers.
2. Land §3 with the flag default-off. Manually enable for `g.fielding@c1staffing.com` and a few QA workers. Confirm parity item-by-item.
3. Flip the flag to default-on for `BCiP2bQ9CgVOCTfV6MhD`. Watch logs.
4. Once Flutter has shipped its V2 (separate brief), retire the legacy builders in both clients.

---

## 5. Files to read before starting

- `src/utils/workerDashboardActionItems.ts` — source of truth for current logic.
- `src/utils/workerProfileActionItemFacts.ts` — DOB / phone / address / last4 / emergency contact / SMS predicates.
- `src/utils/workerComplianceActionDerivers.ts` — background / drug / e-verify derivation.
- `src/utils/workerJobRequirementSignals.ts` — pending-assignment + TempWorks signals.
- `src/utils/workerAiPrescreenDashboardActions.ts` + `src/hooks/useWorkerAiPrescreenSurfaceSignals.ts` — AI prescreen items.
- `src/utils/workerDashboardDismissals.ts` — dismissals shape.
- `functions/src/readiness/syncHrxReadinessSnapshotV1.ts` — reference for callable + idempotent write pattern.
- `functions/src/readiness/homeSnapshotTrigger.ts` — reference for `onDocumentWritten` user-doc trigger gated on `isC1WorkerScope`.
- `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` — the contract this snapshot must match.

---

## 6. Definition of done

- `functions/src/readiness/workerDashboardActionItemsModel.ts` exists, has unit tests, and produces snapshots matching the contract for the case matrix in §2.6.
- Six triggers + one callable exported from `functions/src/index.ts` and verified to fire on staging writes.
- Snapshots visible at `users/{uid}.workerDashboardActionItemsV1` in staging Firestore for at least 50 distinct workers.
- Web dashboard renders identically to V1 for the QA worker set when the feature flag is on.
- `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` updated with a "v2 server snapshot" section pointing at `users/{uid}.workerDashboardActionItemsV1`.
- Stale `docs/WORKER_DASHBOARD_ACTION_ITEMS_SPEC.md` (4-ID legacy version) deleted in the same PR.
