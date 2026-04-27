# ✅ HRX Resume Upload & Parsing — Verification & Enhancement Plan

### Purpose
This document ensures our existing **Resume Upload + Parsing** flow meets all functional, UX, and data integration standards before we move to production.  
**Goal:** parsed resume data should populate the **user profile** and downstream application steps (Qualifications, Preferences, Requirements) — while allowing flexible skills input and resume version management.

---

## 1. Current System Overview (As Built)
Cursor has already implemented:
- ✅ File upload (PDF/DOCX/DOC/TXT)
- ✅ LLM-based parsing and JSON output
- ✅ Display of upload progress and parse status
- ✅ Parsed data preview

This spec ensures:
- Data **saves to Firestore user profile**
- Prior uploads are **viewable/downloadable**
- Users can **upload new resumes safely**
- Skills system supports **custom entries**
- All validation, versioning, and UX standards are **checked and enforced**

---

## 2. Functional Requirements Checklist

### 2.1 Upload & Parse Behavior
| Requirement | Status | Notes |
|-------------|--------|-------|
| Detect file type and enforce allowed formats (PDF/DOCX/DOC/TXT) | ☐ | Show clear error if invalid |
| Show current resume if one exists (preview or download link) | ☐ | Include upload date and size |
| Uploads replace previous resume but old version is stored (versioning) | ☐ | Store in `/resumeUploads/{uid}/{uploadId}` |
| Auto-parse resume text via LLM or deterministic parser | ✅ | Verify Zod schema validation |
| Resume text extraction pipeline handles PDF, DOCX, and scanned PDFs (OCR fallback) | ☐ | Cloud Vision or Tesseract |
| Parsed JSON validated against schema (`ParsedResume`) | ☐ | Reject invalid JSON |
| Parsing result merged into `/users/{uid}` and `/applicants/{uid}` | ☐ | Atomic batch write via `commitMerge()` |
| Logs recorded (`logs/resume-merge`) | ☐ | Include uploadId, counts, confidences |

---

## 3. Displaying Previously Uploaded Resume

**Expected Behavior:**
- If a user has a previously uploaded resume:
  - Show **filename**, **uploaded date**, and **file size**
  - Display buttons:
    - `🔍 View` → open in a new tab (GCS signed URL)
    - `⬇ Download` → direct file download
    - `⬆ Upload New Resume` → triggers new upload flow
- When uploading a new resume:
  - Soft-delete (or archive) the previous file under `/resumeUploads/{uid}/{uploadId}/archived: true`
  - Maintain new `uploadId` for version tracking

**Firestore Example:**
```json
/resumeUploads/uid/2025_10_15_1234 {
  fileName: "John_Smith_Resume.pdf",
  fileType: "application/pdf",
  sizeKB: 242,
  status: "parsed",
  uploadDate: "2025-10-15T17:45:00Z",
  storagePath: "resumes/uid/2025_10_15_1234.pdf",
  parsedResumeId: "parsed_2025_10_15_1234",
  archived: false
}
```

---

## 4. Saving Parsed Data to User Profile

**Integration Logic:**

After parsing, call:
```ts
await commitMerge({
  uid,
  uploadId,
  acceptedChanges: changesFromUserReview
});
```

Then update:
```
/users/{uid}
/applicants/{uid}
/parsedResumes/{uid}/{uploadId}
```

**Fields to sync automatically (if confidence ≥ 0.8):**
- `skills[]`
- `education[]`
- `work[]`
- `certifications[]`
- `licenses[]`
- `summary`
- `languages[]`

**Fields to flag as suggestions (confidence 0.5–0.79):**
- `preferences[]`
- `availability[]`
- `locations[]`
- `rightToWorkHints[]`

---

## 5. Skills Input Redesign (Predefined + Custom)

### 5.1 Problem
Users may have skills not in the predefined HRX dictionary.  
Currently, the UI restricts selection to existing items, which blocks valid input.

