/**
 * Tests for the wire-shape builder used by `updateTimesheetEntryFields`.
 *
 * The Firestore call itself is integration territory (covered by the
 * P3.A spot-check after deploy); these tests pin down the
 * `affectedKeys`-compatible wire shape so the rule's `hasOnly([...])`
 * check never silently rejects an edit because we drifted on field
 * naming or shape.
 */

import { __test__ } from '../updateTimesheetEntryFields';

const { buildWirePatch } = __test__;

describe('buildWirePatch — wire shape contract', () => {
  test('always includes updatedAt + updatedBy', () => {
    const out = buildWirePatch({}, 'uid-123');
    expect(out.updatedBy).toBe('uid-123');
    expect(out.updatedAt).toBeDefined();
    // serverTimestamp returns a sentinel object — exact type is internal
    // to firebase/firestore so we just check it's truthy and not a primitive.
    expect(typeof out.updatedAt).toBe('object');
  });

  test('drops undefined fields entirely', () => {
    const out = buildWirePatch(
      {
        actualStartTime: '08:00',
        actualEndTime: undefined,
        breaks: undefined,
        tips: undefined,
        bonusAmount: undefined,
        notes: undefined,
      },
      'uid',
    );
    expect(Object.keys(out).sort()).toEqual(
      ['actualStartTime', 'updatedAt', 'updatedBy'].sort(),
    );
  });

  test('keeps null values (clearing actuals)', () => {
    const out = buildWirePatch(
      { actualStartTime: null, actualEndTime: null },
      'uid',
    );
    expect(out.actualStartTime).toBeNull();
    expect(out.actualEndTime).toBeNull();
  });

  test('keeps empty array (clearing breaks)', () => {
    const out = buildWirePatch({ breaks: [] }, 'uid');
    expect(out.breaks).toEqual([]);
  });

  test('keeps empty string (clearing notes)', () => {
    const out = buildWirePatch({ notes: '' }, 'uid');
    expect(out.notes).toBe('');
  });

  test('keeps zero (clearing tips/bonus)', () => {
    const out = buildWirePatch({ tips: 0, bonusAmount: 0 }, 'uid');
    expect(out.tips).toBe(0);
    expect(out.bonusAmount).toBe(0);
  });

  test('round-trips a fully populated patch', () => {
    const out = buildWirePatch(
      {
        actualStartTime: '08:00',
        actualEndTime: '17:00',
        breaks: [
          {
            startTime: '12:00',
            endTime: '12:30',
            durationMins: 30,
            paid: false,
          },
        ],
        tips: 12.5,
        bonusAmount: 25,
        notes: 'Worker came in 30m late',
      },
      'recruiter-uid',
    );

    expect(out.actualStartTime).toBe('08:00');
    expect(out.actualEndTime).toBe('17:00');
    expect(out.breaks).toEqual([
      { startTime: '12:00', endTime: '12:30', durationMins: 30, paid: false },
    ]);
    expect(out.tips).toBe(12.5);
    expect(out.bonusAmount).toBe(25);
    expect(out.notes).toBe('Worker came in 30m late');
    expect(out.updatedBy).toBe('recruiter-uid');
  });

  test('wire keys are exactly the rule allowlist (no drift)', () => {
    const out = buildWirePatch(
      {
        actualStartTime: '08:00',
        actualEndTime: '17:00',
        breaks: [],
        tips: 0,
        bonusAmount: 0,
        notes: '',
      },
      'uid',
    );
    expect(new Set(Object.keys(out))).toEqual(
      new Set([
        'actualStartTime',
        'actualEndTime',
        'breaks',
        'tips',
        'bonusAmount',
        'notes',
        'updatedAt',
        'updatedBy',
      ]),
    );
  });
});
