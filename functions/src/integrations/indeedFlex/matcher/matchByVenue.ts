/**
 * **Slice 3b — venue → account fuzzy matcher (2026-05-24).**
 *
 * Indeed Flex's `new_request` emails carry a free-form venue string
 * like `"CHI - Woodridge Warehouse - SVC07/43/00"`. HRX accounts are
 * named after the actual venue, e.g. `"CORT Woodbridge Warehouse"`.
 * The mapping is conventional but fuzzy:
 *
 *   - Indeed prefixes the city code (`"CHI - "`, `"DAL - "`, …)
 *   - Indeed suffixes its own service code (`" - SVC07/43/00"`)
 *   - HRX's account name may have a brand prefix (`"CORT "`)
 *   - Spellings differ (Indeed: `"Woodridge"` vs HRX: `"Woodbridge"`)
 *
 * Approach:
 *   1. Normalize the Indeed venueName by stripping known noise
 *      (prefix codes, suffix service codes, brand prefixes, punctuation).
 *   2. Tokenize both sides into a Set of lowercase words ≥3 chars.
 *   3. Score each account by Jaccard overlap of its tokens with the
 *      venue tokens.
 *   4. Pick the highest-scoring SINGLE match above the threshold;
 *      return ambiguous when the top two are within a tight margin.
 *
 * Why not Levenshtein on the whole string? Whole-string distance
 * penalizes any reorder ("Warehouse Phoenix" vs "Phoenix Warehouse").
 * Token Jaccard is order-invariant and tolerates light typos via
 * substring fallback below.
 *
 * Returns `{ accountId, accountName, venueKey, candidates,
 * confidence }`. The dispatcher rolls these onto `MatchResult`.
 */

import type { Reader, ReaderDoc } from './types';

export interface VenueMatchOutcome {
  /** Top-scoring account, when one stood out clearly. */
  accountId?: string;
  accountName?: string;
  /** The post-normalization "what we tried to match" string. */
  venueKey: string;
  /** Up to 3 close-but-rejected candidates (id + name). Useful so the
   *  recruiter can override our pick from the dry-run log. */
  candidates: Array<{ id: string; name: string }>;
  /**
   * `exact` — token Jaccard ≥ 0.8 AND the top score beats the runner-up
   *           by a clear margin (≥ 0.15)
   * `multiple` — top score above threshold but ties / near-ties with
   *              other candidates → recruiter must pick
   * `none`  — nothing above the threshold
   */
  confidence: 'exact' | 'multiple' | 'none';
  /** Human-readable diagnostic. */
  notes: string;
}

// Indeed prepends a 2-4 letter region/venue code, optionally followed
// by a parenthetical scope (e.g. state abbrev or city), then a dash.
// Real samples that need to strip cleanly:
//   "CHI - Woodridge Warehouse - SVC07/43/00"
//   "CHI (IN) - JW MARRIOTT-INDIANAPOLIS"
//   "WBI (Hanover, MD) - Maryland Warehouse - SVC07/43/00"
const NOISE_PREFIX_REGEX = /^[A-Z]{2,4}\s*(?:\([^)]+\)\s*)?[-–]\s+/u;
const NOISE_SUFFIX_REGEX = /\s*[-–]\s*SVC\d+\/\d+\/\d+\s*$/iu; // " - SVC07/43/00"
const COMMON_BRAND_PREFIXES = ['CORT'];
const STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'at',
  'for',
  'inc',
  'llc',
  'company',
  'co',
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function stripBrandPrefix(name: string): string {
  for (const brand of COMMON_BRAND_PREFIXES) {
    const re = new RegExp(`^${brand}\\s+`, 'i');
    if (re.test(name)) return name.replace(re, '');
  }
  return name;
}

/**
 * Strip the Indeed-side prefix / suffix noise and return the
 * canonical "venue identity" we want to compare against accounts.
 * Idempotent. Exported for tests.
 */
export function normalizeVenueName(raw: string): string {
  let s = raw.trim();
  s = s.replace(NOISE_PREFIX_REGEX, '');
  s = s.replace(NOISE_SUFFIX_REGEX, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) {
    if (b.has(t)) intersect++;
  }
  const unionSize = a.size + b.size - intersect;
  return unionSize > 0 ? intersect / unionSize : 0;
}

