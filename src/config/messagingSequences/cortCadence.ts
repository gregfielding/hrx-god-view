/**
 * UI-facing description of the CORT / gig-worker messaging cadence.
 *
 * This is a read-only source of truth for the Settings → Messaging Sequences page.
 * Today all timing, copy, and reply logic lives in TypeScript:
 *   - Timing / step order:  functions/src/cadence/shiftReminderProfile.ts (CORT_GIG_PROFILE)
 *   - T-24h / T-23h / T-22h copy: functions/src/workerShiftRemindersV2.ts → buildReminderMessage
 *   - T-2h / T-15m / T+0 copy:   functions/src/cadence/cadenceMessages.ts → buildCadenceMessage
 *   - Reply handling (YES/NO/HERE/CANCEL/walk-off): functions/src/cadence/replyClassifier.ts
 *                                                   + cadenceReplyHandler.ts
 *
 * When we move to a Firestore-backed editor (Phase 2), it will populate a doc at
 * `tenants/{tenantId}/messagingConfig/sequences/cort_gig` with overrides for timing + copy,
 * and the cloud-function dispatchers will resolve overrides before falling back to this
 * hardcoded default. Until then, these constants ARE the behavior — edit them here to
 * change both the UI display and the runtime behavior (after a functions deploy).
 */

export interface MessagingSequenceStep {
  /** Canonical reminder type id (matches the Firestore doc id per scheduled reminder). */
  id: string;
  /** 0-based position in the sequence — UI uses this for ordering + numbering. */
  order: number;
  /** Offset in hours from shift start. Positive = before shift, 0 = at shift, negative = after. */
  offsetHours: number;
  /** Human label for the offset. Prefer this in UI over raw offsetHours for readability. */
  offsetLabel: string;
  /** Short title (goes in the step header / table row). */
  title: string;
  /** 1-2 sentences describing what this step is for operationally. */
  purpose: string;
  /**
   * SMS body template, with template variables wrapped in {braces}. These aren't real template
   * strings — they illustrate which fields the cloud function substitutes at send time.
   */
  smsTemplate: string;
  /** What replies this message explicitly asks for, if any. */
  expectedReplies: string[];
  /** Describes the branching / journey effect of this step on the cadence. */
  branching: string;
  /** True when the worker receives NO SMS at this step (internal-only trigger). */
  silent?: boolean;
  /** Source file where the message copy is built (for engineer traceability). */
  sourceFile: string;
}

