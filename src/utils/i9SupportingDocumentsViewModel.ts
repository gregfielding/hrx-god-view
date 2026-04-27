import { Timestamp } from 'firebase/firestore';
import {
  hasApprovedListA,
  hasApprovedListB,
  hasApprovedListC,
  i9DocumentsFromFirestoreRows,
  i9ListGroupForDocumentType,
  isI9DocumentSetComplete,
} from './i9SupportingDocumentCompletion';
import { labelForI9SupportingDocumentType } from '../constants/i9SupportingDocumentUi';

/** Admin Employment I-9 block — system-driven model (no “not requested” / slot-request framing). */
export type I9EmploymentDocsSubstatus = 'not_started' | 'under_review' | 'action_needed' | 'complete';

function millisFromUnknown(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as Timestamp).toMillis === 'function') {
    try {
      return (value as Timestamp).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

export type I9SupportingDocumentsEmploymentViewModel = {
  substatus: I9EmploymentDocsSubstatus;
  substatusLabel: string;
  documentSetComplete: boolean;
  hasApprovedListA: boolean;
  hasApprovedListB: boolean;
  hasApprovedListC: boolean;
  requestCount: number;
  pendingReviewCount: number;
  rejectedCount: number;
  awaitingUploadCount: number;
  approvedCount: number;
  latestUploadedAtLabel: string;
  latestReviewedAtLabel: string;
  latestRejectionReason: string | null;
  stillNeededLines: string[];
  uploadedSummaryLines: string[];
  /** Employment compact block only: framing copy for multi-row / mixed states. */
  compactContextLines: string[];
};

function formatTs(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

export function buildI9SupportingDocumentsEmploymentViewModel(
  rows: Array<{ id: string; data: Record<string, unknown> }>,
  opts?: { i9EmployeeSectionComplete?: boolean; i9SupportingManualComplete?: boolean },
): I9SupportingDocumentsEmploymentViewModel {
  const i9DoneElsewhere = opts?.i9EmployeeSectionComplete === true;
  const manualEmployerConfirm = opts?.i9SupportingManualComplete === true;
  const requestCount = rows.length;
  const docs = i9DocumentsFromFirestoreRows(rows);
  const documentSetComplete = isI9DocumentSetComplete(docs);
  const ha = hasApprovedListA(docs);
  const hb = hasApprovedListB(docs);
  const hc = hasApprovedListC(docs);

  let pendingReviewCount = 0;
  let rejectedCount = 0;
  let awaitingUploadCount = 0;
  let approvedCount = 0;
  let latestUploadMs = 0;
  let latestUploadAt: unknown = null;
  let latestReviewMs = 0;
  let latestReviewedAt: unknown = null;
  let latestRejectionReason: string | null = null;

  for (const { data } of rows) {
    const st = String(data.status || '').toLowerCase();
    if (st === 'pending_review') pendingReviewCount += 1;
    if (st === 'rejected') {
      rejectedCount += 1;
      const rr = String(data.rejectionReason || '').trim();
      if (rr) latestRejectionReason = rr;
    }
    if (st === 'awaiting_upload' && !String(data.storagePath || '').trim()) awaitingUploadCount += 1;
    if (st === 'approved') approvedCount += 1;

    const up = millisFromUnknown(data.uploadedAt);
    if (up > latestUploadMs) {
      latestUploadMs = up;
      latestUploadAt = data.uploadedAt;
    }
    const rv = millisFromUnknown(data.reviewedAt);
    if (rv > latestReviewMs) {
      latestReviewMs = rv;
      latestReviewedAt = data.reviewedAt;
    }
  }

  let substatus: I9EmploymentDocsSubstatus;
  if (manualEmployerConfirm) {
    substatus = 'complete';
  } else if (documentSetComplete) {
    substatus = 'complete';
  } else if (pendingReviewCount > 0) {
    substatus = 'under_review';
  } else if (rejectedCount > 0) {
    substatus = 'action_needed';
  } else {
    substatus = 'not_started';
  }

  const substatusLabels: Record<I9EmploymentDocsSubstatus, string> = {
    not_started: 'Not started',
    under_review: 'Under review',
    action_needed: 'Action needed',
    complete: 'Complete',
  };
  const substatusLabelResolved = manualEmployerConfirm
    ? 'Confirmed by employer'
    : substatusLabels[substatus];

  const stillNeededLines: string[] = [];
  if (manualEmployerConfirm) {
    stillNeededLines.push(
      'Supporting uploads were marked complete by your team. HRX document uploads are not required for this worker.',
    );
  } else if (documentSetComplete) {
    stillNeededLines.push('I-9 supporting document requirement satisfied.');
  } else if (hb && !hc) {
    stillNeededLines.push('Still needed: one List C document (e.g. Social Security card or birth certificate).');
  } else if (hc && !hb) {
    stillNeededLines.push('Still needed: one List B document (e.g. driver’s license or government ID).');
  } else if (i9DoneElsewhere) {
    stillNeededLines.push(
      'If you use uploads here: one List A document, or one List B and one List C (optional — for HRX review or audit).',
    );
  } else {
    stillNeededLines.push(
      'Upload one List A document, or one List B document and one List C document.',
    );
  }

  const uploadedSummaryLines: string[] = [];
  for (const { data } of rows) {
    const st = String(data.status || '').toLowerCase();
    if (!String(data.storagePath || '').trim()) continue;
    const dt = String(data.documentType || '');
    const g = i9ListGroupForDocumentType(dt);
    if (g === 'other') continue;
    const listLabel = g === 'a' ? 'List A' : g === 'b' ? 'List B' : 'List C';
    const name = labelForI9SupportingDocumentType(dt);
    uploadedSummaryLines.push(`Uploaded: ${name} (${listLabel})${st === 'pending_review' ? ' — under review' : st === 'approved' ? ' — approved' : st === 'rejected' ? ' — rejected' : ''}`);
  }

  const compactContextLines: string[] = [];
  if (requestCount > 1) {
    compactContextLines.push(
      `This worker has ${requestCount} separate document requests. Each line below is one request.`,
    );
  }
  if (pendingReviewCount > 0 && rejectedCount > 0) {
    compactContextLines.push(
      rejectedCount === 1
        ? 'One document was rejected and may need replacement; others are still under review.'
        : 'Some documents were rejected and may need replacement; others are still under review.',
    );
  }

  return {
    substatus,
    substatusLabel: substatusLabelResolved,
    documentSetComplete,
    hasApprovedListA: ha,
    hasApprovedListB: hb,
    hasApprovedListC: hc,
    requestCount,
    pendingReviewCount,
    rejectedCount,
    awaitingUploadCount,
    approvedCount,
    latestUploadedAtLabel: latestUploadMs > 0 ? formatTs(latestUploadAt) : '—',
    latestReviewedAtLabel: latestReviewMs > 0 ? formatTs(latestReviewedAt) : '—',
    latestRejectionReason,
    stillNeededLines,
    uploadedSummaryLines,
    compactContextLines,
  };
}
