/**
 * Shift Reminder Profile Resolver
 *
 * Phase 1 of the Shift Cadence Engine.
 *
 * Returns the ordered list of reminder steps (type + offsetHours) that should be
 * scheduled for a given tenant/assignment. Default profile preserves the
 * original two-step cadence (24h + 2h). Gig-worker profile adds instruction /
 * clock-in / check-in steps tuned for CORT-style day labor.
 *
 * Reading config:
 *   tenants/{tenantId}/messagingConfig/shiftReminderProfile
 *     { profile: 'default' | 'cort_gig', enabled: true }
 *
 * Resolution order:
 *   1. assignment.shiftReminderProfile  (per-assignment override, rare)
 *   2. tenant config doc above          (tenant-wide choice)
 *   3. default                          (original 24h + 2h behavior)
 *
 * This module intentionally has no side effects — it's pure data lookup + mapping
 * so it can be unit-tested and called from both the onWrite trigger and the
 * backfill / debug callables.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export type ShiftReminderType =
  | 'assignment_reminder_24h'
  | 'assignment_reminder_2h'
  | 'assignment_reminder_2h_instructions'
  | 'assignment_reminder_15m_clockin'
  | 'assignment_checkin_0h'
  // Worker-facing "are you coming?" at T+15m when the Flex clock-in feed shows
  // no punch (2026-09-07, Greg / Daniel's confirmations board). Dispatcher
  // gates it to Flex-linked assignments (the only ones with a clock-in signal).
  | 'assignment_late_checkin_15m'
  | 'assignment_reminder_23h_escalate'
  | 'assignment_reminder_22h_final'
  // Qwick-style second opt-in a few hours before start — plans change
  // overnight; a worker who re-confirms that afternoon shows up.
  | 'assignment_reconfirm_4h'
  // Late-fill ask: synthesized at materialization when the 24h ask is
  // already past (worker assigned inside the window). Fires ~now, carries
  // the address, and re-anchors the escalation ladder.
  | 'assignment_confirm_now'
  // Career-track welcome the evening before the first day (address, who to
  // ask for). Careers get this + a morning-of note, and nothing else.
  | 'career_first_day'
  // Silent reminder — no SMS to worker. Fires T+30m after start; the
  // dispatcher routes it through a custom path that checks
  // cortConfirmation.state and alerts recruiters if the worker hasn't
  // confirmed arrival (state still 'confirmed' — i.e. no HERE, no clock-in).
  | 'assignment_noshow_check'
  // Open-shift track (Greg 2026-09-03: "once to start, then 1x per week").
  // Standing-crew, date-range assignments — the risk is schedule drift, not
  // commitment. Welcome fires once shortly after the assignment is created;
  // the digest fires Sunday evenings and re-arms itself for the next week
  // until the assignment ends. Neither is an offset-from-start step, so the
  // scheduler synthesizes them instead of running the planner.
  | 'openshift_welcome'
  | 'openshift_weekly_digest'
  // Claim Shift track (Greg 2026-09-03 decision 1, built 2026-09-06): a
  // claimed gig is an instant commitment, so the worker gets ONE immediate
  // artifact of it ("You're on the crew — {job} {date} at {site}") and the
  // 24h/23h/22h YES-ask ladder is skipped. Synthesized at materialization
  // (fires ~1 min after the claim), like openshift_welcome.
  | 'gig_claim_confirmation';

export type ShiftReminderProfileId =
  | 'default'
  | 'cort_gig'
  | 'gig_standard'
  | 'career_placement'
  | 'open_shift'
  | 'gig_claimed';

export interface ShiftReminderStep {
  /** Canonical reminder type; used as the Firestore doc id per assignment. */
  type: ShiftReminderType;
  /**
   * Offset in hours before the shift start. 0 means "at shift start".
   * NEGATIVE values are allowed and mean "after shift start" (the no-show
   * check fires at -0.5h, i.e. 30 minutes past start time).
   */
  offsetHours: number;
}

export interface ShiftReminderProfile {
  id: ShiftReminderProfileId;
  steps: ShiftReminderStep[];
}

