/**
 * Returned-funds detection (2026-09-11).
 *
 * Everee re-routes a long-bounced deposit to the employer's funding account
 * and the payment then reads PAID/DEPOSITED; the payment-issue sweep used to
 * mark those issues resolved while the workers were still owed. These tests
 * pin the classification and the payment → timesheet-entry link against a
 * sanitized copy of the real shapes.
 */

import { expect } from 'chai';

import {
  classifyDepositOutcome,
  extractLabelWorkDate,
  findPossibleRepayment,
  fundsReturnedEntryMessage,
  isFrozenIssueStatus,
  matchReturnedPayables,
  parseEvereeTimestamp,
  parseFundingAccounts,
  sanitizePayableLine,
  sanitizePaymentForDetection,
} from '../../payroll/fundsReturnedDetection';
import {
  DEPOSITED_NO_DEPOSIT_ROWS,
  FIXTURE_ENTITY_FUNDING_ACCOUNTS,
  RETRY_DEPOSITED_TO_WORKER,
  RETRY_IN_FLIGHT,
  RETURNED_COMPANY_ROW_ONLY,
  RETURNED_REISSUED_PAYMENT,
  STILL_BOUNCING,
  WORKER_HRX_LINES,
  WORKER_PAYABLES,
  fixtureImportLine,
} from './fixtures/evereeFundsReturned.fixture';

const accounts = parseFundingAccounts(FIXTURE_ENTITY_FUNDING_ACCOUNTS);
const classify = (raw: unknown, refs = accounts) => classifyDepositOutcome(sanitizePaymentForDetection(raw), refs);

