# Worker Readiness Stub Validation Checklist (C1, Logging-Only)

## Scope
- Validate `logC1WorkerReadinessDomainChanges` trigger coverage.
- Confirm deterministic domain detection and scoping behavior.
- **Do not enable snapshot writes in this phase.**

## Preconditions
- Function deployed: `logC1WorkerReadinessDomainChanges`
- Test account in C1 worker scope:
  - `activeTenantId` or `tenantIds` includes `BCiP2bQ9CgVOCTfV6MhD`
  - worker security level (`<= 4` or null)
- A separate non-C1 or non-worker user available for negative scoping test.

---

## Validation Checklist (Manual)

### Test 1 — Profile Photo
- Edit:
  - Set `users/{uid}.workerProfile.photoUrl` to a new URL (or clear then set).
- Expected readiness domain(s):
  - `profile_photo`
- Expected trigger reason(s):
  - `profile_photo_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 2 — Work Authorization
- Edit one or both:
  - `users/{uid}.workEligibilityAttestation.authorizedToWorkUS`
  - `users/{uid}.workEligibilityAttestation.requireSponsorship`
- Expected readiness domain(s):
  - `work_authorization`
- Expected trigger reason(s):
  - `work_authorization_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 3 — Availability / Work Preferences
- Edit one or both:
  - `users/{uid}.workerProfile.preferences.scheduleIntentOptions`
  - `users/{uid}.workerProfile.preferences.desiredWorkType`
- Expected readiness domain(s):
  - `availability`
  - (if target industries also changed, `target_industries`)
- Expected trigger reason(s):
  - `availability_changed`
  - optional: `target_industries_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 4 — Certification
- Edit:
  - `users/{uid}.workerProfile.credentials.certifications` (add/remove one entry)
  - or legacy `users/{uid}.certifications`
- Expected readiness domain(s):
  - `certifications`
- Expected trigger reason(s):
  - `certifications_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 5 — Skill
- Edit:
  - `users/{uid}.workerProfile.skills` (add/remove one skill)
  - or legacy `users/{uid}.skills`
- Expected readiness domain(s):
  - `skills`
