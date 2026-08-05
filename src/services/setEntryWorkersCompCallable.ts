/**
 * Wrapper for the `setEntryWorkersComp` callable. Backs the inline
 * WC Code / WC Rate cells in the Timesheets grid. Writes the override
 * to the entry doc AND back-fills the shift doc when its slot is empty
 * so future entries on the same shift inherit automatically.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export interface SetEntryWorkersCompInput {
  tenantId: string;
  entryId: string;
  /** String to set; `null` to clear; `undefined` to leave untouched. */
  workersCompCode?: string | null;
  /** Decimal number to set; `null` to clear; `undefined` to leave untouched. */
  workersCompRate?: number | null;
  /**
   * Work state picked in the dialog when the row couldn't resolve one
   * (traveling crews — assignment has no fixed worksite state). Stamped on
   * the entry when its own workState is empty, and used for the matrix rate
   * lookup.
   */
  workState?: string;
}

export interface SetEntryWorkersCompResult {
  ok: true;
  entryUpdated: true;
  shiftBackfilled: boolean;
}

export function callSetEntryWorkersComp(
  functions: Functions,
  payload: SetEntryWorkersCompInput,
) {
  return httpsCallable<SetEntryWorkersCompInput, SetEntryWorkersCompResult>(
    functions,
    'setEntryWorkersComp',
  )(payload);
}
