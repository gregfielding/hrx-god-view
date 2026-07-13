# HRX Background Check Compliance — Migration Plan

**Version:** 1.0 (2026-07-13)
**Companion to:** [background-check-review-process.md](./background-check-review-process.md) (policy v1.1)
**Owner:** Engineering (Greg) · **Operating owner:** Compliance (Donna Persson)

This plan turns policy v1.1 into running software: tiering, individualized assessment,
candidate notices, dispute resolution, and a complete audit trail — plus the security
hardening the current pipeline needs regardless of policy.

---

## 1. Current state — how background check responses are received and managed today

**Intake.** AccuSource (SourceDirect) POSTs webhooks to `apiIntegrationsAccusourceWebhooks`
(`functions/src/integrations/accusource/webhooks.ts`). Raw payloads are persisted to
`integrations_accusource_webhook_raw_intake` + `integrations_accusource_webhook_events`
(SHA-256 dedupe), then the matching top-level `backgroundChecks/{id}` doc is updated:
`providerStatus`, `hrxStatus` (`awaiting_applicant → submitted → report_ready → completed
/ canceled / error`), per-line `providerServiceOrderStatus` map, `providerFinalDecision`,
report-ready flags, and a mirrored `events/` subcollection entry.

**Adjudication.** Each service line carries `adjudication.autoVerdict`
(PASSED/FAILED/NEEDS_REVIEW/PENDING, system-derived — ambiguity errs to NEEDS_REVIEW; labs
and SSN locators auto-PASS on completion) and an optional manual `verdict` override with
`history[]` (who/when/reason) via `setAccusourceLineAdjudication`. Package rollup: any
FAILED → FAILED; any NEEDS_REVIEW → ACTION_NEEDED; any PENDING → IN_PROGRESS; else CLEARED.

**Gating.** `readinessStatusFromAccuSource` aggregates line verdicts into the worker's
screening readiness item: one FAILED line → `complete_fail`, one NEEDS_REVIEW →
`needs_review` — either blocks placement. `markedCompleteOutsideHrx` short-circuits to pass.

**Automation.** `screeningAutomationTrigger` orders the JO's package when an assignment is
confirmed (idempotent, package resolved JO → location → account, skip-if-satisfied with
365-day validity window, item-level duplicate guard on manual orders).

**UI.** Backgrounds & Compliance tab (admin/L5-gated): order, re-order line, mark complete
outside HRX, adjudicate line, view report PDF (fetched on demand from AccuSource, never
stored), refresh catalog.

**Communication & records.** The only worker-facing message in the whole pipeline is
"Background screening started" (automation path). Webhooks notify no one. Adjudication
history lives only on the line. PDF views are not logged. Nothing is ever deleted.

### Gaps vs. policy v1.1

| Policy requirement | HRX today | Gap |
|---|---|---|
| §4 tier (GREEN/YELLOW/RED) | Verdict bands approximate it, but no tier field, no tier assignment step | No explicit tier record |
| §5 individualized assessment | Nothing | No worksheet, no case record, no factor documentation |
| §5.2/§7 candidate notices | Nothing | No pre-adverse / final adverse letters, no CFPB summary delivery, no response-window timer |
| §5.2 dispute handling | Nothing | No dispute state, no reinvestigation tracking, no clock pause |
| §6 approval matrix | Any admin/manager/L5 can set any verdict | No role separation, no counter-signature, no executive override record |
| §8 audit trail | Line `history[]` is good; everything else partial | No server-side activity log for manual orders/PDF views/mark-complete; client-side logging bypassable |
| §8 retention (7 years + disposal) | Indefinite retention, incl. raw webhook PII | No TTL/archival/disposal log |
| §9 audit & adverse-impact review | Nothing | No sampling export, no aggregate outcome report |

### Security gaps (fix regardless of policy)

1. **Unauthenticated webhook (HIGH).** `invoker: 'public'`, no HMAC/secret. A forged
   `report_ready`/decision POST can flip lines → auto-verdict → readiness `complete_pass`,
   clearing placement blockers. Fix: shared-secret or HMAC verification + URL rotation.
2. **No tenant scoping on admin callables (HIGH).** `setAccusourceLineAdjudication`,
   `getAccusourceBackgroundCheckPdf`, `markBackgroundCheckCompleteOutside` read
   `backgroundChecks/{id}` by id only — an admin/L5 in any tenant can adjudicate or pull
   the PDF (PII + criminal history) of any check anywhere. Fix: compare caller tenant to
   doc `tenantId`.
3. **Broad verdict authority (MEDIUM).** `ensureAccusourceAdmin` admits role `manager` or
   securityLevel ≥ 5 — line recruiters can set FAILED→PASSED. Policy §6 requires a
   compliance role for that.

---

## 2. Target architecture

One new object carries the whole §5–§7 lifecycle: an **adjudication case**.

