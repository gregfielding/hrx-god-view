/**
 * Cadence Reply Classifier
 *
 * Phase 2A + 2B of the Shift Cadence Engine.
 *
 * Pure, dependency-free function that maps an inbound SMS body (already
 * normalized — trimmed, uppercased, whitespace collapsed) to a coarse intent
 * against an active shift-cadence confirmation.
 *
 * Why this exists:
 *   The generic STOP/HELP/START keyword matcher already lives in
 *   messaging/stopHelpHandler.ts and considers bare "YES" to be a re-opt-in
 *   keyword. That collides directly with our cadence flow, where a worker
 *   who received a "Reply YES to confirm" reminder naturally replies "YES".
 *
 *   The cadence reply handler consults this classifier BEFORE the generic
 *   STOP/HELP/START matcher runs. If the worker has an active cadence we
 *   claim the YES/NO/CANCEL/HERE/walk-off for the cadence. Otherwise the
 *   message falls through to the regular inbound pipeline unchanged.
 *
 * Phase 2B adds:
 *   - `check_in` — worker confirms arrival on site ("HERE", "I'M HERE", "ON
 *     SITE", "ARRIVED", etc.) so we can short-circuit the T+30 no-show check.
 *   - `walk_off_warning` — ambiguous distress signals that suggest the worker
 *     is about to walk off ("no one is here", "wrong place", "I'm leaving").
 *     These do NOT mutate the confirmation state; they just route a recruiter
 *     alert + the "don't walk off, you're being paid to wait" template back.
 *
 * Scope discipline:
 *   - No Firestore, no network, no side effects. Easy to unit-test.
 *   - No clever NLP. Keyword lists + simple substring phrases. We'll swap
 *     this for an LLM classifier in Phase 3 without changing the surface.
 *   - Ordering rules below intentionally make some intents shadow others —
 *     see the function body comments.
 */

export type CadenceReplyIntent =
  | 'confirmation'
  | 'cancellation'
  | 'check_in'
  | 'walk_off_warning'
  | 'none';

export interface CadenceReplyClassification {
  intent: CadenceReplyIntent;
  /**
   * Short token / phrase that produced the match (e.g. "YES", "CANCEL",
   * "NO ONE HERE"). Used for logging so we can observe which variants
   * workers actually use and tune the lists over time.
   */
  matchedToken: string | null;
  /**
   * Rough confidence score. Keyword classifier is either 1.0 (exact match) or
   * 0 (no match). Phase 3's LLM classifier will return fractional values.
   */
  confidence: number;
}

/**
 * Short explicit confirmations. Order matters only for matchedToken logging.
 *
 * We intentionally *do not* include "START" here — START is owned by the
 * compliance opt-in flow and must never be reinterpreted as a shift
 * confirmation, even when the worker has a pending cadence.
 */
const CONFIRMATION_TOKENS = [
  'YES',
  'YEP',
  'YEAH',
  'YUP',
  'YS',
  'Y',
  'CONFIRM',
  'CONFIRMED',
  'OK',
  'OKAY',
  'SURE',
  "I'M IN",
  'IM IN',
  "I'LL BE THERE",
  'ILL BE THERE',
  'SEE YOU THERE',
  'SEE U THERE',
  'ACCEPT',
  'GOING',
  'WILL BE THERE',
];

/**
 * Cancellations specific to the cadence flow.
 *
 * Note: "CANCEL" is also a STOP-keyword synonym for SMS carrier compliance,
 * but within the cadence window we claim it first. If there is no active
 * cadence, it falls through to the compliance STOP handler as before — this
 * module does not suppress anything by itself, it only returns intent.
 */
const CANCELLATION_TOKENS = [
  'CANCEL',
  'CANCELED',
  'CANCELLED',
  'NO',
  'NOPE',
  'NAH',
  'CANT',
  "CAN'T",
  'CANT MAKE IT',
  "CAN'T MAKE IT",
  'CANT COME',
  "CAN'T COME",
  'NOT COMING',
  'NOT ABLE',
  'DECLINE',
  'DECLINED',
  'PASS',
  'REJECT',
  'REJECTED',
  'WITHDRAW',
  'WITHDRAWN',
];

