/**
 * Client-side typed wrapper around `userGroupBulkInviteCandidates`.
 *
 * Mirrors the request/response shapes from the server callable so the
 * dialog component gets full type-safety. Used by
 * `BulkInviteFromCsvDialog.tsx` on the user-group detail page.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../firebase';

const REGION = 'us-central1';

export interface BulkInviteCandidateInput {
  /** Display name from the CSV (e.g. "Cornelius Broadway"). */
  name: string;
  /** Phone — client should pass in any normalize-able shape; server
   *  re-validates and converts to E.164 before sending. */
  phone: string;
  /** Optional Indeed candidate hash / external id. Stamped on the
   *  idempotency doc for audit / attribution. */
  externalId?: string;
}

export interface BulkInviteRequest {
  tenantId: string;
  groupId: string;
  applyUrl: string;
  candidates: BulkInviteCandidateInput[];
  /** True to validate + report what would happen without sending. */
  dryRun?: boolean;
}

export type BulkInviteRowStatus =
  | 'sent'
  | 'skipped_already_sent'
  | 'skipped_bad_phone'
  | 'skipped_no_phone'
  | 'skipped_no_name'
  | 'twilio_error'
  | 'preview';

export interface BulkInviteRowResult {
  name: string;
  phone: string;
  status: BulkInviteRowStatus;
  twilioSid?: string;
  error?: string;
}

export interface BulkInviteResponse {
  aggregate: {
    rowsReceived: number;
    sent: number;
    skippedAlreadySent: number;
    skippedBadPhone: number;
    skippedNoPhone: number;
    skippedNoName: number;
    twilioError: number;
    previewed: number;
  };
  results: BulkInviteRowResult[];
  appliedUrl: string;
  dryRun: boolean;
}

export const userGroupBulkInviteCandidates = httpsCallable<
  BulkInviteRequest,
  BulkInviteResponse
>(getFunctions(app, REGION), 'userGroupBulkInviteCandidates');