const DEFAULT_PROFILE: ShiftReminderProfile = {
  id: 'default',
  steps: [
    { type: 'assignment_reminder_24h', offsetHours: 24 },
    { type: 'assignment_reminder_2h', offsetHours: 2 },
  ],
};

/**
 * The standardized gig track (2026-08-29, Greg: "standardize assignment
 * reminders with different rules for gigs vs careers"). Confirmation ask,
 * escalations while silent, a Qwick-style re-confirm at T-4h, the worksite
 * checklist at T-2h, the on-site check-in ask, and the silent no-show probe.
 */
const GIG_STANDARD_STEPS: ShiftReminderStep[] = [
  { type: 'assignment_reminder_24h', offsetHours: 24 },
  // Escalations fire only if the worker hasn't replied YES or CANCEL by
  // then (gated at dispatch time against assignment.cortConfirmation.state).
  { type: 'assignment_reminder_23h_escalate', offsetHours: 23 },
  { type: 'assignment_reminder_22h_final', offsetHours: 22 },
  // Second opt-in the afternoon of the shift — skipped only for workers who
  // cancelled or already checked in.
  { type: 'assignment_reconfirm_4h', offsetHours: 4 },
  // Replaces the generic 2h reminder with the instructions / address variant.
  { type: 'assignment_reminder_2h_instructions', offsetHours: 2 },
  { type: 'assignment_checkin_0h', offsetHours: 0 },
  // T+15m: no clock-in yet → ask the worker (HERE / NO). Flex-linked only.
  { type: 'assignment_late_checkin_15m', offsetHours: -0.25 },
  // Silent — fires 30 minutes AFTER shift start (negative offset).
  // Dispatcher checks whether worker has checked in; if not, flips state
  // to no_show and alerts recruiters. Worker receives nothing from this
  // step directly.
  { type: 'assignment_noshow_check', offsetHours: -0.5 },
];

const GIG_STANDARD_PROFILE: ShiftReminderProfile = {
  id: 'gig_standard',
  steps: GIG_STANDARD_STEPS,
};

/**
 * CORT = the standard gig track PLUS the T-15m clock-in step that carries
 * their QR clock-in link (clockInUrl from the shift extras).
 */
const CORT_GIG_PROFILE: ShiftReminderProfile = {
  id: 'cort_gig',
  steps: [
    ...GIG_STANDARD_STEPS.filter((s) => s.type !== 'assignment_checkin_0h' && s.type !== 'assignment_noshow_check'),
    { type: 'assignment_reminder_15m_clockin', offsetHours: 0.25 },
    { type: 'assignment_checkin_0h', offsetHours: 0 },
    { type: 'assignment_noshow_check', offsetHours: -0.5 },
  ],
};

/**
 * Careers are placements, not shifts: a welcome the evening before the first
 * day and a morning-of note. No confirmation demands, no escalations, no
 * no-show probes — a salaried hire nagged like a gig shift learns to ignore
 * us. offsetHours 15 lands the welcome the prior evening for morning starts
 * (8 AM start → 5 PM the day before), with the 8 AM floor as the backstop.
 */
const CAREER_PLACEMENT_PROFILE: ShiftReminderProfile = {
  id: 'career_placement',
  steps: [
    { type: 'career_first_day', offsetHours: 15 },
    { type: 'assignment_reminder_2h', offsetHours: 2 },
    // Careers placed through Flex have clock-ins too (Greg 2026-09-07: "not
    // just for gigs"); the step is a no-op for non-Flex careers.
    { type: 'assignment_late_checkin_15m', offsetHours: -0.25 },
    { type: 'assignment_noshow_check', offsetHours: -0.5 },
  ],
};

/**
 * Open shifts (Greg 2026-09-03): a welcome when the assignment is created
 * and a weekly Sunday-evening schedule digest — replacing the per-day
 * 24h+2h pairs (a 5-day standing week meant 10 near-identical texts).
 * Steps stay empty: welcome/digest aren't offsets from a start time, so
 * the scheduler synthesizes their docs when profile.id === 'open_shift'.
 */
const OPEN_SHIFT_PROFILE: ShiftReminderProfile = {
  id: 'open_shift',
  steps: [],
};

