# Admin Surface Launch Posture (MVP)

Last updated: 2026-03-12

This is the minimum safe operator posture for launch to reduce accidental use of legacy paths.

## Use These Paths (Primary)

- `/jobs/job-orders`
- `/jobs/job-orders/:jobOrderId`
- `/jobs/jobs-board`

## Compatibility Paths (Do Not Train Operators On These)

- `/recruiter/*` routes are legacy compatibility aliases.
- They should be treated as redirect-only entry points, not primary workflow paths.

## Operational Guidance

- Recruiter SOPs should reference only `/jobs/*` routes.
- QA launch checks should validate staffing actions from `/jobs/*` only.
- If a mismatch is observed between `/recruiter/*` and `/jobs/*`, treat `/jobs/*` behavior as canonical and log the other as legacy drift.
