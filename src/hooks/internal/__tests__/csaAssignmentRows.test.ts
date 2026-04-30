/**
 * RD.1 — pure-function tests for the assignment row normalizer + filters.
 *
 * The shapes coming out of the `assignments` collection are mid-migration
 * (string ISO vs Timestamp vs raw millis), and the section hooks rely on
 * this layer to flatten them. These tests pin the variance handling so a
 * future migration step can't silently break either CSA section.
 */
import {
  coerceToMs,
  filterAssignmentsByDateWindow,
  filterAssignmentsByWorkerSet,
  normalizeAssignmentRow,
  type CsaAssignmentRow,
} from '../csaAssignmentRows';

const ISO = '2026-04-29T17:00:00.000Z';
const ISO_MS = Date.parse(ISO);

function row(over: Partial<CsaAssignmentRow> = {}): CsaAssignmentRow {
  return {
    id: 'a1',
    workerUid: 'w1',
    status: 'confirmed',
    startMs: ISO_MS,
    endMs: null,
    firstName: 'Ann',
    lastName: 'Smith',
    email: '',
    phone: '',
    companyName: 'Acme',
    companyId: 'acme',
    jobTitle: '',
    shiftTitle: '',
    worksiteName: '',
    severity: 'normal',
    ...over,
  };
}

describe('coerceToMs', () => {
  it('passes through finite numbers', () => {
    expect(coerceToMs(1714410000000)).toBe(1714410000000);
  });

  it('parses ISO 8601 strings', () => {
    expect(coerceToMs(ISO)).toBe(ISO_MS);
  });

  it('handles Firestore Timestamp duck type via toDate()', () => {
    const stamp = { toDate: () => new Date(ISO) };
    expect(coerceToMs(stamp)).toBe(ISO_MS);
  });

  it('handles serialized timestamp `{seconds, nanoseconds}` shape', () => {
    const seconds = Math.floor(ISO_MS / 1000);
    const nanos = (ISO_MS % 1000) * 1e6;
    expect(coerceToMs({ seconds, nanoseconds: nanos })).toBe(ISO_MS);
  });

  it('handles JS Date instances', () => {
    expect(coerceToMs(new Date(ISO))).toBe(ISO_MS);
  });

  it('returns null for null / undefined / empty / garbage', () => {
    expect(coerceToMs(null)).toBeNull();
    expect(coerceToMs(undefined)).toBeNull();
    expect(coerceToMs('')).toBeNull();
    expect(coerceToMs('   ')).toBeNull();
    expect(coerceToMs('not a date')).toBeNull();
    // NaN should not pass through as a "valid" number.
    expect(coerceToMs(NaN)).toBeNull();
  });

  it('returns null when toDate() throws (defensive against bad fixtures)', () => {
    const stamp = {
      toDate() {
        throw new Error('boom');
      },
    };
    expect(coerceToMs(stamp)).toBeNull();
  });
});

