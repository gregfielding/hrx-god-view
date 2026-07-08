/**
 * **Fieldglass parser (FG Slice 2) — pure email → event extraction.**
 *
 * Built against real SAP Fieldglass "New Job Posting submitted"
 * notification emails from the Sodexo program (July 2026 samples:
 * SDXOJP00186302 Utility Worker / PSH Lancaster, SDXOJP00185856
 * Dishroom-Lead / Fannie Mae Plano). Regex-only for now — the emails are
 * rigidly templated label/value blocks, so regex covers everything except
 * free-form wage prose, and even that follows a stable "$X as the hourly
 * wage" phrasing. An LLM fallback (mirroring the Indeed Flex parser's
 * hybrid mode) can be added when real-world variance shows up.
 *
 * Pure: no IO. Reuses the Indeed Flex normalization helpers (stripHtml
 * etc. — pure functions, provider-agnostic despite the module path).
 */

import {
  collapseWhitespace,
  decodeEntities,
  stripHtml,
} from '../indeedFlex/parser/normalizeEmail';
import type { FieldglassNewJobPostingEvent } from './types';

/** Sodexo rate card: bill = pay × 1.56 (Greg, 2026-07-06 — verified against
 *  Fieldglass Rate Details: ST 18.44 pay → 28.84 bill = 1.564). */
export const SODEXO_BILL_MARKUP = 1.56;

export interface FieldglassParseSuccess {
  ok: true;
  kind: 'new_posting';
  event: FieldglassNewJobPostingEvent;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

/** A closure/cancellation/withdrawal notice. Patterns are ANTICIPATORY —
 *  no real closure email observed yet (2026-07-08) — so classification is
 *  deliberately conservative: an explicit closure phrase adjacent to "job
 *  posting" AND an extractable posting id are both required. The trigger
 *  adds a third gate (acts only on orders HRX already tracks) and
 *  announces every close via the recruiter alert SMS, so a surprise
 *  format can't close anything silently. Harden against the real sample
 *  when the first one lands (stored raw on the ingest event either way). */
export interface FieldglassClosureParseSuccess {
  ok: true;
  kind: 'closure';
  jobPostingId: string;
  title?: string;
  /** Matched phrase ("closed" / "cancelled" / "withdrawn") for audit. */
  closurePhrase: string;
}

export interface FieldglassParseFailure {
  ok: false;
  /** `unclassified` = subject isn't a new-posting or closure notification
   *  (could be an update/revision notice — extractors for those are future
   *  work); `no_body` = nothing to parse; `missing_posting_id` = looked
   *  like a new-posting email but no SDXO id anywhere. */
  reason: 'unclassified' | 'no_body' | 'missing_posting_id';
}

export type FieldglassParseResult =
  | FieldglassParseSuccess
  | FieldglassClosureParseSuccess
  | FieldglassParseFailure;

/** "New Job Posting submitted [Job Posting ID: SDXOJP00185856, Job Posting
 *  Title: Dishroom - Lead]" — id + title are extractable from the subject
 *  alone, which survives even aggressive HTML mangling. */
const SUBJECT_RE =
  /new\s+job\s+posting\s+submitted\s*\[\s*job\s+posting\s+id:\s*([A-Z0-9]+)\s*,\s*job\s+posting\s+title:\s*([^\]]+?)\s*\]/i;

/** Posting ids look like SDXOJP00186302 (buyer prefix + JP + digits). Used
 *  as a body-side fallback when the subject was rewritten by a forwarder. */
const POSTING_ID_RE = /\b([A-Z]{2,6}JP\d{6,12})\b/;

const DETAIL_URL_RE =
  /https:\/\/[^\s"'<>]*fieldglass[^\s"'<>]*job_posting_detail\.do[^\s"'<>]*/i;

/** Closure phrasing near "job posting" — subject or body. Kept tight
 *  (adjacency + passive voice in the body form) so prose like "the cafe
 *  closed early" in a Comments block can't classify a live order closed. */
const CLOSURE_SUBJECT_RE =
  /job\s+posting\b[^\n]{0,120}?\b(?:has\s+been\s+|was\s+|is\s+)?(closed|cancell?ed|withdrawn)\b/i;
const CLOSURE_BODY_RE =
  /job\s+posting\b[\s\S]{0,160}?\bhas\s+been\s+(closed|cancell?ed|withdrawn)\b/i;
/** "Job Posting ID: SDXOJP00186302" — works in subject brackets or body. */
const POSTING_ID_LABEL_RE = /job\s+posting\s+id\s*:\s*([A-Z0-9]+)/i;

/** "$16.36 as the hourly wage" / "offered $16.36" / "$16.36/hr". */
const WAGE_RES: RegExp[] = [
  /\$\s*(\d{1,3}(?:\.\d{1,2})?)\s+as\s+the\s+hourly\s+wage/i,
  /offered\s+\$\s*(\d{1,3}(?:\.\d{1,2})?)/i,
  /\$\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|per\s+)(?:hr|hour)/i,
];

/**
 * Pull the value that follows a printed label in the normalized body.
 * The emails render as "Label\nValue\nNextLabel\n..." once HTML is
 * stripped; values run until the next known label or a blank-ish gap.
 */
