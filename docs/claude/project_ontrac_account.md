---
name: project-ontrac-account
description: OnTrac (via Indeed Flex) — signed agreement terms, screening/attestation process, coverage-sheet deliverable, and the just-in-time Section-2 decision
metadata:
  type: project
---

# OnTrac account (via Indeed Flex MSP)

Agency Partner Agreement SIGNED (Greg 3/4/2026, Flex CEO 3/5/2026; term
to MSP end or 2028-07-22). PDF in Greg's email (Hallie Hunt thread,
2026-08-18). Second Indeed Flex program alongside the existing one —
same weekly PO invoicing rhythm (PO drops Wed, invoice Thu EOD to
Purchasing@indeedflex.com, net 30; workers clock on Flex's system,
timesheets approved by Mon 11:59 PM CST).

## Key terms
- **W-2 ONLY** (no 1099) → C1 Select work, never Events.
- **Markups fixed by rate card**: 38% most ZIPs, 34% at ~a dozen
  (Phoenix, Orlando, Chicago-metro, Charlotte, most NJ, Reno/Henderson,
  Groveport/Lockbourne OH, Fort Mill, Antioch/Lebanon TN, DeSoto TX);
  new locations ≤38%.
- **SLAs**: ≥90.1% fulfillment, ≤2.9% no-show, retro bookings posted
  ≤14 days; 8-hour unsatisfactory-worker guarantee.
- **Screening (Sch. 1)**: SSN verify + sex-offender registry + 7-yr
  national & county criminal; drug test per facility (8 vs 9 panel — 9
  includes alcohol; many sites No DT — matrix in the coverage sheet);
  exclude anyone who ever worked for OnTrac; **E-Verify every worker**.
