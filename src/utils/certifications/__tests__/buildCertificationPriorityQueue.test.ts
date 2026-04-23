import {
  buildCertificationPriorityQueue,
  computeCertificationPriorityBaseScore,
} from '../buildCertificationPriorityQueue';
import {
  approvedActiveRecord,
  EXPIRING_SOON_DATE_ISO,
  FAR_EXPIRATION_ISO,
  FIXTURE_TODAY_ISO,
  pendingReviewRecord,
  rejectedRecord,
  reqRequiredTemplate,
  expiredRecord,
} from '../certificationIntelligenceFixtures';
import type { Phase1CertificationRequirement } from '../../../types/certifications/certificationRequirement';

describe('buildCertificationPriorityQueue', () => {
  const catA = 'cat-a-missing';
  const catB = 'cat-b-expired';
  const catC = 'cat-c-reject';
  const catD = 'cat-d-pending';

  const req = (id: string, catalog: string): Phase1CertificationRequirement =>
    reqRequiredTemplate(catalog, id);

  it('E. empty workers → []', () => {
    expect(
      buildCertificationPriorityQueue({
        workers: [],
        recordsByUserId: {},
        requirements: [req('r1', catA)],
        context: 'assignment',
        todayISO: FIXTURE_TODAY_ISO,
      }),
    ).toEqual([]);
  });

  it('A. priority ordering by issue impact (required): missing > expired > rejected > pending_review', () => {
    const requirements = [req('r-a', catA), req('r-b', catB), req('r-c', catC), req('r-d', catD)];
    const workers = [{ id: 'solo' }];
    const recordsByUserId = {
      solo: [
        expiredRecord(catB, 'ridb'),
        rejectedRecord(catC, FAR_EXPIRATION_ISO, 'ridc'),
        pendingReviewRecord(catD, FAR_EXPIRATION_ISO, 'ridd'),
      ],
    };
    const q = buildCertificationPriorityQueue({
      workers,
      recordsByUserId,
      requirements,
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });

    expect(q).toHaveLength(4);
    const types = q.map((i) => i.issueType);
    expect(types[0]).toBe('missing');
    expect(types[1]).toBe('expired');
    expect(types[2]).toBe('rejected');
    expect(types[3]).toBe('pending_review');

    const miss = computeCertificationPriorityBaseScore('missing', requirements[0]);
    const exp = computeCertificationPriorityBaseScore('expired', requirements[1]);
    const rej = computeCertificationPriorityBaseScore('rejected', requirements[2]);
    const pend = computeCertificationPriorityBaseScore('pending_review', requirements[3]);
    expect(miss).toBeGreaterThan(exp);
    expect(exp).toBeGreaterThan(rej);
    expect(rej).toBeGreaterThan(pend);

    expect(q[0].priorityScore).toBeGreaterThanOrEqual(q[1].priorityScore);
    expect(q[1].priorityScore).toBeGreaterThanOrEqual(q[2].priorityScore);
    expect(q[2].priorityScore).toBeGreaterThanOrEqual(q[3].priorityScore);
  });

  it('B. stable tie-breaking — same score sorts by catalogEntryId then userId', () => {
    const rOnly = req('q1', 'tie-cat');
    const workers = [{ id: 'user-b' }, { id: 'user-a' }];
    const recordsByUserId = {
      'user-a': [],
      'user-b': [],
    };
    const q = buildCertificationPriorityQueue({
      workers,
      recordsByUserId,
      requirements: [rOnly],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(q).toHaveLength(2);
    expect(q[0].userId).toBe('user-a');
    expect(q[1].userId).toBe('user-b');
    const q2 = buildCertificationPriorityQueue({
      workers,
      recordsByUserId,
      requirements: [rOnly],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(q).toEqual(q2);
  });

  it('C. expiration proximity — not in base score; ordering still deterministic via ids', () => {
    const r = req('only', 'solo-cat');
    const q = buildCertificationPriorityQueue({
      workers: [{ id: 'e1' }, { id: 'e2' }],
      recordsByUserId: {
        e1: [approvedActiveRecord('solo-cat', EXPIRING_SOON_DATE_ISO, 'x')],
        e2: [approvedActiveRecord('solo-cat', FAR_EXPIRATION_ISO, 'y')],
      },
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(q).toEqual([]);
  });

  it('D. duplicate worker id in list — duplicate rows (deterministic sort)', () => {
    const r = req('dup', catA);
    const q = buildCertificationPriorityQueue({
      workers: [{ id: 'dup' }, { id: 'dup' }],
      recordsByUserId: { dup: [] },
      requirements: [r],
      context: 'assignment',
      todayISO: FIXTURE_TODAY_ISO,
    });
    expect(q).toHaveLength(2);
    expect(q[0]).toEqual(q[1]);
  });

  it('computeCertificationPriorityBaseScore matches queue scores for surfaced issues', () => {
    const requirement = req('x', catA);
    expect(computeCertificationPriorityBaseScore('missing', requirement)).toBe(
      buildCertificationPriorityQueue({
        workers: [{ id: 'u' }],
        recordsByUserId: { u: [] },
        requirements: [requirement],
        context: 'assignment',
        todayISO: FIXTURE_TODAY_ISO,
      })[0]?.priorityScore,
    );
  });
});
