/**
 * `useCellSaveState` — the shared lifecycle hook every editable cell
 * in the timesheet grid plugs into.
 *
 * **Lifecycle (build-plan §6 Phase 3.A):**
 *
 *   idle  ─── user types/clicks ──▶  (cell-local edit state)
 *     ▲                                    │
 *     │                                    ▼
 *     │                       commit(value)   ───▶  validate
 *     │                                                │
 *     │                       ┌────────────────────────┴────────┐
 *     │                       │                                 │
 *     │                  (validation fail)              (validation pass)
 *     │                       │                                 │
 *     │                  state = 'invalid'                state = 'saving'
 *     │                  errorMessage set                 (optimistic UI on)
 *     │                       │                                 │
 *     │              (cell stays in edit                         ▼
 *     │              mode, no Firestore write)            await onSave(value)
 *     │                       │                                 │
 *     │                       │                  ┌──────────────┴─────────────┐
 *     │                       │                  │                            │
 *     │                       │             (resolve)                     (reject)
 *     │                       │                  │                            │
 *     │                       │            state = 'saved'             state = 'error'
 *     │                       │            (300ms checkmark)           rollback to prior
 *     │                       │                  │                            │
 *     └───────────────────────┴──────────────────┴────────────────────────────┘
 *
 * **150ms spinner threshold.** `showSpinner` only flips true after the
 * save has been in flight for 150ms — sub-perceptual saves don't
 * flicker a spinner that would make every commit feel busy. Same
 * pattern that material design uses for skeleton loaders.
 *
 * **300ms checkmark.** On success, the checkmark stays visible for
 * 300ms before reverting to idle. Below 300ms the brain reads it as a
 * glitch; above 300ms it pollutes the row visually when typing
 * quickly across cells.
 *
 * **Optimistic UI.** The hook does NOT own the displayed value —
 * cells pass `committed` (the prior known-good) and `displayed` (the
 * optimistic value) so they can render whichever is appropriate for
 * the current state. On error, the hook returns `errorMessage` and
 * the cell rolls back to `committed`.
 *
 * **Re-entrancy.** `commit()` is safe to call repeatedly. The
 * underlying save promise is sequenced — a second commit while the
 * first is in flight queues behind it. We do NOT cancel in-flight
 * saves: by the time the user has typed something new, the previous
 * value is already (or about to be) persisted, and discarding it
 * would risk lost-write surprises.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------
 * State machine
 * ------------------------------------------------------------------------- */

export type CellSaveState =
  | 'idle'
  | 'invalid'
  | 'saving'
  | 'saved'
  | 'error';

export interface UseCellSaveStateResult {
  state: CellSaveState;
  /** True after the save has been in flight ≥ 150ms. */
  showSpinner: boolean;
  /** True for ~300ms after a successful save. */
  showCheckmark: boolean;
  /** Validation- or save-failure message. Cleared on next commit. */
  errorMessage: string | null;
  /**
   * Commit a value through the lifecycle. Resolves once the save has
   * settled (success or failure) — caller can `await` to know the
   * final state. Throws nothing; failures land on `errorMessage`.
   */
  commit: (value: unknown, save: (value: unknown) => Promise<void>) => Promise<void>;
  /**
   * Set a validation error explicitly (used by cells that validate
   * before commit() — they short-circuit and call this rather than
   * letting an invalid value reach Firestore).
   */
  setValidationError: (message: string | null) => void;
  /** Reset state to idle. Used when a cell exits edit mode. */
  reset: () => void;
}

const SPINNER_DELAY_MS = 150;
const CHECKMARK_VISIBLE_MS = 300;

/* -------------------------------------------------------------------------
 * Hook
 * ------------------------------------------------------------------------- */

export function useCellSaveState(): UseCellSaveStateResult {
  const [state, setState] = useState<CellSaveState>('idle');
  const [showSpinner, setShowSpinner] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkmarkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const clearTimers = () => {
    if (spinnerTimerRef.current !== null) {
      clearTimeout(spinnerTimerRef.current);
      spinnerTimerRef.current = null;
    }
    if (checkmarkTimerRef.current !== null) {
      clearTimeout(checkmarkTimerRef.current);
      checkmarkTimerRef.current = null;
    }
  };

  useEffect(() => {
    return clearTimers;
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setState('idle');
    setShowSpinner(false);
    setShowCheckmark(false);
    setErrorMessage(null);
  }, []);

  const setValidationError = useCallback((message: string | null) => {
    clearTimers();
    setShowSpinner(false);
    setShowCheckmark(false);
    if (message === null) {
      setState('idle');
      setErrorMessage(null);
    } else {
      setState('invalid');
      setErrorMessage(message);
    }
  }, []);

  const commit = useCallback(
    async (value: unknown, save: (value: unknown) => Promise<void>): Promise<void> => {
      // Sequence after any in-flight save so back-to-back commits to
      // the same cell don't race. We DON'T cancel — the previous
      // commit's value is already on its way to Firestore and racing
      // it would risk lost writes.
      const prior = inFlightRef.current;
      const next = (async () => {
        if (prior) {
          try {
            await prior;
          } catch {
            // Prior failure is already surfaced via errorMessage; we
            // still want to attempt the new commit.
          }
        }
        clearTimers();
        setErrorMessage(null);
        setShowCheckmark(false);
        setState('saving');

        // Spinner kicks in only after 150ms — sub-perceptual saves
        // don't flicker a busy indicator.
        spinnerTimerRef.current = setTimeout(() => {
          setShowSpinner(true);
        }, SPINNER_DELAY_MS);

        try {
          await save(value);

          clearTimers();
          setShowSpinner(false);
          setState('saved');
          setShowCheckmark(true);

          checkmarkTimerRef.current = setTimeout(() => {
            setShowCheckmark(false);
            setState('idle');
          }, CHECKMARK_VISIBLE_MS);
        } catch (err) {
          clearTimers();
          setShowSpinner(false);
          setShowCheckmark(false);
          setState('error');
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMessage(msg);
        }
      })();

      inFlightRef.current = next;
      try {
        await next;
      } finally {
        if (inFlightRef.current === next) {
          inFlightRef.current = null;
        }
      }
    },
    [],
  );

  return {
    state,
    showSpinner,
    showCheckmark,
    errorMessage,
    commit,
    setValidationError,
    reset,
  };
}