- Expected trigger reason(s):
  - `skills_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 6 — Resume
- Edit:
  - `users/{uid}.resume.fileUrl` (set/clear)
  - or legacy `users/{uid}.resumeUrl`
- Expected readiness domain(s):
  - `resume`
- Expected trigger reason(s):
  - `resume_changed`
- Expected `recomputeWouldBeRequired`:
  - `true`

### Test 7 — Unrelated Field (Negative)
- Edit:
  - `users/{uid}.lastSeenAt` or `users/{uid}.uiTheme` (non-readiness field)
- Expected readiness domain(s):
  - `[]`
- Expected trigger reason(s):
  - `[]` (or only `worker_created` on first-ever doc creation case)
- Expected `recomputeWouldBeRequired`:
  - `false`

### Test 8 — Non-C1 or Non-Worker Scope (Negative)
- Edit readiness-related field on:
  - user outside C1 tenant OR user with internal/admin security level
- Expected behavior:
  - function exits for scope guard
  - no readiness-domain log for this trigger
- Expected `recomputeWouldBeRequired`:
  - not logged (preferred), or effectively no-op if log policy changes

---

## Expected Results Matrix

| Test | Field Edit | Expected Domains | Expected Reasons | recomputeWouldBeRequired |
|---|---|---|---|---|
| 1 | `workerProfile.photoUrl` / `avatar` | `profile_photo` | `profile_photo_changed` | `true` |
| 2 | `workEligibilityAttestation.*` / `workEligibility` | `work_authorization` | `work_authorization_changed` | `true` |
| 3 | `preferences.scheduleIntentOptions` / `desiredWorkType` | `availability` | `availability_changed` | `true` |
| 4 | `credentials.certifications` / `certifications` | `certifications` | `certifications_changed` | `true` |
| 5 | `workerProfile.skills` / `skills` | `skills` | `skills_changed` | `true` |
| 6 | `resume.fileUrl` / `resumeUrl` | `resume` | `resume_changed` | `true` |
| 7 | unrelated field | none | none | `false` |
| 8 | non-C1 or non-worker user | excluded by scope | excluded by scope | no trigger log / no-op |

---

## Log Review Guide

Inspect these log fields:
- `functionName` (must be `logC1WorkerReadinessDomainChanges`)
- `version` (must be `1`)
- `uid`
- `tenantId`
- `workerSecurityLevel`
- `triggerReasons`
- `readinessDomainsAffected`
- `changedFieldPrefixes`
- `changedPathsCount`
- `recomputeWouldBeRequired`
- `snapshotWriteEnabled` (must remain `false`)

### Pass Criteria Per Event
- Trigger reason(s) match edited field domain(s).
- `changedFieldPrefixes` contains expected readiness prefix.
- `recomputeWouldBeRequired=true` for readiness edits.
- `recomputeWouldBeRequired=false` for unrelated edit test.
- C1/worker scope enforced (negative scope test produces no matching logs).

### False Positive Indicators
- Unrelated fields producing readiness domain reasons.
- Non-C1 or admin/internal users generating readiness-domain logs.
- Recompute true with empty/incorrect readiness domains.

### False Negative Indicators
- Readiness-domain edits with no corresponding domain/reason.
- Expected domain missing from `readinessDomainsAffected`.
- Expected readiness edit producing `recomputeWouldBeRequired=false`.

---

## Go / No-Go Criteria For Enabling Snapshot Writes

## Go
- All core domain tests (1–6) pass with correct domain/reason mapping.
- Unrelated field test (7) stays `recomputeWouldBeRequired=false`.
- Scope exclusion test (8) confirms C1 worker-only behavior.
- Log quality acceptable:
  - low noise
  - no systemic false positives
  - no repeated missed core domains

## No-Go
- Any core domain repeatedly missed (false negatives).
- Frequent unrelated edits flagged for recompute (false positives).
- Scope leakage to non-C1 or non-worker users.
- Ambiguous/missing log fields that block confident verification.

---

## Activation Reminder
- Keep `snapshotWriteEnabled=false` in logs for this phase.
- Enable write path only after Go criteria above are met.

---

## Test-Run Sheet (Copy/Paste Ready)

Use one C1 worker doc for tests:
- `users/{uid}` where user is in C1 worker scope.

Recommended helper format (Firestore update payload):
```js
// Example shape for updateDoc(doc(db, 'users', uid), payload)
const payload = {
  // field paths...
};
```

### Case A — Profile Photo
- Field(s):
  - `workerProfile.photoUrl` (or legacy `avatar`)
- Before -> After (example):
  - `""` -> `"https://example.com/photos/worker-a.jpg"`
- Payload:
```js
{
  "workerProfile.photoUrl": "https://example.com/photos/worker-a.jpg"
}
```
- Expected domain(s): `profile_photo`
- Expected trigger reason(s): `profile_photo_changed`
- Expected recomputeWouldBeRequired: `true`

### Case B — Work Authorization
- Field(s):
  - `workEligibilityAttestation.authorizedToWorkUS`
  - `workEligibilityAttestation.requireSponsorship`
- Before -> After:
  - `null` -> `true`
  - `null` -> `false`
- Payload:
```js
{
  "workEligibilityAttestation.authorizedToWorkUS": true,
  "workEligibilityAttestation.requireSponsorship": false
}
```
- Expected domain(s): `work_authorization`
- Expected trigger reason(s): `work_authorization_changed`
- Expected recomputeWouldBeRequired: `true`

### Case C — Availability / Work Preferences
- Field(s):
  - `workerProfile.preferences.scheduleIntentOptions`
  - `workerProfile.preferences.desiredWorkType`
- Before -> After:
  - `[]` -> `["part_time","gig"]`
  - `"any"` -> `"part_time"`
- Payload:
```js
{
  "workerProfile.preferences.scheduleIntentOptions": ["part_time", "gig"],
  "workerProfile.preferences.desiredWorkType": "part_time"
}
```
- Expected domain(s): `availability`
- Expected trigger reason(s): `availability_changed`
- Expected recomputeWouldBeRequired: `true`

### Case D — Target Industries
- Field(s):
  - `workerProfile.preferences.targetIndustries`
- Before -> After:
  - `["hospitality"]` -> `["hospitality","industrial"]`
- Payload:
```js
{
  "workerProfile.preferences.targetIndustries": ["hospitality", "industrial"]
}
```
- Expected domain(s): `target_industries`
- Expected trigger reason(s): `target_industries_changed`
- Expected recomputeWouldBeRequired: `true`

### Case E — Certification
- Field(s):
  - `workerProfile.credentials.certifications` (or legacy `certifications`)
- Before -> After:
  - `[]` -> `[{"name":"Food Handler","fileUrl":"https://example.com/certs/fh.pdf"}]`
- Payload:
```js
{
  "workerProfile.credentials.certifications": [
    { "name": "Food Handler", "fileUrl": "https://example.com/certs/fh.pdf" }
  ]
}
```
- Expected domain(s): `certifications`
- Expected trigger reason(s): `certifications_changed`
- Expected recomputeWouldBeRequired: `true`

### Case F — Skill
- Field(s):
  - `workerProfile.skills` (or legacy `skills`)
- Before -> After:
  - `[]` -> `["customer service","inventory"]`
- Payload:
```js
{
  "workerProfile.skills": ["customer service", "inventory"]
}
```
- Expected domain(s): `skills`
- Expected trigger reason(s): `skills_changed`
- Expected recomputeWouldBeRequired: `true`

### Case G — Resume
- Field(s):
  - `resume.fileUrl` (or legacy `resumeUrl`)
- Before -> After:
  - `null` -> `"https://example.com/resumes/worker-a.pdf"`
- Payload:
```js
{
  "resume.fileUrl": "https://example.com/resumes/worker-a.pdf"
}
```
- Expected domain(s): `resume`
- Expected trigger reason(s): `resume_changed`
- Expected recomputeWouldBeRequired: `true`

### Case H — Unrelated Field (Negative)
- Field(s):
  - `uiTheme` or `lastSeenAt`
- Before -> After:
  - `"light"` -> `"dark"` (or timestamp update)
- Payload:
```js
{
  "uiTheme": "dark"
}
```
- Expected domain(s): `[]`
- Expected trigger reason(s): `[]`
- Expected recomputeWouldBeRequired: `false`

### Case I — Non-C1 / Non-Worker Scope (Negative)
- Target doc:
  - user outside C1 **or** C1 user with internal/admin security level
- Example field edit:
  - `workerProfile.skills`
- Payload:
```js
{
  "workerProfile.skills": ["forklift"]
}
```
- Expected domain(s): not logged (scope excluded)
- Expected trigger reason(s): not logged (scope excluded)
- Expected recomputeWouldBeRequired: not logged / no-op

### Quick Verification Steps Per Case
1. Apply one payload update only.
2. Query logs for `functionName=logC1WorkerReadinessDomainChanges` and `uid=<test uid>`.
3. Verify:
   - `changedFieldPrefixes` includes expected prefix
   - `readinessDomainsAffected` matches expected domain(s)
   - `triggerReasons` matches expected reason(s)
   - `recomputeWouldBeRequired` matches expected boolean
4. Reset field if needed and proceed to next case.

### Important
- This sheet is validation support only.
- Keep `snapshotWriteEnabled=false`.
