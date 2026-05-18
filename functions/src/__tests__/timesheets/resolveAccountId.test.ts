/**
 * `resolveMissingDenormUpdates` — accountId resolver (TS.1.P4 Slice 5.5).
 *
 * Validates that the resolver pulls accountId from the JO chain in the
 * documented precedence order:
 *
 *   1. `JO.recruiterAccountId`  (canonical staffing-customer reference)
 *   2. `JO.accountId`            (legacy fallback)
 *   3. unresolvable when neither is set
 *
 * Pure resolver — no Firestore writes. Test feeds fake JO data through a
 * minimal Firestore stand-in (the Caches struct's `jo` Map pre-populated
 * with the desired payload).
 */

import { expect } from 'chai';

import {
  makeCaches,
  resolveMissingDenormUpdates,
  type Caches,
} from '../../timesheets/backfillAssignmentDenormFieldsCallable';

/** Fake fdb shim — `resolveAccountId` only uses it indirectly through
 *  `readJoDoc`, which short-circuits when the cache has the JO. */
const fakeFdb = {} as unknown as Parameters<typeof resolveMissingDenormUpdates>[0]['fdb'];

function withCachedJo(caches: Caches, jobOrderId: string, jo: Record<string, unknown> | null): Caches {
  // The readJoDoc helper stores `Promise<Record<string, unknown> | null>`
  // in the cache (so concurrent readers can dedup on the in-flight
  // request). Pre-resolving with Promise.resolve() satisfies that
  // exact shape for tests.
  caches.jo.set(jobOrderId, Promise.resolve(jo));
  return caches;
}

describe('resolveMissingDenormUpdates — accountId field (Slice 5.5)', () => {
  it('marks accountId already_set when the assignment has it directly', async () => {
    const caches = makeCaches();
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        accountId: 'acct-already-set',
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.outcomes.accountId).to.equal('already_set');
    expect(result.updates.accountId).to.equal(undefined);
  });

  it('stamps from JO.recruiterAccountId when assignment is missing accountId', async () => {
    const caches = withCachedJo(makeCaches(), 'jo-1', {
      recruiterAccountId: 'acct-from-recruiter',
      accountId: 'acct-legacy',
    });
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.outcomes.accountId).to.equal('stamped');
    expect(result.updates.accountId).to.equal('acct-from-recruiter');
  });

  it('falls back to JO.accountId when recruiterAccountId is absent', async () => {
    const caches = withCachedJo(makeCaches(), 'jo-1', { accountId: 'acct-legacy' });
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.outcomes.accountId).to.equal('stamped');
    expect(result.updates.accountId).to.equal('acct-legacy');
  });

  it('returns unresolvable when JO has neither field', async () => {
    const caches = withCachedJo(makeCaches(), 'jo-1', { someOtherField: 'whatever' });
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.outcomes.accountId).to.equal('unresolvable');
    expect(result.updates.accountId).to.equal(undefined);
  });

  it('returns unresolvable when JO does not exist', async () => {
    const caches = withCachedJo(makeCaches(), 'jo-1', null);
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.outcomes.accountId).to.equal('unresolvable');
  });

  it('prefers recruiterAccountId over accountId when both are present', async () => {
    const caches = withCachedJo(makeCaches(), 'jo-1', {
      recruiterAccountId: 'recr-canonical',
      accountId: 'legacy-fallback',
    });
    const result = await resolveMissingDenormUpdates({
      fdb: fakeFdb,
      tenantId: 't',
      assignmentId: 'a',
      assignmentData: {
        hiringEntityId: 'eid',
        worksiteState: 'CA',
        worksiteDisplayName: 'Foo',
        workerDisplayName: 'Bar',
        shiftBreakDefaultMinutes: 30,
        weeklySchedule: { mon: { enabled: true, startTime: '09:00', endTime: '17:00' } },
        jobOrderId: 'jo-1',
      },
      caches,
    });
    expect(result.updates.accountId).to.equal('recr-canonical');
  });
});
