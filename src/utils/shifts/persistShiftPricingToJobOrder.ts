/**
 * Write recruiter-edited pricing from a shift form back up to the parent job order.
 *
 * Companion to `sutaFutaAccountHydration.ts`, but with three intentional differences:
 *  1. **All pricing fields**, not just SUTA/FUTA: pay, markup, bill, WC code, WC rate,
 *     SUTA, FUTA.
 *  2. **Overwrite** semantics — the recruiter typed values on a shift and explicitly hit
 *     Save, so they win over whatever was on the JO row before. (`sutaFutaAccountHydration`
 *     is fill-empty.)
 *  3. **Job order only** — does NOT fan out to `accounts/{recruiterAccountId}.pricing`.
 *     Greg confirmed the rate change should affect future shifts on this JO only;
 *     national-level pricing stays where it lives (Cascading Data tab on the account).
 *
 * The position row is matched by case-insensitive trimmed `jobTitle` against the
 * shift's `defaultJobTitle`. Field-name reconciliation matches `EditShiftForm.mapPos`:
 * legacy writes use `markup` (not `markupPercent`) and `workersCompClassCode`
 * (not `workersCompCode`) — we write both keys so both readers see the new value.
 */

import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';

export type ShiftPricingPatch = {
  /** Hourly pay to the worker. */
  payRate?: number | null;
  /** Markup percent (e.g. 38 for 38%). When set, bill is derived from pay × (1 + markup/100). */
  markupPercent?: number | null;
  /** Hourly bill to the client. When set without markup, markup is derived from (bill − pay)/pay × 100. */
  billRate?: number | null;
  workersCompCode?: string | null;
  workersCompRate?: number | null;
  sutaRate?: number | null;
  futaRate?: number | null;
};

export type PersistShiftPricingResult = {
  wrote: boolean;
  /** Where the patch landed: which array (or top-level legacy) was rewritten. */
  target: 'positions' | 'gigPositions' | 'top_level' | 'none';
  /** When `target` is an array, the new array (use to refresh local JO state). */
  updatedArray?: Record<string, unknown>[];
};

function isFiniteOrUndef(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * True when the patch contains anything worth writing. (`undefined` = unchanged,
 * `null` = explicit clear, finite number / non-empty string = explicit set.)
 */
export function shiftPricingPatchHasChanges(patch: ShiftPricingPatch): boolean {
  return (
    patch.payRate !== undefined ||
    patch.markupPercent !== undefined ||
    patch.billRate !== undefined ||
    patch.workersCompCode !== undefined ||
    patch.workersCompRate !== undefined ||
    patch.sutaRate !== undefined ||
    patch.futaRate !== undefined
  );
}

/**
 * Apply a `ShiftPricingPatch` to a position row. Writes both legacy and canonical
 * key spellings so older readers (`pos.markup`, `pos.workersCompClassCode`) and
 * newer readers (`pos.markupPercent`, `pos.workersCompCode`) both see the update.
 *
 * `null` clears the field (rare — the form usually sends `undefined` for "unchanged");
 * `undefined` leaves it as-is.
 */
function applyPatchToRow(
  row: Record<string, unknown>,
  patch: ShiftPricingPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row };

  if (patch.payRate !== undefined) {
    next.payRate = patch.payRate ?? '';
  }
  if (patch.markupPercent !== undefined) {
    next.markupPercent = patch.markupPercent ?? '';
    next.markup = patch.markupPercent ?? '';
  }
  if (patch.billRate !== undefined) {
    next.billRate = patch.billRate ?? '';
  }
  if (patch.workersCompCode !== undefined) {
    const v = patch.workersCompCode ?? '';
    next.workersCompCode = v;
    next.workersCompClassCode = v;
  }
  if (patch.workersCompRate !== undefined) {
    next.workersCompRate = patch.workersCompRate ?? '';
  }
  if (patch.sutaRate !== undefined) {
    next.sutaRate = patch.sutaRate ?? '';
  }
  if (patch.futaRate !== undefined) {
    next.futaRate = patch.futaRate ?? '';
  }

  return next;
}

/**
 * Build the patch object for a top-level (legacy single-position) job order.
 * Same dual-key strategy as `applyPatchToRow`.
 */
function buildTopLevelPatch(patch: ShiftPricingPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.payRate !== undefined) out.payRate = patch.payRate ?? '';
  if (patch.markupPercent !== undefined) {
    out.markupPercent = patch.markupPercent ?? '';
    out.markup = patch.markupPercent ?? '';
  }
  if (patch.billRate !== undefined) out.billRate = patch.billRate ?? '';
  if (patch.workersCompCode !== undefined) {
    out.workersCompCode = patch.workersCompCode ?? '';
    out.workersCompClassCode = patch.workersCompCode ?? '';
  }
  if (patch.workersCompRate !== undefined) out.workersCompRate = patch.workersCompRate ?? '';
  if (patch.sutaRate !== undefined) out.sutaRate = patch.sutaRate ?? '';
  if (patch.futaRate !== undefined) out.futaRate = patch.futaRate ?? '';
  return out;
}