/**
 * The steps whose only job is to turn an ASSIGNED worker into a COMMITTED one.
 * A claimed shift is already committed (the claim IS the confirmation), so the
 * claim fence strips exactly these. `assignment_reconfirm_4h` deliberately
 * stays — plans change overnight and the afternoon re-confirm is what makes
 * people show up (Qwick pattern).
 */
export const ASK_LADDER_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_reminder_24h',
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
  'assignment_confirm_now',
];

/**
 * Claim Shift track (tier system). Built from the standard gig track minus the
 * ask ladder, plus the immediate claim confirmation. When the underlying
 * resolution is `cort_gig`, the claim fence derives from THAT profile instead so
 * the T-15m clock-in step survives — see `applyClaimedFence`.
 */
const GIG_CLAIMED_PROFILE: ShiftReminderProfile = {
  id: 'gig_claimed',
  steps: [
    { type: 'gig_claim_confirmation', offsetHours: 0 },
    ...GIG_STANDARD_STEPS.filter((s) => !ASK_LADDER_REMINDER_TYPES.includes(s.type)),
  ],
};

const PROFILES_BY_ID: Record<ShiftReminderProfileId, ShiftReminderProfile> = {
  default: DEFAULT_PROFILE,
  cort_gig: CORT_GIG_PROFILE,
  gig_standard: GIG_STANDARD_PROFILE,
  career_placement: CAREER_PLACEMENT_PROFILE,
  open_shift: OPEN_SHIFT_PROFILE,
  gig_claimed: GIG_CLAIMED_PROFILE,
};

/** True when the worker created this assignment themselves by claiming a shift. */
export function isClaimedAssignment(assignment: Record<string, unknown> | null | undefined): boolean {
  return String(assignment?.acquisition ?? '').trim().toLowerCase() === 'claimed';
}

/**
 * Claim fence: for `acquisition === 'claimed'` gig assignments, replace the
 * resolved gig track with its claimed variant — same steps minus the ask
 * ladder, plus the immediate claim confirmation. Careers and open shifts are
 * never claimed (their fences run first); a tenant on the plain `default`
 * track gets the standard claimed set (reconfirm, logistics, check-in,
 * no-show) rather than a lone 2h reminder.
 */
export function applyClaimedFence(
  assignment: Record<string, unknown>,
  resolved: ResolvedShiftReminderProfile,
): ResolvedShiftReminderProfile {
  // Daily-confirm crews are careers — never claimed; leave their track alone.
  if (!isClaimedAssignment(assignment) || resolved.dailyConfirm) return resolved;
  const base = resolved.profile;
  if (base.id === 'career_placement' || base.id === 'open_shift' || base.id === 'gig_claimed') return resolved;
  const baseSteps = base.id === 'cort_gig' || base.id === 'gig_standard' ? base.steps : GIG_STANDARD_STEPS;
  return {
    profile: {
      id: 'gig_claimed',
      steps: [
        { type: 'gig_claim_confirmation', offsetHours: 0 },
        ...baseSteps.filter((s) => !ASK_LADDER_REMINDER_TYPES.includes(s.type)),
      ],
    },
    sequenceId: resolved.sequenceId,
  };
}

/**
 * All reminder types this system can possibly write. Used by the cleanup /
 * cancel code path to know which doc ids to touch on an assignment.
 */
export const ALL_SHIFT_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_reminder_24h',
  'assignment_reminder_2h',
  'assignment_reminder_2h_instructions',
  'assignment_reminder_15m_clockin',
  'assignment_checkin_0h',
  'assignment_late_checkin_15m',
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
  'assignment_reconfirm_4h',
  'assignment_confirm_now',
  'career_first_day',
  'assignment_noshow_check',
  'openshift_welcome',
  'openshift_weekly_digest',
  'gig_claim_confirmation',
];

/**
 * The reminder types that ASK the worker to reply YES / CANCEL. When one of
 * these sends we stamp `cortConfirmation.lastAskedAt` on the assignment so an
 * inbound "YES" can be bound to the shift the worker was actually asked
 * about — a worker holding two pending shifts the same day (Kelly Idarraga,
 * 2026-08-30) otherwise had every reply bound to the EARLIER one, leaving the
 * later shift's escalation ladder live and re-asking her all evening.
 */
