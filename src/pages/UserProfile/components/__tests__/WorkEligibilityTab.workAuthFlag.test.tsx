/**
 * W.3 — `WorkEligibilityTab` collection-disabled rendering smoke test.
 *
 * Locks the user-visible behavior: when the flag is on (default) the
 * tab renders the explanatory Alert and never invokes `onUpdate`; when
 * the flag is off (rollback) the tab renders the editor again. The
 * persist-path EEO preservation is covered indirectly — when the editor
 * doesn't render, no save fires, so EEO can't be clobbered.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import WorkEligibilityTab from '../WorkEligibilityTab';

const FLAG_ENV = 'REACT_APP_WORK_AUTH_COLLECTION_DISABLED';

describe('WorkEligibilityTab — W.3 collection flag', () => {
  const ORIGINAL_ENV = process.env[FLAG_ENV];

  // The flag util reads `process.env` at call time (not at module load),
  // so we can flip the env between cases without `jest.resetModules`.
  // Resetting modules would force React to load twice and explode with
  // "Cannot read properties of null (reading 'useMemo')" — exactly the
  // pitfall this comment is here to call out for the next reader.
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[FLAG_ENV];
    } else {
      process.env[FLAG_ENV] = ORIGINAL_ENV;
    }
  });

  it('renders the explanatory Alert when collection is disabled (default)', () => {
    process.env[FLAG_ENV] = 'true';
    const onUpdate = jest.fn();

    render(<WorkEligibilityTab user={{ workEligibility: false }} onUpdate={onUpdate} />);

    // Match a fragment of the spec-mandated copy so cosmetic word
    // tweaks don't crash the test, but a behavior change (e.g. losing
    // the message entirely) does.
    expect(
      screen.getByText(/work authorization is collected during payroll onboarding/i),
    ).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('renders the editor when collection is enabled (rollback path)', () => {
    process.env[FLAG_ENV] = 'false';
    const onUpdate = jest.fn();

    render(<WorkEligibilityTab user={{ workEligibility: true }} onUpdate={onUpdate} />);

    // Editor path: the explanatory Alert from the disabled branch must
    // be absent. We deliberately don't assert the editor's translated
    // labels (`profile.authorizedToWork` etc.) because the i18n layer
    // would couple this test to translation strings unrelated to W.3.
    expect(
      screen.queryByText(/work authorization is collected during payroll onboarding/i),
    ).not.toBeInTheDocument();
  });
});
