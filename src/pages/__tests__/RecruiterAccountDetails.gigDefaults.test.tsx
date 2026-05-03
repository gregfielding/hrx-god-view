/**
 * **CC.B F.4** — Default gig title/description surfaced on the National
 * Account header (`RecruiterAccountDetails`). The page gates rendering;
 * this file exercises `DefaultGigSettings` in isolation (same props the
 * page passes) so we don't mount the full account shell + router.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import DefaultGigSettings from '../../components/recruiter/DefaultGigSettings';

describe('RecruiterAccountDetails — default gig settings (F.4 UI)', () => {
  it('renders title + description fields and helper copy', () => {
    const onSaveTitle = jest.fn();
    const onSaveDescription = jest.fn();
    render(
      <DefaultGigSettings
        title=""
        description=""
        saving={false}
        onSaveTitle={onSaveTitle}
        onSaveDescription={onSaveDescription}
      />,
    );
    expect(screen.getByTestId('default-gig-settings')).toBeInTheDocument();
    expect(screen.getByText(/Default Gig Job Title/i)).toBeInTheDocument();
    expect(screen.getByText(/Default Gig Job Description/i)).toBeInTheDocument();
    expect(
      screen.getByText(/These defaults apply to gig job orders auto-created/i),
    ).toBeInTheDocument();
  });

  it('shows catalog advisory when title is not in the ONET list', () => {
    render(
      <DefaultGigSettings
        title="___NOT_A_REAL_ONET_TITLE_XYZ123___"
        description=""
        saving={false}
        onSaveTitle={jest.fn()}
        onSaveDescription={jest.fn()}
      />,
    );
    expect(screen.getByTestId('default-gig-title-not-in-catalog')).toBeInTheDocument();
  });

  it('does not show catalog advisory for Warehouse Associate (in catalog)', () => {
    render(
      <DefaultGigSettings
        title="Warehouse Associate"
        description=""
        saving={false}
        onSaveTitle={jest.fn()}
        onSaveDescription={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('default-gig-title-not-in-catalog')).not.toBeInTheDocument();
  });

  it('calls onSaveDescription when description blurs with a changed value', () => {
    const onSaveDescription = jest.fn();
    render(
      <DefaultGigSettings
        title=""
        description="old"
        saving={false}
        onSaveTitle={jest.fn()}
        onSaveDescription={onSaveDescription}
      />,
    );
    const desc = screen.getByLabelText(/Default gig job description/i);
    fireEvent.change(desc, { target: { value: 'new desc text' } });
    fireEvent.blur(desc);
    expect(onSaveDescription).toHaveBeenCalledWith('new desc text');
  });

  it('disables inputs while saving', () => {
    render(
      <DefaultGigSettings
        title=""
        description=""
        saving={true}
        onSaveTitle={jest.fn()}
        onSaveDescription={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/Default gig job description/i)).toBeDisabled();
    expect(screen.getByLabelText(/Default gig job title/i)).toBeDisabled();
  });
});