export const CONFIRMATION_ASK_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_reminder_24h',
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
  'assignment_reconfirm_4h',
  'assignment_confirm_now',
];

function normalizeProfileId(raw: unknown): ShiftReminderProfileId | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'cort_gig' || s === 'cort' || s === 'gig') return 'cort_gig';
  if (s === 'gig_standard' || s === 'standard') return 'gig_standard';
  if (s === 'career_placement' || s === 'career') return 'career_placement';
  if (s === 'gig_claimed' || s === 'claimed') return 'gig_claimed';
  if (s === 'default' || s === '') return 'default';
  return null;
}

async function getTenantProfileId(tenantId: string): Promise<ShiftReminderProfileId | null> {
  if (!tenantId) return null;
  try {
    const snap = await db
      .doc(`tenants/${tenantId}/messagingConfig/shiftReminderProfile`)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    if (data?.enabled === false) return null;
    return normalizeProfileId(data?.profile);
  } catch (err) {
    logger.warn('shiftReminderProfile.getTenantProfileId_failed', {
      tenantId,
      error: (err as Error)?.message || String(err),
    });
    return null;
  }
}

/**
 * Phase 2 (2026-08-27): the Settings → Messaging Sequences targeting docs
 * (`tenants/{t}/messagingSequences/{sequenceId}`) GOVERN which assignments
 * get the confirmation cadence. When any doc has saved targeting, the docs
 * win over the legacy `messagingConfig/shiftReminderProfile` tenant switch;
 * when none has ever been saved, the legacy switch still applies.
 *
 * 2026-08-29: generalized from the single hardcoded `cort_gig` doc to the
 * whole collection so each sequence carries its own accounts + occurrence
 * (CORT stays first_shift; the Oakland Arena pilot is every_shift), and
 * added optional `locationIds` so a sequence can target one venue inside a
 * national account (Oakland Arena lives under Legends National Account).
 */
export interface SequenceTargeting {
  sequenceId: string;
  active: boolean;
  accountIds: string[];
  locationIds: string[];
  workerTypes: string[];
  occurrence: 'first_shift' | 'every_shift';
  /** Which gig track the sequence applies (doc field `track`). */
  profileId: 'cort_gig' | 'gig_standard';
  /**
   * Greg 2026-09-11 (CORT Woodridge): opt the CAREER placements at the
   * targeted venues into this track, asked once per scheduled workday. Only
   * honored with accountIds AND locationIds, workerTypes 'career', and
   * occurrence 'every_shift' (see careerOptInProblems) — never account-wide.
   */
  includeCareer: boolean;
}

async function getSequenceTargetings(tenantId: string): Promise<SequenceTargeting[] | null> {
  if (!tenantId) return null;
  try {
    const snap = await db.collection(`tenants/${tenantId}/messagingSequences`).get();
    const out: SequenceTargeting[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown> | undefined;
      const t = data?.targeting as Record<string, unknown> | undefined;
      if (!t) continue;
      const track = normalizeProfileId(data?.track);
      out.push({
        sequenceId: doc.id,
        active: t.active === true,
        accountIds: Array.isArray(t.accountIds) ? t.accountIds.map((x) => String(x)) : [],
        locationIds: Array.isArray(t.locationIds) ? t.locationIds.map((x) => String(x)) : [],
        workerTypes: Array.isArray(t.workerTypes)
          ? t.workerTypes.map((x) => String(x).toLowerCase())
          : ['gig'],
        occurrence: t.occurrence === 'every_shift' ? 'every_shift' : 'first_shift',
        // Legacy docs (no track field) keep the CORT cadence they always ran.
        profileId: track === 'gig_standard' ? 'gig_standard' : 'cort_gig',
        includeCareer: t.includeCareer === true,
      });
    }
    return out.length > 0 ? out : null;
  } catch (err) {
    logger.warn('shiftReminderProfile.getSequenceTargeting_failed', {
      tenantId,
      error: (err as Error)?.message || String(err),
    });
    return null;
  }
}

