# nontechnical recruiter ux

> "Recruiters are not tech-savvy — every HRX surface must be one-obvious-action, plain-English, impossible to miss a step"

Greg (2026-07-17): some C1 recruiters are not very tech savvy. The goal is
that they "love and embrace HRX for making everything easy and simple
instead of forgetting which buttons to push or missing a step in the
process."

**Why:** adoption is the whole ballgame — the scheduling review found the
recruiter-facing placement flow underused precisely because it was
multi-step and non-obvious ([[project_scheduling_system_review]]). A
feature that needs training is a feature that won't be used.

**How to apply:** when building recruiter-facing UI: (1) plain-English
sentences, not system vocabulary ("Yussuf still shows as working a shift
that ended Monday" — never "stale live assignment"); (2) ONE obvious
button per item, verb-labeled with what it does ("Mark finished", "Close
these out"), never a status dropdown + save; (3) push-based to-do lists
over pull-based report screens — the system should tell them what needs
doing today, not require them to remember to check; (4) no multi-step
flows without a visible checklist; prefer collapsing steps (the
place-then-hire two-stage flow is the anti-pattern); (5) counts/badges to
create "inbox zero" satisfaction. The Scheduling Health page (Phase 1c)
is the reference implementation of this style. See also
[[feedback_ai_automation_ethos]] — AI should reduce decisions, and
recruiters handle only genuine exceptions.
