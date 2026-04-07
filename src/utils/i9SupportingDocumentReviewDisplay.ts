/**
 * Display + effective-value helpers for I-9 supporting document extraction vs recruiter verification.
 */
import type {
  I9DocumentExtractionBlock,
  I9DocumentReviewBlock,
  I9DocumentReviewVerifiedFields,
} from '../types/i9SupportingDocumentV1';

export type I9ReviewFieldKey = keyof I9DocumentReviewVerifiedFields;

export const I9_REVIEW_EDITABLE_FIELD_KEYS: I9ReviewFieldKey[] = [
  'fullName',
  'documentNumber',
  'dateOfBirth',
  'expirationDate',
  'issueDate',
  'issuingState',
  'issuingCountry',
];

const FIELD_LABELS: Record<I9ReviewFieldKey, string> = {
  fullName: 'Full name',
  documentNumber: 'Document number',
  dateOfBirth: 'Date of birth',
  expirationDate: 'Expiration date',
  issueDate: 'Issue date',
  issuingState: 'Issuing state',
  issuingCountry: 'Issuing country / nationality',
};

export function labelForI9ReviewField(key: I9ReviewFieldKey): string {
  return FIELD_LABELS[key] || key;
}

function extractedFullName(ef: NonNullable<I9DocumentExtractionBlock['extractedFields']>): string {
  if (ef.fullName?.trim()) return ef.fullName.trim();
  const a = [ef.firstName, ef.lastName].filter(Boolean).join(' ').trim();
  return a || '';
}

function extractedValueForKey(
  key: I9ReviewFieldKey,
  ext: I9DocumentExtractionBlock | undefined,
): string {
  const ef = ext?.extractedFields;
  if (!ef) return '';
  switch (key) {
    case 'fullName':
      return extractedFullName(ef);
    case 'documentNumber':
      return String(ef.documentNumber || '').trim();
    case 'dateOfBirth':
      return String(ef.dateOfBirth || '').trim();
    case 'expirationDate':
      return String(ef.expirationDate || '').trim();
    case 'issueDate':
      return String(ef.issueDate || '').trim();
    case 'issuingState':
      return String(ef.issuingState || '').trim();
    case 'issuingCountry':
      return String(ef.issuingCountry || '').trim();
    default:
      return '';
  }
}

/**
 * Non-empty verifiedFields[key] overrides extraction. Empty / missing key → use reader value.
 */
export function displayReviewField(
  key: I9ReviewFieldKey,
  ext: I9DocumentExtractionBlock | undefined,
  review: I9DocumentReviewBlock | undefined,
): { text: string; source: 'verified' | 'extracted' | 'none' } {
  const vf = review?.verifiedFields;
  if (vf && Object.prototype.hasOwnProperty.call(vf, key)) {
    const raw = vf[key];
    if (raw != null && String(raw).trim() !== '') {
      return { text: String(raw).trim(), source: 'verified' };
    }
  }
  const ai = extractedValueForKey(key, ext);
  if (ai) return { text: ai, source: 'extracted' };
  return { text: '—', source: 'none' };
}

/** Snapshot what the recruiter currently sees — only non-empty strings are stored (Firestore merge-friendly). */
export function verifiedFieldsSnapshotFromCurrentDisplay(
  ext: I9DocumentExtractionBlock | undefined,
  review: I9DocumentReviewBlock | undefined,
): I9DocumentReviewVerifiedFields {
  const out: I9DocumentReviewVerifiedFields = {};
  for (const key of I9_REVIEW_EDITABLE_FIELD_KEYS) {
    const { text } = displayReviewField(key, ext, review);
    if (text && text !== '—') out[key] = text.trim();
  }
  return out;
}

/** Values to seed the edit form: prefer current display (verified ?? extracted). */
export function initialFormValuesFromRow(
  ext: I9DocumentExtractionBlock | undefined,
  review: I9DocumentReviewBlock | undefined,
): Record<I9ReviewFieldKey, string> {
  const o = {} as Record<I9ReviewFieldKey, string>;
  for (const key of I9_REVIEW_EDITABLE_FIELD_KEYS) {
    const { text } = displayReviewField(key, ext, review);
    o[key] = text === '—' ? '' : text;
  }
  return o;
}

export function allExtractionWarnings(ext: I9DocumentExtractionBlock | undefined): string[] {
  if (!ext) return [];
  return [...(ext.extractionWarnings || []), ...(ext.extractedFields?.extractionWarnings || [])].filter(Boolean);
}

export function categoryHintsFromWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => /category/i.test(w));
}

export function hasPartialExtractedUsableFields(ext: I9DocumentExtractionBlock | undefined): boolean {
  if (!ext?.extractedFields) return false;
  const ef = ext.extractedFields;
  return Boolean(
    extractedFullName(ef) ||
      ef.documentNumber ||
      ef.dateOfBirth ||
      ef.expirationDate ||
      ef.issueDate ||
      ef.issuingState ||
      ef.issuingCountry ||
      ef.extractedDocumentTypeLabel,
  );
}

export function shouldShowStaffExtractionPanel(ext: I9DocumentExtractionBlock | undefined): boolean {
  if (!ext?.status) return false;
  if (ext.status === 'extraction_unsupported') return true;
  if (ext.status === 'extraction_failed') return true;
  if (ext.status === 'extraction_pending') return true;
  if (ext.status === 'extraction_complete') return true;
  return hasPartialExtractedUsableFields(ext);
}

export function isLowConfidenceExtraction(ext: I9DocumentExtractionBlock | undefined): boolean {
  const o = ext?.confidenceSummary?.overall;
  if (typeof o !== 'number' || !Number.isFinite(o)) return false;
  const norm = o <= 1 ? o : o / 100;
  return norm < 0.75;
}

/** Lines for approve dialog: verified-first for key identity fields. */
export function approveDialogSummaryLines(
  ext: I9DocumentExtractionBlock | undefined,
  review: I9DocumentReviewBlock | undefined,
): string[] {
  const lines: string[] = [];
  const name = displayReviewField('fullName', ext, review);
  const doc = displayReviewField('documentNumber', ext, review);
  const exp = displayReviewField('expirationDate', ext, review);
  if (name.text && name.text !== '—') lines.push(`Name: ${name.text}${name.source === 'verified' ? ' (verified)' : ''}`);
  if (doc.text && doc.text !== '—') lines.push(`Document #: ${doc.text}${doc.source === 'verified' ? ' (verified)' : ''}`);
  if (exp.text && exp.text !== '—') lines.push(`Expires: ${exp.text}${exp.source === 'verified' ? ' (verified)' : ''}`);
  const ef = ext?.extractedFields;
  if (ef?.extractedDocumentTypeLabel) lines.push(`Type: ${ef.extractedDocumentTypeLabel}`);
  return lines;
}
