/**
 * `useTimesheetEntryEditor` — per-entry adapter that wires individual
 * inline-cell saves to:
 *
 *   1. The Firestore write helper (`updateTimesheetEntryFields`)
 *      with the surgical `affectedKeys` allowlist.
 *   2. The grid-level merge (`mergeEntryUpdate`) so the row reflects
 *      the new value instantly, without a refetch round trip.
 *   3. The 2.5s deferred re-fetch (`refreshEntry`) so the recompute
 *      trigger's freshly-stamped totals (totalRegularHours,
 *      totalOTHours, etc.) land in the UI shortly after the edit.
 *   4. The page-level undo stack (`pushEdit`) so Cmd+Z can replay
 *      the prior value.
 *
 * **Why a hook instead of inline orchestration in the row.** Cells
 * need a single `onSave(value)` callback that takes their value and
 * "does the right thing." Without this hook, every cell would have
 * to thread tenantId + actorUid + entryId + mergeEntryUpdate +
 * pushEdit + refreshEntry + the field-specific patch shape itself.
 * Centralizing that here means each cell stays focused on UX
 * (parsing, validation, blur handling, error chip) and the row just
 * passes `editor.fieldHandlers.actualStartTime` etc. straight in.
 *
 * **Trigger-recompute timing.** The recompute trigger runs server-
 * side after every actuals/breaks change. On a warm container it
 * settles in ~1-2s; on cold start ~13s (per P2 spot-check). We
 * fire the deferred refetch at 2500ms — covers the common warm
 * case; cold starts will land late and the recruiter will see
 * stale totals briefly. Tradeoff vs setting up an `onSnapshot`
 * listener (heavier; more tied-up reads). P3.A uses the deferred
 * refetch; if cold-start staleness becomes a recruiter pain point,
 * P3.B can swap to `onSnapshot`.
 *
 * **Notes-only edits.** Skip the deferred refetch — `notes` isn't
 * a compute-input field, so the trigger exits at the Tier-1 gate
 * without recomputing. Saves a redundant Firestore read per notes
 * edit.
 */

import { useCallback, useMemo } from 'react';

import { useAuth } from '../contexts/AuthContext';
import { useTimesheetEditor } from '../contexts/TimesheetEditorContext';
import type {
  TimesheetBreak,
  TimesheetEntryV2,
} from '../types/recruiter/timesheet';
import {
  updateTimesheetEntryFields,
  type TimesheetEntryEditablePatch,
} from '../utils/timesheets/updateTimesheetEntryFields';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface UseTimesheetEntryEditorArgs {
  tenantId: string;
  entry: TimesheetEntryV2;
  /** Update local row state with a patch on success. Provided by
   *  `useTimesheetGridRows`. */
  mergeEntryUpdate: (entryId: string, patch: Partial<TimesheetEntryV2>) => void;
  /** Fire after a successful actuals/breaks edit to pick up the
   *  recompute trigger's recomputed totals. Provided by
   *  `useTimesheetGridRows`. */
  refreshEntry: (entryId: string) => Promise<void>;
}

export interface TimesheetEntryEditor {
  /**
   * Field-specific save callbacks. Cells consume the exact
   * function for their column — `editor.fieldHandlers.actualStartTime`
   * is `(value: string | null) => Promise<void>`. The hook handles
   * the surrounding patch shape, undo registration, and merge.
   */
  fieldHandlers: {
    actualStartTime: (value: string | null) => Promise<void>;
    actualEndTime: (value: string | null) => Promise<void>;
    breaks: (breaks: TimesheetBreak[]) => Promise<void>;
    tips: (value: number) => Promise<void>;
    bonusAmount: (value: number) => Promise<void>;
    notes: (value: string) => Promise<void>;
  };
  /** True when the entry's status forbids client-side edits.
   *  Mirrors the Firestore rule's allowlist exactly: edits are
   *  allowed for draft, submitted, approved, and error statuses;
   *  blocked for sent_to_everee and paid. */
  readOnly: boolean;
}

const READONLY_STATUSES = new Set(['sent_to_everee', 'paid']);

/* -------------------------------------------------------------------------
 * Hook
 * ------------------------------------------------------------------------- */

