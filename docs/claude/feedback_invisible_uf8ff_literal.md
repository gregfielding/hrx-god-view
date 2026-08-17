# invisible uf8ff literal

> "Literal U+F8FF chars in Firestore prefix-range bounds render invisibly and get misreported as empty-range bugs — always write the \uf8ff escape; verify suspected empty ranges with hexdump before \"fixing\""

2026-07-28: `queryUsersByLastName` in importTimesheetMatchWorkers.ts was reported as an empty-range bug (`>= v AND < v`) — but hexdump showed the upper bound was actually `` `${v}<U+F8FF literal>` `` (bytes `ef a3 bf`): functionally correct, just invisible in editors/terminals. Same in searchTimesheetWorkers.ts. Both normalized to the visible `\uf8ff` escape (commit on claude/relaxed-almeida-2b9a87); repo-wide byte sweep of src/shared/functions/packages now clean.

**Why:** U+F8FF (Apple private-use) renders as nothing in most fonts, so a correct prefix range reads as an empty one — it survived one code review already (the perf commit e5f300c2 dropped the equality query trusting the "broken-looking" range) and triggered a false bug report. The character also propagates invisibly through copy-paste AND through LLM context (my own generated scripts/commit messages re-emitted the literal three times until byte-checked).

**How to apply:** Before "fixing" a Firestore range that looks empty, `sed -n '<line>p' file | hexdump -C` — look for `ef a3 bf`. Always write `'\uf8ff'` as the six-character escape, never paste the character. After generating text near this topic, sweep with `grep -rl $'\xef\xa3\xbf'`. Related: [[undefined-stripper-timestamp-footgun]] for the other class of silent Firestore corruption.
