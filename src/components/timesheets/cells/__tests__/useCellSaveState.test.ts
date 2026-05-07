/**
 * Tests for `useCellSaveState` — the lifecycle hook that drives the
 * save-on-blur flow for every inline-editable cell in P3.A.
 *
 * Coverage shape:
 *   - Successful save runs through saving → saved → idle.
 *   - 150ms spinner threshold: spinner stays hidden for fast saves.
 *   - 300ms checkmark dwell: visible after success, then auto-clears.
 *   - Save failure: state lands on 'error' with the rejection's message.
 *   - setValidationError: state lands on 'invalid' with the message.
 *   - reset: returns to idle from any state.
 *   - Re-entrancy: a second commit() while the first is pending
 *     queues; both observe their respective save state correctly.
 */

import { act, renderHook } from '@testing-library/react';

import { useCellSaveState } from '../useCellSaveState';

// Use Jest's modern fake timers so we can advance through the
// 150ms spinner threshold and 300ms checkmark dwell deterministically.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * `flush` runs both microtasks (promise resolutions) and any pending
 * timers up to `ms` milliseconds. Combining them in a single helper
 * is the standard React-testing-library pattern for awaiting hooks
 * that mix promises with setTimeout.
 */
async function flush(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useCellSaveState — happy path', () => {
  test('fast save (<150ms) ends in saved → idle without flashing the spinner', async () => {
    const { result } = renderHook(() => useCellSaveState());

    // Save resolves on the next microtask tick — sub-perceptual,
    // well under the 150ms spinner threshold.
    const save = jest.fn().mockResolvedValue(undefined);

    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = result.current.commit('hello', save);
    });

    await act(async () => {
      await commitPromise;
    });

    // Spinner never flipped on (the 150ms timer hasn't fired yet).
    // Saved checkmark is visible briefly after success.
    expect(result.current.state).toBe('saved');
    expect(result.current.showSpinner).toBe(false);
    expect(result.current.showCheckmark).toBe(true);

    // After the 300ms checkmark dwell, returns to idle.
    await flush(300);
    expect(result.current.state).toBe('idle');
    expect(result.current.showCheckmark).toBe(false);
    expect(save).toHaveBeenCalledWith('hello');
  });

  test('successful save longer than 150ms: spinner appears mid-flight', async () => {
    const { result } = renderHook(() => useCellSaveState());

    let resolveSave: (() => void) | undefined;
    const save = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = result.current.commit('payload', save);
    });

    // Cross the 150ms spinner threshold.
    await flush(160);
    expect(result.current.state).toBe('saving');
    expect(result.current.showSpinner).toBe(true);

    // Resolve the save and observe success state.
    await act(async () => {
      resolveSave!();
      await commitPromise;
    });
    expect(result.current.state).toBe('saved');
    expect(result.current.showSpinner).toBe(false);
    expect(result.current.showCheckmark).toBe(true);
  });
});

describe('useCellSaveState — failure path', () => {
  test('rejected save lands on error with rejection message', async () => {
    const { result } = renderHook(() => useCellSaveState());
    const save = jest.fn().mockRejectedValue(new Error('Permission denied'));

    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = result.current.commit('payload', save);
    });

    await act(async () => {
      await commitPromise;
    });

    expect(result.current.state).toBe('error');
    expect(result.current.errorMessage).toBe('Permission denied');
    expect(result.current.showSpinner).toBe(false);
    expect(result.current.showCheckmark).toBe(false);
  });
});

describe('useCellSaveState — validation gate', () => {
  test('setValidationError lands on invalid + clears spinner/check', () => {
    const { result } = renderHook(() => useCellSaveState());

    act(() => {
      result.current.setValidationError('Bad time format');
    });

    expect(result.current.state).toBe('invalid');
    expect(result.current.errorMessage).toBe('Bad time format');
    expect(result.current.showSpinner).toBe(false);
    expect(result.current.showCheckmark).toBe(false);
  });

  test('setValidationError(null) clears the invalid state', () => {
    const { result } = renderHook(() => useCellSaveState());
    act(() => result.current.setValidationError('Bad'));
    expect(result.current.state).toBe('invalid');
    act(() => result.current.setValidationError(null));
    expect(result.current.state).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
  });
});

describe('useCellSaveState — reset', () => {
  test('reset returns to idle from saved', async () => {
    const { result } = renderHook(() => useCellSaveState());
    const save = jest.fn().mockResolvedValue(undefined);

    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = result.current.commit('x', save);
    });
    await act(async () => {
      await commitPromise;
    });
    expect(result.current.state).toBe('saved');

    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.showCheckmark).toBe(false);
  });

  test('reset returns to idle from error', async () => {
    const { result } = renderHook(() => useCellSaveState());
    const save = jest.fn().mockRejectedValue(new Error('boom'));

    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = result.current.commit('x', save);
    });
    await act(async () => {
      await commitPromise;
    });
    expect(result.current.state).toBe('error');

    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
  });
});

describe('useCellSaveState — re-entrancy', () => {
  test('second commit while first in flight queues behind it', async () => {
    // Real timers for this one — the re-entrancy gate is purely
    // promise-sequencing, no setTimeout involved on the hook's own
    // path. Using fake timers here would just stall the chained
    // microtasks in the save() promises.
    jest.useRealTimers();

    const { result } = renderHook(() => useCellSaveState());
    const order: string[] = [];

    const save = jest.fn().mockImplementation(async (v: unknown) => {
      order.push(`start:${v}`);
      // Yield once so the first commit's promise hasn't fully
      // settled when the second commit() lands. Any microtask works.
      await Promise.resolve();
      order.push(`end:${v}`);
    });

    let p1: Promise<void> | undefined;
    let p2: Promise<void> | undefined;
    await act(async () => {
      p1 = result.current.commit('first', save);
      p2 = result.current.commit('second', save);
      await Promise.all([p1, p2]);
    });

    // Sequencing: second save must not start until first completes.
    expect(order).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ]);
  });
});
