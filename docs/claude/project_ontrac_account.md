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

## DECISION (Greg 2026-08-20): I-9 Section 2 = just-in-time
563 of 770 Select workers lack employer Section 2 (visible on
/reports/i9-status). Do NOT run a broad backlog sweep — complete
Section 2 per worker AT OnTrac BOOKING time (attestation asserts the
I-9 is complete in its entirety, so booking flow = verify status
Complete → enter E-Verify date → generate attestation). Same applies to
drug screens (per-facility matrix) — screen at booking.
