/**
 * `TimesheetEditorContext` — page-scoped editor state for the
 * recruiter timesheet grid.
 *
 * **What it owns:**
 *   1. **Undo stack.** Single-step pop on Cmd/Ctrl+Z. Each successful
 *      cell save pushes an `EditEntry` describing the field, prior
 *      value, and committed value. Cmd+Z pops the latest and
 *      re-fires the save with the prior value.
 *   2. **Page-level keyboard listener** for Cmd/Ctrl+Z so the grid
 *      itself doesn't have to. Skips the listener when the user's
 *      focus is inside an `<input>` mid-edit (the browser's text
 *      undo wins there — recruiters expect Cmd+Z to undo the LAST
 *      few keystrokes inside an active editor before reaching the
 *      grid's commit history).
 *
 * **What it doesn't own:**
 *   - The actual Firestore write — the `replay` callback registered
 *     with `pushEdit` is what re-executes the prior save. Each cell
 *     wires its own commit path through this so the undo stack
 *     stays decoupled from any specific save mechanism (callable vs
 *     direct write, optimistic UI, etc.).
 *
 * **Stack size cap.** Default 50 entries. Beyond that, the oldest
 * gets dropped. 50 is enough for a normal week's edits without
 * unbounded growth from a recruiter who's been editing for hours.
 *
 * **No redo.** Cmd+Shift+Z is intentionally not wired in P3.A. Redo
 * with optimistic UI + auto-rollback gets confusing fast (what does
 * "redo" mean if the original save failed and the cell rolled back?).
 * P3.B+ can revisit if recruiter feedback asks for it.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/** One recorded edit. The `replay` callback re-applies `priorValue`
 *  via the cell's saved-on-blur path. The cell is responsible for
 *  validating its own prior-value (it should always be valid — it
 *  was already committed once — but defensive validation in the
 *  cell is cheap insurance). */
export interface EditEntry {
  entryId: string;
  field: string;
  /** The value as it stood BEFORE this commit. Replayed on Cmd+Z. */
  priorValue: unknown;
  /** The value committed on this edit. Diagnostic only — not used
   *  for replay. */
  newValue: unknown;
  /** Re-fire the original save with `priorValue`. Returns the
   *  Promise so the keyboard handler can await + surface failures. */
  replay: () => Promise<void>;
}

interface TimesheetEditorContextValue {
  /** Push a successful edit onto the stack. No-op if disabled. */
  pushEdit: (entry: EditEntry) => void;
  /** Pop the latest edit and replay it. Resolves once the replay
   *  save settles. Returns false if the stack was empty. */
  undoLast: () => Promise<boolean>;
  /** Number of edits currently in the stack. UI doesn't surface
   *  this in P3.A but it's exposed for future debug overlays. */
  stackSize: number;
}

const DEFAULT_VALUE: TimesheetEditorContextValue = {
  pushEdit: () => {},
  undoLast: async () => false,
  stackSize: 0,
};

const TimesheetEditorContext =
  createContext<TimesheetEditorContextValue>(DEFAULT_VALUE);

const STACK_CAP = 50;

/* -------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------- */

export interface TimesheetEditorProviderProps {
  children: React.ReactNode;
  /** Optional override for the cap. Tests pass a small value; UI
   *  uses the default. */
  stackCap?: number;
}

/**
 * Detect whether the user's focus is inside an editable element.
 * Used by the keyboard handler to defer to native browser undo
 * for in-editor keystrokes — only after they Tab/Enter out does
 * Cmd+Z reach the grid-level undo stack.
 */
function isFocusInsideEditableElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export const TimesheetEditorProvider: React.FC<TimesheetEditorProviderProps> = ({
  children,
  stackCap = STACK_CAP,
}) => {
  // Stack is held in a ref to avoid re-render churn on every push —
  // cells don't need to re-render just because someone else pushed.
  // The reactive `stackSize` mirror exists for occasional UI use.
  const stackRef = useRef<EditEntry[]>([]);
  const [stackSize, setStackSize] = React.useState(0);

  const pushEdit = useCallback(
    (entry: EditEntry) => {
      stackRef.current = [...stackRef.current, entry];
      if (stackRef.current.length > stackCap) {
        stackRef.current = stackRef.current.slice(-stackCap);
      }
      setStackSize(stackRef.current.length);
    },
    [stackCap],
  );

  const undoLast = useCallback(async () => {
    if (stackRef.current.length === 0) return false;
    const next = stackRef.current[stackRef.current.length - 1];
    // Pop BEFORE replaying so a failed replay doesn't keep the
    // entry on the stack (the failure surfaces on the cell; the
    // user can retry by editing manually).
    stackRef.current = stackRef.current.slice(0, -1);
    setStackSize(stackRef.current.length);
    try {
      await next.replay();
      return true;
    } catch (err) {
      // Replay failure is logged by the cell's commit path. We
      // intentionally don't re-push the entry — undoing again
      // would just retry the same failure.
      // eslint-disable-next-line no-console
      console.warn('[TimesheetEditor] Undo replay failed:', err);
      return false;
    }
  }, []);

  // Page-level keyboard listener. We attach to document so the
  // shortcut works regardless of which cell has focus. Skips when
  // focus is inside an active text input — browser-native undo
  // wins there.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isUndo =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (!isUndo) return;
      if (isFocusInsideEditableElement()) return;
      if (stackRef.current.length === 0) return;
      e.preventDefault();
      void undoLast();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undoLast]);

  const value = useMemo<TimesheetEditorContextValue>(
    () => ({
      pushEdit,
      undoLast,
      stackSize,
    }),
    [pushEdit, undoLast, stackSize],
  );

  return (
    <TimesheetEditorContext.Provider value={value}>
      {children}
    </TimesheetEditorContext.Provider>
  );
};

/* -------------------------------------------------------------------------
 * Consumer hook
 * ------------------------------------------------------------------------- */

export function useTimesheetEditor(): TimesheetEditorContextValue {
  return useContext(TimesheetEditorContext);
}
