# users read rules (PII lockdown)

> Root `users` collection reads locked down 2026-08-25: owner · HRX ·
> tenant Admin · `isPlatformStaff()` (caller-centric securityLevel >= 5).
> Any-authenticated read is GONE — workers can read exactly their own doc.

## What changed and why

Until 2026-08-25 the `users` block in `firestore.rules` ended with
`allow read: if isAuthenticated() && request.auth.uid != null;` (plus an
`isAssignedToTenant` branch and `hasCRMAccess()`, which is itself
`isAuthenticated() || …`). Any signed-in account — including every
phone-OTP worker — could get AND list all ~14k user docs (phone, address,
DOB). Found while fixing the Applications tab full-collection scans.

Reads are now: **owner** (`request.auth.uid == userId`) · **HRX** (claim
or doc role) · **tenant Admin** (`isTenantAdmin(resource.data.tenantId)`)
· **`isPlatformStaff()`**.

## isPlatformStaff() — the load-bearing design choice

Defined next to `hasSecurityLevel` in `firestore.rules`. It resolves
"securityLevel >= 5" from, in order: the caller's root-level
`securityLevel`, their `tenantIds` map entry for their own home tenant
(`activeTenantId`, else legacy `tenantId`), or custom claims for that
tenant. **It is caller-centric — it never reads `resource.data` — so every
staff list-query shape is provable**: `tenantIds.{T}.securityLevel IN`,
`documentId() IN` chunks, `recruiter`/`crm_sales` flag filters, and the
many unfiltered directory scans (MessageDrawer, PeopleList,
useMentionSearch, RecruiterMultiSelect, OrgTreeView…) all keep working for
staff with NO query changes. A resource-based rule would have broken all
17 unconstrained-scan sites at query-planning time.

Trade-off accepted: staff of any tenant can read users cross-tenant
(pre-existing behavior; the 14 live staff incl. two customer-side level-7
admins are all trusted).

☠️ **Claims alone are NOT a workable gate** — verified in prod 2026-08-25:
only 3 of 14 staff have `roles` claims, only Greg has `hrx: true`, there
is NO claims-sync trigger, and staff can sign in via phone-OTP with
claimless tokens. The doc-based branches must stay first.

## Prod ground truth (2026-08-25)

14 staff docs total, levels all STRINGS ('5'–'7'); zero label-valued
levels ('Admin' etc.) remain; zero map-level-4 staff; 23 legacy workers
have root `securityLevel: "4"` (correctly treated as workers). Shapes that
must keep passing (all emulator-tested): map-only level (g.fielding),
root-only level with no `activeTenantId` (mmazzella, rocco), root high +
map low (gregpfielding test acct), root low + map high (d.waltermyer),
claims-Admin (vicki/tabitha).

## Consumer rules of the road

- **A worker client may only read `users/{their own uid}`.** Any surface
  that shows another user's identity to a worker must use denormalized
  fields or a callable. The one live case was the AssignmentDetails
  "My Recruiter" card — its `getDoc(users/{recruiterUid})` now fails for
  workers and the card falls back to `assignment.recruiterName/-Email/
  -Phone` … which NO assignment doc has ever carried (0/5,195). Card is
  hidden for workers until recruiter contact is materialized onto
  assignments.
- **SalespeopleContext** (`src/contexts/SalespeopleContext.tsx`) gates its
  app-wide `crm_sales == true` onSnapshot on securityLevel 5–7 — don't
  remove that gate; the listener is mounted for every signed-in user.
- **New staff must be provisioned with level >= 5** in the `tenantIds` map
  (string) or root `securityLevel` — flag-only "staff" (`recruiter_access`,
  `role: 'Recruiter'` with level < 5) can no longer read users. None exist
  in prod today.
- The Flutter companion app (`~/Projects/hrxone_app`, pre-launch) has a
  `searchUsers` full-collection scan in `lib/services/firestore_service.dart`
  — it must be removed/replaced with a callable before launch; the rule
  will (correctly) deny it.
- Emulator test harness for this rule (personas + all query shapes):
  written 2026-08-25 as a scratchpad script; recreate from this doc's
  shapes if needed. Run with `npx firebase-tools@13 emulators:exec` —
  firebase-tools 15 requires Java 21, the machine has 17.

## Known remaining holes (deliberately out of scope that day)

- **Owner-write privilege escalation**: `allow read, write: if
  request.auth.uid == userId` lets a worker write their OWN
  `securityLevel`/`tenantIds`/`role` and become "staff" to the rules AND
  to users-doc-gated callables. Pre-existing; needs a field-level write
  rule, but every self-write path (apply wizard, AuthDialog, AuthContext
  self-heal membership stamps) must be audited first.
- **`hasCRMAccess()` is still `isAuthenticated() || …`** — every
  `crm_companies`/`crm_contacts`/`crm_deals`… rule that uses it grants
  read/WRITE to any tenant-assigned user including workers.