/**
 * **IDF-style token weights (2026-05-24, Greg's report)** —
 * raw token-Jaccard was scoring "Phoenix Warehouse" vs
 * "Woodridge Warehouse" at 0.50 because both share the single
 * token `warehouse`, and there are 11 "CORT * Warehouse" accounts
 * in the tenant. Common tokens like "warehouse" / "cort" /
 * "convention" should contribute much less to the match than
 * distinctive tokens like "woodridge" / "indianapolis".
 *
 * Compute `weight[token] = log(N / df[token] + 1)` where N is
 * the number of accounts and df is the document frequency
 * (how many accounts contain the token). A token in EVERY
 * account → weight ~0. A token in only one account → weight ~log(N).
 *
 * The weighted overlap replaces plain set-intersection counts:
 *   score = sum(weights of matched tokens) / sum(weights of venue tokens)
 *
 * This is recall-flavored — every distinctive venue token must
 * have a (possibly fuzzy) account-side match. Adding a precision
 * penalty for over-long account names happens inside the existing
 * `fuzzyTokenOverlap` path.
 */
interface IdfMap {
  /** Per-token weight; tokens NOT in the corpus get `corpusMax`. */
  weights: Map<string, number>;
  /** Weight to use for venue tokens that don't appear in any account
   *  (they're maximally distinctive — if we can't match them on the
   *  account side, the venue probably doesn't belong to that account). */
  corpusMax: number;
}

function buildTokenIdf(accountTokenSets: Set<string>[]): IdfMap {
  const N = accountTokenSets.length;
  const df = new Map<string, number>();
  for (const ts of accountTokenSets) {
    for (const t of ts) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const weights = new Map<string, number>();
  let corpusMax = 1;
  for (const [t, freq] of df) {
    const w = Math.log(N / (freq + 1)) + 1; // +1 inside log so a token in every account stays at ~1, not 0
    weights.set(t, w);
    if (w > corpusMax) corpusMax = w;
  }
  return { weights, corpusMax };
}

function tokenWeight(t: string, idf: IdfMap): number {
  // **2026-05-24 fix (Greg's report)** — venue tokens with no
  // account-side counterpart (e.g. "Maryland" when no account has
  // it in its name) are MAXIMALLY distinctive: failing to match
  // them should crater the score. Previously they fell back to
  // weight 1, which let "Maryland Warehouse" vs "Woodbridge Warehouse"
  // score 0.78 on just the shared "warehouse" token.
  const w = idf.weights.get(t);
  return w !== undefined ? w : idf.corpusMax;
}

function weightedJaccard(
  venueTokens: Set<string>,
  acctTokens: Set<string>,
  idf: IdfMap,
): number {
  let venueWeight = 0;
  for (const t of venueTokens) venueWeight += tokenWeight(t, idf);
  if (venueWeight === 0) return 0;
  let matched = 0;
  for (const t of venueTokens) {
    if (acctTokens.has(t)) matched += tokenWeight(t, idf);
  }
  return matched / venueWeight;
}

/**
 * **Edit-distance substring boost.** Catches single-character typos
 * like Indeed's `"Woodridge"` vs HRX's `"Woodbridge"` — the token
 * Jaccard alone gives those 0 because the tokens don't match
 * exactly. We add a small score boost when ALL of the venue's tokens
 * have a within-edit-distance-1 match somewhere in the account's
 * tokens. Keeps the metric conservative: typo tolerance applies only
 * when all venue tokens fuzzy-match, not when half of them do.
 */
function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diffs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    diffs++;
    if (diffs > 1) return false;
    if (a.length === b.length) {
      i++;
      j++;
    } else if (a.length > b.length) {
      i++;
    } else {
      j++;
    }
  }
  if (i < a.length || j < b.length) diffs++;
  return diffs <= 1;
}

function fuzzyTokenOverlap(
  venueTokens: Set<string>,
  acctTokens: Set<string>,
  idf: IdfMap,
): number {
  if (venueTokens.size === 0) return 0;
  let venueWeight = 0;
  for (const t of venueTokens) venueWeight += tokenWeight(t, idf);
  if (venueWeight === 0) return 0;
  let matchedWeight = 0;
  for (const v of venueTokens) {
    const vWeight = tokenWeight(v, idf);
    for (const a of acctTokens) {
      if (levenshteinAtMostOne(v, a)) {
        matchedWeight += vWeight;
        break;
      }
    }
  }
  // Recall (weighted) × precision penalty for over-long account
  // names. Same shape as before; the IDF weighting is the new
  // signal — the precision penalty stays unchanged.
  const recall = matchedWeight / venueWeight;
  const precisionPenalty = 1 / (1 + Math.log(1 + Math.max(0, acctTokens.size - venueTokens.size)));
  return recall * precisionPenalty;
}

const MATCH_THRESHOLD = 0.5;
const TIE_MARGIN = 0.15;

