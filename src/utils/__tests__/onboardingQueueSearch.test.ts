import { rowMatchesOnboardingWorkerSearch } from '../onboardingQueueSearch';

describe('rowMatchesOnboardingWorkerSearch', () => {
  const row = {
    workerDisplayName: 'Jane Marie Doe',
    workerEmail: 'Jane.Doe@Example.com',
    workerPhone: '(555) 123-4567',
  };

  it('matches empty query', () => {
    expect(rowMatchesOnboardingWorkerSearch('', row)).toBe(true);
    expect(rowMatchesOnboardingWorkerSearch('   ', row)).toBe(true);
  });

  it('matches full name and token order', () => {
    expect(rowMatchesOnboardingWorkerSearch('jane doe', row)).toBe(true);
    expect(rowMatchesOnboardingWorkerSearch('doe jane', row)).toBe(true);
    expect(rowMatchesOnboardingWorkerSearch('marie', row)).toBe(true);
  });

  it('matches email case-insensitively', () => {
    expect(rowMatchesOnboardingWorkerSearch('example.com', row)).toBe(true);
    expect(rowMatchesOnboardingWorkerSearch('jane.doe', row)).toBe(true);
  });

  it('matches phone digits', () => {
    expect(rowMatchesOnboardingWorkerSearch('5551234567', row)).toBe(true);
    expect(rowMatchesOnboardingWorkerSearch('123', row)).toBe(true);
  });

  it('returns false when no token matches', () => {
    expect(rowMatchesOnboardingWorkerSearch('zzz', row)).toBe(false);
    expect(rowMatchesOnboardingWorkerSearch('jane zzz', row)).toBe(false);
  });
});