- **Attestation (Sch. 5)**: per-worker signed form ON EVERY BOOKING —
  I-9 date, E-Verify date, drug screen, background dates. Generator
  LIVE on /reports/i9-status (printer icon; E-Verify date entered once
  per worker from WorkBright's case list — WorkBright has NO
  API/export for E-Verify, John Dodson declined 2026-08-20; the data
  never reaches Everee's API either, confirmed by probing).
- **Conversion (Sch. 6)**: converted worker failing OnTrac screening →
  conversion fee + $1,000.
- Safety: Sch. 4 checklist + conveyor rules signed pre-assignment; no
  headphones; closed-toed shoes.

## Coverage deliverable (due 2026-08-24)
Google Sheet "C1 Staffing Coverage Maps & Pay Rates" → tab **"OnTrac
Site Details"** (+ hidden "OnTrac Coverage by PM"): ~60+ facilities with
pay rates ($15.50–$18.90), DT panel, BGC spec prefilled; C1 fills **Can
cover (y/n) + Branch Contact + Email + Phone** per facility. Flex
contacts: Hallie Hunt (Midwest, hallie.hunt@indeedflex.com) + regional
PMs on the ownership-map tab.

## Account build-out (EXECUTED 2026-08-20)

Full Carrier-pattern build from the coverage sheet. CRM company
`Trcil4aGEFfsYqeFz9s8` (OnTrac); national account **`BBvT5yZcWL5z4SNjWDUM`**
named "OnTrac" (c1_select_llc, accountType national, markup 38,
`defaults.eVerify.eVerifyRequired: true`).

- **116 locations** under `crm_companies/{id}/locations` — name = sheet
  Column C ("Akron"), geocoded coordinates, type Distribution Center,
  plus reference fields `ontracDrugTest` / `ontracBackgroundCheck` /
  `ontracClientPayRate`. Two pre-existing locations left alone: the
  Apollo HQ record and Greg's manual "Las Vegas Facility" (redundant
  with the sheet's "Las Vegas" — safe to delete, no child attached).
- **116 child accounts** (`autoLoc_*`, parentAccountId=national) named
  "OnTrac {Location}". Each carries: per-site Package Handler payRate +
  billRate = pay×(1+markup/100); **25 children at 34% markup** (rate-card
  zips, incl. NJ sites 08619/08085/08066/08810 whose sheet zips were
  blank — resolved via geocoding); WC codes/rates from the matrix via
  title synonyms (Package Handler→"Warehouse Associate" 8044/8015-CA/
  2922-PA; Admin/Ops→8810 IL+TX; Hostler/Yard→6504-CA "Yard Driver");
  positions in states with no matching matrix title left blank on
  purpose (existing codes only — no 8040 placeholder auto-assign);
  `orderDefaults.staffInstructions.credentials.text` = per-site
  E-Verify/background/drug-panel line (cascades into JOs).
- **Gig job orders OFF** (Greg 2026-08-20: not needed) but **116 auto
  user groups created directly** (`auto_{childId}_package_handler`,
  "OnTrac {Location} — Package Handler") via `ensureAutoUserGroup` —
  normally groups only spawn inside the gig-JO path (AG.0).
- National `orderDefaults.staffInstructions`: uniform/firstDay/other
  text + 6 attachments (5 split safety PDFs + job descriptions).
- Scratch scripts: `functions/.scratch/ontrac-build-{a,b,b2,c,d}-*.ts`
  (idempotent, re-runnable), data in `ontrac-facilities.psv` +
  `ontrac-geocache.json`.

### Footguns hit (fixed, remember these)
- **Ambiguous-multi-national skip**: a second (empty, UI-created)
  national linked to the same company made
  `autoChildAccountFromCompanyLocation` skip EVERY location — the
  candidate filter checks `accountType==='national'` only, NOT the
  auto-create toggle. Fixed by deleting the empty duplicate; children
  for already-created locations were backfilled by importing
  `tryCreateChildAccountForNationalParent` directly (Script B2).
- Child names are `${parentName} ${locationName}` frozen at spawn —
  rename the national BEFORE spawning (13 children needed rename).
- Sheet zips: 11 rows blank / leading-zero-stripped (RANDOLPH 2368) —
  four of them were 34%-rate-card NJ zips. Always backfill zips via
  geocoding before markup logic.
- Carrier national + all 23 children also had `eVerifyRequired` false/
  unset — flipped true 2026-08-20 (Greg: "carrier requires e-verify").

## Ramp outlook (Greg 2026-08-28) — the driver of the fall tech push

Realistic path to **150+ workers full time through end of 2026** —
"huge for our bottom line, but we need the tech to pull it off," plus
1–2 more recruiters. The four prerequisite tech tracks Greg named:
1. **Native apps** (worker experience graduates from mobile web —
   nothing scoped yet; wrapper-vs-React-Native decision needed).
2. **Everee no-widget onboarding** — design exists, shared with Mark
   (see [worker onboarding everee](project_worker_onboarding_everee.md),
   complete-record API + phone-auth keystone). Most shovel-ready.
3. **Better overall worker UX** (schedule/hours/pay visibility,
   support — payroll help desk work is part of this).
4. **Massively streamlined recruiting** — REC-1+ was on hold pending
   recruiter feedback; a 150-hire ramp makes it urgent. Note the
   booking-time gates above (Section 2, E-Verify date, drug screen,
   per-booking attestation) are per-worker recruiter touches that must
   scale too.

Scale math: 150 FT W-2 ≈ 6,000 hrs/week through Select payroll —
batch-submit reliability matters (Everee calc-race footgun in
[payroll cost attribution](project_payroll_cost_attribution.md)).
Key unknown: start date / ramp curve — sequencing pins to it.

## DECISION (Greg 2026-08-20): I-9 Section 2 = just-in-time
563 of 770 Select workers lack employer Section 2 (visible on
/reports/i9-status). Do NOT run a broad backlog sweep — complete
Section 2 per worker AT OnTrac BOOKING time (attestation asserts the
I-9 is complete in its entirety, so booking flow = verify status
Complete → enter E-Verify date → generate attestation). Same applies to
drug screens (per-facility matrix) — screen at booking.
