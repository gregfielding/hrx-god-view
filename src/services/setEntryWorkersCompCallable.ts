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
