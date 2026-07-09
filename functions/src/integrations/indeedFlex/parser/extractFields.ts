/**
 * **Indeed Flex parser — regex field extraction (per event type).**
 *
 * One function per `IndeedFlexEventType`. Each returns the extracted
 * event PLUS a `missingFields[]` array — the orchestrator uses that
 * to decide whether to invoke the LLM fallback (Slice 2 hybrid
 * strategy: regex first, LLM only when something's missing).
 *
 * The extractors are intentionally conservative — when a field is
 * ambiguous or the regex doesn't match cleanly, leave it undefined
 * and surface it in `missingFields`. False positives are worse than
 * misses because they fool the recruiter into approving a
 * misparsed action.
 *
 * Pure: no IO. Tested against captured email body samples.
 */

import type {
  IndeedFlexEvent,
  IndeedFlexEventCancelBooking,
  IndeedFlexEventChangeHeadcount,
  IndeedFlexEventChangeTime,
  IndeedFlexEventDailyDigestExpired,
  IndeedFlexEventNewRequest,
  IndeedFlexEventNoShow,
} from '../../../shared/indeedFlex/types';

/**
 * Shared shape returned by every per-type extractor. `missingFields`
 * is empty on a high-confidence extraction.
 */
export interface ExtractionResult<E extends IndeedFlexEvent> {
  event: E;
  missingFields: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Shared field extractors — used by multiple per-type extractors
// ─────────────────────────────────────────────────────────────────────

/**
 * Find the Indeed Flex Job ID in body text. The canonical line is
 * `ID: 509668` but the brief also documented `Job 509668` and
 * `Job ID 509668`. Returns the first match.
 */
export function extractJobId(body: string): string | undefined {
  const m = body.match(/\b(?:job\s*id|job|id)\s*[:#]?\s*(\d{4,8})\b/i);
  return m ? m[1] : undefined;
}

/**
 * Find a date in the body. Accepts:
 *   - YYYY-MM-DD (ISO)
 *   - MM/DD/YYYY (US, with optional leading zeros)
 *   - Mon DD, YYYY (e.g. "May 21, 2026")
 *   - DD Mon YYYY (e.g. "21 May 2026")
 *
 * Returns a YYYY-MM-DD string. Uses `Date.parse` for human forms after
 * a regex sniff so locale ambiguity (DD/MM vs MM/DD) only triggers on
 * recognized formats.
 */
export function extractDate(body: string): string | undefined {
  // ISO
  const iso = body.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // US MM/DD/YYYY
  const us = body.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }

  // "May 21, 2026" or "May 21 2026"
  const monDayYear = body.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (monDayYear) {
    const parsed = Date.parse(`${monDayYear[1]} ${monDayYear[2]}, ${monDayYear[3]}`);
    if (Number.isFinite(parsed)) {
      const d = new Date(parsed);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }

  // "21 May 2026"
  const dayMonYear = body.match(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b/i,
  );
  if (dayMonYear) {
    const parsed = Date.parse(`${dayMonYear[2]} ${dayMonYear[1]}, ${dayMonYear[3]}`);
    if (Number.isFinite(parsed)) {
      const d = new Date(parsed);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return undefined;
}

/**
 * Extract a single time field labeled by a prefix. Returns HH:mm
 * (24-hour). Handles AM/PM with optional period and `:00` omission.
 *
 *   "Start: 9am"           → "09:00"
 *   "Start time: 09:30"    → "09:30"
 *   "End time: 5:30 PM"    → "17:30"
 *
 * Pass the prefix regex without anchors; this function adds the
 * lookahead.
 */
export function extractLabeledTime(
  body: string,
  labelPattern: RegExp,
): string | undefined {
  const re = new RegExp(
    labelPattern.source +
      String.raw`\s*[:\-]?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b`,
    labelPattern.flags.includes('i') ? labelPattern.flags : labelPattern.flags + 'i',
  );
  const m = body.match(re);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = (m[3] ?? '').toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Extract a "start - end" time range like `9am - 5:30pm`. Returns both
 * sides in HH:mm. Useful when the email body shows the shift window
 * inline rather than as two labeled fields.
 */
export function extractTimeRange(
  body: string,
): { start?: string; end?: string } {
  // Strict: at least one side must carry an `am|pm` tag, or both
  // sides must carry minute fragments (`:MM`). Without this guard the
  // regex grabs hyphenated dates like `2026-05-21` as if `05` and `21`
  // were times.
  const re =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2}):(\d{2})\s*[-–to]+\s*(\d{1,2}):(\d{2})\b/i;
  const raw = body.match(re);
  if (!raw) return {};
  // Two alternations in the regex — read groups from whichever
  // alternative matched.
  const m: RegExpMatchArray = raw[1] !== undefined
    ? raw
    : ([raw[0], raw[7], raw[8], undefined, raw[9], raw[10], undefined] as unknown as RegExpMatchArray);
  const make = (h: string, mm: string | undefined, ampm: string | undefined): string | undefined => {
    let hour = Number(h);
    const minute = mm ? Number(mm) : 0;
    const tag = (ampm ?? '').toLowerCase();
    if (tag === 'pm' && hour < 12) hour += 12;
    if (tag === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };
  return {
    start: make(m[1], m[2], m[3]),
    end: make(m[4], m[5], m[6]),
  };
}

/**
 * Extract the venue / location name. Two formats:
 *
 *   1. Colon-labeled (the original brief): "Venue: <name>" /
 *      "Location: <name>" / "Site: <name>"
 *   2. **Line-labeled (2026-07-08, live-format fix)** — the real HTML
 *      emails render field tables as label/value on separate lines
 *      after `normalizeEmailBody` strips the `<td>`s:
 *
 *        Venue
 *        CHI (Mansfield, OH) - Ohio State Reformatory - SVC07/43/00
 *        100 Reformatory Rd., Mansfield 44905, US
 *
 * Returns the trimmed venue line, or undefined. (`Client` was dropped
 * from the label alternation — it's a separate field in the live
 * format, e.g. "Client\nCORT", and must not shadow the venue.)
 */
export function extractVenue(body: string): string | undefined {
  const labeled = body.match(/\b(?:venue|location|site)\s*[:\-]\s*([^\n]+)/i);
  if (labeled) return labeled[1].trim().replace(/[.,;]+$/, '');
  const lineLabeled = body.match(/^venue\s*\n+([^\n]{2,120})/im);
  if (lineLabeled) return lineLabeled[1].trim().replace(/[.,;]+$/, '');
  return undefined;
}

/**
 * Extract the street address printed on the line under the venue name
 * (live format only): "100 Reformatory Rd., Mansfield 44905, US".
 * Conservative — the candidate line must contain a digit and a comma
 * or it's discarded.
 */
export function extractVenueAddress(body: string): string | undefined {
  const m = body.match(/^venue\s*\n+[^\n]{2,120}\n+([^\n]{4,160})/im);
  if (!m) return undefined;
  const candidate = m[1].trim().replace(/[.;]+$/, '');
  if (!/\d/.test(candidate) || !candidate.includes(',')) return undefined;
  // Don't swallow the next field label ("Job requirements", etc.).
  if (/^(job requirements|potential earnings|shift|workers|accept|decline)/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

/** Same heuristic for the role / position name. Live-format addition:
 *  the role is the standalone line directly above the `ID: NNNNNN`
 *  line (e.g. "Loader / Crew\nID: 528091"). */
export function extractRole(body: string): string | undefined {
  const m = body.match(/\b(?:role|position|job\s*title|title)\s*[:\-]\s*([^\n]+)/i);
  if (m) return m[1].trim().replace(/[.,;]+$/, '');
  const aboveId = body.match(/^([^\n]{2,80})\n+ID:\s*\d{4,8}\b/im);
  if (aboveId) {
    const candidate = aboveId[1].trim().replace(/[.,;]+$/, '');
    // Reject obvious non-role lines (countdowns, labels).
    if (!/^(request|first shift|action needed|\d)/i.test(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Live-format shift date range: "Shift date\nJul 12, 2026" or
 * "Shift dates\nJul 12, 2026 - Oct 09, 2026". Returns both ends as
 * YYYY-MM-DD (end undefined for single-day). Falls back to the
 * body-wide `extractDate` when the label is absent.
 */
export function extractShiftDateRange(body: string): { start?: string; end?: string } {
  const line = body.match(/^shift dates?\s*\n+([^\n]+)/im);
  if (line) {
    const dates = Array.from(
      line[1].matchAll(
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/gi,
      ),
    ).map((m) => {
      const parsed = Date.parse(`${m[1]} ${m[2]}, ${m[3]}`);
      if (!Number.isFinite(parsed)) return undefined;
      const d = new Date(parsed);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }).filter((x): x is string => Boolean(x));
    if (dates.length > 0) {
      return { start: dates[0], end: dates.length > 1 ? dates[dates.length - 1] : undefined };
    }
  }
  const single = extractDate(body);
  return { start: single };
}

/** Headcount extraction. Looks for "Number of workers: 3" or "Workers
 *  required: 3" or just "3 workers". */
export function extractHeadcount(body: string): number | undefined {
  const labeled = body.match(
    /\b(?:number of workers|workers needed|workers required(?:\s+now)?|headcount)\s*[:\-]?\s*(\d{1,3})\b/i,
  );
  if (labeled) return Number(labeled[1]);
  return undefined;
}

/** Pay rate in USD/hr. Looks for `$XX.XX`, `XX.XX per hour`, `Pay: $XX`. */
export function extractPayRateUsd(body: string): number | undefined {
  const dollar = body.match(/\$\s*(\d+(?:\.\d{2})?)\s*(?:\/|per)\s*(?:hr|hour)/i);
  if (dollar) return Number(dollar[1]);
  const labeled = body.match(/\b(?:pay\s*rate|rate|pay)\s*[:\-]\s*\$?\s*(\d+(?:\.\d{2})?)/i);
  if (labeled) return Number(labeled[1]);
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Per-type extractors
// ─────────────────────────────────────────────────────────────────────

export function extractNewRequest(body: string): ExtractionResult<IndeedFlexEventNewRequest> {
  const jobId = extractJobId(body);
  const headcount = extractHeadcount(body);
  const { start: workDate, end: endDate } = extractShiftDateRange(body);
  const { start: startTime, end: endTime } = extractTimeRange(body);
  const venueName = extractVenue(body);
  const venueAddress = extractVenueAddress(body);
  const roleName = extractRole(body);
  const payRateUsd = extractPayRateUsd(body);

  const missingFields: string[] = [];
  if (!jobId) missingFields.push('jobId');
  if (headcount === undefined) missingFields.push('headcount');
  if (!workDate) missingFields.push('workDate');
  if (!startTime || !endTime) missingFields.push('startTime/endTime');
  if (!venueName) missingFields.push('venueName');

  // Note: jobId is required by the type; the missingFields check
  // surfaces the regex miss, but we still need a placeholder. The
  // orchestrator decides whether to ship as low-confidence or trigger
  // the LLM. Use empty string here; the LLM fallback overwrites.
  return {
    event: {
      type: 'new_request',
      jobId: jobId ?? '',
      headcount: headcount ?? 0,
      workDate,
      endDate,
      startTime,
      endTime,
      venueName,
      venueAddress,
      roleName,
      payRateUsd,
    },
    missingFields,
  };
}

export function extractChangeHeadcount(
  body: string,
): ExtractionResult<IndeedFlexEventChangeHeadcount> {
  const previous = body.match(
    /\b(?:from|previously|was)\s*[:\-]?\s*(\d{1,3})\s*(?:workers?|to)/i,
  );
  const next = body.match(
    /\b(?:to|now|new)\s*[:\-]?\s*(\d{1,3})(?:\s*workers?)?\b/i,
  );
  let previousHeadcount: number | undefined = previous ? Number(previous[1]) : undefined;
  let newHeadcount: number | undefined = next ? Number(next[1]) : undefined;

  // Live format (2026-07-08): "Workers required now: 1" then
  // "(Decreased by 1 out of 2)" — the labeled extractor gets the new
  // count; "out of N" carries the previous count.
  const liveNew = body.match(/\bworkers required now\s*[:\-]?\s*(\d{1,3})\b/i);
  if (liveNew) newHeadcount = Number(liveNew[1]);
  if (previousHeadcount === undefined) {
    const outOf = body.match(/\b(?:in|de)creased by \d{1,3} out of (\d{1,3})\b/i);
    if (outOf) previousHeadcount = Number(outOf[1]);
  }

  // Fallback to the standalone headcount when only one number was found.
  if (newHeadcount === undefined) {
    const single = extractHeadcount(body);
    if (single !== undefined) newHeadcount = single;
  }

  const jobId = extractJobId(body);
  const workDate = extractDate(body);
  const { start: startTime, end: endTime } = extractTimeRange(body);
  const venueName = extractVenue(body) ?? extractBookingHeaderVenue(body);
  const roleName = extractRole(body);

  const missingFields: string[] = [];
  if (newHeadcount === undefined) missingFields.push('newHeadcount');
  if (!venueName) missingFields.push('venueName');
  if (!workDate) missingFields.push('workDate');

  return {
    event: {
      type: 'change_headcount',
      jobId,
      previousHeadcount,
      newHeadcount: newHeadcount ?? 0,
      workDate,
      startTime,
      endTime,
      venueName,
      roleName,
    },
    missingFields,
  };
}

export function extractChangeTime(
  body: string,
): ExtractionResult<IndeedFlexEventChangeTime> {
  const previousStartTime = extractLabeledTime(body, /\bprevious(?:ly)?\s+start(?:\s+time)?/i);
  const previousEndTime = extractLabeledTime(body, /\bprevious(?:ly)?\s+end(?:\s+time)?/i);
  const newStartTime =
    extractLabeledTime(body, /\bnew\s+start(?:\s+time)?/i) ??
    extractLabeledTime(body, /\bstart\s+time/i);
  const newEndTime =
    extractLabeledTime(body, /\bnew\s+end(?:\s+time)?/i) ??
    extractLabeledTime(body, /\bend\s+time/i);

  const jobId = extractJobId(body);
  const workDate = extractDate(body);
  const venueName = extractVenue(body);
  const roleName = extractRole(body);

  const missingFields: string[] = [];
  if (!jobId) missingFields.push('jobId');
  if (!newStartTime && !newEndTime) missingFields.push('newStartTime/newEndTime');
  if (!workDate) missingFields.push('workDate');

  return {
    event: {
      type: 'change_time',
      jobId: jobId ?? '',
      previousStartTime,
      previousEndTime,
      newStartTime,
      newEndTime,
      workDate,
      venueName,
      roleName,
    },
    missingFields,
  };
}

/**
 * Live-format change/removal header (2026-07-08):
 *
 *   "Hi, C1 Staffing LLC
 *    <Client>, <Venue>, <street address> have removed the following bookings."
 *
 * Returns the whole client+venue+address segment. Too jumbled to split
 * reliably by regex (client names contain commas — "Continental
 * Battery Systems, Inc."), so callers keep it raw and let the LLM
 * refine `venueName` in production.
 */
export function extractBookingHeaderVenue(body: string): string | undefined {
  const m = body.match(/^(.{4,200}?)\s+have (?:removed|changed) the following bookings/im);
  return m ? m[1].trim() : undefined;
}

export function extractCancelBooking(
  body: string,
): ExtractionResult<IndeedFlexEventCancelBooking> {
  // Worker names are usually under a "have removed the following
  // bookings:" header, one per line. We capture the first 10
  // non-empty lines below the header.
  const workerNames: string[] = [];
  const headerIdx = body
    .toLowerCase()
    .search(/(?:removed the following|cancelled bookings? for|cancellations? for)/);
  if (headerIdx >= 0) {
    const after = body.slice(headerIdx);
    const lines = after
      .split('\n')
      .slice(1) // drop the header line itself
      .map((l) => l.trim())
      .filter((l) => l && !/^(?:venue|location|site|client|date|time|role|position)/i.test(l));
    // Live format (2026-07-08): the removal list is "ROLE\n<date> -
    // <time> - <time>" pairs with NO worker names — the old name-shape
    // regex was capturing the role ("Warehouse Operative") ten times.
    // A line directly followed by a date line is a role header, not a
    // person.
    const dateLineRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i;
    for (let i = 0; i < lines.length; i++) {
      if (workerNames.length >= 10) break;
      if (lines[i + 1] && dateLineRe.test(lines[i + 1])) continue;
      // Strip leading bullet / dash characters.
      const name = lines[i].replace(/^[-•*\d.\s]+/, '').trim();
      if (!name || name.length > 80) continue;
      // Look like a person name? at least two words, mostly letters.
      if (/^[A-Z][a-z']+(?:\s+[A-Z][a-z'.-]+){1,4}$/.test(name)) {
        workerNames.push(name);
      }
    }
  }

  // Live format: the removal list spans many dates ("Jul 09 … Jul 31").
  // First date = workDate, last = endDate so the today-forward gate
  // treats a still-running range as current.
  const allDates = Array.from(
    body.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/gi),
  ).map((m) => {
    const parsed = Date.parse(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!Number.isFinite(parsed)) return undefined;
    const d = new Date(parsed);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }).filter((x): x is string => Boolean(x)).sort();
  const workDate = allDates[0] ?? extractDate(body);
  const endDate = allDates.length > 1 ? allDates[allDates.length - 1] : undefined;
  const { start: startTime, end: endTime } = extractTimeRange(body);
  const venueName = extractVenue(body) ?? extractBookingHeaderVenue(body);
  const roleName = extractRole(body);
  const reasonMatch = body.match(/\breason\s*[:\-]\s*([^\n]+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim().replace(/[.,;]+$/, '') : undefined;

  const missingFields: string[] = [];
  if (workerNames.length === 0) missingFields.push('workerNames');
  if (!venueName) missingFields.push('venueName');
  if (!workDate) missingFields.push('workDate');

  return {
    event: {
      type: 'cancel_booking',
      workerNames,
      reason,
      workDate,
      endDate,
      startTime,
      endTime,
      venueName,
      roleName,
    },
    missingFields,
  };
}

export function extractNoShow(body: string): ExtractionResult<IndeedFlexEventNoShow> {
  // "Your assigned worker <First Last> did not turn up to their shift"
  const m = body.match(
    /\b(?:assigned worker|worker)\s+([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,4})\s+(?:did not|didn'?t)\s+(?:turn up|show up|attend)/,
  );
  const workerName = m ? m[1] : '';

  const jobId = extractJobId(body);
  const workDate = extractDate(body);
  const { start: startTime, end: endTime } = extractTimeRange(body);
  const venueName = extractVenue(body);
  const roleName = extractRole(body);

  const missingFields: string[] = [];
  if (!workerName) missingFields.push('workerName');
  if (!workDate) missingFields.push('workDate');

  return {
    event: {
      type: 'no_show',
      workerName,
      jobId,
      workDate,
      startTime,
      endTime,
      venueName,
      roleName,
    },
    missingFields,
  };
}

export function extractDailyDigestExpired(
  body: string,
): ExtractionResult<IndeedFlexEventDailyDigestExpired> {
  // Walks the body looking for "Job NNN" patterns under an "expired"
  // section. The digest format is loose, so we collect all (jobId,
  // venueName) pairs we can find.
  const expiredJobs: Array<{ jobId?: string; venueName?: string }> = [];
  const expiredSection = body.match(
    /(?:job\s*requests?\s*expired|expired\s*job\s*requests?)([\s\S]+?)(?:\n\s*\n|$)/i,
  );
  const target = expiredSection ? expiredSection[1] : body;
  const jobMatches = Array.from(target.matchAll(/\bjob\s*(\d{4,8})\b/gi));
  for (const m of jobMatches) {
    expiredJobs.push({ jobId: m[1] });
  }

  const missingFields: string[] = [];
  if (expiredJobs.length === 0) missingFields.push('expiredJobs');

  return {
    event: {
      type: 'daily_digest_expired',
      expiredJobs,
    },
    missingFields,
  };
}