/** Canonical CORT / gig-worker cadence. Order preserved from CORT_GIG_PROFILE. */
export const CORT_SEQUENCE_STEPS: MessagingSequenceStep[] = [
  {
    id: 'assignment_reminder_24h',
    order: 0,
    offsetHours: 24,
    offsetLabel: '24 hours before shift',
    title: 'Confirmation request',
    purpose:
      'First touch. Asks the worker to confirm tomorrow\'s shift. This is the message whose reply drives the entire escalation path — if YES or CANCEL arrives, the 23h / 22h reminders are skipped.',
    smsTemplate:
      "{brand}: You're scheduled for {jobTitle} tomorrow at {startTime} at {locationName}. Reply YES to confirm or CANCEL to decline.",
    expectedReplies: ['YES', 'CANCEL'],
    branching:
      'YES → mark confirmed, skip 23h + 22h escalations. CANCEL → mark declined, alert recruiter feed + Scheduling Health, skip rest of cadence (seat re-open/backfill is a planned follow-up). No reply → 23h escalation fires.',
    sourceFile: 'functions/src/workerShiftRemindersV2.ts (buildReminderMessage)',
  },
  {
    id: 'assignment_reminder_23h_escalate',
    order: 1,
    offsetHours: 23,
    offsetLabel: '23 hours before shift',
    title: 'First escalation',
    purpose:
      'Fires only if the worker hasn\'t replied YES or CANCEL to the 24h message. Friendly nudge — "we still need a response".',
    smsTemplate:
      '{brand}: We still need a response for your {jobTitle} shift at {startTime}. Reply YES to confirm or CANCEL to decline.',
    expectedReplies: ['YES', 'CANCEL'],
    branching:
      'YES → mark confirmed, skip 22h. CANCEL → mark declined, alert recruiter feed, skip rest. No reply → 22h final reminder fires.',
    sourceFile: 'functions/src/workerShiftRemindersV2.ts (buildReminderMessage)',
  },
  {
    id: 'assignment_reminder_22h_final',
    order: 2,
    offsetHours: 22,
    offsetLabel: '22 hours before shift',
    title: 'Final escalation',
    purpose:
      'Last chance before the recruiter may need to reassign. Tone shifts from friendly nudge to "last call".',
    smsTemplate:
      '{brand}: Last reminder for {jobTitle} at {startTime}. Reply YES to keep the shift or CANCEL — otherwise we may need to reassign it.',
    expectedReplies: ['YES', 'CANCEL'],
    branching:
      'YES → mark confirmed, continue to T-2h instructions. CANCEL → mark declined, alert recruiter feed, skip rest. No reply → nothing else fires at 22h; the unconfirmed shift shows on Scheduling Health, and the T+30m no-show probe alerts recruiters if they never check in (cadence still proceeds to T-2h in case the worker replies late).',
    sourceFile: 'functions/src/workerShiftRemindersV2.ts (buildReminderMessage)',
  },
  {
    id: 'assignment_reconfirm_4h',
    order: 3,
    offsetHours: 4,
    offsetLabel: '4 hours before shift (evening before, for 5-9 AM starts)',
    title: 'Re-confirm',
    purpose:
      'Second opt-in a few hours before start — plans change overnight. Deliberately ALSO sent to already-confirmed workers; skipped only when the worker cancelled or already checked in. Dropped automatically if it would land on top of the worksite-details step.',
    smsTemplate:
      '{brand}: Still good for your shift? {jobTitle} at {startTime} at {locationName}. Reply YES — or CANCEL now so we can cover your spot.',
    expectedReplies: ['YES', 'CANCEL'],
    branching:
      'YES → (re)confirmed. CANCEL → mark declined, alert recruiter feed, skip rest. No reply → cadence proceeds.',
    sourceFile: 'functions/src/workerShiftRemindersV2.ts (buildReminderMessage)',
  },
  {
    id: 'assignment_reminder_2h_instructions',
    order: 4,
    offsetHours: 2,
    offsetLabel: '2 hours before shift',
    title: 'Worksite details',
    purpose:
      'Ships address, parking/entry instructions, and shift description. The "Replaces the generic 2h reminder" step for CORT.',
    smsTemplate:
      '{brand}: Your {jobTitle} shift at {locationName} starts at {startTime}. Address: {locationAddress}. {shiftDescription} Reply HELP if you need anything.',
    expectedReplies: ['HELP'],
    branching: 'HELP → triggers the help response path. Otherwise this is informational — cadence proceeds to T-15m clock-in.',
    sourceFile: 'functions/src/cadence/cadenceMessages.ts (buildCadenceMessage)',
  },
  {
    id: 'assignment_reminder_15m_clockin',
    order: 5,
    offsetHours: 0.25,
    offsetLabel: '15 minutes before shift',
    title: 'Clock-in link',
    purpose:
      'Delivers the clock-in URL. If no clockInUrl is configured, falls back to "open the app to clock in".',
    smsTemplate:
      '{brand}: {jobTitle} starts at {startTime}. Clock in here: {clockInUrl}. Keep this thread open — we may send you instructions when you arrive.',
    expectedReplies: ['HELP'],
    branching: 'Informational. The next step (T+0 check-in) determines whether the worker showed up.',
    sourceFile: 'functions/src/cadence/cadenceMessages.ts (buildCadenceMessage)',
  },
  {
    id: 'assignment_checkin_0h',
    order: 6,
    offsetHours: 0,
    offsetLabel: 'At shift start',
    title: 'On-site check-in',
    purpose:
      "Asks worker to confirm arrival. The reply (HERE / walk-off phrases / HELP) determines the no-show path.",
    smsTemplate:
      '{brand}: Your {jobTitle} shift has started. Location: {locationName}. Are you on site? Reply HERE once you arrive, or reply HELP if you need assistance.',
    expectedReplies: ['HERE', 'HELP', 'walk-off phrases'],
    branching:
      'HERE (or "I\'m here", "made it", etc.) → mark arrived, cadence complete. Walk-off phrases ("no one is here", "locked out") → escalate to recruiter. HELP → help path. No reply → T+30m silent no-show check determines status.',
    sourceFile: 'functions/src/cadence/cadenceMessages.ts (buildCadenceMessage) + replyClassifier.ts',
  },
  {
    id: 'assignment_noshow_check',
    order: 7,
    offsetHours: -0.5,
    offsetLabel: '30 minutes after shift start',
    title: 'No-show check (silent)',
    purpose:
      "Internal trigger — worker receives NOTHING. Dispatcher reads assignment.cortConfirmation.state; if the worker hasn't replied HERE or clocked in, flips status to no_show and alerts recruiters.",
    smsTemplate: '(no SMS — internal trigger only)',
    expectedReplies: [],
    branching:
      'No-show detected → recruiter alerted, shift marked for reassignment, worker prior-shift record updated. Worker arrived → no action, silent.',
    silent: true,
    sourceFile: 'functions/src/cadence/shiftReminderProfile.ts + dispatcher',
  },
  {
    id: 'assignment_confirm_now',
    order: 8,
    offsetHours: 0,
    offsetLabel: 'Immediately on late assignment (inside the 24h window)',
    title: 'Late-fill ask (situational)',
    purpose:
      'Synthesized when a worker is assigned after the 24h ask would have fired and the shift is still ≥45 minutes away. First cadence message for that worker — asks for the commitment AND carries the address. Escalations are rebuilt at +2h/+4h after it when there is room.',
    smsTemplate:
      "{brand}: You're on the crew — {jobTitle} at {startTime} at {locationName}. Address: {locationAddress}. Reply YES to confirm or CANCEL if you can't make it.",
    expectedReplies: ['YES', 'CANCEL'],
    branching:
      'Same as the 24h confirmation request. Suppressed if the worker already confirmed or cancelled by dispatch time.',
    sourceFile: 'functions/src/workerShiftRemindersV2.ts (buildReminderMessage)',
  },
];

