import { eventsSetupDone, eventsSetupSteps, shiftStarted } from '../../natalie/eventsApplicantSetup';

const status = (steps: ReturnType<typeof eventsSetupSteps>) => Object.fromEntries(steps.map((x) => [x.key, `${x.status}/${x.actor}`]));
const photo = { avatar: 'https://x/a.jpg' };

describe('eventsSetupSteps — C1 Events checklist: photo · direct deposit · W-9 (no I-9 / W-4)', () => {
  it('a hire who has done nothing owes all three on the worker side', () => {
    const steps = eventsSetupSteps({ user: {}, employments: [{ status: 'onboarding', entityId: 'c1_events_llc' }], link: { status: 'created' } });
    expect(status(steps)).toEqual({ profile_photo: 'missing/worker', payroll_setup: 'in_progress/worker', tax_form: 'missing/worker' });
    expect(eventsSetupDone(steps)).toBe(false);
  });

  it('no hire yet makes payroll a recruiter item', () => {
    expect(status(eventsSetupSteps({ user: photo, employments: [], link: null })).payroll_setup).toBe('missing/recruiter');
  });

  it('finished payroll marks direct deposit and the W-9 done even without mirror stamps', () => {
    const steps = eventsSetupSteps({ user: photo, employments: [{ status: 'onboarding' }], link: { status: 'onboarding_complete', readinessMirror: { w9SignedAt: null } } });
    expect(eventsSetupDone(steps)).toBe(true);
  });

  it('mid-setup steps follow the readiness mirror', () => {
    const steps = eventsSetupSteps({ user: photo, employments: [{ status: 'onboarding' }], link: { status: 'created', readinessMirror: { directDepositReady: true } } });
    expect(status(steps)).toEqual({ profile_photo: 'complete/worker', payroll_setup: 'complete/worker', tax_form: 'missing/worker' });
  });

  it('a not-a-headshot rejection on the current photo leaves the photo step open', () => {
    const user = { avatar: 'https://x/a.jpg', avatarVerification: { status: 'rejected', rejectionReason: 'multiple_faces', sourceAvatarUrl: 'https://x/a.jpg' } };
    expect(status(eventsSetupSteps({ user, employments: [], link: { status: 'onboarding_complete' } })).profile_photo).toBe('missing/worker');
  });
});

describe('shiftStarted (local time at the worksite)', () => {
  const now = new Date('2026-09-14T22:00:00Z'); // 5:00 PM in Kansas City
  it('before the start time on the day', () => expect(shiftStarted('2026-09-14', '23:30', 'America/Chicago', now)).toBe(false));
  it('after the start time', () => expect(shiftStarted('2026-09-14', '16:00', 'America/Chicago', now)).toBe(true));
  it('a later day has not started; an earlier day has', () => {
    expect(shiftStarted('2026-09-15', '08:00', 'America/Chicago', now)).toBe(false);
    expect(shiftStarted('2026-09-13', '23:30', 'America/Chicago', now)).toBe(true);
  });
  it('no usable date never counts as started', () => expect(shiftStarted('', '08:00', 'America/Chicago', now)).toBe(false));
});
