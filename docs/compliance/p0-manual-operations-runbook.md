# P0 Runbook — Running the Background Check Policy on Paper

**Version:** 1.0 (2026-07-13) · **Owner:** Donna Persson (Compliance) · **Backup:** Greg Fielding
**Implements:** Policy v1.1 §5–§8, Migration Plan Phase P0 (manual operations, zero code)

The policy is effective the day this runbook is in use. Software (Phases P1–P6) automates
this exact workflow later — nothing here is throwaway; the paper trail this produces is the
same record the software will keep.

## The kit (delivered 2026-07-13, in Downloads)

1. **C1 Background Check Review Process v1.1.pdf** — the policy (print one for the desk).
2. **C1 Adverse Action Letter Templates — DRAFT for Counsel v1.docx** — pre-adverse,
   final adverse, and dispute-acknowledgment letters, EN + ES, with CA/PA variant blocks.
   **Do not send until counsel signs off.**
3. **C1 Individualized Assessment Worksheet (fillable).pdf** — 3 pages, 45 fields; one per
   candidate per assignment decision.

## One-time setup checklist (this week)

| # | Task | Owner | Done |
|---|---|---|---|
| 1 | Send policy v1.1 + letter templates to employment counsel; log sign-off date | Greg | ☐ |
| 2 | Create `compliance@c1staffing.com` (Google Workspace → Groups → collaborative inbox; members: Donna, Greg; posting: anyone) | Greg | ☐ |
| 3 | Download the CFPB "Summary of Consumer Rights" **English AND Spanish** from consumerfinance.gov → Compliance resources → FCRA → **Model forms and disclosures**; save both to the compliance drive | Donna | ☐ |
| 4 | Fill the `{craBlock}` in the letter templates with AccuSource's current legal name, address, and phone (from the AccuSource portal / latest invoice) | Donna | ☐ |
| 5 | Create the drive folder structure: `Compliance/Background Checks/{year}/{Last, First — HRX id}/` | Donna | ☐ |
| 6 | Confirm the compliance phone number for `{compliancePhone}` | Greg | ☐ |
| 7 | Hold the 30-minute recruiter training (agenda below); collect signatures on the attendance log | Donna | ☐ |
| 8 | Ask AccuSource: their consumer-dispute intake path + reinvestigation SLA (needed for Step 6 below and Phase P4) | Donna | ☐ |

## The paper workflow (one case, start to finish)

1. **Report lands** (HRX Backgrounds tab shows NEEDS REVIEW / ACTION NEEDED).
   *Recruiter, same business day:* tier it per policy §4.
   - 🟢 GREEN → set the line verdicts PASSED in HRX and proceed. Done — no case.
   - 🟡/🔴 → **touch nothing in HRX**, email `compliance@` with the worker's name + HRX
     link. The worker's readiness stays blocked automatically while lines sit un-adjudicated.
2. **Open the case** (*Donna, within 3 business days*): create the drive folder; download
   the report PDF from HRX; start a worksheet; enter tier + convictions at issue.
3. **Pre-adverse notice**: fill the letter (state variant per worksite), enclose the report
   PDF + CFPB summary (EN + ES), send from `compliance@`. Log the send date on the
   worksheet. Compute the response deadline: **at least 5 business days** from send.
   If the email bounces → print and mail; note it on the worksheet.
4. **Wait for the window.** If the candidate says they're gathering evidence of inaccuracy
   → extend 5 more business days (CA requires it; we do it everywhere).
5. **Candidate responds?** Save everything they send into the folder; summarize on the
   worksheet.
6. **Dispute?** If they dispute report accuracy: send the dispute-acknowledgment letter,
   note the AccuSource reinvestigation reference, and **stop the clock** — no decision
   while a dispute is open. When the corrected report arrives, restart from step 3 with a
   fresh window.
7. **Decide**: complete all 11 factors on the worksheet (write "N/A" rather than leaving
   blanks — an empty field reads as "didn't consider it"). Collect approvals per §6:
   - YELLOW hire → Donna signs. YELLOW deny → Donna + Operations Manager.
   - RED hire override → Donna + Greg, with Greg's written rationale attached.
   - RED deny → Donna (after the full process above).
8. **If deny**: send the final adverse letter (state variant). **If hire**: proceed with
   placement.
9. **Record in HRX**: set the line verdicts to match the outcome (PASSED on hire; FAILED on
   deny) and put a short note in the adjudication reason referencing the case folder, e.g.
   `IA case 2026-07 Smith — see compliance drive`.
10. **File**: worksheet (flattened PDF), letters, report, candidate submissions, approvals —
    all in the case folder. Attach the worksheet PDF to the worker's HRX file. Retain
    **7 years**.

## Interim rules for recruiters (announce verbatim)

> Effective immediately, C1 has a formal background check review policy.
>
> 1. If a background report comes back with anything other than all-clear, do not touch
>    the verdicts. Email compliance@c1staffing.com the same day with the worker's name.
> 2. If the worker asks, say exactly this: **"Your report is in review — you'll receive
>    written notice with a chance to respond."** Never say "you failed the background
>    check," and never discuss what's on a report by text, phone, or in person.
> 3. Never share report contents or offense details with clients. The only thing a client
>    hears is "meets" or "does not meet" their screening criteria.
> 4. Arrests without conviction, pending charges, and sealed/expunged/juvenile records are
>    never considered — if you see one on a report, treat it as if it isn't there.
> 5. Only Compliance (Donna) and Greg may set FAILED verdicts or override a verdict in HRX.

## Training session (30 min) — agenda

1. Why this exists: consistency + documentation is the lawsuit defense (5 min).
2. The traffic-light tiers with 3 worked examples — GREEN clear, YELLOW old conviction,
   RED recent violent felony (10 min).
3. The recruiter's entire job: tier, hold, route, use the script (5 min).
4. What Compliance does after routing — so recruiters can set worker expectations (5 min).
5. Q&A + sign the attendance log (5 min).

**Attendance log** (keep in the compliance drive): Date · Name · Role · Signature — one row
per attendee, plus the trainer's signature. Policy §9.3: untrained staff do not tier reports.

## Reference

- Policy (shareable): claude.ai/code/artifact/c08d90b4-22bc-4314-8dc9-3d365b022374
- Policy + migration plan (repo): `docs/compliance/`
- CFPB model forms: consumerfinance.gov → Compliance → FCRA → Model forms and disclosures
- HRX: worker profile → Backgrounds & Compliance tab (report PDF, verdicts, notes)
