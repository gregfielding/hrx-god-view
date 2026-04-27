/**
 * **R.8** — `BulkActionBar` UX smoke tests.
 *
 * Targets the D4.R8 locks:
 *   - Hidden when selectedCount = 0.
 *   - Selection summary + cap chip shown.
 *   - Waive / mark-failed require a note (commit button stays disabled).
 *   - Confirm allows empty note.
 *   - lastResult alert reflects per-row outcome counts.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import BulkActionBar, { type BulkActionResult } from '../BulkActionBar';

function makeProps(overrides: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  return {
    selectedCount: 3,
    selectionCap: 50,
    itemFanOutCount: 5,
    selectedRedCount: 1,
    selectedYellowCount: 2,
    inFlight: false,
    lastResult: null as BulkActionResult | null,
    onClearSelection: jest.fn(),
    onCommit: jest.fn(),
    ...overrides,
  };
}

describe('BulkActionBar', () => {
  test('renders nothing when no cells selected', () => {
    const { container } = render(<BulkActionBar {...makeProps({ selectedCount: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  test('shows selection summary with item fan-out count', () => {
    render(<BulkActionBar {...makeProps()} />);
    expect(screen.getByText('3 cells selected')).toBeInTheDocument();
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  test('shows cap chip when selectedCount === selectionCap', () => {
    render(<BulkActionBar {...makeProps({ selectedCount: 50, selectionCap: 50 })} />);
    expect(screen.getByText(/at cap/i)).toBeInTheDocument();
  });

  test('confirm dialog allows empty note (csa_confirm)', () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    render(<BulkActionBar {...makeProps({ onCommit })} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm all/i }));
    // The dialog's primary action button label is "Confirm 3"
    const submit = screen.getByRole('button', { name: /^confirm 3$/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onCommit).toHaveBeenCalledWith({ kind: 'csa_confirm', note: null });
  });

  test('waive dialog disables submit until note entered', () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    render(<BulkActionBar {...makeProps({ onCommit })} />);
    fireEvent.click(screen.getByRole('button', { name: /waive all/i }));
    const submit = screen.getByRole('button', { name: /^waive 3$/i });
    expect(submit).toBeDisabled();

    const note = screen.getByLabelText(/note/i);
    fireEvent.change(note, { target: { value: 'Worker exempt per SOW.' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onCommit).toHaveBeenCalledWith({
      kind: 'csa_waive',
      note: 'Worker exempt per SOW.',
    });
  });

  test('lastResult success surface shows ok + idempotent counts', () => {
    render(
      <BulkActionBar
        {...makeProps({
          lastResult: {
            total: 5,
            ok: 3,
            idempotentNoOp: 2,
            failed: 0,
            failedKeys: [],
          },
        })}
      />,
    );
    expect(screen.getByText(/3 confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/2 already in target state/i)).toBeInTheDocument();
  });

  test('lastResult mixed surface flags failed count + first error', () => {
    render(
      <BulkActionBar
        {...makeProps({
          lastResult: {
            total: 5,
            ok: 3,
            idempotentNoOp: 0,
            failed: 2,
            failedKeys: ['w1__e1', 'w2__e2'],
            firstError: 'permission-denied',
          },
        })}
      />,
    );
    expect(screen.getByText(/2 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/permission-denied/i)).toBeInTheDocument();
  });
});
