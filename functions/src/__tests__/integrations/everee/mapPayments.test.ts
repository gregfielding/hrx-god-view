/**
 * Unit tests — `/api/v2/payments` → pay history mapper.
 *
 * Pure-function tests. Sample shapes lifted from real Everee responses
 * captured during PR #23 troubleshooting:
 *   - top-level fields: id, payDate, payPeriodStartDate, payPeriodEndDate,
 *     grossEarnings, netEarnings, status, queryStatus, depositStatus
 *   - employee sub-object carries externalWorkerId (HRX uid)
 */

import { expect } from 'chai';

import {
  mapPaymentsToPayHistory,
  rollupPaymentStatus,
  type RawPayment,
} from '../../../integrations/everee/payHistory/mapPayments';

const SAMPLE_UID = 'UwYAlty9c4RPBuPzDkfAHvDopS23';
const OTHER_UID = '__OTHER_UID__';
const UUID_KEY = '88dd26ee-14e6-4407-83a0-52337a30e0a4';

function makePayment(overrides: Partial<RawPayment> = {}): RawPayment {
  return {
    id: 23076363,
    payDate: '2026-05-20',
    payPeriodStartDate: '2026-04-26',
    payPeriodEndDate: '2026-05-02',
    grossEarnings: { amount: '480.00', currency: 'USD' },
    netEarnings: { amount: '372.15', currency: 'USD' },
    status: 'CALCULATED',
    queryStatus: 'APPROVED',
    depositStatus: 'PAID',
    employee: {
      externalWorkerId: SAMPLE_UID,
      employeeId: 2177765,
    },
    ...overrides,
  };
}

describe('mapPaymentsToPayHistory — envelope', () => {
  it('handles { items: [] } envelope', () => {
    const r = mapPaymentsToPayHistory({ items: [makePayment()] }, SAMPLE_UID);
    expect(r.items).to.have.lengthOf(1);
  });

  it('handles bare array', () => {
    const r = mapPaymentsToPayHistory([makePayment()], SAMPLE_UID);
    expect(r.items).to.have.lengthOf(1);
  });

  it('returns empty for garbage input', () => {
    expect(mapPaymentsToPayHistory(null, SAMPLE_UID).items).to.have.lengthOf(0);
    expect(mapPaymentsToPayHistory({}, SAMPLE_UID).items).to.have.lengthOf(0);
    expect(mapPaymentsToPayHistory(42, SAMPLE_UID).items).to.have.lengthOf(0);
  });

  it('returns empty when no candidate keys provided', () => {
    expect(mapPaymentsToPayHistory([makePayment()], '').items).to.have.lengthOf(0);
    expect(mapPaymentsToPayHistory([makePayment()], '   ').items).to.have.lengthOf(0);
    expect(mapPaymentsToPayHistory([makePayment()], []).items).to.have.lengthOf(0);
    expect(mapPaymentsToPayHistory([makePayment()], ['', '  ']).items).to.have.lengthOf(0);
  });

  it('accepts multiple candidate keys (HRX uid OR Everee UUID)', () => {
    // Payment carries Everee UUID in employee.externalWorkerId (older
    // linkage shape). Caller passes both HRX uid AND UUID — should match.
    const p = makePayment({
      employee: { externalWorkerId: UUID_KEY, employeeId: 999 },
    });
    expect(
      mapPaymentsToPayHistory([p], [SAMPLE_UID, UUID_KEY]).items,
    ).to.have.lengthOf(1);
    // Same payment but caller only passes HRX uid — no match.
    expect(mapPaymentsToPayHistory([p], [SAMPLE_UID]).items).to.have.lengthOf(0);
  });
});

describe('mapPaymentsToPayHistory — client-side filter', () => {
  it('filters to only payments for the requested uid', () => {
    const r = mapPaymentsToPayHistory(
      {
        items: [
          makePayment({ id: 1 }),
          makePayment({ id: 2, employee: { externalWorkerId: OTHER_UID } }),
          makePayment({ id: 3 }),
        ],
      },
      SAMPLE_UID,
    );
    expect(r.items).to.have.lengthOf(2);
    expect(r.items.map((it) => it.statementId)).to.include.members(['pmt_1', 'pmt_3']);
    expect(r.items.map((it) => it.statementId)).not.to.include('pmt_2');
  });

  it('falls back to top-level externalWorkerId when employee sub-object lacks it', () => {
    const p: RawPayment = {
      id: 99,
      employee: undefined,
      externalWorkerId: SAMPLE_UID,
      grossEarnings: { amount: '100', currency: 'USD' },
      netEarnings: { amount: '77', currency: 'USD' },
    };
    const r = mapPaymentsToPayHistory([p], SAMPLE_UID);
    expect(r.items).to.have.lengthOf(1);
  });
});

