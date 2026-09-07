jest.mock('firebase-admin', () => {
  const firestore = () => ({ collection: jest.fn(), doc: jest.fn(), collectionGroup: jest.fn() });
  (firestore as any).FieldValue = { serverTimestamp: () => 'ts', arrayUnion: (...a: unknown[]) => a, increment: (n: number) => n };
  (firestore as any).Timestamp = { fromMillis: (n: number) => ({ n, toMillis: () => n }), fromDate: (d: Date) => ({ d }), now: () => ({ n: Date.now() }) };
  return { apps: [{}], initializeApp: jest.fn(), firestore };
});
jest.mock('firebase-functions/v2', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));
jest.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ name, value: () => '' }) }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {} }));

import { scoreReliability } from '../../natalie/natalieTools';
import { summarizePortalOutcome } from '../../natalie/natalieOutbox';
import { renderBriefFallback, type BriefFacts } from '../../natalie/natalieBrief';
import { slackPermalink } from '../../natalie/natalieAudit';

describe('scoreReliability', () => {
  const base = { userId: 'u', name: 'A', tier: 2, completed: 0, noShows: 0, cancels: 0, upcoming: 0, lastWorked: null, matchedQuery: 0 };
  it('rewards completed shifts and punishes no-shows hardest', () => {
    const solid = scoreReliability({ ...base, completed: 12 });
    const flaky = scoreReliability({ ...base, completed: 12, noShows: 2 });
    const canceler = scoreReliability({ ...base, completed: 12, cancels: 2 });
    expect(solid.score).toBeGreaterThan(canceler.score);
    expect(canceler.score).toBeGreaterThan(flaky.score);
    expect(solid.reasons).toContain('12 completed shifts in 90 days');
    expect(solid.reasons).toContain('no no-shows');
    expect(flaky.reasons).toContain('2 no-shows');
  });
  it('accounts for tier and prior work at the site', () => {
    expect(scoreReliability({ ...base, completed: 3, tier: 1 }).reasons).toContain('Tier 1');
    expect(scoreReliability({ ...base, completed: 3, tier: 3 }).score).toBeLessThan(scoreReliability({ ...base, completed: 3, tier: 2 }).score);
    expect(scoreReliability({ ...base, completed: 3, matchedQuery: 4 }).reasons).toContain('worked there 4×');
  });
});

describe('summarizePortalOutcome', () => {
  it('describes accept, sync, and failure outcomes in plain words', () => {
    expect(summarizePortalOutcome({ status: 'succeeded', action: 'accept_job_request', result: { jobId: '545107', verified: true } })).toContain('Accepted Flex request 545107');
    expect(summarizePortalOutcome({ status: 'succeeded', action: 'accept_job_request', result: { jobId: '545107', alreadyAccepted: true } })).toContain('already accepted');
    expect(summarizePortalOutcome({ status: 'succeeded', action: 'fieldglass_sync', result: { postingsVisited: 94, ingested: 2, closed: 1 } })).toBe('Fieldglass sync done: 94 postings checked, 2 updated, 1 closed.');
    expect(summarizePortalOutcome({ status: 'needs_human', action: 'indeed_flex_sync', lastError: { message: 'session expired' } })).toContain('needs a person: session expired');
  });
});

describe('renderBriefFallback', () => {
  it('renders counts without the model', () => {
    const facts: BriefFacts = {
      dateLabel: 'Monday, Sep 8', isMonday: true, unacceptedFlexRequests: [{}, {}], fieldglassLast24h: { passes: 3, updated: 2, closed: 1, created: 0, failures: 0, lastAt: null },
      todayShifts: { total: 40, unconfirmed: [{}], flexLinked: 12 }, yesterdayLateNoAnswer: [{}], yesterdayNoShows: 1, portal: {},
    };
    const t = renderBriefFallback(facts);
    expect(t).toContain('*Morning brief — Monday, Sep 8*');
    expect(t).toContain('waiting on an accept: 2');
    expect(t).toContain('40 shifts, 1 unconfirmed');
  });
});

describe('slackPermalink', () => {
  it('builds the archive link from channel + ts', () => {
    expect(slackPermalink({ channel: 'C08U7U0FL03', ts: '1788807513.522579' })).toBe('https://c1staffing.slack.com/archives/C08U7U0FL03/p1788807513522579');
    expect(slackPermalink({ channel: 'C1' })).toBeNull();
  });
});