```
backgroundChecks/{id}
  tier: 'green' | 'yellow' | 'red' | null        // §4, set at review
  adjudicationCaseId: string | null
  ...existing fields unchanged

tenants/{tid}/adjudication_cases/{caseId}
  backgroundCheckId, candidateId, jobOrderId, accountId, worksiteState
  tier, tierSetBy, tierSetAt
  status: 'open' → 'pre_adverse_sent' → 'awaiting_candidate' →
          'candidate_responded' | 'disputed' | 'window_expired' →
          'decided_approve' | 'decided_deny' → 'closed'
  responseDeadlineAt            // ≥5 business days, worksite-state aware
  worksheet: { factor1..factor11: { finding, enteredBy, enteredAt } }   // §5.1
  candidateResponse: { receivedAt, channel, summary, attachments[] }
  dispute: { openedAt, craTicketRef, resolvedAt, outcome, reportCorrected }
  approvals: [ { role: 'compliance'|'ops_manager'|'executive', uid, name, at, decision, rationale } ]
  notices: [ { kind: 'pre_adverse'|'final_adverse'|'dispute_ack', sentAt, channel,
               deliveredAt?, templateVersion, stateVariant, attachments: ['report_pdf','cfpb_summary'] } ]
  events: []                    // immutable append-only audit trail (server-stamped)
```

Everything the policy's Appendix B worksheet asks for maps to a field. `events` is the
audit trail: every status change, letter, signature, view, and edit appends an entry
`{at, by, kind, detail}` written server-side only.

---

## 3. Migration phases

### P0 — Operate the policy manually (this week, zero code)

The policy is effective the day Donna can run it on paper; software follows.

- Counsel finalizes the Appendix C letters (pre-adverse EN/ES, final adverse EN/ES,
  dispute acknowledgment) and the Appendix B worksheet as a fillable PDF.
- Compliance mailbox (e.g. `compliance@c1staffing.com`) becomes the reply-to on all
  notices; Donna owns it.
- Interim ops rules, announced to all recruiters:
  - Recruiters never communicate results. The phrase is: *"Your report is in review;
    you'll receive written notice with a chance to respond."*
  - Only Donna (or Greg as backup) touches FAILED verdicts or overrides.
  - Every YELLOW/RED gets a worksheet PDF stored in the worker's HRX file (attachment) —
    even before the structured model exists.
- One training session; attendance logged (policy §9.3).

### P1 — Security hardening (prerequisite, ~1–2 days)

1. Webhook auth: require AccuSource-configurable shared secret (header check) or HMAC of
   body; reject/log otherwise. Rotate the endpoint URL when enabling.
2. Tenant scoping: all three id-only callables verify caller tenant == doc `tenantId`.
3. Verdict authority split (policy §6):
   - NEEDS_REVIEW → PASSED: stays admin/L5 (recruiters clear routine reviews — GREEN work).
   - Setting FAILED, or overriding FAILED → PASSED, or any RED-tier action: requires new
     `complianceReviewer` claim (Donna + Greg initially). Enforced server-side in
     `setAccusourceLineAdjudication`.
4. PDF access audit: `getAccusourceBackgroundCheckPdf` appends a server-side worker
   activity log + case event (`report_viewed`, uid, timestamp).

### P2 — Adjudication case model (~2–3 days)

- `adjudication_cases` collection + `tier` on `backgroundChecks` (schema above).
- Callables: `openAdjudicationCase` (sets tier; auto-suggested from rollup — FAILED→red
  candidate, ACTION_NEEDED→yellow — reviewer confirms), `updateAdjudicationWorksheet`,
  `recordAdjudicationApproval` (role-checked per §6), `closeAdjudicationCase`.
- Every §5.2 timestamp is stamped by the server; `events` append-only.
- Server-side activity log writes added to ALL manual callables (order, reorder,
  mark-complete, adjudicate, PDF view) — closes the client-side-only logging gap.
- Backgrounds tab: tier chip + "Open compliance case" button; case panel showing status,
  deadline countdown, worksheet, approvals.

### P3 — Candidate notices (~3–4 days) — "fully-compliant messaging"

- **Templates** (versioned, per-state variants CA/PA/default, EN + ES): pre-adverse,
  final adverse, dispute acknowledgment. Stored as code-versioned templates; the case
  records `templateVersion` + `stateVariant` per send — provable content years later.
- **Pre-adverse send** (from the case): email to candidate with letter body, report PDF
  (fetched on demand), and the CFPB Summary of Rights (EN/ES bundled). Case →
  `pre_adverse_sent`, `responseDeadlineAt` computed in business days for the worksite
  state. Delivery result recorded; bounce alerts Donna for postal fallback (logged
  manually on the case).
- **SMS guardrail:** the only permitted SMS is a nudge — *"We sent an important email
  about your C1 application to {email}. Please review and reply by {date}."* Never
  offense details, never outcomes, over SMS.
- **Timers** (extend an existing cron): reminder to candidate at deadline-2 days;
  escalation to Donna at deadline; `window_expired` transition (decision may proceed —
  policy §5.2 step 5).
