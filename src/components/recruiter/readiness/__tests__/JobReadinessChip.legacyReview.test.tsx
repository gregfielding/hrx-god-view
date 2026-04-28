/**
 * **R.4.3** — UI smoke test for the `legacy_review` chip variant.
 *
 * Per L.4.3.5 in `docs/CLEANUP_R4_R16.2D_HANDOFF.md`, the helper unit
 * tests cover the classifier branch (5 cases) — this file locks the UI
 * surface (1 case): the chip renders with the legacy label, gray
 * `default` MUI color, and a history icon (NOT the `'computing'`
 * spinner). Hovering surfaces the legacy popover copy from
 * `JobReadinessChipPopover`.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import JobReadinessChip from '../JobReadinessChip';
import type { JobReadinessChipData } from '../../../../shared/jobReadinessChip/types';

const LEGACY_DATA: JobReadinessChipData = {
  state: 'legacy_review',
  text: 'Legacy \u2014 needs review',
  pendingCount: 0,
  blockerCount: 0,
  contributors: [],
};

describe('JobReadinessChip — legacy_review variant (R.4.3)', () => {
  test('renders the legacy label, gray default MUI color, history icon (not a spinner), and popover copy on hover', () => {
    const { container } = render(<JobReadinessChip data={LEGACY_DATA} />);

    // Label — the chip surface uses the en-dash form per the helper's
    // `buildText('legacy_review', ...)`. Use a forgiving regex so this
    // doesn't break if MUI splits the label across nodes.
    expect(screen.getByText(/Legacy.*needs review/i)).toBeInTheDocument();

    // ARIA — the chip wrapper exposes the label for screen readers.
    const wrapper = screen.getByRole('button', { name: /Legacy.*needs review/i });
    expect(wrapper).toBeInTheDocument();

    // Color — MUI applies `MuiChip-colorDefault` for the gray variant.
    // We assert against the rendered chip (not the wrapper Box) by
    // querying for the descendant element carrying the chip class.
    const chip = container.querySelector('.MuiChip-root');
    expect(chip).not.toBeNull();
    expect(chip!.className).toMatch(/MuiChip-colorDefault/);

    // Icon — `'legacy_review'` shows a history icon (the `data-testid`
    // attribute MUI sets on icon SVGs is `<IconName>Icon`).
    expect(container.querySelector('[data-testid="HistoryIcon"]')).not.toBeNull();
    // NOT a spinner — `'computing'` would render a CircularProgress.
    expect(container.querySelector('.MuiCircularProgress-root')).toBeNull();

    // Popover copy — open via mouse-enter (matches the chip's
    // `onMouseEnter` / `onFocus` pattern).
    fireEvent.mouseEnter(wrapper);
    expect(
      screen.getByText(/predates the readiness rebuild/i),
    ).toBeInTheDocument();
  });
});