describe('normalizeAssignmentRow', () => {
  it('coalesces userId then candidateId for legacy rows', () => {
    expect(normalizeAssignmentRow('a', { userId: 'u1' })?.workerUid).toBe('u1');
    expect(normalizeAssignmentRow('a', { candidateId: 'c1' })?.workerUid).toBe('c1');
    // userId wins when both present — matches every other surface that
    // reads from this collection.
    expect(
      normalizeAssignmentRow('a', { userId: 'u1', candidateId: 'c1' })?.workerUid,
    ).toBe('u1');
  });

  it('returns null when neither uid field is present (row is unrenderable)', () => {
    expect(normalizeAssignmentRow('a', { firstName: 'Dangling' })).toBeNull();
  });

  it('falls back through the start-time field aliases (startDate / startTime / startTimestamp)', () => {
    expect(normalizeAssignmentRow('a', { userId: 'u1', startDate: ISO })?.startMs).toBe(
      ISO_MS,
    );
    expect(normalizeAssignmentRow('a', { userId: 'u1', startTime: ISO })?.startMs).toBe(
      ISO_MS,
    );
    expect(
      normalizeAssignmentRow('a', { userId: 'u1', startTimestamp: ISO })?.startMs,
    ).toBe(ISO_MS);
  });

  it('falls back through the end-time field aliases (endDate / endTime / endTimestamp)', () => {
    expect(normalizeAssignmentRow('a', { userId: 'u1', endDate: ISO })?.endMs).toBe(
      ISO_MS,
    );
  });

  it('hardens worksite name fallback: locationNickname > worksiteName', () => {
    expect(
      normalizeAssignmentRow('a', {
        userId: 'u1',
        locationNickname: 'Bay 12',
        worksiteName: 'Plant West',
      })?.worksiteName,
    ).toBe('Bay 12');
    expect(
      normalizeAssignmentRow('a', { userId: 'u1', worksiteName: 'Plant West' })
        ?.worksiteName,
    ).toBe('Plant West');
  });

  it('always tags severity as `normal` in v1', () => {
    expect(normalizeAssignmentRow('a', { userId: 'u1' })?.severity).toBe('normal');
  });
});

describe('filterAssignmentsByDateWindow', () => {
  const t0 = 1_000_000;
  const day = 24 * 60 * 60 * 1000;

  it('startsBetween: keeps rows whose start falls in [from, to)', () => {
    const rows = [
      row({ id: 'before', startMs: t0 - 1 }),
      row({ id: 'in', startMs: t0 + day }),
      row({ id: 'edge-from', startMs: t0 }),
      row({ id: 'edge-to', startMs: t0 + 2 * day }), // exclusive upper bound
      row({ id: 'after', startMs: t0 + 3 * day }),
    ];
    const result = filterAssignmentsByDateWindow(rows, {
      kind: 'startsBetween',
      fromMs: t0,
      toMs: t0 + 2 * day,
    });
    expect(result.map((r) => r.id).sort()).toEqual(['edge-from', 'in']);
  });

  it('endsBetween: keeps rows whose end falls in [from, to)', () => {
    const rows = [
      row({ id: 'no-end', endMs: null }),
      row({ id: 'in', endMs: t0 + day }),
      row({ id: 'after', endMs: t0 + 3 * day }),
    ];
    const result = filterAssignmentsByDateWindow(rows, {
      kind: 'endsBetween',
      fromMs: t0,
      toMs: t0 + 2 * day,
    });
    expect(result.map((r) => r.id)).toEqual(['in']);
  });

  it('drops rows with a null relevant timestamp (rather than treating null as 0)', () => {
    // Important: a row with null startMs in a startsBetween window starting
    // at t0=0 would otherwise sneak through if we evaluated `null >= 0`.
    const rows = [row({ id: 'orphan', startMs: null })];
    const result = filterAssignmentsByDateWindow(rows, {
      kind: 'startsBetween',
      fromMs: 0,
      toMs: Number.MAX_SAFE_INTEGER,
    });
    expect(result).toHaveLength(0);
  });
});

describe('filterAssignmentsByWorkerSet', () => {
  const rows = [row({ id: 'a', workerUid: 'u1' }), row({ id: 'b', workerUid: 'u2' })];

  it('returns a copy of all rows when myWorkerUids is null (All Users scope)', () => {
    const out = filterAssignmentsByWorkerSet(rows, null);
    expect(out).toHaveLength(2);
    // New array, not the same reference — protects against accidental
    // mutation by downstream callers.
    expect(out).not.toBe(rows);
  });

  it('returns empty when myWorkerUids is the empty set (My Users scope, no workers)', () => {
    expect(filterAssignmentsByWorkerSet(rows, new Set())).toEqual([]);
  });

  it('intersects on workerUid', () => {
    const out = filterAssignmentsByWorkerSet(rows, new Set(['u2']));
    expect(out.map((r) => r.id)).toEqual(['b']);
  });
});