### 5.2 Required Behavior
- Input allows **free text entry** in addition to **dropdown selection**.
- When a new skill is typed:
  - It’s visually marked as **“custom”**.
  - It’s saved to the user’s skill array with a `source: "custom"` flag.
- AI parsing can add both predefined and custom skills.

### 5.3 Schema Update
```ts
export const Skill = z.object({
  name: z.string(),
  canonicalId: z.string().optional(),   // reference to HRX predefined list
  source: z.enum(["predefined", "custom"]).default("custom"),
  confidence: z.number().min(0).max(1).optional(),
});

export const ParsedResume = z.object({
  ...
  skills: z.array(Skill).default([]),
});
```

### 5.4 UI Component Update
Use an **MUI Autocomplete** with `freeSolo: true`:

```tsx
<Autocomplete
  multiple
  freeSolo
  options={predefinedSkills}
  value={selectedSkills}
  onChange={(event, newValue) => handleSkillChange(newValue)}
  renderTags={(value, getTagProps) =>
    value.map((option, index) => (
      <Chip
        label={option}
        color={predefinedSkills.includes(option) ? "primary" : "default"}
        variant={predefinedSkills.includes(option) ? "filled" : "outlined"}
        {...getTagProps({ index })}
      />
    ))
  }
/>
```

---

## 6. Firestore Data Flow Summary

| Collection | Purpose |
|-------------|----------|
| `/resumeUploads/{uid}/{uploadId}` | Metadata & status of uploaded file |
| `/parsedResumes/{uid}/{uploadId}` | Structured JSON output |
| `/mergeProposals/{uid}/{uploadId}` | Proposed changes for user review |
| `/users/{uid}` | Canonical profile (merged data) |
| `/logs/resume-merge` | Audit of changes & confidence summaries |

---

## 7. UX/Frontend Notes
- Use subtle loader animation during parsing: `Parsing your resume (5–10s)…`
- After parsing: “We extracted information from your resume. Review and confirm changes.”
- If parsing fails: offer manual entry or retry.
- Allow optional resume deletion (e.g., for privacy or GDPR requests).

---

## 8. QA Validation Scenarios

| Scenario | Expected Result |
|-----------|----------------|
| Upload new PDF resume | Parses, shows preview, pre-fills data |
| Upload duplicate file | Detects via hash, skips reparse |
| Upload scanned image | OCR fallback parses correctly |
| Upload resume twice | First archived, second becomes active |
| Add custom skill | Saves to `skills[]` with `source: custom` |
| Replace resume | New file replaces old, preserves previous version |
| Resume parse fails | Graceful fallback, logs error, allows manual input |

---

## 9. Developer To-Do List

**Backend**
- [ ] Verify Cloud Function writes parsed data to `/users/{uid}`.
- [ ] Ensure `/parsedResumes` is versioned and queryable.
- [ ] Implement archive logic for old resumes.
- [ ] Add `source` field to skill schema.
- [ ] Log every resume merge in `/logs`.

**Frontend**
- [ ] Display previous resume with “View” and “Download” buttons.
- [ ] Add “Upload new resume” button beside preview.
- [ ] Upgrade Skills input to support free text + predefined.
- [ ] Confirm review screen handles new skills correctly.
- [ ] Add badge “Suggested by Resume” for prefilled values.

**Testing**
- [ ] Confirm user profile updates after merge.
- [ ] Test with multiple resume formats (PDF, DOCX, scanned PDF).
- [ ] Validate rollback/version restoration works.

---

## 10. Optional Enhancements
- Resume Embedding for future AI matching (`/embeddings/resumes/{uid}`).
- Gap detection and “Confirm Employment Dates” mini-prompts.
- Extract & auto-link certifications to verification uploads.

---

### Summary
> ✅ We already have a functional upload + parse system.  
> This checklist ensures it is **connected, versioned, transparent**, and **flexible with skills**.  
> The result: a resume flow as seamless and smart as Indeed’s — but integrated directly with HRX’s intelligence ecosystem.

---

**Author:** Greg Fielding  
**Date:** October 15, 2025  
**File:** `HRX_Resume_Parsing_Verification.md`
