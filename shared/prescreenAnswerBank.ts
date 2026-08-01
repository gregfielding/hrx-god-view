/**
 * Cumulative worker pre-screen answer bank — staleness policy + delta computation.
 *
 * The bank lives at `users/{uid}/prescreen/answerBank` (admin-written only) and holds the latest
 * answer per question id with when it was answered. A new application's interview asks only the
 * DELTA: target question set minus bank answers that are still fresh for their category.
 * See docs/prescreen-cumulative-interview.md.
 *
 * Pure module, no imports — byte-identical copies in `shared/`, `src/shared/`,
 * `functions/src/shared/`. Question-id lists and thresholds below mirror
 * `functions/src/workerAiPrescreen/{prescreenOpeningKeys,submitWorkerAiPrescreenInterview,prescreenTextAnswerQuality}.ts`
 * and `src/shared/prescreenAnswerQuality.ts`; keep in sync when those change.
 */

export const PRESCREEN_BANK_COLLECTION = 'prescreen';
export const PRESCREEN_BANK_DOC_ID = 'answerBank';
export const PRESCREEN_BANK_VERSION = 1;

/** Keep in sync with PRESCREEN_MIN_SUBSTANTIVE_WORDS (client + functions copies). */
export const PRESCREEN_BANK_MIN_SUBSTANTIVE_WORDS = 9;
/** Keep in sync with COMPLIANCE_DETAIL_MIN_CHARS in submitWorkerAiPrescreenInterview.ts. */
export const PRESCREEN_BANK_COMPLIANCE_DETAIL_MIN_CHARS = 15;

export type PrescreenBankAnswerValue = string | string[];

export type PrescreenBankEntryLite = {
  answer: PrescreenBankAnswerValue;
  answeredAtMs: number;
};

export type PrescreenBankCategory =
  | 'preferences'
  | 'experience'
  | 'reliability'
  | 'compliance'
  | 'certification'
  | 'wrap_up'
  | 'job_specific'
  | 'identity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Keep in sync with PRESCREEN_OPENING_MULTI_SELECT_KEYS (functions/src/workerAiPrescreen/prescreenOpeningKeys.ts). */
const OPENING_MULTI_SELECT_IDS = [
  'opening_target_work_types',
  'opening_schedule_preferences',
  'opening_experience_industrial',
  'opening_experience_hospitality',
  'opening_experience_events',
  'opening_experience_clerical',
  'opening_experience_healthcare',
  'opening_gig_types',
] as const;

const MULTI_SELECT_IDS = new Set<string>(['work_confidence', ...OPENING_MULTI_SELECT_IDS]);

const EXPERIENCE_IDS = new Set<string>([
  'motivation',
  'experience_details',
  'work_confidence',
  'pressure_situation',
]);

const RELIABILITY_IDS = new Set<string>([
  'attendance_issues',
  'attendance_explanation',
  'transportation_plan',
  'backup_transportation',
  'physical_comfort',
]);

const COMPLIANCE_IDS = new Set<string>([
  'drug_screen',
  'drug_screen_detail',
  'background_check',
  'background_check_detail',
  'background_offense_class',
  'background_offense_when',
  'dyn_job_drug_screen',
  'dyn_job_background_check',
]);

const WRAP_UP_IDS = new Set<string>(['supervisor_feedback', 'additional_notes']);

/** Substantive-narrative text ids (min word count for bank coverage). */
const SUBSTANTIVE_TEXT_IDS = new Set<string>([
  'motivation',
  'pressure_situation',
  'supervisor_feedback',
]);

const ALLOWED_YES_NO = new Set(['yes', 'no']);
const ALLOWED_YES_NO_NOT_SURE = new Set(['yes', 'no', 'not_sure']);
/** `not_sure_yet` is a valid interview answer but too weak to carry across applications. */
const ALLOWED_TRANSPORT_FOR_CARRY = new Set([
  'own_vehicle',
  'ride_from_someone_else',
  'public_transportation',
  'walk_bike',
  'other',
]);