/**
 * Per-tenant targeting config for a sequence. Persisted to Firestore at:
 *   `tenants/{tenantId}/messagingConfig/sequences/{sequenceId}`
 *
 * The cloud-function dispatcher reads this (Phase 2 work) to decide which assignments
 * get the sequence, instead of the tenant-wide `shiftReminderProfile` switch we use today.
 */
export type SequenceWorkerType = 'gig' | 'career';
export type SequenceOccurrence = 'first_shift' | 'every_shift';

export interface SequenceTargeting {
  /**
   * Human-readable label for THIS targeting rule (not the underlying sequence template).
   * e.g. "CORT CSR Waitlist". Lets recruiters distinguish between multiple active rules
   * that use the same sequence template but target different accounts.
   */
  label: string;
  /**
   * Master on/off switch. When false, the dispatcher skips this sequence entirely even if
   * accountIds / workerTypes would otherwise match. Lets recruiters pause a rule without
   * losing its configuration.
   */
  active: boolean;
  /** Tenant Account ids (`tenants/{tid}/accounts/{id}`). Empty = applies to no accounts (disabled). */
  accountIds: string[];
  /** Which worker types this cadence applies to. */
  workerTypes: SequenceWorkerType[];
  /**
   * `first_shift` = run from the worker's first assignment at this account through completion,
   * then stop (subsequent shifts at the same account use the default cadence).
   * `every_shift` = run on every assignment at these accounts.
   */
  occurrence: SequenceOccurrence;
  /**
   * Optional venue filter INSIDE the targeted accounts: assignment.locationId must be in this
   * list when non-empty (e.g. Oakland Arena within Legends National Account). Empty/absent =
   * whole account.
   */
  locationIds?: string[];
}

/** Which reminder track a sequence applies. Careers never come from targeting —
 *  the backend fences jobOrderType 'career' into its own quiet track. */
