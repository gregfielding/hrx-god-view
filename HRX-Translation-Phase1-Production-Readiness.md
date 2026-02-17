
# HRX Translation Phase 1 – Production Readiness & Go‑Live Advisory

## Current State

You now have:

- Loop-safe Firestore trigger
- Async Cloud Tasks processing
- OIDC-protected HTTP worker
- Per-field hashes (fieldHashes)
- Per-field manual locks (translationMeta.es.manualFields)
- Placeholder validation
- Translation logging (translation_logs)
- Passing translation unit tests

This is production-grade infrastructure.

---

# Before Enabling in Production

## 1. Confirm Per-Field Hash Model

Ensure hashes are stored per field:

translationMeta: {
  es: {
    fieldHashes: {
      jobTitle_i18n: "abc123",
      jobDescription_i18n: "def456"
    }
  }
}

Worker logic must compare:
computeHash(enValue) === existingHash → skip translation

This prevents unnecessary retranslation and protects unrelated fields.

---

## 2. Add a Production Safety Valve (Highly Recommended)

Add environment variable:

TRANSLATION_ENABLED=true

In trigger:

if (process.env.TRANSLATION_ENABLED !== "true") return;

This allows immediate shutdown of translation if:
- OpenAI latency spikes
- IAM issues occur
- Rate limits hit
- Budget risk emerges

Redeploy with TRANSLATION_ENABLED=false to disable safely.

---

## 3. Add Soft Budget Guard

Prevent oversized payloads from exhausting API budget.

Example guard in worker:

if (sourceText.length > 8000) {
  log + skip
}

Even a simple character limit is sufficient for Phase 1.

---

# First 48-Hour Monitoring Checklist

## A. Translation Frequency

Watch for rapid consecutive edits to the same job.
If needed later, implement debounce or short time-based suppression.

## B. Cloud Tasks Retry Rate

Retries indicate:
- IAM misconfiguration
- Network/OpenAI failure
- Worker returning 5xx unexpectedly

Ensure 5xx is only returned for true retryable failures.

## C. translation_logs Review

Watch for:
- Placeholder mismatch errors
- JSON parse errors from OpenAI
- Empty translation outputs

Failure rate should remain very low (<1–2%).

---

# Architectural Assessment

You now have a translation microservice embedded inside HRX.

This supports future expansion into:

- Multilingual worker onboarding
- Companion AI prompts in multiple languages
- Recruiter note auto-translation
- Multilingual AI interviews
- Cross-language behavioral analytics

This is strategic infrastructure, not just job translation.

---

# Recommended Rollout Strategy

1. Enable for one staging tenant.
2. Validate queue + worker + logs for 24 hours.
3. Enable for one real tenant.
4. Monitor for 24–48 hours.
5. Roll out globally.

Do not activate across all tenants on day one.

---

# Optional Next Enhancements

## Operational Control UI
Add admin interface to:
- View translationMeta + fieldHashes
- Lock/unlock fields
- Re-run translation
- View translation_logs per document

## Strategic Expansion
Extend translation engine to:
- Assignment instructions
- Worksite safety notes
- Shift reminders
- Worker onboarding flows

---

# Deployment Reminder

Before first production activation:

- Confirm Cloud Tasks queue exists
- Confirm TASKS_SERVICE_ACCOUNT_EMAIL has roles/run.invoker
- Confirm runtime service account can enqueue tasks
- Confirm TRANSLATION_WORKER_URL is correct
- Confirm OPENAI_API_KEY secret binding works
- Confirm TRANSLATION_ENABLED is true

---

END OF DOCUMENT