export function prescreenBankCategoryForQuestionId(id: string): PrescreenBankCategory {
  if (id === 'confirm_legal_first_name') return 'identity';
  if (id.startsWith('opening_')) return 'preferences';
  if (id === 'dyn_gig_path_willing') return 'preferences';
  if (EXPERIENCE_IDS.has(id)) return 'experience';
  if (RELIABILITY_IDS.has(id)) return 'reliability';
  if (COMPLIANCE_IDS.has(id)) return 'compliance';
  if (id.startsWith('dyn_cert')) return 'certification';
  if (WRAP_UP_IDS.has(id)) return 'wrap_up';
  // dyn_shift_punctuality, dyn_worksite_commute, dyn_physical_job_fit, dyn_uniform_available,
  // and any future/unknown ids: per-job, always asked.
  return 'job_specific';
}

const CATEGORY_FRESHNESS_MS: Record<PrescreenBankCategory, number | null> = {
  preferences: 90 * DAY_MS,
  experience: 180 * DAY_MS,
  reliability: 90 * DAY_MS,
  compliance: 180 * DAY_MS,
  certification: 365 * DAY_MS, // expiry proxy — no per-cert expiry data yet
  wrap_up: 180 * DAY_MS,
  job_specific: null, // never carried — asked for every job
  identity: null, // gated by userDocNeedsLegalFirstNameConfirm, never carried
};

/**
 * Freshness window for a question id; `null` = never satisfied from the bank (always asked).
 */