describe('mapPaymentsToPayHistory — per-record mapping', () => {
  it('maps period + payDate + gross + net + currency', () => {
    const r = mapPaymentsToPayHistory([makePayment()], SAMPLE_UID);
    const item = r.items[0];
    expect(item.statementId).to.equal('pmt_23076363');
    expect(item.periodStart).to.equal('2026-04-26');
    expect(item.periodEnd).to.equal('2026-05-02');
    expect(item.payDate).to.equal('2026-05-20');
    expect(item.gross).to.equal(480);
    expect(item.net).to.equal(372.15);
    expect(item.currency).to.equal('USD');
    expect(item.status).to.equal('PAID');
  });

  it('handles numeric money values', () => {
    const r = mapPaymentsToPayHistory(
      [
        makePayment({
          grossEarnings: { amount: 250, currency: 'USD' },
          netEarnings: { amount: 200, currency: 'USD' },
        }),
      ],
      SAMPLE_UID,
    );
    expect(r.items[0].gross).to.equal(250);
    expect(r.items[0].net).to.equal(200);
  });

  it('defaults net to gross when net is zero/missing', () => {
    const r = mapPaymentsToPayHistory(
      [
        makePayment({
          netEarnings: { amount: '0.00', currency: 'USD' },
        }),
      ],
      SAMPLE_UID,
    );
    expect(r.items[0].net).to.equal(480); // falls back to gross
  });

  it('uses forDate when payDate is missing', () => {
    const r = mapPaymentsToPayHistory(
      [makePayment({ payDate: undefined, forDate: '2026-05-15' })],
      SAMPLE_UID,
    );
    expect(r.items[0].payDate).to.equal('2026-05-15');
  });
});

describe('mapPaymentsToPayHistory — sort order', () => {
  it('sorts newest payDate first', () => {
    const r = mapPaymentsToPayHistory(
      [
        makePayment({ id: 'A', payDate: '2026-05-01' }),
        makePayment({ id: 'B', payDate: '2026-05-20' }),
        makePayment({ id: 'C', payDate: '2026-05-10' }),
      ],
      SAMPLE_UID,
    );
    expect(r.items.map((it) => it.statementId)).to.deep.equal([
      'pmt_B',
      'pmt_C',
      'pmt_A',
    ]);
  });
});

describe('rollupPaymentStatus', () => {
  it('depositStatus=PAID wins everything', () => {
    expect(
      rollupPaymentStatus({
        depositStatus: 'PAID',
        queryStatus: 'PENDING_APPROVAL',
        status: 'CALCULATED',
      }),
    ).to.equal('PAID');
  });

  it('depositStatus=ERROR / RETURNED', () => {
    expect(rollupPaymentStatus({ depositStatus: 'ERROR' })).to.equal('ERROR');
    expect(rollupPaymentStatus({ depositStatus: 'RETURNED' })).to.equal('RETURNED');
  });

  it('queryStatus=PENDING_APPROVAL → PENDING', () => {
    expect(
      rollupPaymentStatus({ queryStatus: 'PENDING_APPROVAL', status: 'CALCULATED' }),
    ).to.equal('PENDING');
  });

  it('queryStatus=READY_TO_CALCULATE → PENDING', () => {
    expect(rollupPaymentStatus({ queryStatus: 'READY_TO_CALCULATE' })).to.equal('PENDING');
  });

  it('queryStatus=UNPAYABLE_WORKER → UNPAYABLE_WORKER', () => {
    expect(
      rollupPaymentStatus({ queryStatus: 'UNPAYABLE_WORKER', status: 'ERRORED' }),
    ).to.equal('UNPAYABLE_WORKER');
  });

  it('status=PRE_CALCULATED → PENDING', () => {
    expect(rollupPaymentStatus({ status: 'PRE_CALCULATED' })).to.equal('PENDING');
  });

  it('status=ERRORED → ERROR', () => {
    expect(rollupPaymentStatus({ status: 'ERRORED' })).to.equal('ERROR');
  });

  it('queryStatus=APPROVED + no deposit → SUBMITTED', () => {
    expect(
      rollupPaymentStatus({ queryStatus: 'APPROVED', depositStatus: 'NONE' }),
    ).to.equal('SUBMITTED');
  });

  it('queryStatus=REJECTED → ERROR', () => {
    expect(rollupPaymentStatus({ queryStatus: 'REJECTED' })).to.equal('ERROR');
  });

  it('status=CALCULATED + no approval → PENDING', () => {
    expect(rollupPaymentStatus({ status: 'CALCULATED' })).to.equal('PENDING');
  });

  it('falls back to raw status on unknown combo', () => {
    expect(rollupPaymentStatus({ status: 'EXOTIC_NEW_STATUS' })).to.equal('EXOTIC_NEW_STATUS');
  });

  it('defaults to PENDING when everything is empty', () => {
    expect(rollupPaymentStatus({})).to.equal('PENDING');
  });
});