/** Why a targeting doc can't opt careers in — [] means it validly does. */
export function careerOptInProblems(t: SequenceTargeting): string[] {
  const problems: string[] = [];
  if (!t.includeCareer) problems.push('includeCareer_not_set');
  if (!t.active) problems.push('inactive');
  if (t.accountIds.length === 0) problems.push('no_accountIds');
  if (t.locationIds.length === 0) problems.push('no_locationIds');
  if (!t.workerTypes.includes('career')) problems.push('workerTypes_missing_career');
  if (t.occurrence !== 'every_shift') problems.push('occurrence_not_every_shift');
  return problems;
}

/**
 * Account + venue match. `accountLineage` is the assignment's accountId
 * followed by its ancestors (child → national), so a sequence that targets a
 * national account covers every per-location child account without listing
 * each one (2026-09-11: CORT job orders carry `autoLoc_*` child accounts, and
 * the national-only `cort_gig` doc matched nothing until 74 ids were pasted in).
 */
export function targetingMatchesAccountAndLocation(
  t: SequenceTargeting,
  assignment: Record<string, unknown>,
  accountLineage: ReadonlyArray<string>,
): boolean {
  if (accountLineage.length === 0 || t.accountIds.length === 0) return false;
  if (!accountLineage.some((id) => t.accountIds.includes(id))) return false;
  const locId = String(assignment?.locationId ?? '').trim();
  if (t.locationIds.length > 0 && (!locId || !t.locationIds.includes(locId))) return false;
  return true;
}

/** First sequence that validly opts this CAREER assignment into daily confirmation. */
export function selectCareerDailyConfirmSequence(
  targetings: ReadonlyArray<SequenceTargeting>,
  assignment: Record<string, unknown>,
  accountLineage: ReadonlyArray<string>,
): SequenceTargeting | null {
  for (const t of targetings) {
    if (careerOptInProblems(t).length > 0) continue;
    if (targetingMatchesAccountAndLocation(t, assignment, accountLineage)) return t;
  }
  return null;
}

/** Gig sequences matching this assignment, in doc order. first_shift docs still
 *  need the async prior-completion check before one wins. */
export function gigSequenceCandidates(
  targetings: ReadonlyArray<SequenceTargeting>,
  assignment: Record<string, unknown>,
  accountLineage: ReadonlyArray<string>,
): SequenceTargeting[] {
  return targetings.filter(
    (t) => t.active && t.workerTypes.includes('gig') && targetingMatchesAccountAndLocation(t, assignment, accountLineage),
  );
}

const ACCOUNT_LINEAGE_TTL_MS = 5 * 60 * 1000;
const accountLineageCache = new Map<string, { lineage: string[]; at: number }>();

/** accountId + up to 3 ancestors via tenants/{t}/accounts/{id}.parentAccountId. Fail-open to [accountId]. */
async function getAccountLineage(tenantId: string, accountId: string): Promise<string[]> {
  if (!accountId) return [];
  const key = `${tenantId}/${accountId}`;
  const hit = accountLineageCache.get(key);
  if (hit && Date.now() - hit.at < ACCOUNT_LINEAGE_TTL_MS) return hit.lineage;
  const lineage = [accountId];
  try {
    let current = accountId;
    for (let depth = 0; depth < 3; depth += 1) {
      const snap = await db.doc(`tenants/${tenantId}/accounts/${current}`).get();
      const parent = String(snap.get('parentAccountId') ?? '').trim();
      if (!parent || lineage.includes(parent)) break;
      lineage.push(parent);
      current = parent;
    }
  } catch (err) {
    logger.warn('shiftReminderProfile.account_lineage_failed', {
      tenantId,
      accountId,
      error: (err as Error)?.message || String(err),
    });
  }
  accountLineageCache.set(key, { lineage, at: Date.now() });
  return lineage;
}

export interface ResolvedShiftReminderProfile {
  profile: ShiftReminderProfile;
  /** The messagingSequences doc that matched, when the profile came from
   *  targeting — lets dispatch load that sequence's copy overrides. Null
   *  for fences, per-assignment overrides, and the legacy tenant switch. */
  sequenceId: string | null;
  /** A career opt-in matched: materialize the steps once per scheduled
   *  workday from weeklySchedule (cadence/dailyConfirm.ts), not once from
   *  the assignment's first day. */
  dailyConfirm?: boolean;
}

