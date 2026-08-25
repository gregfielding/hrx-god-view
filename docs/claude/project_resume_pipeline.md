# Résumé parsing pipeline — state + 2026-08-25 fix round

Parser: `functions/src/resumeParser.ts` → `parseResumeHttp` (onRequest, 1GiB,
540s, us-central1). Client: `src/components/ResumeUpload.tsx` (8 surfaces)
base64s the file into a JSON POST; the FUNCTION uploads to Storage at
`resumes/{userId}/{uploadId}.{ext}` and stores a token download URL on
`users/{uid}.resume.downloadUrl`. AI: Claude (via `utils/claudeChat`, model
env `CLAUDE_MODEL`, adapter ignores per-call model params — the
`RESUME_*_MODEL='gpt-4o-mini'` defaults only matter for jsonMode regex).

## Fixed 2026-08-25 (audit items 1-6, all live-verified on prod)
1. **Fail-loud extraction**: `extractWithAI` retries once then throws
   `ResumeParseClientError` — the old catch returned an all-empty structure so
   failures surfaced as "parsed successfully!" with a blank profile. The outer
   failure path now marks the REAL upload doc `failed` (was minting a bogus
   fresh uploadId with `storagePath: ''`).
2. **Additive cert/skill merge** (`buildUserProfileMergePatch` now takes the
   existing user doc): existing certification entries are preserved VERBATIM
   (wizard-uploaded evidence fileUrl/fileName/expirationDate survives), only
   new names are appended, and `dateObtained` is no longer fabricated to
   today. Skills: existing rich objects (canonicalId/source/confidence) kept,
   new names appended. Education/languages/workHistory keep replace semantics.
3. **Job submit resume object**: `Wizard.tsx` passed
   `formData.requirements.uploaded` (a certName→boolean map, `{}` never falls
   through `??`) as the resume — scoring/eligibility saw résumé-less workers.
   Now formData.resume (fresh upload) → userData.resume.
4. **Readiness trigger fields**: `homeSnapshotTriggerStub.ts` +
   `src/utils/homeReadinessTriggerRules.ts` watched `resume.fileUrl`/`resumeUrl`
   which NOTHING writes; now `resume.downloadUrl/.storagePath/.fileName` too.
   Note the trigger's `isC1WorkerScope` gate requires C1 tenant membership —
   fresh phone signups (no tenantIds yet) don't log until an application
   stamps membership.
5. **generateAIAnalysis deleted** (~1/3 of per-résumé Claude spend):
   yearsOfExperience + educationLevel now come from the extraction call's
   schema; the unread jobFit/scores are gone. Extraction input window raised
   4,000 → 12,000 chars (2-page résumés were silently truncated; the old
   limit note was INSIDE the prompt text).
6. **Storage lockdown**: `resumes/{userId}/**` was `allow read: if true`
   (world-readable). Now owner + staff (HRX / level 5+ top-level or
   C1-tenant, via `firestore.get`). Token downloadUrls keep working for
   everyone; client fallbacks that hand-built `?alt=media` URLs
   (ResumeStep, userResumeOpen, UserProfile) now use authed SDK
   `getDownloadURL`. Verified: public URL 403, token URL 200.

## Fixed 2026-08-25 (second sweep — the ranked remaining-debt list)
- **Zod aligned + real**: schemas now match the extraction output (skills
  without source/confidence, string years/current/isNative, schemeless
  LinkedIn, synthesized aiAnalysis zeros, `storagePath` on
  `ParsedResumeSchema` — Zod's unknown-key stripping would have silently
  dropped it the day validation passed). Still fail-open: a
  console.error from a validator now means REAL prompt/schema drift.
- **Legacy fields purged**: every reader of never-written
  `resumeUrl`/`resumeStoragePath`/`resume.fileUrl` trimmed to canonical
  `users.resume.{downloadUrl,storagePath,fileName}` (15+ files incl. all
  shared/ mirrors). ☠️ Real bug found beyond the audit:
  `homeSnapshotModel.hasResume` read ONLY the phantom fields — every
  worker's resume checklist item showed incomplete
  (syncC1WorkerHomeReadinessSnapshot redeployed with the fix).
- **Dead code deleted**: updateUserProfile/geocodeAddress/logAiEvent/
  helpers/commitMerge URL block (~350 lines); resumeSuggestions producer
  (wrote formData.resume, consumer read formData.personal — dead since
  day one); dead client callable consts. **Three deployed callables
  DELETED from Cloud Run** (getResumeParsingStatus, getUserResumeUploads,
  getResumeSignedUrl — zero callers) → 3 service slots freed at the cap.
- **ResumeHistory fixed**: gated on a `success` flag the callable never
  returned — page was permanently in its error state.
- **parsedResumes autofill revived**: rules entry (owner-only read) +
  userId+uploadDate composite index deployed; QualificationsStep's bare
  `catch {}` now logs. Work-history autofill from parsed résumés works
  for the first time.
- **employmentHistory retired as a write target** (3rd identical copy):
  resumeParser + admin SkillsTab now write workHistory; readers keep
  fallbacks for old docs.
- **Upload cap 25MB → 20MB**: base64-JSON inflates ~4/3 against Cloud
  Run's 32MB body limit — 24-25MB files died platform-side with a
  generic error before our handler ran.
- Root RESUME_PARSING_SYSTEM.md replaced with a pointer here (described
  OpenAI + a parseResume callable that didn't exist).

## Known remaining debt (deliberately deferred)
- workHistory vs workExperience dual-write is a REAL migration:
  calculateApplicantFitScore/applicantScoring read only workHistory;
  jobScore*/workHistoryJobTitles prefer workExperience. Target per
  jobReadinessReadModel: `workerProfile.experience.workHistory`.
- Transport refactor: client → Storage direct upload + POST storagePath
  (kills the 32MB ceiling and the 1GiB memory need); maxInstances 5 is
  the parse-surge ceiling.
- parsedText+aiAnalysis still duplicated into
  localStorage/applicationDrafts/applications.
