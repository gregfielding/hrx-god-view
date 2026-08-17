# carrier account buildout

> "Carrier national account — 23 Distribution Center child accounts created from coverage-map CSV 2026-07-08; markup 40, pay rates NOT yet applied"

# Carrier national account build-out (2026-07-08)

Carrier national account `FcDQOJtlcfgdQSIXKIMF` (CRM company
`2Jy1CsYq4uICnyx3955n`, hiring entity c1_select_llc, all three
auto-create toggles ON). From Greg's "Client locations / coverage map"
CSV (Downloads), script `.scratch/carrierLocationsImport20260708.ts`
(idempotent by venue name — rerun if the sheet grows):

- 23 company locations created, ALL `type: 'Distribution Center'`,
  geocoded coords (FL - Tampa needed a manual re-geocode: the "#100"
  suite broke the geocoder — patched).
- Deployed locationMirror trigger auto-spawned 23 child accounts
  ("Carrier {venue}", e.g. "Carrier SE - Charlotte Hub") + 23 auto gig
  JOs parked `on_hold` for recruiter activation + user groups.
- Markup: `pricing.flatMarkupPercent: 40` on the NATIONAL (was already
  set); children inherit the whole pricing object at create time.

**Why:** these venues are Indeed Flex / CORT hub sites — the venue
matcher resolves Indeed venue strings against these child-account names
(see [[feature-indeed-flex-automation-roadmap]]).

**Not applied (likely follow-up):** the CSV has per-site PAY RATES
(e.g. Charlotte $15.53-$17.17, Piscataway $22, Greenville "TBC") and a
Feedback column (bill-ish numbers) — Greg only asked for markup + type,
so no position pricing was written. If he asks for site pay rates, they
go in the child accounts' pricing positions (cascade keys
`pricing.positions` / see shared/cascade/loaders.ts).
