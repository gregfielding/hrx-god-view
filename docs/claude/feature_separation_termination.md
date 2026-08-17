# separation termination

> Worker termination/separation (item 2) — separateWorker callable, CA final-pay gate, auto-cancel, notices, rehire block; Everee side is manual (no termination API); I-9 mirror nuance discovered

# Termination/Separation — shipped 2026-07-10/11

Commits 9141eecb (callable+enforcement), 03395b55 (dialog+chips),
17dbcb45 (board hide+apply gate), + notices/rehire-block commit.
Design doc: session scratchpad termination-design-draft.md; research
report in transcript (Everee/§201-203/competitors).

**Flow:** User Details → Employment → "Separate…" (below + DNR).
SeparationSection (src/components/separation/) → separateWorker
callable (functions/src/separation/): per-entity entity_employments →
'terminated' via buildAdminEntityEmploymentLifecyclePatch; separations[]
audit + separatedEntityIds + rehireEligible flags on user doc;
auto-cancels live assignments at the entity (cancel-cascade clone with
notificationsSuppressed); involuntary REQUIRES finalPayConfirmed (CA
§201 same-day; §203 penalties — confirmation timestamped = defense).
Notices (separationNotices.ts): SMS via outbound queue
(source 'automation', 168h dedupe), email via getEmailProvider, in-app/
push via sendNotificationAndPush; professional copy, no reason/rehire.

**Enforcement:** filterDnrRecipients also blocks separatedEntityIds vs
jo.hiringEntityId (messaging + placements); postings stamped with
hiringEntityId (all paths + backfill 324) → board hide + apply gate.
Signup: checkRehireEligibility (unauth callable, bare boolean; exact
email/phoneE164/phone match, fails open) gates the apply wizard BEFORE
Auth account creation; composite users indexes added.

**Everee side is MANUAL** (no public termination API — dialog reminds).
Piers asked 2026-07-10 re: termination API + rehire re-activation.

**I-9 nuance discovered en route:** Everee onboarding-status
`documentsVerifiedByCompany` stays false even when the I-9 doc signature
shows COMPLETE in their Documents tab — the flag = the separate employer
"verify documents" (Section 2) dashboard action, NOT the e-sign envelope.
CONFIRMED 2nd case 2026-07-11: Ricardo Colbert — Greg e-signed Section 2
live, flag still false minutes later (and `documentsVerifiedAt` was
stamped a month earlier with both booleans false — flag is unreliable).
Exhaustive API dig 2026-07-11 (developer.everee.com/llms.txt = full
catalog, only ~30 endpoints): NO I-9/document-signature API exists.
/api/v2/workers/files returns fileName+publishedAt only (Ricardo's I-9
file publishedAt unchanged by countersign); webhook catalog (11 events)
has nothing document-related; worker obj has hasWorkbrightDocs (Everee↔
WorkBright I-9 integration, false for C1) + companyDocumentGroups.
SOLVED 2026-07-11 (inspected Greg's live Everee admin UI): Everee has
TWO parallel I-9 systems. (1) Native Documents-tab e-sign — what C1
uses; NO API signal exists for its employer countersignature. (2) An
embedded **WorkBright** pipeline (Onboarding+ → I-9 Forms: "Sign
Section 2", Pending Employer Section / Completed queues, E-Verify
cases) — C1 has NEVER used it: both queues empty, workers'
`hasWorkbrightDocs: false`. `documentsVerified(ByCompany)` almost
certainly belongs to the WorkBright/verify-documents machinery → reads
false FOREVER for native-flow workers no matter what is signed. No "I-9
report" exists under Reports on C1's plan (2023 help article stale).
**C1 IS CUTTING OVER TO WORKBRIGHT** (Greg, 2026-07-11, operational "in
a couple of days") — they thought it was active; it wasn't set up. HRX
is already fully wired for it: reconcile fetches onboarding-status
unconditionally (even post-completion), mirror maps
documentsVerifiedByCompany → employerI9SignedAt, reconciler bridges to
entity_employments.i9Section2CompletedAt (source 'everee_mirror',
respects manual stamps), evereeReconcileCron sweeps every worker every
2h + "Sync from Everee" for instant. Mirror now also captures
`hasWorkbrightDocs` (rollout signal). Once live: employer signs Section
2 in Onboarding+ → I-9 Forms → auto-clears in HRX ≤2h. The header
"Mark signed" button (markEmployerI9Signed callable) stays as fallback
for native-flow/legacy workers. DURABLE FIX SHIPPED 2026-07-11: header
"Mark signed (done in Everee)" link on pending employer-I-9 rows →
reuses E.7 csaMarkI9Section2Complete (documentTypes
['completed_in_everee_esignature'], same audit + readiness cascade).
One-off scripts stampGizelleI9S2.ts / stampRicardoI9S2.ts predate it.