- **Final adverse send:** CRA contact block, dispute/free-report rights, CA CRD-complaint
  paragraph, PA CHRIA written-notice language. Case → `decided_deny` → `closed`.
- **Candidate response intake:** replies land in the compliance mailbox; Donna logs them
  on the case (`candidateResponse`) with attachments. (Portal upload page = later polish.)

### P4 — Dispute resolution (~1–2 days)

- "Candidate disputes accuracy" action → case `disputed`: all timers pause, decision
  locked, dispute-acknowledgment letter sent, AccuSource reinvestigation reference stored.
- Corrected report arrives (webhook) → auto-verdicts recompute → case flags
  `reportCorrected`, clock restarts per policy §5.2 step 4, Donna notified.
- Case cannot reach `decided_deny` while `disputed`.

### P5 — Audit trail, reporting & retention (~2–3 days)

- **Consolidated audit view** per check: merges case `events`, line `history[]`, order
  `events/`, and worker activity log into one chronological screen (and CSV export).
- **Quarterly audit export:** ≥10% sample of closed YELLOW/RED cases with completeness
  checks (worksheet filled? deadlines met? signatures present?) — policy §9.1.
- **Annual outcome report:** aggregate case outcomes by tier/offense category. (True
  adverse-impact analysis needs applicant-flow demographic data we don't collect —
  flagged as an open question for counsel.)
- **Retention (7 years):** scheduled job archives then disposes `backgroundChecks`,
  case docs, and raw webhook payloads 7 years after decision, writing a disposal-log
  entry (what, when, under which schedule). Raw webhook intake payloads (full PII
  duplicates) get a much shorter TTL — 90 days — since the parent doc holds the record.

### P6 — Recruiter UX & queue (~1–2 days)

- Compliance queue page (pattern: /readiness): open cases, deadlines, aging, tier chips.
- Recruiter view of a held worker shows only "In compliance review" — no offense details.
- Quick-reference card (policy Appendix A) embedded in the Backgrounds tab.

**Suggested order:** P0 now · P1 immediately after (security) · P2 → P3 (the compliance
core) · P4 · P6 · P5. Total engineering ≈ 2 weeks elapsed.

---

## 4. Notice templates (skeletons — counsel finalizes wording; merge fields in braces)

**Pre-adverse (EN, default state):**
> Subject: Important information about your application with C1 Staffing
>
> Dear {firstName}, — As part of your application for {position} we received a consumer
> report from {CRA name/address/phone}. Information in that report may affect our
> decision. **No final decision has been made.** A copy of your report and "A Summary of
> Your Rights Under the Fair Credit Reporting Act" are attached. If any information is
> inaccurate or incomplete, or if you would like to provide context — including evidence
> of rehabilitation or mitigating circumstances — please respond by **{deadline}** to
> {compliance email/phone}. We will consider everything you send before any decision.
> [CA variant adds: the specific conviction(s) at issue and the CRD-rights paragraph.]

**Final adverse (EN, default state):**
> Dear {firstName}, — After completing our review, including any information you
> provided, we are unable to move forward with your assignment to {position}. This
> decision was based in whole or in part on information in a consumer report provided by
> {CRA name/address/phone}. The CRA did not make this decision and cannot explain why it
> was made. You may dispute the accuracy or completeness of the report with the CRA and
> may request a free copy within 60 days. [CA variant: CRD complaint right +
> reconsideration procedure. PA variant: CHRIA written-notice language.] This decision
> applies to this assignment's requirements; you may remain eligible for other
> opportunities with C1.

**Dispute acknowledgment (EN):**
> We received your dispute regarding the accuracy of your report and have paused our
> review. The CRA is reinvestigating; we will send you the corrected report and a new
> response window when it completes. No decision will be made while your dispute is open.

**SMS nudge (only permitted SMS):**
> C1 Staffing: we sent an important email about your application to {email}. Please
> review and respond by {date}.

---

## 5. Open questions (for Greg / Donna / counsel)

1. **Delivery channel:** is email-only sufficient for notices, with postal fallback on
   bounce — or certified mail for all final adverse actions? (Counsel call; email is
   generally accepted where the application ran through email.)
2. **Verdict authority split** (P1.3): confirm NEEDS_REVIEW→PASSED staying at L5 is
   acceptable, or should ALL manual verdicts require the compliance role?
3. **Adverse-impact analysis** (P5): collect voluntary EEO self-identification at apply
   time, or run outcome-only reporting? (Counsel: what does a defensible §9.2 review
   require at our size?)
4. **AccuSource dispute mechanics:** confirm their reinvestigation intake path and SLA so
   P4 models it correctly.
5. **Client attestations:** do any clients (Sodexo/Fieldglass) require a formal
   "meets criteria" artifact we should generate from the case record?

---

*Prepared 2026-07-13 from a full code review of the AccuSource integration
(`functions/src/integrations/accusource/`, `functions/src/compliance/`, readiness shared
modules, and the Backgrounds & Compliance tab). Policy references are to
background-check-review-process.md v1.1.*