export type SequenceTrack = 'gig_standard' | 'cort_gig';

export const SEQUENCE_TRACK_LABELS: Record<SequenceTrack, string> = {
  gig_standard: 'Gig standard (confirm → re-confirm → check-in)',
  cort_gig: 'Gig standard + QR clock-in link (CORT)',
};

export const DEFAULT_CORT_TARGETING: SequenceTargeting = {
  label: 'CORT CSR Waitlist',
  active: false,
  accountIds: [],
  workerTypes: ['gig'],
  occurrence: 'first_shift',
};

/**
 * Firestore path builder so the page and future dispatcher agree on where targeting lives.
 *
 * Each sequence is one document in the tenant's `messagingSequences` subcollection —
 * 4 path segments, valid document reference. Future sequences (beyond CORT) are just
 * additional docs in the same collection.
 */
export function sequenceTargetingDocPath(tenantId: string, sequenceId: string): string {
  return `tenants/${tenantId}/messagingSequences/${sequenceId}`;
}

/** UI-facing labels for the worker type choices. */
export const WORKER_TYPE_LABELS: Record<SequenceWorkerType, string> = {
  gig: 'Gig',
  career: 'Career',
};

/** UI-facing labels for the occurrence choices. */
export const OCCURRENCE_LABELS: Record<SequenceOccurrence, string> = {
  first_shift: 'First shift at account (until completion)',
  every_shift: 'Every shift at account',
};

/** Summary shown at top of the UI describing what this sequence is. */
export const CORT_SEQUENCE_SUMMARY = {
  id: 'cort_gig',
  name: 'CORT CSR Waitlist / Gig Shift Cadence',
  purpose:
    "Multi-step SMS flow for gig-style day-labor shifts (CORT). Confirms the worker day-before, escalates if they don't reply, drops worksite details + clock-in link close to start time, and catches no-shows 30 minutes after start.",
  trigger:
    "Fires on every confirmed assignment whose tenant has `tenants/{tenantId}/messagingConfig/shiftReminderProfile.profile = 'cort_gig'`, or whose assignment itself specifies `shiftReminderProfile = 'cort_gig'`.",
  resolutionOrder: [
    "assignment.shiftReminderProfile (per-assignment override, rare)",
    "tenants/{tenantId}/messagingConfig/shiftReminderProfile (tenant-wide choice)",
    "default (original 24h + 2h behavior — not this sequence)",
  ],
  totalSteps: CORT_SEQUENCE_STEPS.length,
};

/**
 * Global reply tokens this sequence listens for. Not step-specific — these work on any
 * inbound reply while a cadence is active for the worker.
 */
export const CORT_REPLY_TOKENS: Array<{
  token: string;
  kind: 'confirm' | 'decline' | 'check-in' | 'walk-off' | 'help';
  effect: string;
}> = [
  {
    token: 'YES / YEP / CONFIRM / I\'LL BE THERE',
    kind: 'confirm',
    effect: 'Marks assignment.cortConfirmation.state = "confirmed". Skips remaining 23h / 22h escalations.',
  },
  {
    token: 'CANCEL / CANCELED / CANCELLED',
    kind: 'decline',
    effect: 'Marks the worker declined (cortConfirmation.state=cancelled), alerts the recruiter feed, stops the cadence. Seat re-open/backfill is a planned follow-up. Claimed by the cadence before the carrier-compliance STOP handler; with no active cadence it still acts as a STOP synonym.',
  },
  {
    token: 'HERE / I\'M HERE / MADE IT / ARRIVED',
    kind: 'check-in',
    effect: 'Marks worker on-site at T+0. Prevents the silent no-show check at T+30m from flipping state.',
  },
  {
    token: 'NO ONE HERE / NOBODY HERE / LOCKED OUT / SUPERVISOR NOT HERE',
    kind: 'walk-off',
    effect: 'Worker is on site but cannot start shift. Escalated to recruiter for intervention.',
  },
  {
    token: 'HELP',
    kind: 'help',
    effect: 'Routes to the standard SMS-compliance HELP handler (owned by messaging/stopHelpHandler.ts).',
  },
];
