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
  | 'assignment_noshow_check';

export type ShiftReminderProfileId = 'default' | 'cort_gig' | 'gig_standard' | 'career_placement';

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
  ],
};

const PROFILES_BY_ID: Record<ShiftReminderProfileId, ShiftReminderProfile> = {
  default: DEFAULT_PROFILE,
  cort_gig: CORT_GIG_PROFILE,
  gig_standard: GIG_STANDARD_PROFILE,
  career_placement: CAREER_PLACEMENT_PROFILE,
};

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
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
  'assignment_reconfirm_4h',
  'assignment_confirm_now',
  'career_first_day',
  'assignment_noshow_check',
];

function normalizeProfileId(raw: unknown): ShiftReminderProfileId | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'cort_gig' || s === 'cort' || s === 'gig') return 'cort_gig';
  if (s === 'gig_standard' || s === 'standard') return 'gig_standard';
  if (s === 'career_placement' || s === 'career') return 'career_placement';
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
interface SequenceTargeting {
  sequenceId: string;
  active: boolean;
  accountIds: string[];
  locationIds: string[];
  workerTypes: string[];
  occurrence: 'first_shift' | 'every_shift';
  /** Which gig track the sequence applies (doc field `track`). Careers never
   *  come from targeting — the career fence routes them before this scan. */
  profileId: 'cort_gig' | 'gig_standard';
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

/**
 * Resolve the profile for this (tenant, assignment). Never throws — falls back
 * to the default profile on any lookup error. Upstream callers should treat the
 * returned list as the canonical set of reminders to materialize.
 */
export async function resolveShiftReminderProfile(args: {
  tenantId: string;
  assignment: Record<string, unknown>;
}): Promise<ShiftReminderProfile> {
  const { tenantId, assignment } = args;

  // Hard product fences (Greg, 2026-08-29): the confirm/check-in cadence is
  // for gig SHIFT work only. Careers get their own quiet track (first-day
  // welcome + morning-of note — never confirmation demands or no-show
  // probes); Open Shift (standing-crew, date-range) assignments get the
  // plain two-step reminders. No targeting doc, tenant switch, or
  // per-assignment override can pull either into the confirm cadence.
  if (assignment?.isOpenShift === true) return DEFAULT_PROFILE;
  if (String(assignment?.jobOrderType ?? '').trim().toLowerCase() === 'career') {
    return CAREER_PLACEMENT_PROFILE;
  }

  // Honor the override ONLY when the field is actually set: normalizeProfileId
  // maps '' to 'default' (correct for the tenant-config doc), so feeding it an
  // absent field made this branch return 'default' for EVERY assignment and
  // left the targeting scan below unreachable (found 2026-08-29 when the
  // Oakland pilot resolved to the default profile despite a matching doc).
  const rawOverride = String(assignment?.shiftReminderProfile ?? '').trim();
  const perAssignmentId = rawOverride ? normalizeProfileId(rawOverride) : null;
  if (perAssignmentId) {
    return PROFILES_BY_ID[perAssignmentId];
  }

  const targetings = await getSequenceTargetings(tenantId);
  if (targetings) {
    const acctId = String(assignment?.accountId ?? '').trim();
    const locId = String(assignment?.locationId ?? '').trim();
    for (const targeting of targetings) {
      if (!targeting.active || targeting.accountIds.length === 0) continue;
      if (!acctId || !targeting.accountIds.includes(acctId)) continue;
      if (targeting.locationIds.length > 0 && (!locId || !targeting.locationIds.includes(locId))) {
        continue;
      }
      if (!targeting.workerTypes.includes('gig')) continue;
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
      return PROFILES_BY_ID[targeting.profileId];
    }
    // Targeting docs exist → they govern; no fallback to the legacy switch.
    return DEFAULT_PROFILE;
  }

  const tenantId_ = await getTenantProfileId(tenantId);
  if (tenantId_) {
    return PROFILES_BY_ID[tenantId_];
  }
  return DEFAULT_PROFILE;
}

/**
 * Synchronous variant — use ONLY when the caller has already fetched the tenant
 * config doc (e.g. during batch backfill). Pure function, easy to unit-test.
 */
export function resolveShiftReminderProfileSync(args: {
  tenantProfile: ShiftReminderProfileId | null | undefined;
  assignment: Record<string, unknown>;
}): ShiftReminderProfile {
  // Same hard fences as the async resolver: gig shift work only.
  if (args.assignment?.isOpenShift === true) return DEFAULT_PROFILE;
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
