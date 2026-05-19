/**
 * Slice 3 unit tests — top-level matcher dispatcher.
 *
 * Uses a hand-rolled mock `Reader` so tests don't need an emulator.
 * One test per event-type strategy in the dispatcher; the
 * worker-name matching has its own focused tests below.
 */

import { expect } from 'chai';

import { matchShiftRequest } from '../../../../integrations/indeedFlex/matcher/matchShiftRequest';
import {
  matchWorkerAssignments,
  normalizeName,
  tokenize,
} from '../../../../integrations/indeedFlex/matcher/matchWorkerAssignments';
import type {
  Reader,
  ReaderDoc,
} from '../../../../integrations/indeedFlex/matcher/types';

// ─────────────────────────────────────────────────────────────────────
// Mock reader helpers
// ─────────────────────────────────────────────────────────────────────

interface MockData {
  jobOrdersByPoNumber?: Record<string, ReaderDoc>;
  shiftsByJobOrder?: Record<string, ReaderDoc[]>;
  shiftsByWorksiteDate?: Record<string, ReaderDoc[]>; // key: `${worksiteId}::${workDate}`
  worksitesByName?: Record<string, ReaderDoc>;
  assignmentsByShift?: Record<string, ReaderDoc[]>;
}

function mockReader(d: MockData): Reader {
  return {
    async findJobOrderByPoNumber({ jobId }) {
      return d.jobOrdersByPoNumber?.[jobId] ?? null;
    },
    async listShiftsForJobOrder({ jobOrderId, workDate }) {
      const shifts = d.shiftsByJobOrder?.[jobOrderId] ?? [];
      if (!workDate) return shifts;
      return shifts.filter((s) => s.data.shiftDate === workDate);
    },
    async listShiftsByWorksiteDate({ worksiteId, workDate }) {
      return d.shiftsByWorksiteDate?.[`${worksiteId}::${workDate}`] ?? [];
    },
    async findWorksiteByName({ venueName }) {
      const key = venueName.toLowerCase();
      const direct = d.worksitesByName?.[key];
      if (direct) return direct;
      for (const [k, v] of Object.entries(d.worksitesByName ?? {})) {
        if (k.includes(key) || key.includes(k)) return v;
      }
      return null;
    },
    async listAssignmentsForShift({ shiftId }) {
      return d.assignmentsByShift?.[shiftId] ?? [];
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// new_request
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — new_request', () => {
  it('exact: jobId matches JO, no workDate → returns JO only', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: { poNumber: '509668' } } },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'new_request',
        jobId: '509668',
        headcount: 4,
      },
    });
    expect(result.matchedJobOrderId).to.equal('jo_abc');
    expect(result.matchedShiftId).to.be.undefined;
    expect(result.matchConfidence).to.equal('exact');
  });

  it('none: no JO with that poNumber', async () => {
    const reader = mockReader({});
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: { type: 'new_request', jobId: '999999', headcount: 4 },
    });
    expect(result.matchConfidence).to.equal('none');
    expect(result.matchNotes ?? '').to.contain('999999');
  });
});

// ─────────────────────────────────────────────────────────────────────
// change_time
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — change_time', () => {
  it('exact: jobId + workDate resolves to one shift', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: {} } },
      shiftsByJobOrder: {
        jo_abc: [
          { id: 'sh_1', data: { shiftDate: '2026-05-21' } },
          { id: 'sh_2', data: { shiftDate: '2026-05-22' } },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'change_time',
        jobId: '509668',
        workDate: '2026-05-21',
      },
    });
    expect(result.matchedJobOrderId).to.equal('jo_abc');
    expect(result.matchedShiftId).to.equal('sh_1');
    expect(result.matchConfidence).to.equal('exact');
  });

  it('multiple: jobId + workDate hits 2 shifts (same JO, same date)', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: {} } },
      shiftsByJobOrder: {
        jo_abc: [
          { id: 'sh_1', data: { shiftDate: '2026-05-21' } },
          { id: 'sh_2', data: { shiftDate: '2026-05-21' } },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: { type: 'change_time', jobId: '509668', workDate: '2026-05-21' },
    });
    expect(result.matchConfidence).to.equal('multiple');
    expect(result.matchedShiftId).to.be.undefined;
  });
});

