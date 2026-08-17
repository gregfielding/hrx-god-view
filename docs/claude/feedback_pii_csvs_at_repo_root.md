# pii csvs at repo root

> select.CSV and events.CSV live at the repo root and contain SSN-last-4, phone, email — gitignore must exclude *.CSV; the project's .cursorrules requires redacting sensitive data

Tempworks export CSVs (`select.CSV`, `events.CSV`) live in `~/Projects/hrx-god-view/` (repo root) during migration work. They contain SSN-last-4, phone, and email — heavy PII.

**Why:** The project's `.cursorrules` requires redacting sensitive data. Committing one of these would put a few thousand workers' PII into git history permanently — that's a notify-affected-parties, regenerate-secrets-grade incident.

**How to apply:**
- Verify `.gitignore` excludes `*.CSV` (capital C) before running any `git add .` or `git add -A` in a session that touched migration work. The pattern is case-sensitive on the filesystem.
- Prefer `git add <specific paths>` over `git add .` when there's any chance a CSV is in the worktree.
- Don't read CSV contents into chat output for "let me check the data" — quote schema (header row) and counts only, not row contents.
- BI.0's match strategy (Amendment A.1) dropped SSN-last-4 from the import schema entirely — privacy posture. Future imports should follow the same dropping rule unless SSN-last-4 is genuinely load-bearing for the match logic.
