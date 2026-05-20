/**
 * Unit tests — Everee payables → pay history mapper.
 *
 * Pure-function tests, no Firestore / Everee API. Covers:
 *   - Envelope extraction (bare array, { items }, { payables }, { data })
 *   - Grouping by payment.id / paymentId / paymentRequestId / synthetic
 *   - Status rollup severity ordering
 *   - Money parsing (string vs number)
 *   - Sort order (newest payDate first)
 */

import { expect } from 'chai';

import {
  groupByPaymentId,
  mapPayablesToPayHistory,
  rollupStatus,
  type RawPayable,
} from '../../../integrations/everee/payHistory/mapPayHistory';

describe('mapPayablesToPayHistory — envelope extraction', () => {
  it('handles a bare array', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '10.00', currency: 'USD' }, paymentStatus: 'PAID' },
    ]);
    expect(r.items).to.have.lengthOf(1);
    expect(r.items[0].gross).to.equal(10);
  });

  it('handles { items, nextCursor }', () => {
    const r = mapPayablesToPayHistory({
      items: [{ paymentId: 'p1', amount: { amount: '20.00' } }],
      nextCursor: 'next-token',
    });
    expect(r.items).to.have.lengthOf(1);
    expect(r.nextCursor).to.equal('next-token');
  });

  it('handles { payables: [...] }', () => {
    const r = mapPayablesToPayHistory({
      payables: [{ paymentId: 'p1', amount: { amount: '5' } }],
    });
    expect(r.items).to.have.lengthOf(1);
  });

  it('handles { data: [...] }', () => {
    const r = mapPayablesToPayHistory({
      data: [{ paymentId: 'p1', amount: { amount: '5' } }],
    });
    expect(r.items).to.have.lengthOf(1);
  });

  it('returns empty when raw is garbage', () => {
    expect(mapPayablesToPayHistory(null).items).to.have.lengthOf(0);
    expect(mapPayablesToPayHistory('not-json').items).to.have.lengthOf(0);
    expect(mapPayablesToPayHistory(42).items).to.have.lengthOf(0);
  });
});

describe('groupByPaymentId', () => {
  it('prefers nested payment.id', () => {
    const payables: RawPayable[] = [
      { id: 1, payment: { id: 'pmt-A' }, paymentId: 'pmt-B' },
      { id: 2, payment: { id: 'pmt-A' } },
    ];
    const groups = groupByPaymentId(payables);
    expect(groups.size).to.equal(1);
    expect([...groups.keys()][0]).to.equal('pmt_pmt-A');
  });

  it('falls back to flat paymentId', () => {
    const payables: RawPayable[] = [
      { id: 1, paymentId: 'pmt-X' },
      { id: 2, paymentId: 'pmt-X' },
      { id: 3, paymentId: 'pmt-Y' },
    ];
    const groups = groupByPaymentId(payables);
    expect(groups.size).to.equal(2);
  });

  it('falls back to paymentRequestId (legacy)', () => {
    const payables: RawPayable[] = [{ id: 1, paymentRequestId: 'old-id' }];
    const groups = groupByPaymentId(payables);
    expect([...groups.keys()][0]).to.equal('pmt_old-id');
  });

  it('synthetic per-day key when no payment id (pending payable)', () => {
    const payables: RawPayable[] = [
      { id: 1, timestamp: '2026-05-15T12:00:00Z' },
      { id: 2, timestamp: '2026-05-15T14:00:00Z' },
      { id: 3, timestamp: '2026-05-16T12:00:00Z' },
    ];
    const groups = groupByPaymentId(payables);
    expect(groups.size).to.equal(2);
    const keys = [...groups.keys()].sort();
    expect(keys[0]).to.equal('pending_2026-05-15');
    expect(keys[1]).to.equal('pending_2026-05-16');
  });

  it('handles epoch-seconds timestamps too', () => {
    const epochS = 1747310400; // 2025-05-15
    const payables: RawPayable[] = [{ id: 1, timestamp: epochS }];
    const groups = groupByPaymentId(payables);
    const key = [...groups.keys()][0];
    expect(key.startsWith('pending_')).to.be.true;
  });
});

describe('rollupStatus', () => {
  it('worst-of: PENDING < PAID < ERROR', () => {
    expect(rollupStatus(new Set(['PENDING', 'PAID']))).to.equal('PAID');
    expect(rollupStatus(new Set(['PAID', 'ERROR']))).to.equal('ERROR');
    expect(rollupStatus(new Set(['PENDING', 'PAID', 'ERROR']))).to.equal('ERROR');
  });

  it('UNPAYABLE_WORKER + RETURNED treated as severity 5', () => {
    expect(rollupStatus(new Set(['PAID', 'UNPAYABLE_WORKER']))).to.equal('UNPAYABLE_WORKER');
    expect(rollupStatus(new Set(['PAID', 'RETURNED']))).to.equal('RETURNED');
  });

  it('empty set returns PENDING', () => {
    expect(rollupStatus(new Set())).to.equal('PENDING');
  });

  it('unknown statuses pass through', () => {
    expect(rollupStatus(new Set(['WEIRD_NEW_STATUS']))).to.equal('WEIRD_NEW_STATUS');
  });
});

describe('mapPayablesToPayHistory — summarization + sort', () => {
  it('sums gross across a group, picks USD currency', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '10.00', currency: 'USD' } },
      { paymentId: 'p1', amount: { amount: '7.50', currency: 'USD' } },
      { paymentId: 'p1', amount: { amount: '2.50', currency: 'USD' } },
    ]);
    expect(r.items[0].gross).to.equal(20);
    expect(r.items[0].net).to.equal(20);
    expect(r.items[0].currency).to.equal('USD');
  });

  it('extracts period range from payable timestamps', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '5' }, timestamp: '2026-05-10T12:00:00Z' },
      { paymentId: 'p1', amount: { amount: '5' }, timestamp: '2026-05-15T12:00:00Z' },
    ]);
    expect(r.items[0].periodStart).to.equal('2026-05-10');
    expect(r.items[0].periodEnd).to.equal('2026-05-15');
  });

  it('sorts newest payDate first', () => {
    const r = mapPayablesToPayHistory([
      {
        paymentId: 'pA',
        amount: { amount: '10' },
        payment: { id: 'pA', completedAt: '2026-05-10' },
      },
      {
        paymentId: 'pB',
        amount: { amount: '20' },
        payment: { id: 'pB', completedAt: '2026-05-20' },
      },
      {
        paymentId: 'pC',
        amount: { amount: '15' },
        payment: { id: 'pC', completedAt: '2026-05-15' },
      },
    ]);
    expect(r.items.map((it) => it.statementId)).to.deep.equal(['pmt_pB', 'pmt_pC', 'pmt_pA']);
  });

  it('falls back to USD when no currency surfaced', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '10' } },
    ]);
    expect(r.items[0].currency).to.equal('USD');
  });

  it('rolls up payable statuses to one summary status', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '5' }, paymentStatus: 'PAID' },
      { paymentId: 'p1', amount: { amount: '5' }, paymentStatus: 'PENDING' },
    ]);
    expect(r.items[0].status).to.equal('PAID');
  });

  it('handles missing amounts gracefully', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1' },
      { paymentId: 'p1', amount: { amount: '5.00' } },
    ]);
    expect(r.items[0].gross).to.equal(5);
  });

  it('strips dollar/comma chars from string amounts', () => {
    const r = mapPayablesToPayHistory([
      { paymentId: 'p1', amount: { amount: '$1,234.56' } },
    ]);
    expect(r.items[0].gross).to.equal(1234.56);
  });
});