export function useTimesheetEntryEditor(
  args: UseTimesheetEntryEditorArgs,
): TimesheetEntryEditor {
  const { tenantId, entry, mergeEntryUpdate, refreshEntry } = args;
  const { currentUser } = useAuth();
  const { pushEdit } = useTimesheetEditor();

  const readOnly = useMemo(
    () => READONLY_STATUSES.has(entry.status),
    [entry.status],
  );

  /**
   * Generic field saver. Enforces the consistent flow:
   *   1. Write to Firestore with the surgical allowlist patch.
   *   2. Merge the new value into local row state.
   *   3. Push an undo entry (replay re-fires #1 with the prior value).
   *   4. If the field is compute-relevant, fire the deferred refetch.
   *
   * `compute` lets the caller flag whether the field changes the
   * recompute trigger's input set (`COMPUTE_INPUT_FIELDS` in the
   * trigger). Notes/tips/bonus = false; actuals/breaks = true.
   */
  const saveField = useCallback(
    async <K extends keyof TimesheetEntryEditablePatch>(
      field: K,
      newValue: TimesheetEntryEditablePatch[K],
      priorValue: TimesheetEntryEditablePatch[K],
      opts: { compute: boolean },
    ): Promise<void> => {
      if (!currentUser) {
        throw new Error('Sign-in required to edit timesheets.');
      }

      const patch: TimesheetEntryEditablePatch = {
        [field]: newValue,
      } as TimesheetEntryEditablePatch;

      await updateTimesheetEntryFields({
        tenantId,
        entryId: entry.id,
        patch,
        actorUid: currentUser.uid,
      });

      // Merge locally so the cell view reflects the saved value
      // immediately. `as Partial<...>` because TS can't infer that
      // a single-key patch is a Partial<TimesheetEntryV2> — the
      // shape matches at runtime.
      mergeEntryUpdate(entry.id, {
        [field]: newValue,
      } as Partial<TimesheetEntryV2>);

      // Register the undo: replay re-saves the prior value via
      // the same path. The replay's success/failure is tracked by
      // the editor context; cells don't need to know about it.
      pushEdit({
        entryId: entry.id,
        field: String(field),
        priorValue,
        newValue,
        replay: async () => {
          if (!currentUser) return;
          const replayPatch: TimesheetEntryEditablePatch = {
            [field]: priorValue,
          } as TimesheetEntryEditablePatch;
          await updateTimesheetEntryFields({
            tenantId,
            entryId: entry.id,
            patch: replayPatch,
            actorUid: currentUser.uid,
          });
          mergeEntryUpdate(entry.id, {
            [field]: priorValue,
          } as Partial<TimesheetEntryV2>);
          if (opts.compute) {
            // Fire-and-forget: don't await — the user's perception
            // is "Cmd+Z brought it back instantly," refetch lands
            // when the trigger settles.
            window.setTimeout(() => {
              void refreshEntry(entry.id);
            }, 2500);
          }
        },
      });

      if (opts.compute) {
        window.setTimeout(() => {
          void refreshEntry(entry.id);
        }, 2500);
      }
    },
    [
      currentUser,
      entry.id,
      mergeEntryUpdate,
      pushEdit,
      refreshEntry,
      tenantId,
    ],
  );

  const fieldHandlers = useMemo<TimesheetEntryEditor['fieldHandlers']>(
    () => ({
      actualStartTime: (value) =>
        saveField('actualStartTime', value, entry.actualStartTime ?? null, {
          compute: true,
        }),
      actualEndTime: (value) =>
        saveField('actualEndTime', value, entry.actualEndTime ?? null, {
          compute: true,
        }),
      breaks: (next) =>
        saveField(
          'breaks',
          next,
          Array.isArray(entry.breaks) ? entry.breaks : [],
          { compute: true },
        ),
      tips: (value) =>
        saveField('tips', value, typeof entry.tips === 'number' ? entry.tips : 0, {
          compute: false,
        }),
      bonusAmount: (value) =>
        saveField(
          'bonusAmount',
          value,
          typeof entry.bonusAmount === 'number' ? entry.bonusAmount : 0,
          { compute: false },
        ),
      notes: (value) =>
        saveField('notes', value, typeof entry.notes === 'string' ? entry.notes : '', {
          compute: false,
        }),
    }),
    [
      entry.actualEndTime,
      entry.actualStartTime,
      entry.bonusAmount,
      entry.breaks,
      entry.notes,
      entry.tips,
      saveField,
    ],
  );

  return {
    fieldHandlers,
    readOnly,
  };
}

export default useTimesheetEntryEditor;