/**
 * Resolve the profile for this (tenant, assignment). Never throws — falls back
 * to the default profile on any lookup error. Upstream callers should treat the
 * returned list as the canonical set of reminders to materialize.
 */
export async function resolveShiftReminderProfile(args: {
  tenantId: string;
  assignment: Record<string, unknown>;
}): Promise<ResolvedShiftReminderProfile> {
  const base = await resolveShiftReminderProfileBase(args);
  // Claim fence runs LAST: it needs the resolved gig track (cort vs standard)
  // to know which steps to keep.
  return applyClaimedFence(args.assignment, base);
}

/**
 * The fences, pure (unit-tested): Open Shift → open_shift, no exception;
 * career → the daily-confirm opt-in when a sequence validly targets its
 * venue, else career_placement. Null = not fenced; the gig path continues.
 */
export function resolveFencedProfile(
  assignment: Record<string, unknown>,
  targetings: ReadonlyArray<SequenceTargeting> | null,
  accountLineage: ReadonlyArray<string>,
): ResolvedShiftReminderProfile | null {
  if (assignment?.isOpenShift === true) return { profile: OPEN_SHIFT_PROFILE, sequenceId: null };
  if (String(assignment?.jobOrderType ?? '').trim().toLowerCase() !== 'career') return null;
  const optIn = targetings ? selectCareerDailyConfirmSequence(targetings, assignment, accountLineage) : null;
  if (optIn) return { profile: PROFILES_BY_ID[optIn.profileId], sequenceId: optIn.sequenceId, dailyConfirm: true };
  return { profile: CAREER_PLACEMENT_PROFILE, sequenceId: null };
}

