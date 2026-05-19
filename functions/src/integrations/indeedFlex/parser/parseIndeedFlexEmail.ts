/**
 * **Indeed Flex parser — top-level orchestrator.**
 *
 * The entrypoint Slice 2's Firestore trigger calls. Takes a raw
 * (Slice 1) ingest event and returns the typed events the trigger
 * writes to `external_shift_requests`.
 *
 * Pipeline:
 *
 *   1. `normalizeEmailBody` — pick HTML or text, strip tags, decode
 *      entities, trim footer + reply chains, collapse whitespace.
 *   2. `classifyEvent` — subject (+ body hint) → `IndeedFlexEventType`.
 *   3. Per-type regex extractor — `extractNewRequest`, etc.
 *   4. If `missingFields` is non-empty AND the LLM is available, call
 *      `llmExtract` to fill them in. Merged event + notes returned.
 *   5. Confidence rolls up from the count of fields the LLM provided.
 *
 * **One email → many events.** Today, only `daily_digest_expired`
 * actually produces multiple events; every other type is single-event.
 * The function returns an array so the trigger can write one
 * `external_shift_requests` row per event without special-casing the
 * digest path.
 *
 * **Failure modes:**
 *   - `classifyEvent` returns null → returns `events: []` + `reason:
 *     'unclassified'`. Trigger flips source to `parse_failed`.
 *   - Regex extracted nothing AND LLM unavailable → returns the
 *     low-confidence regex event with `parseSource: 'regex'`. Trigger
 *     still writes it; recruiter reviews.
 *   - LLM throws → caught, downgrades to regex-only result with
 *     a note.
 */

import type {
  IndeedFlexEvent,
  IndeedFlexEventType,
  ExternalShiftRequestConfidence,
  ExternalShiftRequestParseSource,
} from '../../../shared/indeedFlex/types';

import { classifyEvent } from './classifyEvent';
import {
  extractCancelBooking,
  extractChangeHeadcount,
  extractChangeTime,
  extractDailyDigestExpired,
  extractNewRequest,
  extractNoShow,
  type ExtractionResult,
} from './extractFields';
import { llmExtract, type OpenAILike } from './llmFallback';
import { normalizeEmailBody } from './normalizeEmail';

export interface ParseInput {
  subject: string;
  text?: string;
  html?: string;
  /** Pass a mock client in tests; production uses the lazy default. */
  llmClient?: OpenAILike;
  /** Disable the LLM fallback (always returns regex-only result).
   *  Used in tests and for cost-control debugging. */
  disableLlm?: boolean;
}

export interface ParsedEvent {
  event: IndeedFlexEvent;
  confidence: ExternalShiftRequestConfidence;
  parseSource: ExternalShiftRequestParseSource;
  /** Free-form. Set when LLM was used or when something looked off. */
  notes?: string;
}

export interface ParseResult {
  events: ParsedEvent[];
  /** Set when classification failed. Trigger uses this to mark the
   *  source ingest event as `parse_failed`. */
  reason?: 'unclassified' | 'no_body';
}

// ─────────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────────

export async function parseIndeedFlexEmail(input: ParseInput): Promise<ParseResult> {
  const body = normalizeEmailBody({ text: input.text, html: input.html });
  if (!body.trim()) {
    return { events: [], reason: 'no_body' };
  }

  const eventType = classifyEvent({ subject: input.subject, bodyHint: body });
  if (!eventType) {
    return { events: [], reason: 'unclassified' };
  }

  const raw = extractByType(eventType, body);

  // For digests, every "expired job" is its own logical event; the
  // recruiter UI's "approve" surface fans out per job. The single
  // ParsedEvent here represents the whole digest.
  const needsLlm = raw.missingFields.length > 0 && !input.disableLlm;

  if (!needsLlm) {
    return {
      events: [
        {
          event: raw.event,
          confidence: 'high',
          parseSource: 'regex',
        },
      ],
    };
  }

  // Try the LLM. On error, downgrade to regex-only with a note.
  try {
    const result = await llmExtract({
      eventType,
      partial: raw.event,
      missingFields: raw.missingFields,
      normalizedBody: body,
      client: input.llmClient,
    });
    const confidence = computeConfidence({
      missingBefore: raw.missingFields.length,
      filledByLlm: result.filledFields.length,
    });
    return {
      events: [
        {
          event: result.event,
          confidence,
          parseSource: 'hybrid',
          notes: combineNotes([
            `regex missed: ${raw.missingFields.join(', ')}`,
            result.filledFields.length > 0
              ? `llm filled: ${result.filledFields.join(', ')}`
              : 'llm filled nothing',
            result.notes,
          ]),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      events: [
        {
          event: raw.event,
          confidence: 'low',
          parseSource: 'regex',
          notes: `llm fallback failed: ${message}; ${raw.missingFields.length} field(s) still missing`,
        },
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function extractByType(
  eventType: IndeedFlexEventType,
  body: string,
): ExtractionResult<IndeedFlexEvent> {
  switch (eventType) {
    case 'new_request':
      return extractNewRequest(body);
    case 'change_headcount':
      return extractChangeHeadcount(body);
    case 'change_time':
      return extractChangeTime(body);
    case 'cancel_booking':
      return extractCancelBooking(body);
    case 'no_show':
      return extractNoShow(body);
    case 'daily_digest_expired':
      return extractDailyDigestExpired(body);
  }
}

/**
 * Confidence rule (deliberately simple):
 *
 *   - 0 missing fields after regex                        → high
 *   - 1-2 missing, all filled by LLM                       → medium
 *   - 3+ missing, OR LLM filled nothing, OR fewer filled
 *     than missing                                          → low
 *
 * Easy to tweak as we observe real-world parse quality.
 */
function computeConfidence(args: {
  missingBefore: number;
  filledByLlm: number;
}): ExternalShiftRequestConfidence {
  if (args.missingBefore === 0) return 'high';
  if (args.filledByLlm >= args.missingBefore && args.missingBefore <= 2) return 'medium';
  return 'low';
}

function combineNotes(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim()));
  return filtered.length ? filtered.join(' | ') : undefined;
}
