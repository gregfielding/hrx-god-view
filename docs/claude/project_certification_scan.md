# Certification scan (Claude reads uploaded cards) + review queue

> Status: **BUILT + DEPLOYED 2026-09-08** (Greg: "build it - the cert scan
> with Claude and the review queue"). Origin: the Qwick/Instawork "badges"
> discussion — their cert uploads are reviewed by a team in ~1–2 business
> days and never issuer-checked; HRX auto-decides in seconds and only
> queues what a human should judge. This is the credential half of the
> badge / claim-eligibility model in
> [project_tier_system_claim_shift_spec.md](project_tier_system_claim_shift_spec.md).

## What happens when a worker uploads a certification

1. Web upload paths (`EducationStep` in the apply wizard AND the worker
   profile's Certifications section; `RequirementsAcknowledgementStep`
   for job-required certs) write the legacy `users.certifications[]` row
   AND a canonical `users/{uid}/certification_records/{id}` row
   (`review.status:'submitted'`, `recordStatus:'pending_review'`,
   `source:'worker_upload'`, `evidenceFileRefs[{storagePath,storageUrl,
   fileName}]`). The dual-write flag `isCertRecordsDualWriteEnabled()` is
   **ON by default** since 2026-09-08 (it was an opt-in env flag before,
   so no canonical rows were being created in prod).
2. Trigger `onCertificationRecordWrittenScan`
   (`functions/src/certifications/certificationScanTrigger.ts`) fires on
   the canonical row: `review.status == 'submitted'` + an evidence file →
   downloads the file (Storage path, or parsed out of the download URL),
   `sharp` → JPEG ≤2000px (EXIF rotate, HEIC ok) or a PDF document block,
   and asks Claude (`CERT_SCAN_MODEL` env → else `CLAUDE_MODEL`, Opus 5)
   for a structured JSON reading: readable? the credential itself (vs a
   receipt / course page)? matches the claimed catalog entry? holder name,
   issuer, jurisdiction, accreditation, certificate number, issue /
   expiration dates, tampering signals, confidence, reviewer notes.
   Prompt + JSON schema: `certificationScanClaude.ts`
   (`CERTIFICATION_SCAN_PROMPT_VERSION` in the shared type — bump it and
   every record re-scans on its next write).
3. Pure verdict rules (`certificationVerdict.ts`, 19 tests):
   - **auto_approve** (`looks_valid`): readable, the credential itself,
     matches claim, name matches (model AND local last-name check), not
     expired, expiration present when the catalog expects one (or
     derived from issue date + `validityPeriodYears`), no tampering
     signals, **high** confidence. Writes `review.status:'approved'`,
     `recordStatus:'active'`, `decidedBy:'system'`, and fills
     `issuer` / `expirationDate` from the document (the card beats what
     the worker typed; the note records the discrepancy).
   - **auto_reject** only with high confidence AND one of: unreadable,
     not a certificate, different credential, expired. Writes
     `review.status:'rejected'`, `rejectionReason:<code>`,
     `recordStatus:'rejected'`.
   - **needs_review** for everything else — name mismatch and tampering
     ALWAYS go to a human (never an automated accusation), plus unsure /
     medium-low confidence / missing expiration / scan errors /
     unsupported file types.
   The full reading lands on the record as `aiVerification`
   (`shared/certifications/certificationAiVerification.ts`).
4. Worker notice (`certificationWorkerNotify.ts`, EN/ES, neutral copy):
   auto-approve → in-app "Your Food Handler Card was verified";
   auto-reject → in-app + SMS "We couldn't read the photo… upload a clear
   photo of the whole certificate" (opt-in gated, deduped 24h per record).
   The worker's cert list shows **Verified / Under review / Needs a new
   photo** (`EducationStep` chip via `certificationRecordId`).
5. Review queue: needs_review rows are mirrored to
   `tenants/{tid}/certification_reviews/{uid}__{recordId}` (worker name,
   claimed vs read fields, evidence link, verdict/reason/confidence/notes).
   `/readiness/employee-readiness` → **"Certifications to review"**
   (`CertificationReviewSection.tsx`, live snapshot). Approve (with
   editable issuer/expiration), **New photo** (reject + SMS ask), or
   Reject (reason code, in-app only) → callable
   `setCertificationReviewDecision` (Manager 4 / Admin 5 sharing a tenant,
   same rule as headshot decisions). It stamps `review.decidedBy/At/note`,
   stashes `previousAutoVerdict` when overriding the scan, writes a
   `users/{uid}/activityLogs` entry, deletes the queue row, notifies. The
   trigger also deletes the queue row whenever any writer moves the
   record out of `submitted` (L5 edits in the profile tab included).

## Operating notes / footguns

- **Cloud Run cap:** these two functions took the slots of two orphans
  (`firestoreLogSettingCreated/Deleted`, gone from source since
  2025-12) which were deleted first. Orphan finder: diff
  `firebase functions:list` names against `exports.X =` in
  `functions/lib/index.js` — 21 orphans remained on 2026-09-08 (the
  `firestoreLog*`, `*CircuitBreaker*`, `getTestResults`,
  `exportAnalyticsData` family are safe deletions; the `natalie*` names
  in that list were just not compiled locally, NOT orphans).
- Records with `review.status: 'not_required'` (recruiter-entered,
  `admin_manual`) or without an evidence file are never scanned.
- Re-upload = a new evidence file on the record → new `evidenceKey` →
  fresh scan; the client also resets `review.status` to `submitted`.
- Rules: `certification_reviews` is read-only for tenant staff (L4+);
  `certification_records` client writes stay L5+/owner — L4 reviewers act
  through the callable (Admin SDK).
- Scan cost: one Opus 5 call per upload (image ≤2000px). Set
  `CERT_SCAN_MODEL=claude-sonnet-5` in `functions/.env.hrx1-d3beb` if
  volume ever makes that matter.
- FCRA does not apply to certifications, but the worker copy stays
  neutral on purpose ("we couldn't read…", never "you uploaded the wrong
  thing"); reason codes are internal.
- Flutter: the app lists/edits legacy `certifications[]` only — no
  canonical row, so app uploads are NOT scanned yet (punch list entry
  2026-09-08). Server-side materialization from legacy rows was
  considered and parked (duplicate race with the web dual-write); the
  clean fix is the app writing canonical rows like the web does.

## Not built (next)

- Issuer confirmation (ServSafe / TABC / StateFoodSafety / eFoodHandlers
  public lookups by certificate number) → `issuerConfirmed` on the
  record; check each site's terms before automating.
- Duplicate certificate-number detection across workers (cheap, catches
  borrowed cards) — needs a collection-group index on
  `aiVerification.extracted.certificateNumber`.
- Badges: derive worker-level credentials (this + screening packages +
  onboarding) and gate Claim Shift on them — spec'd in the tier doc.
