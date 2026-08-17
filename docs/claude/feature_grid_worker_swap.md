# grid worker swap

> "Timesheet Grid worker swap — import rows use reassignImportEntryWorker pencil; scheduled rows use swapScheduledAssignmentWorker (assignment+entries MOVE, ids are structural)"

Timesheet Grid worker-fix coverage (2026-07-07, commit 91c8070f):

- **Import rows**: already had the pencil (ImportRowWorkerPicker → `reassignImportEntryWorker`) — moves the synthetic entry doc (`import__{customer}__{userId|csvKey}__{workDate}`), recomputes Everee linkage, carries pay/WC/worksite. Blocked when matchStatus submitted/paid.
- **Scheduled rows** (new): same pencil on EntryRow via ImportRowWorkerPicker `mode="scheduled"` → `swapScheduledAssignmentWorker` callable. Identity is STRUCTURAL: assignment doc id = `{shiftId}__{userId}`, entry doc id = `{assignmentId}_{workDate}` → swap MOVES everything: new assignment doc (identity refreshed from users/{uid}, `assignmentReadinessV1` dropped so readiness re-evaluates, `suppressInitialNotification: true`), entries rewritten to new ids with `swappedFromEntryId`, old assignment HARD-DELETED (grid resolver has no status filter — cancelled assignments would leave phantom rows; and the wrong worker's app must stop showing the shift).
- Guards: refuses if any entry under the assignment is `sent_to_everee`/`paid` (recall via revertSentTimesheetEntryToDraft first) or if the target worker already has an entry for a same date on that shift. Auth: securityLevel ≥ 5 / roles / HRX (drafts only — not an Everee mutation).
- After swap the UI must `reloadAll()` — every doc id changed.

**Why:** the import-tab matching can be corrected pre-save, but Greg needed post-hoc fixes on the grid ("no way to change the incorrect worker to the correct one").
