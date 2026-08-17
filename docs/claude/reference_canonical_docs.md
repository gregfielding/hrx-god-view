# canonical docs

> Pointers to the load-bearing design docs in this repo — read these before touching the corresponding subsystems

The `docs/` directory holds the canonical specs for the cross-cutting subsystems. Treat these as authoritative over any brief you receive:

- `docs/READINESS_EXECUTION_MATRIX.md` — Readiness layer's phased roadmap (Phases A/B/C/D/E + R.x sub-items). §4 has the Job-Readiness requirement-by-requirement spec; §7 has the phase roadmap. Status of phases lives in this doc, not in briefs.
- `docs/READINESS_MODEL.md` — three-bucket readiness framing: Worker Profile (worker-owned, no gating), Employee/Contractor (Onboarding-Specialist-owned, gates payable work), Job (Onboarding-Specialist-owned, gates starting an assignment).
- `docs/RECRUITING_ROLE_MODEL.md` — operating-role model (Recruiter / Scheduler / Onboarding Specialist / HRX Systems Operator / Payroll Coordinator). Has the changelog explaining the CSA → Onboarding Specialist simplification.
- `docs/ONBOARDING_SPECIALIST_RENAME_CURSOR_BRIEF.md` — the file-by-file rename surface for the CSA → Onboarding Specialist rename. Useful history; the rename is already merged.
- `docs/WORKFORCE_DOMAIN_MODEL.md` — AccountWorkforce (worker-to-account relationship state). Orthogonal to the role/readiness models.
- `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` — worker-dashboard action-items shape.

When a brief asserts a field name, function name, or phase status, verify it against the current doc + repo rather than trusting the brief verbatim — briefs drift faster than docs.