async function resolveShiftReminderProfileBase(args: {
  tenantId: string;
  assignment: Record<string, unknown>;
}): Promise<ResolvedShiftReminderProfile> {
  const { tenantId, assignment } = args;

  // Hard product fences (Greg, 2026-08-29): the confirm/check-in cadence is
  // for gig SHIFT work only. Careers get their own quiet track (first-day
  // welcome + morning-of note — never confirmation demands or no-show
  // probes); Open Shift (standing-crew, date-range) assignments get their own
  // welcome + check-in track. No tenant switch or per-assignment override can
  // pull either into the confirm cadence, and Open Shifts have no exception.
  //
  // ONE narrow career exception (Greg, 2026-09-11 — CORT Woodridge ran 27%
  // no-show on Indeed Flex's scorecard): a messagingSequences doc with
  // `targeting.includeCareer` that names BOTH accounts and venues (plus
  // workerTypes 'career' + every_shift — see careerOptInProblems) opts the
  // careers at exactly those venues into the track, asked every scheduled
  // workday (`dailyConfirm` → workerShiftRemindersV2 expands weeklySchedule).
  // Every other career stays fenced. Don't widen this into an account-wide
  // or tenant-wide switch, and don't move the fence below the override.
  const acctId = String(assignment?.accountId ?? '').trim();
  const isCareer =
    assignment?.isOpenShift !== true && String(assignment?.jobOrderType ?? '').trim().toLowerCase() === 'career';
  let careerTargetings: SequenceTargeting[] | null = null;
  let careerLineage: string[] = [];
  if (isCareer) {
    careerTargetings = await getSequenceTargetings(tenantId);
    if (careerTargetings?.some((t) => t.includeCareer)) careerLineage = await getAccountLineage(tenantId, acctId);
  }
  const fenced = resolveFencedProfile(assignment, careerTargetings, careerLineage);
  if (fenced) {
    if (isCareer && !fenced.dailyConfirm) {
      for (const t of careerTargetings ?? []) {
        // A doc that WOULD match but is missing a guard rail: say so, since
        // the fence wins silently otherwise.
        if (!t.includeCareer || !targetingMatchesAccountAndLocation(t, assignment, careerLineage)) continue;
        logger.warn('shiftReminderProfile.career_opt_in_ignored', {
          tenantId,
          sequenceId: t.sequenceId,
          problems: careerOptInProblems(t),
        });
      }
    }
    return fenced;
  }

  // Honor the override ONLY when the field is actually set: normalizeProfileId
  // maps '' to 'default' (correct for the tenant-config doc), so feeding it an
  // absent field made this branch return 'default' for EVERY assignment and
  // left the targeting scan below unreachable (found 2026-08-29 when the
  // Oakland pilot resolved to the default profile despite a matching doc).
  const rawOverride = String(assignment?.shiftReminderProfile ?? '').trim();
  const perAssignmentId = rawOverride ? normalizeProfileId(rawOverride) : null;
  if (perAssignmentId) {
    return { profile: PROFILES_BY_ID[perAssignmentId], sequenceId: null };
  }

  const targetings = await getSequenceTargetings(tenantId);
  if (targetings) {
    const lineage = await getAccountLineage(tenantId, acctId);
    for (const targeting of gigSequenceCandidates(targetings, assignment, lineage)) {
      if (targeting.occurrence === 'first_shift') {
        // "First shift at account (until completion)": once the worker has a
        // COMPLETED/ended assignment at this account, later shifts drop to
        // the default two-step cadence. Fail-open to the CORT profile.
        const userId = String(assignment?.userId ?? assignment?.candidateId ?? '').trim();
        if (userId) {
          try {
            const priorSnap = await db
              .collection(`tenants/${tenantId}/assignments`)
              .where('userId', '==', userId)
              .where('accountId', '==', acctId)
              .limit(10)
              .get();
            const hasCompletedPrior = priorSnap.docs.some((d) =>
              ['completed', 'ended'].includes(String(d.data()?.status ?? '').trim().toLowerCase()),
            );
            if (hasCompletedPrior) continue;
          } catch (err) {
            logger.warn('shiftReminderProfile.first_shift_lookup_failed', {
              tenantId,
              error: (err as Error)?.message || String(err),
            });
          }
        }
      }
      return { profile: PROFILES_BY_ID[targeting.profileId], sequenceId: targeting.sequenceId };
    }
    // Targeting docs exist → they govern; no fallback to the legacy switch.
    return { profile: DEFAULT_PROFILE, sequenceId: null };
  }

  const tenantId_ = await getTenantProfileId(tenantId);
  if (tenantId_) {
    return { profile: PROFILES_BY_ID[tenantId_], sequenceId: null };
  }
  return { profile: DEFAULT_PROFILE, sequenceId: null };
}

/**
 * Synchronous variant — use ONLY when the caller has already fetched the tenant
 * config doc (e.g. during batch backfill). Pure function, easy to unit-test.
 */
export function resolveShiftReminderProfileSync(args: {
  tenantProfile: ShiftReminderProfileId | null | undefined;
  assignment: Record<string, unknown>;
}): ShiftReminderProfile {
  const base = resolveShiftReminderProfileSyncBase(args);
  return applyClaimedFence(args.assignment, { profile: base, sequenceId: null }).profile;
}

function resolveShiftReminderProfileSyncBase(args: {
  tenantProfile: ShiftReminderProfileId | null | undefined;
  assignment: Record<string, unknown>;
}): ShiftReminderProfile {
  // Same hard fences as the async resolver: gig shift work only. Careers stay
  // fenced here unconditionally — the daily-confirm opt-in needs the targeting
  // docs, which only the async resolver reads.
  if (args.assignment?.isOpenShift === true) return OPEN_SHIFT_PROFILE;
  if (String(args.assignment?.jobOrderType ?? '').trim().toLowerCase() === 'career') {
    return CAREER_PLACEMENT_PROFILE;
  }
  // Same absent-field guard as the async resolver — '' normalizes to
  // 'default' and must not count as an override.
  const rawOverride = String(args.assignment?.shiftReminderProfile ?? '').trim();
  const perAssignmentId = rawOverride ? normalizeProfileId(rawOverride) : null;
  if (perAssignmentId) return PROFILES_BY_ID[perAssignmentId];
  const tenantId = normalizeProfileId(args.tenantProfile);
  if (tenantId) return PROFILES_BY_ID[tenantId];
  return DEFAULT_PROFILE;
}
