import { formatClaimShiftError } from '../formatClaimShiftError';

jest.mock('../../../i18n', () => ({ t: (key: string) => key }));

const failed = (details: Record<string, unknown>) => ({
  code: 'functions/failed-precondition',
  message: 'Firebase: blocked (functions/failed-precondition).',
  details,
});

describe('formatClaimShiftError — payroll readiness (2026-09-11)', () => {
  it('setup_required started → setup-started copy and the Finish setup flag', () => {
    const f = formatClaimShiftError(failed({ code: 'setup_required', stage: 'started', entityId: 'c1_events_llc' }));
    expect(f?.message).toBe('jobs.claimErrorSetupStarted');
    expect(f?.setupRequired).toBe(true);
    expect(f?.shiftFilled).toBe(false);
  });

  it('setup_required in progress → finish-setup copy', () => {
    const f = formatClaimShiftError(failed({ code: 'setup_required', stage: 'in_progress' }));
    expect(f?.message).toBe('jobs.claimErrorSetupRequired');
    expect(f?.setupRequired).toBe(true);
  });

  it('ineligible not_hired → apply copy, no Finish setup', () => {
    const f = formatClaimShiftError(failed({ code: 'ineligible', reason: 'not_hired' }));
    expect(f?.message).toBe('jobs.claimErrorNotHired');
    expect(f?.setupRequired).toBe(false);
  });

  it('other codes keep their copy and never flag setup', () => {
    expect(formatClaimShiftError(failed({ code: 'ineligible', reason: 'dnr' }))?.message).toBe('jobs.claimErrorIneligible');
    const filled = formatClaimShiftError(failed({ code: 'shift_filled' }));
    expect(filled?.shiftFilled).toBe(true);
    expect(filled?.setupRequired).toBe(false);
  });

  it('non-claim errors return null', () => {
    expect(formatClaimShiftError(failed({ code: 'HEADSHOT_MISSING' }))).toBeNull();
    expect(formatClaimShiftError(new Error('boom'))).toBeNull();
  });
});
