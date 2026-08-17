# staff instructions jo cascade

> "How staff instructions reach job orders — materialized (stamped on the JO doc), not read-time resolved; creation trigger + manual sync button + 3-way merge"

Staff instructions cascade Account → Child → Location → JO via the registry
`merge_deep` strategy (`shared/cascade`), BUT the JO Staff-Instructions tab
(`StaffInstructionCard` in `RecruiterJobOrderDetail.tsx`) reads the JO doc's own
top-level `staffInstructions` field **directly** — it does NOT resolve the
cascade at read time. So the cascade is **materialized**: a resolved value only
appears on a JO if something physically writes it onto the JO doc.

Storage paths (per `shared/cascade/loaders.ts`): account/child/location =
`orderDefaults.staffInstructions`; JO/shift = top-level `staffInstructions`.

**Three write paths stamp it onto JOs:**
1. Auto-gig JO creation — `gigJobOrderFromChildAccount.ts` stamps a shallow
   `{...parentSI, ...childSI}` inline at birth (AG.0 JOs only).
2. **Creation trigger** `onJobOrderCreatedCascadeStaffInstructions` (onCreate over
   `job_orders`, deployed 2026-06-24) — fills blank sections on EVERY new JO
   (manual UI / quickAdd / wizard / API), the gap #1 left for non-gig JOs.
3. **Manual sync button** "Sync staff instructions to job orders" on the account
   Cascading Data → Staff Instructions card (national + child, level 5+) →
   `syncStaffInstructionsToJobOrdersCallable`. Re-propagates account edits to
   existing JOs.

Both #2 and #3 live in `functions/src/jobOrders/syncStaffInstructionsToJobOrders.ts`
and resolve from the **account chain only** (drop jo/shift levels). #3 uses a
**3-way merge** (`mergeStaffInstructionsForJo`): fill blanks, refresh sections
still equal to the last-synced snapshot, preserve hand-edited overrides. The
snapshot lives on the JO as `cascadeStaffInstructionsSnapshot` (named WITHOUT a
`staffInstructions` prefix so the translation-discovery scan, which keys off the
exact `staffInstructions` key, ignores it). #2 seeds + always records the
snapshot so #3's refresh detection works later.

Propagation to existing JOs is button-driven (consistent with the rest of the
cascade — national→child sync is also a button, not a live trigger). See
[[project_conventions]] and the cascade registry. Related auto-gig machinery:
[[feature_indeed_flex_automation_roadmap]] is unrelated; AG.0/AG.1 group attach
is the sibling pattern this trigger mirrors.
