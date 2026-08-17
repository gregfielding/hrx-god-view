# dnr do not return

> DNR (Do Not Return) — per-account worker blocks; model, callable, 4 enforcement points, posting account-lineage denormalization; item 2 (termination/separation) planned next

# DNR (Do Not Return) — shipped 2026-07-10 (commit 8a09ce4c)

**Model:** user doc gets `dnr: DnrEntry[]` (full audit: accountId/Name/
Type, parentAccountId, notes, status active|removed, addedBy/At ISO,
removedBy/At) + flattened `dnrAccountIds: string[]` (ACTIVE ids only) —
the one field every enforcement point reads. Written ONLY via
`setWorkerDnr` callable (functions/src/dnr/, gate = canManageAssignments
= recruiter+). National/standalone DNR covers children automatically:
checks intersect dnrAccountIds with ALL account ids a JO carries
(`joAccountIdCandidates`: accountId, recruiterAccountId, companyId,
parentAccountId, nationalAccountId).

**Enforcement (4 points):**
1. placementsCreateAssignments → hard reject with worker names
   (failed-precondition), nothing created.
2. jobOrderAutoMessaging (groups + radius + Worker Reach) →
   filterDnrRecipients silently drops, logs blocked count.
3. Signed-in jobs board (PublicJobsBoard) hides postings whose
   accountId/parentAccountId ∈ worker's dnrAccountIds. Postings now
   carry denormalized account lineage: stamped on ALL creation paths
   (jobsBoardService createPostFromJobOrder + manual create + JO-sync
   refresh; fieldglass createFieldglassJobPosting) and backfilled
   (323 stamped, 30 orphans unresolvable, 2026-07-10).
4. Apply wizard: `dnrBlocked` gate re-checked on auth changes → generic
   "position is no longer available" screen (never reveals DNR).

**UI:** DnrSection (src/components/dnr/) in the User Details
Employment header — red chips `DNR — <Account>`, + DNR dialog (account
autocomplete over tenants/{t}/accounts, notes, upcoming-work warning —
Greg's decisions 2026-07-10: block apply too; warn-don't-cancel
existing future assignments; recruiter-level permission).

**Next (Greg):** item 2 = termination/separation — same header area,
likely reuses the callable/audit pattern.
