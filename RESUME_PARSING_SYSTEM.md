# Resume Parsing System

> **This document was retired 2026-08-25.** It described an OpenAI-based
> pipeline and a `parseResume` callable that no longer exist (the parser runs
> on Claude via the `parseResumeHttp` HTTP function).
>
> The living documentation is **`docs/claude/project_resume_pipeline.md`**:
> current architecture, the canonical `users.resume.*` field model, the
> 2026-08-25 fix rounds, and remaining known debt.

Quick orientation:

- Entry point: `functions/src/resumeParser.ts` → `parseResumeHttp` (HTTP,
  bearer-token auth, base64-JSON body, 20MB client cap).
- Upload UI: `src/components/ResumeUpload.tsx` and the apply wizard's
  `src/components/apply/steps/ResumeStep.tsx`.
- Output: `resumeUploads/{uid}/uploads/{id}`, `parsedResumes/{id}`, and a
  merge patch onto `users/{uid}` (additive certs/skills, canonical
  `resume: { fileName, storagePath, downloadUrl, … }`).