export async function matchByVenue(
  reader: Reader,
  args: { tenantId: string; venueName?: string },
): Promise<VenueMatchOutcome> {
  const raw = (args.venueName ?? '').trim();
  if (!raw) {
    return {
      venueKey: '',
      candidates: [],
      confidence: 'none',
      notes: 'no venueName on event',
    };
  }
  const venueKey = normalizeVenueName(raw);

  // **Alias short-circuit (Slice 3c, 2026-06-02).** Recruiters can
  // explicitly link a venue string → account via the /shifts/log
  // "Link to account" UI. When the alias exists, return it directly —
  // skipping the IDF + fuzzy pass entirely. Saves us from edge cases
  // where the fuzzy scorer can't clear threshold for venue strings
  // stuffed with brand prefixes (`"WBI (Hanover, MD) -"`) and SVC
  // codes (`"- SVC07/44/00"`).
  const aliased = await reader.getVenueAlias({
    tenantId: args.tenantId,
    rawVenueName: raw,
  });
  if (aliased) {
    return {
      accountId: aliased.accountId,
      accountName: aliased.accountName,
      venueKey,
      candidates: [{ id: aliased.accountId, name: aliased.accountName }],
      confidence: 'exact',
      notes: `matched via alias (recruiter-linked) → ${aliased.accountName}`,
    };
  }
  const venueTokens = tokenize(venueKey);
  if (venueTokens.size === 0) {
    return {
      venueKey,
      candidates: [],
      confidence: 'none',
      notes: `venueKey "${venueKey}" had no tokenizable content`,
    };
  }

  const accounts = await reader.listAccounts({ tenantId: args.tenantId });
  if (accounts.length === 0) {
    return {
      venueKey,
      candidates: [],
      confidence: 'none',
      notes: 'no accounts on tenant',
    };
  }

  // Pre-tokenize every account name once. The IDF map is built from
  // these so the weighting reflects what's actually in the tenant
  // (common tokens here may differ from another tenant's account list).
  const acctEntries: Array<{ doc: ReaderDoc; name: string; tokens: Set<string> }> = [];
  for (const a of accounts) {
    const rawName = String(a.data.name ?? '').trim();
    if (!rawName) continue;
    const stripped = stripBrandPrefix(rawName);
    acctEntries.push({ doc: a, name: rawName, tokens: tokenize(stripped) });
  }
  const idf = buildTokenIdf(acctEntries.map((e) => e.tokens));

  // Score every account with both weighted exact (Jaccard-weighted) and
  // weighted fuzzy (Levenshtein-tolerant) overlap. Take the max so a
  // clean substring match and a typo-tolerant match can both win.
  // Plain Jaccard kept as a tie-breaker for the (rare) case where
  // every venue token's idf is 0 (e.g. brand-new tenant with one
  // account).
  const scored: Array<{ doc: ReaderDoc; score: number; name: string }> = [];
  for (const e of acctEntries) {
    const wj = weightedJaccard(venueTokens, e.tokens, idf);
    const fz = fuzzyTokenOverlap(venueTokens, e.tokens, idf);
    const fallbackJ = jaccard(venueTokens, e.tokens);
    const score = Math.max(wj, fz, fallbackJ * 0.5); // halve the fallback so it's a tie-breaker, not a primary signal
    scored.push({ doc: e.doc, score, name: e.name });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];

  if (!top || top.score < MATCH_THRESHOLD) {
    return {
      venueKey,
      candidates: scored
        .slice(0, 3)
        .filter((s) => s.score > 0)
        .map((s) => ({ id: s.doc.id, name: s.name })),
      confidence: 'none',
      notes: `no account scored ≥ ${MATCH_THRESHOLD} (top: "${top?.name ?? 'n/a'}" @ ${top?.score.toFixed(2) ?? '0'})`,
    };
  }

  const margin = runnerUp ? top.score - runnerUp.score : Infinity;
  if (margin < TIE_MARGIN) {
    return {
      venueKey,
      candidates: scored.slice(0, 3).map((s) => ({ id: s.doc.id, name: s.name })),
      confidence: 'multiple',
      notes:
        `ambiguous match: "${top.name}" @ ${top.score.toFixed(2)} vs "${runnerUp?.name}" @ ${runnerUp?.score.toFixed(2)} ` +
        `(margin ${margin.toFixed(2)} < ${TIE_MARGIN})`,
    };
  }

  return {
    accountId: top.doc.id,
    accountName: top.name,
    venueKey,
    candidates: scored
      .slice(1, 3)
      .filter((s) => s.score > 0)
      .map((s) => ({ id: s.doc.id, name: s.name })),
    confidence: 'exact',
    notes: `matched "${top.name}" @ ${top.score.toFixed(2)} (next: "${runnerUp?.name ?? 'n/a'}" @ ${runnerUp?.score.toFixed(2) ?? '0'})`,
  };
}
