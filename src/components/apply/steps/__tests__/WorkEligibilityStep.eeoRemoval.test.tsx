/**
 * W.3 — `WorkEligibilityStep` EEO removal lock.
 *
 * Greg's 2026-04-29 decision: HRX is no longer collecting EEO data
 * (gender / veteranStatus / disabilityStatus) at all. This test ensures
 * the form no longer renders those selectors — neither the grouping
 * heading nor the individual inputs. A revival would have to happen
 * deliberately (and would require changing this test), not by accident.
 *
 * The work-authorization + sponsorship checkboxes MUST still render —
 * those are the values the (rollback path) editor is for.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import WorkEligibilityStep from '../WorkEligibilityStep';

describe('WorkEligibilityStep — W.3 EEO removal', () => {
  it('renders the work-auth + sponsorship checkboxes only (no EEO inputs)', () => {
    const onChange = jest.fn();
    render(<WorkEligibilityStep value={{}} onChange={onChange} />);

    // Authorization + sponsorship checkboxes are the only acceptable
    // inputs. Both have aria-labels driven by translation keys; the
    // i18n shim renders the key text when no translation is wired,
    // which is the case in tests.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    // EEO selectors used to render `<TextField select label="...">`
    // (rendered as combobox role). After W.3 there should be none.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /skip/i })).toHaveLength(0);
  });

  it('does not crash when the legacy `onSkipOptionalEeo` prop is still passed (back-compat)', () => {
    // Wizard.tsx still passes `onSkipOptionalEeo` for the moment. The
    // prop is now a no-op (the EEO grid + skip button are gone), but
    // accepting the prop without crashing is the contract that lets
    // W.3 ship without touching every Wizard call site.
    const onChange = jest.fn();
    const onSkip = jest.fn();
    render(
      <WorkEligibilityStep value={{ workAuthorized: true }} onChange={onChange} onSkipOptionalEeo={onSkip} />,
    );
    expect(onSkip).not.toHaveBeenCalled();
  });
});
