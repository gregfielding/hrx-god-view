/**
 * Tests for `TimesheetEditorContext` — the page-scoped undo stack
 * + Cmd/Ctrl+Z keyboard listener that the recruiter timesheet grid
 * sits on top of.
 *
 * Coverage:
 *   - pushEdit grows the stack; cap drops oldest beyond limit.
 *   - undoLast pops the latest and replays it.
 *   - undoLast on empty stack returns false (no-op).
 *   - Cmd+Z keyboard fires undoLast.
 *   - Cmd+Z does NOT fire when focus is inside an <input>
 *     (browser-native undo wins inside active editors).
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

import {
  TimesheetEditorProvider,
  useTimesheetEditor,
} from '../TimesheetEditorContext';

const wrapper: React.FC<{ children: React.ReactNode; cap?: number }> = ({
  children,
  cap,
}) => (
  <TimesheetEditorProvider stackCap={cap}>
    {children}
  </TimesheetEditorProvider>
);

describe('TimesheetEditorContext — stack mechanics', () => {
  test('pushEdit grows stack; undoLast pops + replays', async () => {
    const { result } = renderHook(() => useTimesheetEditor(), { wrapper });

    const replay1 = jest.fn().mockResolvedValue(undefined);
    const replay2 = jest.fn().mockResolvedValue(undefined);

    act(() => {
      result.current.pushEdit({
        entryId: 'e1',
        field: 'tips',
        priorValue: 0,
        newValue: 10,
        replay: replay1,
      });
      result.current.pushEdit({
        entryId: 'e2',
        field: 'notes',
        priorValue: '',
        newValue: 'x',
        replay: replay2,
      });
    });

    expect(result.current.stackSize).toBe(2);

    let popped: boolean | undefined;
    await act(async () => {
      popped = await result.current.undoLast();
    });

    // Replays the LATEST first.
    expect(popped).toBe(true);
    expect(replay2).toHaveBeenCalledTimes(1);
    expect(replay1).not.toHaveBeenCalled();
    expect(result.current.stackSize).toBe(1);
  });

  test('undoLast on empty stack returns false', async () => {
    const { result } = renderHook(() => useTimesheetEditor(), { wrapper });
    const popped = await act(async () => result.current.undoLast());
    expect(popped).toBe(false);
  });

  test('stack cap drops oldest entries beyond limit', () => {
    const { result } = renderHook(() => useTimesheetEditor(), {
      wrapper: ({ children }) => wrapper({ children, cap: 3 }),
    });

    act(() => {
      for (let i = 0; i < 5; i += 1) {
        result.current.pushEdit({
          entryId: `e${i}`,
          field: 'notes',
          priorValue: '',
          newValue: `v${i}`,
          replay: jest.fn().mockResolvedValue(undefined),
        });
      }
    });

    expect(result.current.stackSize).toBe(3);
  });

  test('failed replay does NOT re-push the entry', async () => {
    const { result } = renderHook(() => useTimesheetEditor(), { wrapper });
    const replay = jest.fn().mockRejectedValue(new Error('Permission denied'));

    act(() => {
      result.current.pushEdit({
        entryId: 'e1',
        field: 'tips',
        priorValue: 0,
        newValue: 10,
        replay,
      });
    });

    let popped: boolean | undefined;
    await act(async () => {
      popped = await result.current.undoLast();
    });

    expect(popped).toBe(false);
    expect(result.current.stackSize).toBe(0);
  });
});

describe('TimesheetEditorContext — keyboard listener', () => {
  test('Cmd+Z fires undoLast when focus is outside an editable element', async () => {
    const replay = jest.fn().mockResolvedValue(undefined);

    const TestComponent: React.FC = () => {
      const { pushEdit } = useTimesheetEditor();
      React.useEffect(() => {
        pushEdit({
          entryId: 'e1',
          field: 'tips',
          priorValue: 0,
          newValue: 10,
          replay,
        });
      }, [pushEdit]);
      return <div data-testid="outside" />;
    };

    render(<TestComponent />, { wrapper });

    // Click the non-editable div to drop focus there.
    fireEvent.click(screen.getByTestId('outside'));

    await act(async () => {
      fireEvent.keyDown(document, { key: 'z', metaKey: true });
      // Two microtasks for the undo replay to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replay).toHaveBeenCalledTimes(1);
  });

  test('Cmd+Z does NOT fire undoLast when focus is in an input', async () => {
    const replay = jest.fn().mockResolvedValue(undefined);

    const TestComponent: React.FC = () => {
      const { pushEdit } = useTimesheetEditor();
      React.useEffect(() => {
        pushEdit({
          entryId: 'e1',
          field: 'tips',
          priorValue: 0,
          newValue: 10,
          replay,
        });
      }, [pushEdit]);
      return <input data-testid="my-input" />;
    };

    render(<TestComponent />, { wrapper });

    const input = screen.getByTestId('my-input') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'z', metaKey: true });
      await Promise.resolve();
    });

    expect(replay).not.toHaveBeenCalled();
  });

  test('Cmd+Shift+Z is NOT treated as undo (redo not wired in P3.A)', async () => {
    const replay = jest.fn().mockResolvedValue(undefined);

    const TestComponent: React.FC = () => {
      const { pushEdit } = useTimesheetEditor();
      React.useEffect(() => {
        pushEdit({
          entryId: 'e1',
          field: 'tips',
          priorValue: 0,
          newValue: 10,
          replay,
        });
      }, [pushEdit]);
      return <div data-testid="outside" />;
    };

    render(<TestComponent />, { wrapper });
    fireEvent.click(screen.getByTestId('outside'));

    await act(async () => {
      fireEvent.keyDown(document, { key: 'z', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });

    expect(replay).not.toHaveBeenCalled();
  });
});
