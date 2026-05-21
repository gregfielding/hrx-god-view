/**
 * Client-side typed wrappers for the timesheet-batch lifecycle.
 *
 *   createTimesheetBatch  → validates entries, creates the batch doc
 *                           with status='pending', returns batchId.
 *   submitTimesheetBatch  → kicks the Slice 6b orchestrator on an
 *                           existing pending batch.
 *
 * The recruiter-facing "Submit X to Everee" button calls these in
 * sequence. Two callables (rather than a single create-and-submit)
 * keeps the orchestrator's retry path clean — submitTimesheetBatch
 * works the same whether the batch was just created or has been
 * sitting at status='pending' for a while.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../firebase';

const REGION = 'us-central1';

// ─────────────────────────────────────────────────────────────────────
// createTimesheetBatch
// ─────────────────────────────────────────────────────────────────────

export type CreateTimesheetBatchScope =
  | {
      kind: 'entity_period';
      periodStart: string;
      periodEnd: string;
    }
  | { kind: 'shift'; refId: string }
  | {
      kind: 'jobOrder';
      refId: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | {
      kind: 'account';
      refId: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | { kind: 'day'; date: string; hiringEntityId?: string }
  | {
      kind: 'worker';
      workerId: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'manual';
      periodStart?: string;
      periodEnd?: string;
    };

export interface CreateTimesheetBatchRequest {
  tenantId: string;
  hiringEntityId: string;
  entryIds: string[];
  scope: CreateTimesheetBatchScope;
}

export interface CreateTimesheetBatchResult {
  batchId: string;
  totals: {
    workerCount: number;
    totalRegularHours: number;
    totalOTHours: number;
    totalGrossPay: number;
    totalGrossBill: number;
  };
}

export const createTimesheetBatch = httpsCallable<
  CreateTimesheetBatchRequest,
  CreateTimesheetBatchResult
>(getFunctions(app, REGION), 'createTimesheetBatch');

// ─────────────────────────────────────────────────────────────────────
// submitTimesheetBatch
// ─────────────────────────────────────────────────────────────────────

export interface SubmitTimesheetBatchRequest {
  tenantId: string;
  batchId: string;
}

export interface SubmitTimesheetBatchResult {
  batchId: string;
  enqueuedEntryCount: number;
  preflightErrorCount: number;
  status: 'submitting' | 'failed';
}

export const submitTimesheetBatch = httpsCallable<
  SubmitTimesheetBatchRequest,
  SubmitTimesheetBatchResult
>(getFunctions(app, REGION), 'submitTimesheetBatch');