// ─────────────────────────────────────────────────────────────────────
// change_headcount (no jobId — fallback)
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — change_headcount', () => {
  it('fuzzy: venue+date narrows to one shift', async () => {
    const reader = mockReader({
      worksitesByName: { 'moscone center': { id: 'ws_1', data: { name: 'Moscone Center' } } },
      shiftsByWorksiteDate: {
        'ws_1::2026-05-21': [
          {
            id: 'sh_1',
            data: { jobOrderId: 'jo_abc', defaultStartTime: '09:00', defaultEndTime: '17:00' },
          },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'change_headcount',
        newHeadcount: 5,
        venueName: 'Moscone Center',
        workDate: '2026-05-21',
        startTime: '09:00',
        endTime: '17:00',
      },
    });
    expect(result.matchedShiftId).to.equal('sh_1');
    expect(result.matchedJobOrderId).to.equal('jo_abc');
    expect(result.matchConfidence).to.equal('fuzzy');
  });

  it('multiple: 2 shifts on the same venue/date within tolerance', async () => {
    const reader = mockReader({
      worksitesByName: { 'moscone center': { id: 'ws_1', data: {} } },
      shiftsByWorksiteDate: {
        'ws_1::2026-05-21': [
          { id: 'sh_1', data: { defaultStartTime: '09:00', defaultEndTime: '13:00' } },
          { id: 'sh_2', data: { defaultStartTime: '13:00', defaultEndTime: '17:00' } },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'change_headcount',
        newHeadcount: 3,
        venueName: 'Moscone Center',
        workDate: '2026-05-21',
      },
    });
    expect(result.matchConfidence).to.equal('multiple');
  });

  it('none: venue doesnt resolve', async () => {
    const reader = mockReader({});
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'change_headcount',
        newHeadcount: 3,
        venueName: 'Unknown Place',
        workDate: '2026-05-21',
      },
    });
    expect(result.matchConfidence).to.equal('none');
  });

  it('jobId path: prefers jobId match when present', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: {} } },
      shiftsByJobOrder: {
        jo_abc: [{ id: 'sh_via_id', data: { shiftDate: '2026-05-21' } }],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'change_headcount',
        newHeadcount: 5,
        jobId: '509668',
        venueName: 'Moscone Center',
        workDate: '2026-05-21',
      },
    });
    expect(result.matchedShiftId).to.equal('sh_via_id');
    expect(result.matchConfidence).to.equal('exact');
  });
});

// ─────────────────────────────────────────────────────────────────────
// cancel_booking
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — cancel_booking', () => {
  it('full match: venue+date+time → shift, then 2 worker names → 2 assignments', async () => {
    const reader = mockReader({
      worksitesByName: { 'moscone center': { id: 'ws_1', data: {} } },
      shiftsByWorksiteDate: {
        'ws_1::2026-05-21': [
          {
            id: 'sh_1',
            data: { jobOrderId: 'jo_abc', defaultStartTime: '09:00', defaultEndTime: '17:00' },
          },
        ],
      },
      assignmentsByShift: {
        sh_1: [
          { id: 'asn_a', data: { workerName: 'Tihitna Ade' } },
          { id: 'asn_b', data: { workerName: 'Brianna Arnold' } },
          { id: 'asn_c', data: { workerName: 'Someone Else' } },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'cancel_booking',
        workerNames: ['Tihitna Ade', 'Brianna Arnold'],
        venueName: 'Moscone Center',
        workDate: '2026-05-21',
        startTime: '09:00',
        endTime: '17:00',
      },
    });
    expect(result.matchedShiftId).to.equal('sh_1');
    expect(result.matchedAssignmentIds).to.deep.equal(['asn_a', 'asn_b']);
  });

  it('partial: 1 of 2 worker names matches — empty string for the miss', async () => {
    const reader = mockReader({
      worksitesByName: { 'moscone center': { id: 'ws_1', data: {} } },
      shiftsByWorksiteDate: {
        'ws_1::2026-05-21': [{ id: 'sh_1', data: { defaultStartTime: '09:00' } }],
      },
      assignmentsByShift: {
        sh_1: [{ id: 'asn_a', data: { workerName: 'Tihitna Ade' } }],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'cancel_booking',
        workerNames: ['Tihitna Ade', 'Unknown Person'],
        venueName: 'Moscone Center',
        workDate: '2026-05-21',
      },
    });
    expect(result.matchedAssignmentIds).to.deep.equal(['asn_a', '']);
    expect(result.matchNotes ?? '').to.contain('unmatched');
  });
});

