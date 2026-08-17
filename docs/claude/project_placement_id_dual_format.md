# placement id dual format

> Placement docs for a (shift, user) pair exist under two ID schemes — simple ${shiftId}__${userId} (UI-created) and day-scoped ${shiftId}__${userId}__${yyyy-mm-dd} (server-recreated by placementsCancelAssignment) — any read/write code must handle both

Placement docs for a given `(shift, user)` pair can exist under **two distinct ID formats** in the placements collection:

- **Simple**: `${shiftId}__${userId}` — created by the UI when a recruiter places a worker.
- **Day-scoped**: `${shiftId}__${userId}__${YYYY-MM-DD}` — recreated server-side by `placementsCancelAssignment` whenever an assignment is cancelled (multi-day shifts get one doc per day).

**Why this matters:** A worker who has cycled through cancel-then-replace ends up with both formats co-existing for the same `(shift, user)`. Reads that rely on `where('shiftId', '==', X)` will see both; reads/deletes that key on the simple-format ID alone will miss day-scoped docs.

**How to apply:**
- For **reads**, query by `shiftId` (+ `userId` if known) — don't look up by ID. The snapshot listener pattern in [PlacementsTab.tsx](src/components/recruiter/PlacementsTab.tsx) does this.
- For **deletes**, query first to find every matching doc and batch-delete all of them. Don't `doc.delete()` on the constructed simple-format ID — fixed in commit `8bf55097`.
- For **writes**, prefer the simple format for new UI-initiated placements; the day-scoped format is internal to the cancel-cascade path. Don't manually construct day-scoped IDs from new code.
- For optimistic-UI add/remove patterns, also clear any `pendingPlacementAdds` refs after a delete — the snapshot rebuild can otherwise re-add the placement via the optimistic merge.
