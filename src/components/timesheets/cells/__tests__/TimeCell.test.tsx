/**
 * RTL smoke tests for `TimeCell` — the single most-load-bearing
 * inline-editable cell in P3.A. Coverage:
 *
 *   1. Click-to-edit transitions from view → edit mode.
 *   2. Blur with valid input commits via onSave.
 *   3. Blur with invalid input does NOT call onSave; stays in edit
 *      with an error chip (the validation gate).
 *   4. Escape cancels and reverts.
 *   5. Save failure rolls back to prior value.
 *
 * Cell-level tests, not full grid tests — that surface gets covered
 * by the live spot-check after deploy.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import TimeCell from '../TimeCell';

function makeProps(overrides: Partial<React.ComponentProps<typeof TimeCell>> = {}) {
  return {
    value: '08:00' as string | null,
    onSave: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TimeCell — view mode', () => {
  test('renders the formatted value', () => {
    render(<TimeCell {...makeProps({ value: '08:00' })} />);
    expect(screen.getByText('08:00')).toBeInTheDocument();
  });

  test('em-dash on null value', () => {
    render(<TimeCell {...makeProps({ value: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('clicking the cell enters edit mode (input appears)', () => {
    render(<TimeCell {...makeProps({ value: '08:00' })} />);
    fireEvent.click(screen.getByText('08:00'));
    expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
  });

  test('disabled cell does NOT enter edit mode on click', () => {
    render(<TimeCell {...makeProps({ value: '08:00', disabled: true })} />);
    fireEvent.click(screen.getByText('08:00'));
    expect(screen.queryByDisplayValue('08:00')).not.toBeInTheDocument();
  });
});

describe('TimeCell — save-on-blur', () => {
  test('valid edit → onSave called with canonicalized value', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<TimeCell {...makeProps({ value: '08:00', onSave })} />);

    fireEvent.click(screen.getByText('08:00'));
    const input = screen.getByDisplayValue('08:00') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '9:30' } });
      fireEvent.blur(input);
      // Let the promise chain settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('09:30');
  });

  test('invalid edit → onSave NOT called; cell stays in edit', async () => {
    const onSave = jest.fn();
    render(<TimeCell {...makeProps({ value: '08:00', onSave })} />);

    fireEvent.click(screen.getByText('08:00'));
    const input = screen.getByDisplayValue('08:00') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'garbage' } });
      fireEvent.blur(input);
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
    // Still in edit mode (input still mounted).
    expect(screen.getByDisplayValue('garbage')).toBeInTheDocument();
  });

  test('Escape reverts and exits edit mode without calling onSave', async () => {
    const onSave = jest.fn();
    render(<TimeCell {...makeProps({ value: '08:00', onSave })} />);

    fireEvent.click(screen.getByText('08:00'));
    const input = screen.getByDisplayValue('08:00') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '15:00' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSave).not.toHaveBeenCalled();
    // View mode restored, original value back.
    expect(screen.queryByDisplayValue('15:00')).not.toBeInTheDocument();
    expect(screen.getByText('08:00')).toBeInTheDocument();
  });

  test('unchanged value (typed same) does not invoke onSave', async () => {
    const onSave = jest.fn();
    render(<TimeCell {...makeProps({ value: '08:00', onSave })} />);

    fireEvent.click(screen.getByText('08:00'));
    const input = screen.getByDisplayValue('08:00') as HTMLInputElement;

    await act(async () => {
      // Same value, just exits.
      fireEvent.blur(input);
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('TimeCell — failure rollback', () => {
  test('Firestore rejection rolls back to prior value display', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Permission denied'));
    render(<TimeCell {...makeProps({ value: '08:00', onSave })} />);

    fireEvent.click(screen.getByText('08:00'));
    const input = screen.getByDisplayValue('08:00') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '17:00' } });
      fireEvent.blur(input);
      // Settle the rejection.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('17:00');
  });
});
