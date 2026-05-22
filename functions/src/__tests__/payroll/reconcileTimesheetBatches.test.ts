/**
 * Slice 7 unit tests — pure status-mapping helpers from
 * `reconcileTimesheetBatches`. The Firestore-touching sweep is
 * exercised by integration tests once a stuck batch shows up.
 */

import { expect } from 'chai';

import {
  mapEvereeStatusToEntryStatus,
  rollupPayableStatuses,
} from '../../payroll/reconcileTimesheetBatches';

describe('mapEvereeStatusToEntryStatus', () => {
  it('PAID → paid', () => {
    expect(mapEvereeStatusToEntryStatus('PAID')).to.equal('paid');
  });

  it('COMPLETED → paid (Everee variant)', () => {
    expect(mapEvereeStatusToEntryStatus('COMPLETED')).to.equal('paid');
  });

  it('ERROR → error', () => {
    expect(mapEvereeStatusToEntryStatus('ERROR')).to.equal('error');
  });

  it('RETURNED → error (deposit returned)', () => {
    expect(mapEvereeStatusToEntryStatus('RETURNED')).to.equal('error');
  });

  it('UNPAYABLE_WORKER → error', () => {
    expect(mapEvereeStatusToEntryStatus('UNPAYABLE_WORKER')).to.equal('error');
  });

  it('PENDING → null (still in-flight)', () => {
    expect(mapEvereeStatusToEntryStatus('PENDING')).to.be.null;
  });

  it('IN_PROGRESS / SCHEDULED / SUBMITTED → null', () => {
    expect(mapEvereeStatusToEntryStatus('IN_PROGRESS')).to.be.null;
    expect(mapEvereeStatusToEntryStatus('SCHEDULED')).to.be.null;
    expect(mapEvereeStatusToEntryStatus('SUBMITTED')).to.be.null;
  });

  it('undefined / empty → null', () => {
    expect(mapEvereeStatusToEntryStatus(undefined)).to.be.null;
    expect(mapEvereeStatusToEntryStatus('')).to.be.null;
  });

  it('case-insensitive + whitespace tolerant', () => {
    expect(mapEvereeStatusToEntryStatus('  paid  ')).to.equal('paid');
    expect(mapEvereeStatusToEntryStatus('Error')).to.equal('error');
  });

  it('unknown values → null (conservative — no false-terminal)', () => {
    expect(mapEvereeStatusToEntryStatus('EXOTIC_NEW_VALUE')).to.be.null;
  });
});

describe('rollupPayableStatuses', () => {
  it('all PAID → paid', () => {
    expect(rollupPayableStatuses(['PAID', 'PAID', 'PAID'])).to.equal('paid');
  });

  it('mixed PAID + PENDING → null (wait for all)', () => {
    expect(rollupPayableStatuses(['PAID', 'PENDING'])).to.be.null;
  });

  it('any ERROR wins — even when other items paid', () => {
    expect(rollupPayableStatuses(['PAID', 'ERROR', 'PAID'])).to.equal('error');
  });

  it('RETURNED counts as error', () => {
    expect(rollupPayableStatuses(['PAID', 'RETURNED'])).to.equal('error');
  });

  it('UNPAYABLE_WORKER counts as error', () => {
    expect(rollupPayableStatuses(['PAID', 'UNPAYABLE_WORKER'])).to.equal('error');
  });

  it('all PENDING → null', () => {
    expect(rollupPayableStatuses(['PENDING', 'IN_PROGRESS', 'SCHEDULED'])).to.be.null;
  });

  it('empty array → null', () => {
    expect(rollupPayableStatuses([])).to.be.null;
  });

  it('mixed terminal + null', () => {
    // PAID + empty (unknown) → not all paid → null
    expect(rollupPayableStatuses(['PAID', '', 'PAID'])).to.be.null;
    // ERROR + PENDING → error wins
    expect(rollupPayableStatuses(['ERROR', 'PENDING'])).to.equal('error');
  });
});
