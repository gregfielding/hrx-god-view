/**
 * AI certification scan — verification block stored on
 * `users/{uid}/certification_records/{id}.aiVerification` (Greg 2026-09-08:
 * "We need to use AI" for reading uploaded cards). Written only by the
 * server (`onCertificationRecordWrittenScan`); clients read it to show a
 * status and reviewers read it to decide quickly.
 *
 * Runtime-neutral: no firebase imports. Timestamps are `unknown` on this
 * shape; callers convert on read.
 *
 * @see functions/src/certifications/certificationVerdict.ts (decision rules)
 * @see docs/claude/project_certification_scan.md
 */

/** Bump when the prompt or schema changes so old scans re-run on the next write. */
export const CERTIFICATION_SCAN_PROMPT_VERSION = 1;

export type CertificationScanStatus = 'pending' | 'complete' | 'error' | 'unsupported';

export type CertificationScanVerdict = 'auto_approve' | 'auto_reject' | 'needs_review';

/**
 * Why the scan landed where it did. Doubles as the worker-facing rejection
 * reason key (`review.rejectionReason`) when a scan or a reviewer rejects.
 */
export type CertificationScanReasonCode =
  | 'looks_valid'
  | 'unreadable'
  | 'not_a_certificate'
  | 'wrong_credential'
  | 'name_mismatch'
  | 'expired'
  | 'expiration_missing'
  | 'tampering_suspected'
  | 'low_confidence'
  | 'file_unsupported'
  | 'scan_error'
  | 'manual_override'
  | 'other';

export type CertificationScanConfidence = 'high' | 'medium' | 'low';
export type CertificationScanTriState = 'yes' | 'no' | 'unsure';

/** Exactly what the model reports about the document. Nulls mean "not found", never guesses. */
export type CertificationAiExtractionV1 = {
  documentReadable: boolean;
  /** True for the credential itself (card / certificate); false for receipts, course pages, enrollment emails, random photos. */
  isCertificateOrCard: boolean;
  /** One line: what the document is, in the model's words. */
  documentDescription: string;
  matchesClaimedCredential: CertificationScanTriState;
  holderName: string | null;
  holderNameMatchesWorker: CertificationScanTriState;
  issuer: string | null;
  /** State / county / country printed on the document, when present. */
  issuingJurisdiction: string | null;
  /** e.g. "ANSI", "ANAB", "TABC-approved". */
  accreditation: string | null;
  certificateNumber: string | null;
  /** YYYY-MM-DD or null. */
  issueDate: string | null;
  /** YYYY-MM-DD or null. */
  expirationDate: string | null;
  /** Empty when nothing looks edited. */
  tamperingSignals: string[];
  confidence: CertificationScanConfidence;
  /** One or two sentences for the human reviewer. */
  reviewerNotes: string;
};

export type CertificationAiVerificationV1 = {
  status: CertificationScanStatus;
  verdict: CertificationScanVerdict | null;
  reasonCode: CertificationScanReasonCode | null;
  extracted: CertificationAiExtractionV1 | null;
  /** storagePath (preferred) or storageUrl of the evidence file that was scanned. */
  evidenceKey: string;
  model: string | null;
  promptVersion: number;
  requestedAt?: unknown;
  scannedAt?: unknown;
  error?: { code: string; message: string } | null;
  tokens?: { input: number; output: number } | null;
};

/** English labels for reviewer chips and audit lines. Worker copy lives in i18n / server notify. */
export const CERTIFICATION_SCAN_REASON_LABELS: Record<CertificationScanReasonCode, string> = {
  looks_valid: 'Looks valid',
  unreadable: 'Photo unreadable',
  not_a_certificate: 'Not the certificate itself',
  wrong_credential: 'Different credential than claimed',
  name_mismatch: 'Name does not match worker',
  expired: 'Expired',
  expiration_missing: 'No expiration found',
  tampering_suspected: 'Possible editing',
  low_confidence: 'Low confidence read',
  file_unsupported: 'File type not supported',
  scan_error: 'Scan failed',
  manual_override: 'Reviewer decision',
  other: 'Other',
};
