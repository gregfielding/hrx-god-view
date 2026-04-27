# Action Items v1 — Product spec (locked)

## Goal

The Action Items card answers:

- What is blocking this worker now  
- What should happen next  
- What should a recruiter notice  

## v1 schema (normalized)

See `src/types/actionItems.ts` — required fields: `id`, `dedupeKey`, `type`, `category`, `severity`, `actor`, `title`, `shortDescription`, `scope`, `blocking`, `sourceType`, `sourceId`, `ctaLabel`, `ctaTarget`, `priority`, `rulesVersion`.

`rulesVersion` is always `action_items_v1`.

## v1 action types (enum)

As implemented in `ActionItemType` in code.

## Precedence

- Specific beats generic for the same entity scope (e.g. I-9 / E-Verify vs generic onboarding).  
- Hard blockers sort before soft.  
- Dedupe by `dedupeKey`; one winner per key (highest severity, then lower `priority` number).

## Section mapping

- `blocking === 'hard'` → **Blocking now** (max 3)  
- `blocking === 'soft'` → **Next steps** (max 4)  
- Watchouts: risk, score, informational (`blocking === 'informational'`) (max 2)  
- Overflow: `+ N more` not required in v1 (cap by slicing).

## Compute architecture (v1)

Pure derivation in the client: `deriveActionItemsV1(input)` — no Firestore writes, no Cloud Functions, no cached summary field.

## Data sources (v1)

User profile Overview: user doc snapshot fields, `scoreSummary`, `riskProfile`, entity employment hook output (chips + per-entity signals), optional interview flag from parent (same reads as header).

## Deferred (phase 2)

Snooze/dismiss, messaging-driven actions, generalized stale engine, audit history, AI prioritization.
