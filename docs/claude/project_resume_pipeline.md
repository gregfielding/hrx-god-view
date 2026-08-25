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

## Known remaining debt (audit items NOT yet fixed — ranked)
- Zod validation is theatre: schemas mismatch the prompt output, every parse
  logs console.error and returns raw data; `ParsedResumeSchema` omits
  `storagePath` (would strip it if validation ever started passing) — fix
  together.
- `resumeUrl`/`resumeStoragePath`/`resume.fileUrl` are read by 9+ files but
  written by nothing — pick `users.resume` as canonical and delete branches.
- Dead server code: `updateUserProfile`/`logAiEvent`/`geocodeAddress` etc.
  (~150 lines) — including the résumé-address geocoding the UI claims happens.
- `resumeSuggestions`/badges UI dead (reads formData.personal, written to
  formData.resume); ResumeHistory page reads `data.success` that's never set;
  `parsedResumes` has no client read rules (QualificationsStep autofill dies).
- 3 identical copies of work history on users docs
  (workExperience/workHistory/employmentHistory); parsedText+aiAnalysis
  duplicated into localStorage/applicationDrafts/applications.
- Client base64-JSON transport: 25MB cap ≈ 33MB encoded vs Cloud Run's 32MB
  body limit; maxInstances 5 is a surge ceiling.
- Docs RESUME_PARSING_SYSTEM.md still describes OpenAI + a `parseResume`
  callable that doesn't exist.