describe('fundsReturnedDetection', () => {
  describe('sanitizePaymentForDetection', () => {
    it('keeps ids, statuses, amounts and bank last-4s — never the SSN or full bank numbers', () => {
      const p = sanitizePaymentForDetection(RETURNED_REISSUED_PAYMENT);
      const serialized = JSON.stringify(p);
      expect(serialized).not.to.include('taxpayerIdentifier');
      expect(serialized).not.to.include('123456789');
      expect(serialized).not.to.include('000090001');
      expect(serialized).not.to.include('000080123');
      expect(serialized).not.to.include('employee');
      expect(p).to.include({
        id: '90000002',
        prevPaymentId: '90000001',
        depositStatus: 'DEPOSITED',
        payDate: '2026-07-30',
        gross: 542.72,
        externalWorkerId: 'fixtureWorkerUid0000000001',
      });
      expect(p.deposits[1]).to.deep.equal({
        bankAccountId: '9001',
        bankName: 'Company Test Bank',
        routingLast4: '0001',
        accountLast4: '4321',
        status: 'DEPOSITED',
        amount: 542.72,
        updatedAt: '2026-09-11T12:11:56.851504',
      });
    });

    it('tolerates garbage input', () => {
      const p = sanitizePaymentForDetection(null);
      expect(p.id).to.equal('');
      expect(p.deposits).to.deep.equal([]);
    });
  });

  describe('parseFundingAccounts', () => {
    it('accepts an id-only ref and a last-4 pair, and a single object', () => {
      expect(parseFundingAccounts([{ bankAccountId: 42 }, { routingLast4: '1234', accountLast4: '9876' }])).to.have.length(2);
      expect(parseFundingAccounts({ bankAccountId: '42' })[0].bankAccountId).to.equal('42');
    });

    it('drops a routing-only ref (it would match every account at that bank)', () => {
      expect(parseFundingAccounts([{ routingLast4: '1234' }])).to.deep.equal([]);
      expect(parseFundingAccounts(undefined)).to.deep.equal([]);
    });
  });

  describe('classifyDepositOutcome', () => {
    it('re-issued payment with the worker row zeroed and a company row → funds_returned', () => {
      const outcome = classify(RETURNED_REISSUED_PAYMENT);
      expect(outcome.kind).to.equal('funds_returned');
      if (outcome.kind !== 'funds_returned') return;
      expect(outcome.amount).to.equal(542.72);
      expect(outcome.returnedAt?.toISOString()).to.equal('2026-09-11T12:11:56.851Z');
      expect(outcome.bankName).to.equal('Company Test Bank');
    });

    it('company row only → funds_returned', () => {
      const outcome = classify(RETURNED_COMPANY_ROW_ONLY);
      expect(outcome).to.include({ kind: 'funds_returned', amount: 187.56 });
    });

    it('matches on routing + account last-4 when Everee re-keys the bank account id', () => {
      const rekeyed = {
        ...RETURNED_COMPANY_ROW_ONLY,
        depositList: RETURNED_COMPANY_ROW_ONLY.depositList.map((d) => ({ ...d, bankAccountId: 777777 })),
      };
      const refs = parseFundingAccounts([{ bankAccountId: 1, routingLast4: '0001', accountLast4: '4321' }]);
      expect(classify(rekeyed, refs).kind).to.equal('funds_returned');
    });

    it('same bank routing but a different account is the worker, not the company', () => {
      const sameBank = {
        ...RETRY_DEPOSITED_TO_WORKER,
        depositList: RETRY_DEPOSITED_TO_WORKER.depositList.map((d) => ({ ...d, routingNumber: '000090001' })),
      };
      expect(classify(sameBank).kind).to.equal('worker_deposited');
    });

    it('settled retry to the worker’s (new) bank → worker_deposited', () => {
      expect(classify(RETRY_DEPOSITED_TO_WORKER)).to.deep.equal({ kind: 'worker_deposited', amount: 347.97 });
    });

    it('DEPOSITED with no deposit rows is never resolved', () => {
      expect(classify(DEPOSITED_NO_DEPOSIT_ROWS)).to.deep.equal({ kind: 'unconfirmed', reason: 'no_deposit_records' });
    });

    it('without a configured funding account a returned payment is unconfirmed, not resolved', () => {
      expect(classify(RETURNED_REISSUED_PAYMENT, [])).to.deep.equal({
        kind: 'unconfirmed',
        reason: 'no_funding_account_configured',
      });
    });

    it('still bouncing → still_failing; retry pending → in_flight', () => {
      expect(classify(STILL_BOUNCING).kind).to.equal('still_failing');
      expect(classify(RETRY_IN_FLIGHT).kind).to.equal('in_flight');
    });
  });

  describe('matchReturnedPayables', () => {
    const payables = WORKER_PAYABLES.map(sanitizePayableLine);

    it('links a re-issued payment through prevPaymentId to exactly its three entries', () => {
      const match = matchReturnedPayables({
        paymentGross: 542.72,
        chainPaymentIds: ['90000002', '90000001'],
        evereePayables: payables,
        hrxLines: WORKER_HRX_LINES,
      });
      expect(match).to.deep.equal({
        ok: true,
        entryIds: [
          'import__test_venue__fixtureworkeruid0000000001__2026-07-17',
          'import__test_venue__fixtureworkeruid0000000001__2026-07-18',
          'import__test_venue__fixtureworkeruid0000000001__2026-07-19',
        ],
        workDates: ['2026-07-17', '2026-07-18', '2026-07-19'],
      });
    });

    it('finds nothing when the chain misses the payables’ payment id', () => {
      const match = matchReturnedPayables({
        paymentGross: 542.72,
        chainPaymentIds: ['90000002'],
        evereePayables: payables,
        hrxLines: WORKER_HRX_LINES,
      });
      expect(match).to.deep.equal({ ok: false, reason: 'no_everee_payables' });
    });

    it('refuses when the payables do not add up to the payment', () => {
      const match = matchReturnedPayables({
        paymentGross: 600,
        chainPaymentIds: ['90000001'],
        evereePayables: payables,
        hrxLines: WORKER_HRX_LINES,
      });
      expect(match).to.deep.equal({ ok: false, reason: 'total_mismatch' });
    });

    const sameAmount = (label1: string, label2: string) => [
      { paymentId: '90000010', amount: 93.78, label: label1 },
      { paymentId: '90000010', amount: 93.78, label: label2 },
    ];
    const threeLines = [
      fixtureImportLine('2026-08-01', 93.78),
      fixtureImportLine('2026-08-02', 93.78),
      fixtureImportLine('2026-08-09', 93.78),
    ];

    it('tells same-amount days apart by the label work date', () => {
      const match = matchReturnedPayables({
        paymentGross: 187.56,
        chainPaymentIds: ['90000010'],
        evereePayables: sameAmount('Contractor pay — Fest — 2026-08-01 — 5.5 hrs', 'Contractor pay — Fest — 2026-08-02 — 5.5 hrs'),
        hrxLines: threeLines,
      });
      expect(match.ok && match.workDates).to.deep.equal(['2026-08-01', '2026-08-02']);
    });

    it('is ambiguous when undated labels leave more candidate lines than payables', () => {
      const match = matchReturnedPayables({
        paymentGross: 187.56,
        chainPaymentIds: ['90000010'],
        evereePayables: sameAmount('Contractor pay (5.5h)', 'Contractor pay (5.5h)'),
        hrxLines: threeLines,
      });
      expect(match).to.deep.equal({ ok: false, reason: 'ambiguous' });
    });

    it('never matches a line HRX has no amount for (grid rows)', () => {
      const match = matchReturnedPayables({
        paymentGross: 120,
        chainPaymentIds: ['90000020'],
        evereePayables: [{ paymentId: '90000020', amount: 120, label: 'Acme · Gala — Arena · Contractor pay (8h)' }],
        hrxLines: [{ entryId: 'assign_2026-08-12', externalId: 't::assign::2026-08-12::CONTRACTOR', amount: null, workDate: '2026-08-12' }],
      });
      expect(match).to.deep.equal({ ok: false, reason: 'unmatched_payable' });
    });

    it('reads the work date out of a payable label', () => {
      expect(extractLabelWorkDate('Contractor pay — LollaPalooza — 2026-08-03 — 1.83 hrs')).to.equal('2026-08-03');
      expect(extractLabelWorkDate('Cricket 7/12 & 7/13')).to.equal(null);
    });
  });

  describe('isFrozenIssueStatus', () => {
    it('freezes every funds_returned* status and nothing else', () => {
      for (const s of ['funds_returned', 'funds_returned_repaid', 'funds_returned_already_repaid']) {
        expect(isFrozenIssueStatus(s), s).to.equal(true);
      }
      for (const s of ['open', 'resolved', 'deposit_unconfirmed', undefined, null]) {
        expect(isFrozenIssueStatus(s), String(s)).to.equal(false);
      }
    });
  });

  describe('ops helpers', () => {
    it('parses Everee’s offset-less microsecond timestamps as UTC', () => {
      expect(parseEvereeTimestamp('2026-09-11T12:11:56.851504')?.toISOString()).to.equal('2026-09-11T12:11:56.851Z');
      expect(parseEvereeTimestamp('2026-09-11T12:11:56Z')?.toISOString()).to.equal('2026-09-11T12:11:56.000Z');
      expect(parseEvereeTimestamp('2026-09-11T05:11:56-0700')?.toISOString()).to.equal('2026-09-11T12:11:56.000Z');
      expect(parseEvereeTimestamp('yesterday')).to.equal(null);
    });

    it('writes the entry message ops used for the manual fix', () => {
      const msg = fundsReturnedEntryMessage({
        amount: 542.72,
        paymentId: '90000002',
        entityName: 'C1 Events LLC',
        returnedAt: new Date('2026-09-11T12:11:56Z'),
      });
      expect(msg).to.equal(
        'Deposit undeliverable — Everee returned $542.72 (payment 90000002) to C1 Events LLC on 9/11/26. ' +
          'Worker still owed: repay with an off-cycle payment; do NOT resubmit (Everee dedupes the original payable).',
      );
    });

    it('flags an off-cycle of the same amount sent after the pay date as a possible repayment', () => {
      const payDateMs = Date.parse('2026-07-31T00:00:00Z');
      const offCycles = [
        { id: 'before', total: 135, status: 'sent_to_everee', createdAtMs: payDateMs - 86400e3 },
        { id: 'failed', total: 135, status: 'error', createdAtMs: payDateMs + 86400e3 },
        { id: 'other', total: 90, status: 'sent_to_everee', createdAtMs: payDateMs + 86400e3 },
        { id: 'hit', total: 135, status: 'sent_to_everee', createdAtMs: payDateMs + 7 * 86400e3 },
      ];
      expect(findPossibleRepayment({ amount: 135, payDate: '2026-07-31', offCycles })?.id).to.equal('hit');
      expect(findPossibleRepayment({ amount: 135, payDate: '2026-07-31', offCycles: offCycles.slice(0, 3) })).to.equal(null);
    });
  });
});
