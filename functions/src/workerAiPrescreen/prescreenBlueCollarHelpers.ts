/**
 * Blue-collar–friendly prescreen text helpers (deterministic, explainable).
 * Mirrors `src/shared/prescreenBlueCollarHelpers.ts` — keep in sync.
 */

/** Single-token or short compliance-style answers on drug/background follow-ups. */
const EXPLICIT_COMPLIANCE_TOKEN = new Set(
  [
    'yes',
    'no',
    'y',
    'n',
    'pass',
    'fail',
    'clean',
    'clear',
    'ok',
    'okay',
    'sure',
    'maybe',
    'idk',
    'na',
    'n/a',
    'can',
    'cant',
    "can't",
    'cannot',
    'wont',
    "won't",
    'not',
    'sure',
  ].map((s) => s.toLowerCase()),
);

/** Phrases that signal ability to pass / no issue (not admissions). */
const EXPLICIT_PASS_PHRASES =
  /\b(can\s+pass|able\s+to\s+pass|will\s+pass|i\s+can\s+pass|no\s+issue|no\s+issues|negative\s+test|clean\s+test|i\s+dont\s+use|don't\s+use|dont\s+use|never\s+failed|never\s+failed\s+a\s+test)\b/i;

const EXPLICIT_UNCERTAIN_PHRASES =
  /\b(not\s+sure|unsure|maybe|idk|don'?t\s+know|dont\s+know|unclear|not\s+clear)\b/i;

/** Hard admissions / failures (severity routing elsewhere). */
const EXPLICIT_ADMISSION_PHRASES =
  /\b(marijuana|weed|cannabis|thc|misdemeanor|felony|felonies|convicted|conviction|dwi|dui|failed\s+test|won'?t\s+pass|will\s+not\s+pass|cannot\s+pass|can't\s+pass|dirty)\b/i;

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'i',
  'im',
  "i'm",
  'my',
  'me',
  'we',
  'it',
  'is',
  'are',
  'was',
  'be',
  'have',
  'has',
  'just',
  'very',
  'like',
  'um',
  'uh',
]);

const OPERATIONAL_SIGNAL_PATTERNS: RegExp[] = [
  /\b\d+\s*(years?|yrs?|months?|mos?|weeks?|days?|hours?|hrs?)\b/i,
  /\b(warehouse|forklift|shipping|receiving|stock|picker|packer|loader|unload|banquet|serving|server|host|hostess|event|setup|tear|custodial|janitor|cleaner|housekeeping|hospitality|hotel|kitchen|dish|prep|cook|line)\b/i,
  /\b(warehouse|retail|restaurant|construction|manufacturing|delivery|driver|driving|uber|lyft|car|vehicle|bus|transit|commute|bike|walk)\b/i,
  /\b(early|on\s*time|reliable|show\s+up|attendance|shift|overtime|weekend|night|physical|lift|stand|hours)\b/i,
  /\b(worked|work|job|experience|years|supervisor|team|customer|busy|rush|pressure)\b/i,
];

/**
 * Normalized tokens (alphanumeric) stripped of filler — for short-answer signal checks.
 */
export function extractOperationalSignalTokens(text: string): string[] {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = t.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return tokens;
}

/**
 * Short replies that are normal for compliance questions (drug/background) — not "vague narrative".
 */
export function isExplicitComplianceAnswer(text: string): boolean {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (t.length <= 32 && EXPLICIT_PASS_PHRASES.test(t)) return true;
  if (t.length <= 32 && EXPLICIT_UNCERTAIN_PHRASES.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && EXPLICIT_COMPLIANCE_TOKEN.has(words[0].replace(/[^a-z0-9]/gi, ''))) {
    return true;
  }
  if (words.length <= 2 && words.every((w) => EXPLICIT_COMPLIANCE_TOKEN.has(w.replace(/[^a-z0-9]/gi, '')))) {
    return true;
  }
  return false;
}

/**
 * Disclosure follow-up: likely "can pass / clean" vs admission / uncertainty.
 */
export function isExplicitDrugBackgroundPassSignal(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (EXPLICIT_PASS_PHRASES.test(t)) return true;
  const low = t.toLowerCase();
  if (/^(yes|y|pass|clean|clear|ok|okay|sure)$/i.test(low)) return true;
  return false;
}

export function isExplicitUncertaintySignal(text: string): boolean {
  return EXPLICIT_UNCERTAIN_PHRASES.test(String(text ?? ''));
}

export function isLikelyComplianceAdmission(text: string): boolean {
  return EXPLICIT_ADMISSION_PHRASES.test(String(text ?? ''));
}

/** Background follow-up: likely clean / no record (short plain answers). */
export function isExplicitBackgroundPassSignal(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (/^(no|n|clean|clear|none|nothing|pass|ok|okay)$/i.test(low)) return true;
  return /\b(no\s+record|clean\s+record|nothing\s+to|no\s+issues?|never\s+been\s+arrested|never\s+charged)\b/i.test(t);
}

/**
 * Short but usable for blue-collar narratives (experience, motivation, etc.) — not corporate polish.
 */
export function isShortButOperationallyValidAnswer(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (isExplicitComplianceAnswer(t)) return true;
  const wc = t.split(/\s+/).filter(Boolean).length;
  if (wc > 12) return false;
  if (isLikelyComplianceAdmission(t)) return false;
  for (const re of OPERATIONAL_SIGNAL_PATTERNS) {
    if (re.test(t)) return true;
  }
  const tokens = extractOperationalSignalTokens(t);
  if (tokens.length >= 2) return true;
  return false;
}