function extractLabeledValue(body: string, label: string, stopLabels: string[]): string | undefined {
  const stop = stopLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${labelEsc}\\s*[:\\n]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stop})\\s*[:\\n]|$)`, 'i');
  const m = body.match(re);
  if (!m) return undefined;
  const value = collapseWhitespace(m[1]).trim();
  // "-" is Fieldglass's rendering of an empty field (Job Posting Owner: -).
  if (!value || value === '-' || value === '—') return undefined;
  return value;
}

const LABELS = [
  'Job Posting ID',
  'Job Posting Title',
  'Description',
  'Job Posting Start Date',
  'Job Posting End Date',
  'Business Unit',
  'Site',
  'Location',
  'Job Posting Owner',
  'Comments To Supplier',
  'Posting Information',
  'Comments',
  'Details',
  'This notification was sent by the SAP Fieldglass system',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseFieldglassEmail(input: {
  subject: string;
  text?: string;
  html?: string;
}): FieldglassParseResult {
  const rawBody = input.html ? stripHtml(input.html) : input.text ?? '';
  if (!rawBody.trim() && !input.subject.trim()) return { ok: false, reason: 'no_body' };
  // Cut the SAP footer ("This notification was sent by the SAP Fieldglass
  // system…") — it directly follows the Comments block and otherwise bleeds
  // into the last extracted value.
  const body = decodeEntities(rawBody).split(
    /this notification was sent by the sap fieldglass system/i,
  )[0];

  const subjectMatch = input.subject.match(SUBJECT_RE);
  const looksLikeNewPosting =
    Boolean(subjectMatch) ||
    (/new\s+job\s+posting\s+has\s+been\s+submitted/i.test(body) && POSTING_ID_RE.test(body));
  if (!looksLikeNewPosting) {
    // Closure notice? (checked second — the new-posting subject is far more
    // specific, and a new-posting email can legitimately mention "closed"
    // in its Close Details block.)
    const closureMatch =
      input.subject.match(CLOSURE_SUBJECT_RE) ?? body.match(CLOSURE_BODY_RE);
    if (closureMatch) {
      // Every candidate is re-validated against the strict id shape — the
      // labeled-value extractor can drag trailing prose along with the id.
      const idCandidate =
        input.subject.match(POSTING_ID_LABEL_RE)?.[1]?.trim() ||
        extractLabeledValue(body, 'Job Posting ID', LABELS) ||
        input.subject.match(POSTING_ID_RE)?.[1] ||
        body.match(POSTING_ID_RE)?.[1];
      const closureId = idCandidate?.match(POSTING_ID_RE)?.[1];
      if (closureId) {
        const closureTitle =
          extractLabeledValue(body, 'Job Posting Title', LABELS) ?? undefined;
        return {
          ok: true,
          kind: 'closure',
          jobPostingId: closureId,
          ...(closureTitle ? { title: closureTitle } : {}),
          closurePhrase: closureMatch[1].toLowerCase(),
        };
      }
      // Closure phrase but no id → fall through to unclassified so the
      // recruiter alert flags it and the raw sample gets collected.
    }
    return { ok: false, reason: 'unclassified' };
  }

  const jobPostingId =
    subjectMatch?.[1]?.trim() ||
    extractLabeledValue(body, 'Job Posting ID', LABELS) ||
    body.match(POSTING_ID_RE)?.[1];
  if (!jobPostingId) return { ok: false, reason: 'missing_posting_id' };

  const title =
    subjectMatch?.[2]?.trim() || extractLabeledValue(body, 'Job Posting Title', LABELS);
  const description = extractLabeledValue(body, 'Description', LABELS);
  const startDate = extractLabeledValue(body, 'Job Posting Start Date', LABELS);
  const endDate = extractLabeledValue(body, 'Job Posting End Date', LABELS);
  const businessUnit = extractLabeledValue(body, 'Business Unit', LABELS);
  const siteName = extractLabeledValue(body, 'Site', LABELS);
  const locationName = extractLabeledValue(body, 'Location', LABELS);
  const commentsToSupplier = extractLabeledValue(body, 'Comments To Supplier', LABELS);
  const detailUrl = body.match(DETAIL_URL_RE)?.[0] ?? input.html?.match(DETAIL_URL_RE)?.[0];

  let payRate: number | undefined;
  for (const re of WAGE_RES) {
    const m = (commentsToSupplier ?? body).match(re);
    if (m) {
      const parsed = Number(m[1]);
      if (Number.isFinite(parsed) && parsed > 5 && parsed < 500) {
        payRate = parsed;
        break;
      }
    }
  }

  const event: FieldglassNewJobPostingEvent = {
    type: 'new_job_posting',
    jobPostingId,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(businessUnit ? { businessUnit } : {}),
    ...(siteName ? { siteName } : {}),
    ...(locationName ? { locationName } : {}),
    ...(commentsToSupplier ? { commentsToSupplier } : {}),
    ...(payRate !== undefined ? { payRate, billRateDerived: round2(payRate * SODEXO_BILL_MARKUP) } : {}),
    ...(detailUrl ? { detailUrl } : {}),
  };

  const confidence: 'high' | 'medium' | 'low' =
    title && siteName && startDate && endDate ? 'high' : title ? 'medium' : 'low';

  const missing = ['title', 'siteName', 'startDate', 'endDate', 'payRate'].filter(
    (k) => (event as unknown as Record<string, unknown>)[k] === undefined,
  );

  return {
    ok: true,
    kind: 'new_posting',
    event,
    confidence,
    ...(missing.length > 0 ? { notes: `missing: ${missing.join(', ')}` } : {}),
  };
}
