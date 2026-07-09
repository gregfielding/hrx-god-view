/**
 * **Indeed Flex parser — subject-based event classification.**
 *
 * Indeed Flex's notification subjects are templated, so the subject
 * line alone is usually enough to classify the event type. This
 * module returns the type as a string the per-type extractors switch
 * on; when the subject is unrecognized we return `null` and the
 * orchestrator falls back to the body text (and ultimately the LLM
 * if regex misses too).
 *
 * Subjects we've observed in the wild (from the original brief +
 * captured samples):
 *
 *   - "New job request starting soon — Job 509668"
 *   - "Booking change — Job 509668"
 *   - "We have removed the following bookings"
 *   - "Your assigned worker <name> did not turn up"
 *   - "Daily Brief: Allocations & Priorities"
 *
 * Pure, no IO. Tested against captured email subjects.
 */

import type { IndeedFlexEventType } from '../../../shared/indeedFlex/types';

interface ClassifyInput {
  subject: string;
  /** Optional — when the body mentions specific keywords (e.g.
   *  "removed the following bookings" or "did not turn up"), use it
   *  to disambiguate when the subject is generic. */
  bodyHint?: string;
}

/**
 * Classify the inbound email to an `IndeedFlexEventType`. Returns
 * `null` when the subject + body don't match any known pattern;
 * callers fall back to LLM classification at that point.
 *
 * **`change_headcount` vs `change_time`** — both share the "Booking
 * change" subject. We use the body hint to disambiguate: a headcount
 * change includes phrases like "Number of workers" or "headcount
 * changed"; a time change includes "Start time" / "End time". When
 * neither hint matches but the subject is "Booking change", we
 * default to `change_time` (the more common case) and let the
 * extractor's confidence flag the ambiguity.
 */
export function classifyEvent(input: ClassifyInput): IndeedFlexEventType | null {
  const subject = (input.subject ?? '').toLowerCase();
  const bodyHint = (input.bodyHint ?? '').toLowerCase();

  // `new_request` — "New job request"
  if (/\bnew job request\b/.test(subject)) {
    return 'new_request';
  }

  // `cancel_booking` — "removed the following bookings" / "cancelled" /
  // live-format "Your upcoming bookings have been removed" (2026-07-08).
  if (
    /\bremoved the following\b/.test(subject) ||
    /\bbookings have been removed\b/.test(subject) ||
    /\bbooking cancel/.test(subject) ||
    /\bcanceled\b/.test(subject) ||
    /\bcancelled\b/.test(subject)
  ) {
    return 'cancel_booking';
  }

  // Live-format change notices (2026-07-08):
  //   "Some of your upcoming bookings have been changed"
  //   "Some of the details for your Job 528091 have changed."
  // Disambiguate headcount vs time from the body ("Workers required
  // now: 1" appears only on headcount changes).
  if (
    /\bbookings have been changed\b/.test(subject) ||
    /\bdetails for your job\b/.test(subject)
  ) {
    if (/\bworkers required now\b/.test(bodyHint)) {
      return 'change_headcount';
    }
    return 'change_time';
  }

  // `no_show` — "did not turn up" / "no show"
  if (/\bdid not turn up\b/.test(subject) || /\bno[\s-]?show\b/.test(subject)) {
    return 'no_show';
  }

  // `daily_digest_expired` — "Daily Brief" / "Allocations & Priorities"
  if (/\bdaily brief\b/.test(subject) || /\ballocations\b.*\bpriorities\b/.test(subject)) {
    return 'daily_digest_expired';
  }

  // `change_headcount` vs `change_time` — both under "Booking change"
  if (/\bbooking change\b/.test(subject) || /\bjob.*change\b/.test(subject)) {
    // Disambiguate from body.
    if (
      /\bnumber of workers\b/.test(bodyHint) ||
      /\bheadcount changed\b/.test(bodyHint) ||
      /\bworkers needed\b/.test(bodyHint) ||
      /\bworkers required\b/.test(bodyHint)
    ) {
      return 'change_headcount';
    }
    if (
      /\bstart time\b/.test(bodyHint) ||
      /\bend time\b/.test(bodyHint) ||
      /\bshift time\b/.test(bodyHint) ||
      /\btime changed\b/.test(bodyHint)
    ) {
      return 'change_time';
    }
    // Default to change_time (the more common case) when ambiguous;
    // extractor confidence will flag it.
    return 'change_time';
  }

  return null;
}
