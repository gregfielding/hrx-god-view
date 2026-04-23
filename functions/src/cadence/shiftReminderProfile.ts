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
  // Silent reminder — no SMS to worker. Fires T+30m after start; the
  // dispatcher routes it through a custom path that checks
  // cortConfirmation.state and alerts recruiters if the worker hasn't
  // confirmed arrival (state still 'confirmed' — i.e. no HERE, no clock-in).
  | 'assignment_noshow_check';

export type ShiftReminderProfileId = 'default' | 'cort_gig';

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

const CORT_GIG_PROFILE: ShiftReminderProfile = {
  id: 'cort_gig',
  steps: [
    { type: 'assignment_reminder_24h', offsetHours: 24 },
    // Escalations fire only if the worker hasn't replied YES or CANCEL by
    // then (gated at dispatch time against assignment.cortConfirmation.state).
    { type: 'assignment_reminder_23h_escalate', offsetHours: 23 },
    { type: 'assignment_reminder_22h_final', offsetHours: 22 },
    // Replaces the generic 2h reminder with the instructions / address variant.
    { type: 'assignment_reminder_2h_instructions', offsetHours: 2 },
    { type: 'assignment_reminder_15m_clockin', offsetHours: 0.25 },
    { type: 'assignment_checkin_0h', offsetHours: 0 },
    // Silent — fires 30 minutes AFTER shift start (negative offset).
    // Dispatcher checks whether worker has checked in; if not, flips state
    // to no_show and alerts recruiters. Worker receives nothing from this
    // step directly.
    { type: 'assignment_noshow_check', offsetHours: -0.5 },
  ],
};

const PROFILES_BY_ID: Record<ShiftReminderProfileId, ShiftReminderProfile> = {
  default: DEFAULT_PROFILE,
  cort_gig: CORT_GIG_PROFILE,
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
  'assignment_noshow_check',
];

function normalizeProfileId(raw: unknown): ShiftReminderProfileId | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'cort_gig' || s === 'cort' || s === 'gig') return 'cort_gig';
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
 * Resolve the profile for this (tenant, assignment). Never throws — falls back
 * to the default profile on any lookup error. Upstream callers should treat the
 * returned list as the canonical set of reminders to materialize.
 */
export async function resolveShiftReminderProfile(args: {
  tenantId: string;
  assignment: Record<string, unknown>;
}): Promise<ShiftReminderProfile> {
  const { tenantId, assignment } = args;
  const perAssignmentId = normalizeProfileId(assignment?.shiftReminderProfile);
  if (perAssignmentId) {
    return PROFILES_BY_ID[perAssignmentId];
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
  const perAssignmentId = normalizeProfileId(args.assignment?.shiftReminderProfile);
  if (perAssignmentId) return PROFILES_BY_ID[perAssignmentId];
  const tenantId = normalizeProfileId(args.tenantProfile);
  if (tenantId) return PROFILES_BY_ID[tenantId];
  return DEFAULT_PROFILE;
}
