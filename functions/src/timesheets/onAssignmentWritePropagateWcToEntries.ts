/**
 * Assignment → import-entry WC propagation (Greg 2026-08-12: "rows that
 * have codes but no rates... shouldn't those resolve on page load?").
 *
 * The import-match pass stamps whatever WC data exists at import time
 * into the entry sidecar. When the ASSIGNMENT's workers-comp data is
 * fixed afterwards (WC dialog, matrix row added, apply-to-all), the
 * already-created entries kept their stale sidecar values and the grid
 * faithfully showed code-without-rate until someone clicked re-resolve
 * per row. This trigger closes that loop: assignment WC edits fan out to
 * the assignment's UNSENT csv-import entries.
 *
 * Rules (mirror reresolveImportEntry semantics, conservative):
 *   - Only entries with source == 'csv_import' and status not in
 *     sent_to_everee/paid/voided — a submitted payroll record never changes.
 *   - Code: overwrite when the entry's top-level code is EMPTY or equals
 *     the assignment's PREVIOUS code (the entry was tracking the
 *     assignment). A differing non-empty code is a manual override — kept.
 *   - Rate: written whenever the code was written (rate follows code).
 *   - workState: fill only when empty on the entry.
 *
 * Loop safety: writes go to timesheet_entries, never back to the
 * assignment — no self-retrigger. Entry-side recompute triggers already
 * guard csv_import sources.
 */

import * as admin from "firebase-admin";
import {logger} from "firebase-functions/v2";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const SENT_STATUSES = new Set(["sent_to_everee", "paid", "voided"]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const onAssignmentWritePropagateWcToEntries = onDocumentWritten(
  {
    document: "tenants/{tenantId}/assignments/{assignmentId}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    if (!event.data?.after?.exists) return; // delete — cancel cascade owns entries
    const tenantId = event.params.tenantId as string;
    const assignmentId = event.params.assignmentId as string;
    const after = event.data.after.data() as Record<string, unknown>;
    const before = event.data?.before?.exists ?
      (event.data.before.data() as Record<string, unknown>) :
      undefined;

    const code = str(after.workersCompCode);
    if (!code) return; // nothing to propagate
    const rate = num(after.workersCompRate);
    const state =
      str(after.workState) ||
      str((after.worksiteAddress as Record<string, unknown> | undefined)?.state);

    const prevCode = before ? str(before.workersCompCode) : "";
    const prevRate = before ? num(before.workersCompRate) : null;
    const changed = code !== prevCode || rate !== prevRate;
    if (before && !changed) return; // WC untouched by this write

    let entries;
    try {
      entries = await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where("assignmentId", "==", assignmentId)
        .where("source", "==", "csv_import")
        .get();
    } catch (error) {
      logger.warn("[propagateWcToEntries] entry query failed", {
        tenantId, assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (entries.empty) return;

    let patched = 0;
    for (const d of entries.docs) {
      const v = d.data();
      if (SENT_STATUSES.has(str(v.status))) continue;
      const entryCode = str(v.workersCompCode);
      // Manual override (non-empty, not tracking the assignment) wins.
      if (entryCode && entryCode !== prevCode && entryCode !== code) continue;
      const patch: Record<string, unknown> = {
        workersCompCode: code,
        "import.workersCompCode": code,
        "import.workersCompSource": "assignment",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (rate != null) {
        patch.workersCompRate = rate;
        patch["import.workersCompRate"] = rate;
      }
      if (state && !str(v.workState)) patch.workState = state;
      try {
        await d.ref.update(patch);
        patched += 1;
      } catch (error) {
        logger.warn("[propagateWcToEntries] entry update failed", {
          tenantId, assignmentId, entryId: d.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (patched > 0) {
      logger.info("[propagateWcToEntries] propagated", {
        tenantId, assignmentId, code, rate, patched,
      });
    }
  },
);