function pickPositionsArray(jobOrder: Record<string, unknown>): {
  field: 'positions' | 'gigPositions' | null;
  rows: Record<string, unknown>[];
} {
  if (Array.isArray(jobOrder.positions) && jobOrder.positions.length > 0) {
    return { field: 'positions', rows: jobOrder.positions as Record<string, unknown>[] };
  }
  if (
    jobOrder.jobType === 'gig' &&
    Array.isArray(jobOrder.gigPositions) &&
    (jobOrder.gigPositions as unknown[]).length > 0
  ) {
    return { field: 'gigPositions', rows: jobOrder.gigPositions as Record<string, unknown>[] };
  }
  return { field: null, rows: [] };
}

/**
 * Persist a recruiter-edited pricing patch from a shift form to its parent JO row.
 *
 * - Matches the position row by case-insensitive trimmed `jobTitle` vs `defaultJobTitle`.
 * - Returns `{ wrote: false, target: 'none' }` without writing when the patch is empty
 *   or the JO has no matching row.
 * - For legacy single-position JOs (no `positions[]` / `gigPositions[]` and a top-level
 *   `jobTitle` that matches), writes to top-level fields.
 *
 * Caller is responsible for refetching/refreshing local JO state after this resolves
 * (typically via the existing `onJobOrderUpdated?.()` callback in `EditShiftForm`).
 */
export async function persistShiftPricingToJobOrder(params: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: Record<string, unknown>;
  defaultJobTitle: string;
  pricing: ShiftPricingPatch;
  userId?: string | null;
}): Promise<PersistShiftPricingResult> {
  const { tenantId, jobOrderId, jobOrder, defaultJobTitle, pricing, userId } = params;

  if (!tenantId || !jobOrderId || !jobOrder || !defaultJobTitle.trim()) {
    return { wrote: false, target: 'none' };
  }
  if (!shiftPricingPatchHasChanges(pricing)) {
    return { wrote: false, target: 'none' };
  }

  const titleNorm = defaultJobTitle.trim().toLowerCase();
  const joRef = doc(db, p.jobOrder(tenantId, jobOrderId));

  const { field, rows } = pickPositionsArray(jobOrder);

  if (field && rows.length > 0) {
    const idx = rows.findIndex(
      (r) => String(r?.jobTitle ?? '').trim().toLowerCase() === titleNorm,
    );
    if (idx < 0) return { wrote: false, target: 'none' };

    const nextRows = rows.map((r, i) => (i === idx ? applyPatchToRow(r, pricing) : r));
    await updateDoc(joRef, {
      [field]: nextRows,
      updatedAt: serverTimestamp(),
      ...(userId ? { updatedBy: userId } : {}),
    });
    return { wrote: true, target: field, updatedArray: nextRows };
  }

  // Legacy single-position JO: only patch when the top-level title matches.
  const topTitle = String(jobOrder.jobTitle ?? '').trim().toLowerCase();
  if (topTitle && topTitle === titleNorm) {
    await updateDoc(joRef, {
      ...buildTopLevelPatch(pricing),
      updatedAt: serverTimestamp(),
      ...(userId ? { updatedBy: userId } : {}),
    });
    return { wrote: true, target: 'top_level' };
  }

  return { wrote: false, target: 'none' };
}

/**
 * Compute pay / markup / bill consistently when one of the three changes.
 *
 *  - changing `payRate`: keep markup, recompute bill from (pay × (1 + markup/100))
 *  - changing `markupPercent`: keep pay, recompute bill
 *  - changing `billRate`: keep pay, recompute markup as ((bill − pay) / pay) × 100
 *
 * Returns the new triple. Strings come in (since the form holds strings); strings go out.
 * Empty string passes through unchanged so the user can blank a field without us
 * fabricating a value.
 */
export function recomputePricingTriple(args: {
  changed: 'payRate' | 'markupPercent' | 'billRate';
  payRate: string;
  markupPercent: string;
  billRate: string;
}): { payRate: string; markupPercent: string; billRate: string } {
  const { changed } = args;
  const payRate = args.payRate.trim();
  const markupPercent = args.markupPercent.trim();
  const billRate = args.billRate.trim();

  const pay = parseFloat(payRate);
  const markup = parseFloat(markupPercent);
  const bill = parseFloat(billRate);

  const round2 = (n: number): string => String(Number(n.toFixed(2)));

  if (changed === 'payRate' || changed === 'markupPercent') {
    if (
      isFiniteOrUndef(pay) &&
      pay > 0 &&
      isFiniteOrUndef(markup) &&
      markup >= 0
    ) {
      return {
        payRate,
        markupPercent,
        billRate: round2(pay * (1 + markup / 100)),
      };
    }
    return { payRate, markupPercent, billRate };
  }

  // changed === 'billRate'
  if (
    isFiniteOrUndef(pay) &&
    pay > 0 &&
    isFiniteOrUndef(bill) &&
    bill >= pay
  ) {
    return {
      payRate,
      markupPercent: round2((bill / pay - 1) * 100),
      billRate,
    };
  }
  return { payRate, markupPercent, billRate };
}