- `allow write: if isHighSecurityLevel()` on users is tenant-unscoped and
  string-only.

## 2026-09-09 — Everee mirror reads were claims-only (Daniel couldn't see C1 Select checkmarks)

Symptom: on a worker record, Daniel (Admin, level 7, Firestore-only —
no `roles` claim) saw the C1 Select header block fall back to the HRX-side
pending rows ("Direct deposit: Not started") and the Employment tab's
Everee status card render every row open with no dates, while Greg (hrx
claim) saw the mirror-driven checkmarks + completion dates. Cause: the
`everee_workers` / `everee_embed_sessions` / `everee_pay_history_cache` /
`payroll_payment_issues` read rules only had `isHRX() || hasTenantRole(
claims)` + own-doc branches; the client swallows the permission error
and falls back silently. Fix (deployed; Daniel reloaded Claudia Vargas's record the same day and
confirmed the checkmarks + dates show): added `hasSecurityLevel(tenantId,
5)` (doc-based, tenant-scoped) to those four reads — Greg's rule: ALL
internal staff (securityLevel 5+) see this. Same day, second pass (Greg: "fix the other reads"): every remaining
`allow read` clause that had `hasTenantRole(claims)` without a doc-based
branch (21 more: tenants, job_orders, shifts, applicationDrafts,
userGroups, savedSmartGroups, messagingSequences, employee/assignment
ReadinessItems, accounts, entity_cost_centers, entity_jurisdictions,
compliance_documents, workers_comp, requirement_packages,
onboarding_item_library, onboarding_documents, document_templates,
document_bundles, signature_sessions, signature_envelopes_public) got
`hasSecurityLevel(tenantId, 5) ||`. Third pass (Greg: "extend the three write clauses too"): the
`read, create, update, delete` clauses on accounts/{id}/uploads,
location_defaults and location_uploads got the same branch, so level-5+
staff can write there without claims (the worker_i9_supporting_documents
`update` clause already had it). Rule for new collections:
staff reads = `isHRX() || hasSecurityLevel(tenantId, 5) || hasTenantRole(...)`,
never claims alone.

## 2026-09-10 — full `users` scans replaced (cost)

Admin surfaces that read the WHOLE collection (14.4k docs × ~15 KB ≈ 210 MB
per load) or `limit(500)` user docs per keystroke were converted (Greg:
"fix the admin pages loading the whole users collection"). Use these
instead of any unfiltered `users` read:

- **Staff (level 5–7) lists** → `src/utils/tenantStaffUsers.ts`:
  `fetchTenantStaffCandidateDocs(db, tenantId, { includeRecruiterFlag })`
  runs `tenantIds.{T}.securityLevel IN ['5','6','7',5,6,7]` + root
  `securityLevel IN [...]` (+ `recruiter IN [true,'true']` map/root) and
  returns ~16 de-duplicated docs in doc-id order. ⚠️ The root queries span
  all tenants — callers keep their own tenant/level filter.
  `getTenantStaffCandidateDocsCached` (5 min, per tenant) for per-keystroke
  search; `isTenantStaffUser(user, tenantId)` for the standard filter.
  Proof: `functions/.scratch/staff_query_equivalence{,2}.ts` — identical
  people for every original filter, all 4 tenants, zero misses.
- **Worker lists/search** → the worker directory: `useTenantWorkerDirectory`
  in components, `getTenantWorkerDirectoryForSearch(tenantId)`
  (`src/utils/tenantWorkerDirectoryLoader.ts`) in plain async code. Shares
  the IndexedDB cache; a warm search costs zero reads.
- **Known ids** → `documentId() in` chunks of 30. **Counts** →
  `getCountFromServer`.

Converted: RecruiterMultiSelect, userGroupManagerCandidateUsers
(UserGroupsTab/UserGroupDetails), SenderManagementPage, MessagingTab
recruiter-numbers list, ManageSalespeopleDialog (internal team), EditJobPost
applicants, OrgTreeView headcounts (C1 has 0 job titles → 0 queries),
useMentionSearch (staff + workers), MessageDrawer recipient search (now
tenant-scoped, capped at 50 people), PeopleList (dormant).

Behavior notes: the old `limit(500)` searches only ever saw the first 500
user docs by id (~3% of users), so mention/recipient search and the
SenderManagement / MessagingTab staff lists now find people they used to
miss. Worker mention results carry no avatar (the directory has none).

`useTenantWorkerDirectory(tenantId, { revalidateIfOlderThanMs })` — default
0 keeps always-revalidate. Only AddRetroactiveWorkerDialog opts in (10 min).
☠️ Don't opt `/users/all` in: its text search reads ONLY the directory, so a
just-applied applicant would be unfindable until the next refresh.

Deliberately left: MessagingTab `loadTestRecipients` (`limit(500)` on tab
open, a picker over all tenant users — needs a design, not a swap);
CompanyDirectory's `_cacheBust` on `getUsersByTenant` (0 calls/week).
