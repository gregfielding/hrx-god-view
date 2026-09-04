# Posting content translation (EN→ES at write time)

Worker-visible job-posting CONTENT (title + description) is auto-translated
to Spanish when the posting is written, so ES-mode viewers never see English
descriptions. (Static UI strings are a different system — see
feedback_i18n_source_of_truth.md.)

## How it works

- Rides the existing `notifyGoogleJobsIndexing` trigger
  (`functions/src/notifyGoogleJobsIndexing.ts`,
  `tenants/{t}/job_postings/{postId}` onDocumentWritten) — function cap, no
  new functions. Translation runs BEFORE the active/public indexing gate and
  fails open.
- `translateJobTextToSpanish` (functions/src/messaging/translateWorkerText.ts)
  → claude-opus-5 via getClaudeChat(); structure-preserving prompt (line
  breaks, markdown, names, amounts, dates kept exact).
- Written back onto the posting doc as
  `jobDescription_i18n: { en, es, sourceHash }` and
  `jobTitle_i18n: { en, es, sourceHash }`.
- `sourceHash` = sha256(title + "\n" + description) first 16 chars. Guards
  the write-loop: the i18n write re-fires the trigger, hash matches, no-op.
- Renderers (Flutter `JobPostingModel.jobDescriptionI18n` / web) pick the
  viewer's language with EN fallback; the app also re-derives the
  responsibilities bullets from the ES description when present.

## ☠️ Field-name footgun (2026-09-04)

Postings store the body under **`jobDescription`** — NOT `description`.
The first version read `data.description`, which is always empty, so all
201 active postings got translated TITLES and no description translation,
and the bug was invisible until someone browsed in ES mode (title Spanish,
body English). Fixed in c4c4b186: read `jobDescription ?? description`.

## Backfill recipe

Touch the docs and let the deployed trigger do the work — a merge write of
a throwaway field (`i18nRetranslateTouchAt: serverTimestamp`) re-fires the
trigger; since sourceHash won't match, it retranslates. Touch in waves
(15 docs / 25s) so ~200 postings don't fire 400 concurrent Opus calls.
Script pattern: `functions/.scratch/touch_postings_for_translation.ts`
(scratch, gitignored — rewrite from this recipe if needed).

A posting edited by ops retranslates automatically on save (hash changes).
Postings whose translation call failed (rate limit etc.) stay untranslated
until the NEXT write of the doc — re-run the touch recipe if a sweep shows
stragglers.