/**
 * Check-in tokens — worker is confirming they've arrived on site. These are
 * matched via prefix + exact-match, same style as confirmations.
 *
 * IMPORTANT: we also match these as substrings of the message body, but ONLY
 * after ruling out walk-off phrases, because "NO ONE IS HERE" contains
 * "HERE" and must NOT be classified as a check-in.
 */
const CHECKIN_TOKENS = [
  'HERE',
  'IM HERE',
  "I'M HERE",
  'I AM HERE',
  'ARRIVED',
  'ARRIVED ON SITE',
  'ON SITE',
  'ONSITE',
  'ON-SITE',
  'AT SITE',
  'AT THE SITE',
  'AT WORK',
  'MADE IT',
  'MADE IT HERE',
  'HERE NOW',
  'CHECKED IN',
  'CHECK IN',
  'CHECKIN',
];

/**
 * Walk-off / distress phrases. Intent here is deliberately broad — we would
 * rather pull a recruiter in on a false positive than miss a real walk-off.
 *
 * Matching is via substring (phrase containment after normalization), NOT
 * prefix-only, because these phrases most often appear mid-message
 * ("been here 15 minutes, no one is here").
 *
 * We explicitly do NOT include bare tokens like "HELP" (owned by the SMS
 * compliance HELP handler) or "HOME" alone (too many false positives —
 * "heading home after" is fine mid-sentence after clock-out but we can't
 * distinguish that yet). Add cautiously.
 */
const WALK_OFF_PHRASES = [
  // Nobody's on site
  'NO ONE IS HERE',
  'NO ONE HERE',
  'NOBODY IS HERE',
  'NOBODY HERE',
  'NOONE HERE',
  'NOONE IS HERE',
  'NOBODY ANSWERS',
  "NOBODY'S ANSWERING",
  'NOBODY ANSWERING',
  'NOBODY AROUND',
  'NOBODY IS AROUND',
  'NO ONE AROUND',
  'NO ONE RESPONDING',
  'NO SUPERVISOR',
  'NO BOSS',
  'NO MANAGER',
  'SUPERVISOR NOT HERE',
  'NOT WORKING TODAY',
  // Locked out / wrong place
  'DOOR LOCKED',
  'DOOR IS LOCKED',
  'LOCKED OUT',
  'CLOSED',
  'THEY ARE CLOSED',
  "THEY'RE CLOSED",
  'WRONG ADDRESS',
  'WRONG PLACE',
  'WRONG LOCATION',
  'WRONG SITE',
  "CAN'T FIND",
  'CANT FIND',
  "CAN'T FIND IT",
  'CANT FIND IT',
  'CANT FIND THE',
  "CAN'T FIND THE",
  "I'M LOST",
  'IM LOST',
  // Leaving / quitting threats
  "I'M LEAVING",
  'IM LEAVING',
  'GONNA LEAVE',
  'GOING TO LEAVE',
  'ABOUT TO LEAVE',
  'HEADING OUT',
  'HEADING HOME',
  'GOING HOME',
  'LEAVING NOW',
  'BOUNCING',
  "I'M OUT",
  'IM OUT',
  'IM DONE',
  "I'M DONE",
  'WALKING OFF',
  'WALK OFF',
  'QUITTING',
  "I QUIT",
  'I QUIT',
  // Confusion / been waiting
  'BEEN WAITING',
  'STILL WAITING',
  'BEEN HERE FOR',
  'IVE BEEN HERE',
  "I'VE BEEN HERE",
  'WHERE AM I',
  'WHERE IS THIS',
  "WHAT'S GOING ON",
  'WHATS GOING ON',
];

