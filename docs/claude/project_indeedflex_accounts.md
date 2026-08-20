# Indeed Flex client accounts — build pipeline + records

C1 staffs for multiple end-clients via the Indeed Flex MSP. Source of
truth for sites/rates: Google Sheet **"C1 Staffing Coverage Maps & Pay
Rates"** (id `1VPYBOImWNmxnW3LfcchA6sg5uOnFl_19U54E0zhucE0`, shared by
Hallie Hunt; NOT link-public — fetch via gviz CSV **inside Greg's
logged-in Chrome tab**: `/gviz/tq?tqx=out:csv&sheet=<name>`; clipboard
writes can freeze the Sheets renderer — chunk data through JS results
instead). Client tabs as of 2026-08-20: CORT (Sites & MU + Pay Rates),
Purolator Phase 4, AFC Phase 3, **Mattres Firm** (sheet's typo),
Carrier Enterprise, Continental Battery Services, Rhino Staging,
OnTrac Site Details (see [project_ontrac_account.md]), Domino's.

## Reusable build pipeline (Carrier pattern + hard-won fixes)

Scratch scripts in `functions/.scratch/` (run from `functions/`):
`mattressfirm-build.ts` is the current single-script template —
preflight → geocode (cached json) → crm_company → national account →
locations (1.5s pacing) → 90s trigger wait → backfill via direct
`tryCreateChildAccountForNationalParent` import → verify. OnTrac's
multi-script version: `ontrac-build-{a,b,b2,c,d}-*.ts`.

Non-negotiables learned 2026-08-20 (OnTrac build):
- **ONE national linked per company** — a second linked account with
  `accountType==='national'` makes the auto-child trigger skip every
  location as `ambiguous_multi_national` (the filter ignores the
  auto-create toggle). Preflight for it; delete/unlink empties.
- **Name the national its final short name BEFORE spawning** — children
  are named `${parentName} ${locationName}` frozen at spawn.
- **`autoCreateGigJobOrders: false`** (Greg: parked JOs not needed).
  Auto user groups normally spawn INSIDE the gig-JO path (AG.0) — with
  JOs off, create groups directly via `ensureAutoUserGroup`
  (`ontrac-build-d-groups.ts` pattern).
- Zips: sheet drops leading zeros and leaves blanks — backfill via the
  Geocoding API address components before any zip-keyed logic (markup
  rate cards!).
- WC matrix titles are learned from usage — map client titles through
  synonyms (Package Handler→"Warehouse Associate" etc.); never
  auto-assign untitled 8040 placeholder rows.

## Mattress Firm (built 2026-08-20)

Company `SmD2huKUT0E7efCn4VU4` · national **`AppChDb5mMfoIyxZHzcO`**
"Mattress Firm" (c1_select_llc) · **60 locations + 60 children**
("Mattress Firm {Location}"), all geocoded, type Distribution Center.
Sheet tab had ONLY Location + Address — **no pay rates, no markups, no
positions yet** (pricing.flatMarkupPercent null, positions []); the
"Can you supply? / Markup % / contact" columns are blank = C1's
deliverable to fill later. No gig JOs, no user groups yet (no job title
known). Near-duplicate sites kept as-is per sheet: Franklin MASS ≈
Sleepys Franklin (32 Forge Park/Pkwy), Robbinsville NJ ≈ Sleepys
Robbinsville (same 11 Applegate Dr). Data:
`.scratch/mattressfirm-facilities.psv` + `mattressfirm-geocache.json`.
