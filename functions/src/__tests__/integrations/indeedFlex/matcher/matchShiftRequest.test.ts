/**
 * Slice 3 unit tests — top-level matcher dispatcher.
 *
 * Uses a hand-rolled mock `Reader` so tests don't need an emulator.
 * One test per event-type strategy in the dispatcher; the
 * worker-name matching has its own focused tests below.
 */

import { expect } from 'chai';

import { normalizeVenueName } from '../../../../integrations/indeedFlex/matcher/matchByVenue';
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
  shiftsByAccountDate?: Record<string, ReaderDoc[]>; // key: `${accountId}::${workDate}`
  worksitesByName?: Record<string, ReaderDoc>;
  assignmentsByShift?: Record<string, ReaderDoc[]>;
  accounts?: ReaderDoc[];
  inboxJoByAccount?: Record<string, ReaderDoc>;
  venueAliases?: Record<string, { accountId: string; accountName: string }>; // key: raw venue string
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
    async listShiftsForAccountDate({ accountId, workDate }) {
      return d.shiftsByAccountDate?.[`${accountId}::${workDate}`] ?? [];
    },
    async listAccounts() {
      return d.accounts ?? [];
    },
    async findInboxGigJobOrder({ accountId }) {
      return d.inboxJoByAccount?.[accountId] ?? null;
    },
    async getVenueAlias({ rawVenueName }) {
      return d.venueAliases?.[rawVenueName] ?? null;
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

  it('none: no JO with that poNumber and no venue to fall back on', async () => {
    // Post-2026-05-24 rewrite: a jobId miss falls through to the
    // venue→account path, so with no venueName the note reflects that.
    const reader = mockReader({});
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: { type: 'new_request', jobId: '999999', headcount: 4 },
    });
    expect(result.matchConfidence).to.equal('none');
    expect(result.matchNotes ?? '').to.contain('no venueName');
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
      async listShiftsForAccountDate() {
        return [];
      },
      async listAccounts() {
        return [];
      },
      async findInboxGigJobOrder() {
        return null;
      },
      async getVenueAlias() {
        return null;
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

// ─────────────────────────────────────────────────────────────────────
// 2026-07-20 — account-leg fallback for cancel/change venue strings
// ─────────────────────────────────────────────────────────────────────

describe('normalizeVenueName — address-tail cut', () => {
  it('drops the street-address tail from cancel-format strings', () => {
    expect(
      normalizeVenueName("Domino's, Colorado, 10252 E. 51st Ave, Denver 80239, US"),
    ).to.equal("Domino's, Colorado");
  });

  it('handles brand-comma prefix + mid-string SVC code + parenthetical commas', () => {
    expect(
      normalizeVenueName(
        'CORT, WBI (Hanover, MD) - Maryland Warehouse - SVC07/44/00, 7466 Candlewood Rd., Suite G, Hanover 21076, US',
      ),
    ).to.equal('Maryland Warehouse');
  });
});

describe('matchByFallback — account leg', () => {
  it('cancel resolves venue → account → shift when no worksite matches', async () => {
    const reader = mockReader({
      accounts: [
        { id: 'acctCO', data: { name: "Domino's Distribution Center Colorado" } },
      ],
      shiftsByAccountDate: {
        'acctCO::2026-07-12': [
          {
            id: 'shift1',
            data: { jobOrderId: 'jo1', shiftDate: '2026-07-12' },
          },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'cancel_booking',
        venueName: "Domino's, Colorado, 10252 E. 51st Ave, Denver 80239, US",
        workDate: '2026-07-12',
        workerNames: [],
      },
    });
    expect(result.matchConfidence).to.equal('fuzzy');
    expect(result.matchedShiftId).to.equal('shift1');
    expect(result.matchedJobOrderId).to.equal('jo1');
    expect(result.matchedAccountName).to.equal("Domino's Distribution Center Colorado");
  });

  it('vetoes a fuzzy account whose name shares no token with the client segment', async () => {
    // "CORT …" venue must never land on a Domino's account just
    // because both contain the rare token "maryland". The extra Depot
    // accounts mirror the prod corpus shape: they make 'depot' a cheap
    // token so the wrong account clears the exact-match threshold on
    // 'maryland' alone — exactly the failure the veto exists to catch.
    // (No SVC code here on purpose — that has its own earlier guard.)
    const reader = mockReader({
      accounts: [
        { id: 'acctMD', data: { name: "Domino's Distribution Center Maryland" } },
        { id: 'acctPH', data: { name: 'CORT Phoenix Depot' } },
        { id: 'acctDE', data: { name: 'CORT Denver Depot' } },
        { id: 'acctAU', data: { name: 'CORT Austin Depot' } },
      ],
      shiftsByAccountDate: {
        'acctMD::2026-07-17': [
          { id: 'shiftX', data: { jobOrderId: 'joX', shiftDate: '2026-07-17' } },
        ],
      },
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'cancel_booking',
        venueName:
          'CORT, WBI (Hanover, MD) - Maryland Depot, 7466 Candlewood Rd., Suite G, Hanover 21076, US',
        workDate: '2026-07-17',
        workerNames: [],
      },
    });
    expect(result.matchConfidence).to.equal('none');
    expect(result.matchedShiftId).to.equal(undefined);
    expect(result.matchNotes ?? '').to.contain('vetoed');
  });

  it('SVC-coded venue never exact-matches a non-CORT account', async () => {
    // The real 2026-07-21 near-miss: a new_request for CORT's
    // "Maryland Warehouse - SVC07/44/00" sat stamped exact against
    // "Domino's Distribution Center Maryland" and was one triage run
    // away from minting a CORT shift on Domino's JO.
    const reader = mockReader({
      accounts: [
        { id: 'acctMD', data: { name: "Domino's Distribution Center Maryland" } },
        { id: 'acctPH', data: { name: 'CORT Phoenix Warehouse' } },
        { id: 'acctDE', data: { name: 'CORT Denver Warehouse' } },
        { id: 'acctAU', data: { name: 'CORT Austin Warehouse' } },
      ],
    });
    const result = await matchShiftRequest(reader, {
      tenantId: 'T',
      event: {
        type: 'new_request',
        jobId: '',
        headcount: 1,
        venueName: 'WBI (Hanover, MD) - Maryland Warehouse - SVC07/44/00',
        workDate: '2026-07-25',
      },
    });
    expect(result.matchConfidence).to.equal('multiple');
    expect(result.matchedJobOrderId).to.equal(undefined);
    expect(result.matchNotes ?? '').to.contain("isn't a CORT account");
  });
});