// ─────────────────────────────────────────────────────────────────────
// no_show
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — no_show', () => {
  it('full: jobId + workerName resolve to assignment', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: {} } },
      shiftsByJobOrder: {
        jo_abc: [{ id: 'sh_1', data: { shiftDate: '2026-05-21' } }],
      },
      assignmentsByShift: {
        sh_1: [{ id: 'asn_x', data: { workerName: 'John Smith' } }],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'no_show',
        jobId: '509668',
        workDate: '2026-05-21',
        workerName: 'John Smith',
      },
    });
    expect(result.matchedShiftId).to.equal('sh_1');
    expect(result.matchedAssignmentIds).to.deep.equal(['asn_x']);
  });

  it('worker not on the shift roster', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: { '509668': { id: 'jo_abc', data: {} } },
      shiftsByJobOrder: {
        jo_abc: [{ id: 'sh_1', data: { shiftDate: '2026-05-21' } }],
      },
      assignmentsByShift: { sh_1: [] },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'no_show',
        jobId: '509668',
        workDate: '2026-05-21',
        workerName: 'John Smith',
      },
    });
    expect(result.matchedShiftId).to.equal('sh_1');
    expect(result.matchedAssignmentIds).to.deep.equal(['']);
    expect(result.matchNotes ?? '').to.contain('not on the shift');
  });
});

// ─────────────────────────────────────────────────────────────────────
// daily_digest_expired
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — daily_digest_expired', () => {
  it('summarizes per-job resolutions', async () => {
    const reader = mockReader({
      jobOrdersByPoNumber: {
        '509668': { id: 'jo_a', data: {} },
        '509669': { id: 'jo_b', data: {} },
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'daily_digest_expired',
        expiredJobs: [{ jobId: '509668' }, { jobId: '509669' }, { jobId: '999999' }],
      },
    });
    expect(result.matchConfidence).to.equal('multiple');
    expect(result.matchNotes ?? '').to.contain('2/3');
  });

  it('none when every job id misses', async () => {
    const reader = mockReader({});
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'daily_digest_expired',
        expiredJobs: [{ jobId: '111' }, { jobId: '222' }],
      },
    });
    expect(result.matchConfidence).to.equal('none');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Worker-name fuzzy matching
// ─────────────────────────────────────────────────────────────────────

describe('matchWorkerAssignments — name matching', () => {
  const reader = mockReader({
    assignmentsByShift: {
      sh_1: [
        { id: 'a1', data: { workerName: 'John Smith' } },
        { id: 'a2', data: { workerName: 'Mary J. O’Connor' } }, // U+2019 apostrophe
        { id: 'a3', data: { workerName: 'Carlos Sainz' } },
      ],
    },
  });

  it('exact match', async () => {
    const r = await matchWorkerAssignments(reader, {
      tenantId: 'T',
      shiftId: 'sh_1',
      workerNames: ['John Smith'],
    });
    expect(r.assignmentIds).to.deep.equal(['a1']);
    expect(r.unmatched).to.be.empty;
  });

  it('tolerates middle initials and apostrophes', async () => {
    const r = await matchWorkerAssignments(reader, {
      tenantId: 'T',
      shiftId: 'sh_1',
      workerNames: ['Mary OConnor'],
    });
    expect(r.assignmentIds[0]).to.equal('a2');
  });

  it('substring fallback: prefix on first name', async () => {
    const r = await matchWorkerAssignments(reader, {
      tenantId: 'T',
      shiftId: 'sh_1',
      workerNames: ['Carl Sainz'],
    });
    expect(r.assignmentIds[0]).to.equal('a3');
  });

  it('returns empty string + unmatched for misses', async () => {
    const r = await matchWorkerAssignments(reader, {
      tenantId: 'T',
      shiftId: 'sh_1',
      workerNames: ['Nobody Here'],
    });
    expect(r.assignmentIds).to.deep.equal(['']);
    expect(r.unmatched).to.deep.equal(['Nobody Here']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Exception handling
// ─────────────────────────────────────────────────────────────────────

describe('matchShiftRequest — error handling', () => {
  it('downgrades a reader exception to matchConfidence=none', async () => {
    const throwing: Reader = {
      async findJobOrderByPoNumber() {
        throw new Error('firestore boom');
      },
      async listShiftsForJobOrder() {
        return [];
      },
      async listShiftsByWorksiteDate() {
        return [];
      },
      async findWorksiteByName() {
        return null;
      },
      async listAssignmentsForShift() {
        return [];
      },
    };
    const result = await matchShiftRequest(throwing, {
      tenantId: 'T',
      event: { type: 'new_request', jobId: '509668', headcount: 1 },
    });
    expect(result.matchConfidence).to.equal('none');
    expect(result.matchNotes ?? '').to.contain('firestore boom');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure helper coverage
// ─────────────────────────────────────────────────────────────────────

describe('normalizeName / tokenize', () => {
  it('normalizes case + punctuation + extra spaces', () => {
    expect(normalizeName('  Mary  J.  O’Connor  ')).to.equal('mary j oconnor');
  });

  it('tokenize drops single-letter "initials" like "p."', () => {
    expect(tokenize('John P. Smith')).to.deep.equal(['john', 'smith']);
  });
});
