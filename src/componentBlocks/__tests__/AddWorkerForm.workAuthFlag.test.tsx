/**
 * W.3 — `AddWorkerForm` work-eligibility checkbox visibility.
 *
 * Locks: with the flag on the "Work Eligibility" checkbox + helper text
 * are absent; with the flag off the checkbox renders so HRX staff can
 * still set it manually if they need to.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import AddWorkerForm from '../AddWorkerForm';

const FLAG_ENV = 'REACT_APP_WORK_AUTH_COLLECTION_DISABLED';

function makeProps(overrides: Partial<React.ComponentProps<typeof AddWorkerForm>> = {}) {
  return {
    form: {},
    onChange: jest.fn(),
    onPhoneChange: jest.fn(),
    onSubmit: jest.fn(),
    loading: false,
    departments: [],
    locations: [],
    showForm: true,
    setShowForm: jest.fn(),
    isFormValid: false,
    jobTitles: [],
    contextType: 'agency' as const,
    ...overrides,
  };
}

describe('AddWorkerForm — W.3 work-eligibility checkbox', () => {
  const ORIGINAL_ENV = process.env[FLAG_ENV];
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[FLAG_ENV];
    } else {
      process.env[FLAG_ENV] = ORIGINAL_ENV;
    }
  });

  it('hides the Work Eligibility checkbox when collection is disabled (default)', () => {
    process.env[FLAG_ENV] = 'true';

    render(<AddWorkerForm {...makeProps()} />);

    expect(screen.queryByLabelText(/work eligibility/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/eligibility for employment in the region/i),
    ).not.toBeInTheDocument();
  });

  it('renders the Work Eligibility checkbox when collection is enabled (rollback)', () => {
    process.env[FLAG_ENV] = 'false';

    render(<AddWorkerForm {...makeProps()} />);

    expect(screen.getByLabelText(/work eligibility/i)).toBeInTheDocument();
    expect(
      screen.getByText(/eligibility for employment in the region/i),
    ).toBeInTheDocument();
  });
});