export function prescreenBankFreshnessMsForQuestionId(id: string): number | null {
  if (id === 'additional_notes') return 90 * DAY_MS;
  if (id.startsWith('dyn_cert_willing__')) return 90 * DAY_MS;
  return CATEGORY_FRESHNESS_MS[prescreenBankCategoryForQuestionId(id)];
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeToArray(v: PrescreenBankAnswerValue): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function normLower(v: PrescreenBankAnswerValue): string {
  return String(Array.isArray(v) ? v.join(', ') : (v ?? ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * Whether a banked answer is strong enough to carry into a new interview — mirrors the wizard's
 * per-step minimums (`validatePrescreenNavEntry`) plus carry-specific tightenings ("not sure"
 * style answers are answered-but-not-carriable).
 */
export function isPrescreenBankAnswerUsable(id: string, value: PrescreenBankAnswerValue): boolean {
  if (id === 'confirm_legal_first_name') return false;
  if (MULTI_SELECT_IDS.has(id)) return normalizeToArray(value).length > 0;

  const raw = String(Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
  if (!raw) return false;
  const norm = normLower(value);

  if (id === 'attendance_issues' || id === 'backup_transportation' || id === 'physical_comfort') {
    return ALLOWED_YES_NO.has(norm);
  }
  if (id === 'transportation_plan') return ALLOWED_TRANSPORT_FOR_CARRY.has(norm);
  if (id === 'drug_screen' || id === 'background_check') {
    // `not_sure` is a legal live answer but not worth carrying — re-ask next time.
    return norm === 'yes' || norm === 'no';
  }
  if (id === 'drug_screen_detail' || id === 'background_check_detail') {
    return raw.length >= PRESCREEN_BANK_COMPLIANCE_DETAIL_MIN_CHARS;
  }
  if (id.startsWith('dyn_')) {
    if (!ALLOWED_YES_NO_NOT_SURE.has(norm)) return false;
    // A definite yes/no carries; "not sure" gets re-asked.
    return norm !== 'not_sure';
  }
  if (id === 'experience_details') {
    // Fast-path parity: >=3 words proceeds (followup text is merged in before storage).
    return wordCount(raw) >= 3;
  }
  if (SUBSTANTIVE_TEXT_IDS.has(id)) {
    return wordCount(raw) >= PRESCREEN_BANK_MIN_SUBSTANTIVE_WORDS;
  }
  if (id === 'attendance_explanation') {
    return wordCount(raw) >= PRESCREEN_BANK_MIN_SUBSTANTIVE_WORDS || /^(n\/a|na)$/i.test(raw);
  }
  return raw.length >= 2;
}

/**
 * Parse a Firestore bank doc's `answers` map into ms-based entries. Accepts admin/client
 * Timestamps (duck-typed `toMillis`), `{seconds}` shapes, or numbers.
 */
export function parsePrescreenBankDocAnswers(data: unknown): Record<string, PrescreenBankEntryLite> {
  const out: Record<string, PrescreenBankEntryLite> = {};
  const answers =
    data && typeof data === 'object' ? (data as Record<string, unknown>).answers : undefined;
  if (!answers || typeof answers !== 'object') return out;
  for (const [id, rawEntry] of Object.entries(answers as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const e = rawEntry as Record<string, unknown>;
    const answer = e.answer;
    if (typeof answer !== 'string' && !Array.isArray(answer)) continue;
    const answeredAtMs = timestampLikeToMs(e.answeredAt);
    if (answeredAtMs == null) continue;
    out[id] = { answer: answer as PrescreenBankAnswerValue, answeredAtMs };
  }
  return out;
}

function timestampLikeToMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as { toMillis?: unknown; seconds?: unknown };
    if (typeof o.toMillis === 'function') {
      const ms = (o.toMillis as () => number)();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return null;
}

export type FreshPrescreenBankAnswers = {
  /** Fresh + carriable core answers (arrays for multi-select ids). */
  coreAnswers: Record<string, PrescreenBankAnswerValue>;
  /** Fresh + carriable `dyn_*` answers (normalized yes/no tokens). */
  dynamicAnswers: Record<string, string>;
};

export function freshPrescreenBankAnswers(
  bank: Record<string, PrescreenBankEntryLite>,
  nowMs: number,
): FreshPrescreenBankAnswers {
  const coreAnswers: Record<string, PrescreenBankAnswerValue> = {};
  const dynamicAnswers: Record<string, string> = {};
  for (const [id, entry] of Object.entries(bank)) {
    const windowMs = prescreenBankFreshnessMsForQuestionId(id);
    if (windowMs == null) continue;
    if (!(Number.isFinite(entry.answeredAtMs) && nowMs - entry.answeredAtMs <= windowMs)) continue;
    if (!isPrescreenBankAnswerUsable(id, entry.answer)) continue;
    if (id.startsWith('dyn_')) {
      dynamicAnswers[id] = normLower(entry.answer);
    } else {
      coreAnswers[id] = MULTI_SELECT_IDS.has(id) ? normalizeToArray(entry.answer) : entry.answer;
    }
  }
  return { coreAnswers, dynamicAnswers };
}

export type PrescreenBankDeltaInput = {
  fresh: FreshPrescreenBankAnswers;
  /** Full dynamic plan ids for this application (server order). */
  dynamicStepIds: string[];
  /**
   * Dynamic ids already covered by the deterministic core-answer dedupe
   * (`applyPrescreenDynamicDedupe` run against the fresh bank answers) — caller-computed so the
   * dedupe rules stay single-sourced.
   */
  dedupeCoveredDynamicIds: string[];
  needsLegalNameConfirm: boolean;
};

export type PrescreenBankDelta = {
  /** Core question ids the worker still needs to answer (statically derivable subset). */
  neededCoreStepIds: string[];
  neededDynamicStepIds: string[];
  /** Question ids satisfied from the bank for this application. */
  coveredCoreStepIds: string[];
  coveredDynamicStepIds: string[];
  /** True when the interview can be skipped entirely (nothing blocking to ask). */
  zeroDelta: boolean;
};

/**
 * Compute which questions a new application's interview still needs, given fresh bank answers.
 *
 * Conditional steps whose gate answer is itself stale (e.g. `opening_experience_*` when
 * `opening_target_work_types` must be re-asked) are NOT listed — the wizard reveals them from live
 * answers as today; zero-delta requires every gate to be fresh, so the skip decision is exact.
 *
 * `additional_notes` is optional: it joins a non-empty delta but never blocks zero-delta.
 */
export function computePrescreenBankDelta(input: PrescreenBankDeltaInput): PrescreenBankDelta {
  const { fresh, dynamicStepIds, dedupeCoveredDynamicIds, needsLegalNameConfirm } = input;
  const core = fresh.coreAnswers;
  const has = (id: string): boolean => id in core;
  const str = (id: string): string => normLower(core[id] ?? '');
  const arr = (id: string): string[] => normalizeToArray(core[id] ?? []);

  const neededCoreStepIds: string[] = [];
  const coveredCoreStepIds: string[] = [];
  const mark = (id: string): void => {
    if (has(id)) coveredCoreStepIds.push(id);
    else neededCoreStepIds.push(id);
  };

  mark('opening_target_work_types');
  mark('opening_schedule_preferences');
  if (has('opening_target_work_types')) {
    const targets = new Set(arr('opening_target_work_types'));
    if (targets.has('industrial')) mark('opening_experience_industrial');
    if (targets.has('hospitality')) mark('opening_experience_hospitality');
    if (targets.has('events')) mark('opening_experience_events');
    if (targets.has('clerical_admin')) mark('opening_experience_clerical');
    if (targets.has('healthcare')) mark('opening_experience_healthcare');
  }
  if (has('opening_schedule_preferences') && new Set(arr('opening_schedule_preferences')).has('gig_work')) {
    mark('opening_gig_types');
  }

  mark('work_confidence');
  mark('attendance_issues');
  if (str('attendance_issues') === 'yes') mark('attendance_explanation');
  mark('transportation_plan');
  mark('backup_transportation');
  mark('physical_comfort');

  mark('experience_details');
  if (has('experience_details')) {
    // Expanded-narrative parity with `shouldAskExpandedQuestions` (<8 words → motivation/pressure shown).
    const expWords = wordCount(String(core['experience_details'] ?? ''));
    if (expWords < 8) {
      mark('motivation');
      mark('pressure_situation');
    }
  }

  const dynSet = new Set(dynamicStepIds);
  if (!dynSet.has('dyn_job_drug_screen')) {
    mark('drug_screen');
    if (str('drug_screen') === 'yes') mark('drug_screen_detail');
  }
  if (!dynSet.has('dyn_job_background_check')) {
    mark('background_check');
    if (str('background_check') === 'yes') mark('background_check_detail');
  }
  mark('supervisor_feedback');
  mark('additional_notes');

  const dedupeCovered = new Set(dedupeCoveredDynamicIds);
  const neededDynamicStepIds: string[] = [];
  const coveredDynamicStepIds: string[] = [];
  for (const id of dynamicStepIds) {
    if (dedupeCovered.has(id)) {
      coveredDynamicStepIds.push(id);
      continue;
    }
    const bankable = prescreenBankFreshnessMsForQuestionId(id) != null;
    if (bankable && id in fresh.dynamicAnswers) coveredDynamicStepIds.push(id);
    else neededDynamicStepIds.push(id);
  }

  const blockingCore = neededCoreStepIds.filter((id) => id !== 'additional_notes');
  const zeroDelta =
    !needsLegalNameConfirm && blockingCore.length === 0 && neededDynamicStepIds.length === 0;

  return {
    neededCoreStepIds: zeroDelta ? [] : neededCoreStepIds,
    neededDynamicStepIds,
    coveredCoreStepIds: zeroDelta
      ? [...coveredCoreStepIds, ...neededCoreStepIds]
      : coveredCoreStepIds,
    coveredDynamicStepIds,
    zeroDelta,
  };
}
