jest.mock('firebase-admin', () => {
  const firestore = () => ({ collection: jest.fn(), doc: jest.fn(), collectionGroup: jest.fn() });
  (firestore as any).FieldValue = { serverTimestamp: () => 'ts', increment: (n: number) => n };
  return { apps: [{}], initializeApp: jest.fn(), firestore };
});
jest.mock('firebase-functions/v2', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ name, value: () => '' }) }));

import { composeFlexTeamAsk, isFlexLinkedAssignment } from '../../messaging/slackAsNatalie';

describe('isFlexLinkedAssignment', () => {
  it('detects portal-sourced, id-stamped, and time.indeed.com assignments', () => {
    expect(isFlexLinkedAssignment({ assignmentSource: 'indeed_flex_portal' })).toBe(true);
    expect(isFlexLinkedAssignment({ flexJobId: '545107' })).toBe(true);
    expect(isFlexLinkedAssignment({ refs: { flexJobId: '545107' } })).toBe(true);
    expect(isFlexLinkedAssignment({ shift: { clockInUrl: 'https://time.indeed.com/abc' } })).toBe(true);
  });
  it('ignores ordinary HRX assignments', () => {
    expect(isFlexLinkedAssignment({ source: 'recruiter', jobTitle: 'Loader' })).toBe(false);
    expect(isFlexLinkedAssignment(null)).toBe(false);
  });
});

describe('composeFlexTeamAsk', () => {
  const base = { workerLabel: 'Maria G.', jobTitle: 'Loader / Crew', venue: 'CORT San Francisco Warehouse', whenLabel: 'Sat, Sep 12, 8:00 AM' };

  it('asks about a replacement for a cancellation', () => {
    const t = composeFlexTeamAsk({ ...base, kind: 'cancelled', priorNoShows: 0 });
    expect(t).toContain("Maria G. just let us know they can't make their shift (Loader / Crew) at CORT San Francisco Warehouse, Sat, Sep 12, 8:00 AM.");
    expect(t).toContain('Would you like us to send a replacement today?');
    expect(t).not.toContain('permanent replacement');
  });

  it('describes a no-show and escalates on repeats', () => {
    const one = composeFlexTeamAsk({ ...base, kind: 'no_show', priorNoShows: 1 });
    expect(one).toContain("hasn't checked in");
    expect(one).toContain('second no-show');
    const many = composeFlexTeamAsk({ ...base, kind: 'no_show', priorNoShows: 2, detail: 'no check-in 30 minutes after start' });
    expect(many).toContain('3rd no-call/no-show');
    expect(many).toContain('permanent replacement');
    expect(many).toContain('(no check-in 30 minutes after start)');
  });

  it('degrades gracefully without venue or title', () => {
    const t = composeFlexTeamAsk({ kind: 'cancelled', workerLabel: 'the worker', jobTitle: '', venue: '', whenLabel: 'today', priorNoShows: 0 });
    expect(t.startsWith("Hi team — the worker just let us know they can't make their shift, today.")).toBe(true);
  });
});