function normalize(body: string): string {
  return String(body ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.!?,]+$/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Exact-or-prefix match against a token list. Used for confirmations and
 * cancellations where the worker usually just sends the keyword.
 */
function matchesTokenList(normalized: string, tokens: readonly string[]): string | null {
  for (const token of tokens) {
    if (normalized === token) return token;
    if (normalized.startsWith(token + ' ')) return token;
  }
  return null;
}

/**
 * Substring (phrase containment) match. Used for walk-off phrases that tend
 * to appear mid-sentence. We also guard against one-word noise — require at
 * least 2 whitespace-separated tokens in the matched phrase so "OK" can't
 * accidentally match a walk-off list via a single-letter substring.
 */
function matchesPhraseList(normalized: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (!phrase.includes(' ')) continue; // Safety — phrases must be ≥2 words.
    if (normalized === phrase) return phrase;
    if (normalized.includes(` ${phrase} `)) return phrase;
    if (normalized.startsWith(phrase + ' ')) return phrase;
    if (normalized.endsWith(' ' + phrase)) return phrase;
  }
  return null;
}

/**
 * Classify an inbound SMS body against the cadence reply grammar.
 *
 * This is pure — the caller decides whether to act on the intent based on
 * whether an active cadence exists for the sender. A returned intent of
 * `confirmation` for a worker with no pending shift is NOT a bug; the caller
 * must treat intent + cadence-state as a pair.
 *
 * Priority order:
 *   1. Cancellation — explicit opt-out beats everything. A worker typing
 *      "CANCEL I can't make it" is not checking in.
 *   2. Walk-off warning — distress signals need recruiter attention even if
 *      the body also contains the string "HERE" ("no one is here").
 *   3. Check-in — positive arrival. Only evaluated after walk-off rules out
 *      a distress phrase, because "HERE" is a substring of many walk-off
 *      phrases.
 *   4. Confirmation — YES/OK/etc. Runs last among explicit intents so a
 *      reply like "YES I'm here" resolves to check-in (the stronger signal)
 *      rather than a belated confirmation. In practice a worker who's
 *      already on site is ALSO confirmed, so the handler treats check-in
 *      as implicitly confirming for state-machine purposes.
 */
export function classifyCadenceReply(body: string): CadenceReplyClassification {
  const normalized = normalize(body);
  if (!normalized) {
    return { intent: 'none', matchedToken: null, confidence: 0 };
  }

  // 1. Cancellation
  const cancelToken = matchesTokenList(normalized, CANCELLATION_TOKENS);
  if (cancelToken) {
    return { intent: 'cancellation', matchedToken: cancelToken, confidence: 1 };
  }

  // 2. Walk-off phrases (substring match — must come BEFORE check-in so
  //    "NO ONE IS HERE" doesn't get stolen by the HERE keyword below).
  const walkOffPhrase = matchesPhraseList(normalized, WALK_OFF_PHRASES);
  if (walkOffPhrase) {
    return { intent: 'walk_off_warning', matchedToken: walkOffPhrase, confidence: 1 };
  }

  // 3. Check-in
  const checkInToken = matchesTokenList(normalized, CHECKIN_TOKENS);
  if (checkInToken) {
    return { intent: 'check_in', matchedToken: checkInToken, confidence: 1 };
  }

  // 4. Confirmation
  const confirmToken = matchesTokenList(normalized, CONFIRMATION_TOKENS);
  if (confirmToken) {
    return { intent: 'confirmation', matchedToken: confirmToken, confidence: 1 };
  }

  return { intent: 'none', matchedToken: null, confidence: 0 };
}

/**
 * Export the keyword lists so the handler can use them for logging / metrics
 * without mutating them. ReadonlyArray prevents accidental in-place edits.
 */
export const CADENCE_CONFIRMATION_TOKENS: ReadonlyArray<string> = CONFIRMATION_TOKENS;
export const CADENCE_CANCELLATION_TOKENS: ReadonlyArray<string> = CANCELLATION_TOKENS;
export const CADENCE_CHECKIN_TOKENS: ReadonlyArray<string> = CHECKIN_TOKENS;
export const CADENCE_WALK_OFF_PHRASES: ReadonlyArray<string> = WALK_OFF_PHRASES;
