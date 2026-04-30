/**
 * E.4 — Canonical display helper for `EmployeeReadinessItem` chip surfaces.
 *
 * **Single source of truth** for how a (requirementType × status) pair
 * renders as a chip: label, color, icon, hide-or-not, tooltip, and
 * severity-rank (for sorting).
 *
 * **Why this exists.** Pre-E.4 every readiness chip surface (header strip,
 * matrix cell, table row, action-items list, payroll TIN badge) hand-rolled
 * its own status→color mapping. They drifted: `StatusChip.tsx` says
 * "Passed" for `complete_pass`; `ReadinessCsaActionsSection.tsx` says
 * "Complete" for the same status; `formatTinStatus` says "IRS verified"
 * vs the new spec's "SSN: IRS verified". E.4 centralizes the mapping so
 * every surface that adopts `getReadinessItemDisplay()` renders the same
 * label / color / icon. Surfaces that haven't adopted it yet keep their
 * old display path — this helper is purely additive.
 *
 * **Item-type coverage.** The spec mandates new copy for the seven items
 * the Everee mirror owns (E.3) plus `tin_verification` (E.4-new). For
 * other canonical types in `EmployeeReadinessRequirementType` (e_verify,
 * background_check, drug_screen, ic_agreement, profile_photo, etc.) we
 * provide reasonable defaults — those items aren't Everee-sourced and
 * their display copy will be refined by the surfaces that already render
 * them (R.5 vendor drawers, R.6 background-check panels). No surface
 * should crash on an unknown type.
 *
 * **Status enum.** Consumes the canonical `EmployeeReadinessItemStatus`
 * union from `shared/employeeReadinessItemV1.ts`:
 *   `incomplete | in_progress | complete_pass | complete_fail |
 *    needs_review | expired | blocked | not_applicable | complete`
 * (`complete` is legacy and treated as `complete_pass`.)
 *
 * **N/A handling per surface.** Per the spec:
 *   - chip / list contexts: `not_applicable` → `hidden: true` (item is
 *     filtered out entirely; reduces noise on per-entity panels)
 *   - matrix context: `not_applicable` → `hidden: false`, rendered as a
 *     muted "—" so the column stays consistent across rows
 *   - tooltip context: `hidden: false`, label includes "(not applicable
 *     for this worker type)"
 *
 * **Hard-block treatment.** Items where `(status === 'blocked' &&
 * blocking === true)` are flagged `hardBlock: true` and earn the highest
 * severity rank — surfaces should sort them to the top and render in
 * red. Today the only item that routinely hits this is `tin_verification`
 * with `MISMATCH`; some assignment items can also block on missing prereqs.
 *
 * **Spec naming gap.** The E.4 spec uses descriptive type names
 * (`i9_worker_portion`, `w4`, `w9`, `handbook`, `policies`) that don't
 * match canonical (`i9_section_1`, `tax_w4`, `tax_w9`,
 * `handbook_acknowledgement`, `policy_acknowledgement`). This helper
 * accepts the canonical names — the spec's descriptive names are aliased
 * via `aliasRequirementType()` so a caller passing either form gets the
 * same display.
 *
 * **`lifecycle_active` is NOT covered.** The spec mentions
 * `lifecycle_active` as conditional ("if E.3 added this") — E.3 did not
 * add it. The helper does not include it; if it lands later, add a
 * branch in `getRequirementTypeBaseLabel` + `getStatusVisualsForType`.
 *
 * **Header chip rollup.** The E.4 spec asks whether the User Profile
 * header chip should show rolled-up readiness across entities or
 * primary-entity-only. Investigating the current header
 * (`UserProfileHeader.tsx` + `useUserProfileEntityEmploymentChips`) shows
 * the header today renders **per-entity employment chips**, NOT
 * per-readiness-item chips. The rollup question is **moot for the
 * current header surface**; this helper is per-item by design and lets
 * each consumer decide its own grouping. If a future header surface
 * adopts this helper for a roll-up chip, the recommended approach is:
 * pick the worst status across all entities for that requirement type
 * (matches the matrix cell aggregation).
 *
 * **Feature flag.** `USE_E4_DISPLAY_MAPPING` (env override
 * `REACT_APP_USE_E4_DISPLAY_MAPPING`) defaults to `true`. When `false`,
 * `getReadinessItemDisplay()` returns the legacy display
 * (`humanizeRequirementType` for the label + a basic status→color map).
 * Kept callable for ~1 week post-rollout; remove in a follow-up cleanup
 * once stable.
 *
 * **Pure & runtime-neutral except for `icon`.** Everything except `icon`
 * is plain JS and trivially testable. `icon: ReactNode` requires
 * importing MUI icons. Tests that don't care about the icon can ignore
 * the field.
 *
 * @see shared/employeeReadinessItemV1.ts (canonical types/statuses)
 * @see shared/readinessStatusFromEvereeMirror.ts (E.3 mirror→status mapper)
 * @see src/utils/evereeFormatters.ts (sister `formatTinStatus` for the
 *      EmployeePayrollSection chip — short copy without "SSN:" prefix)
 */

import React from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import RateReviewIcon from '@mui/icons-material/RateReview';
import RemoveIcon from '@mui/icons-material/Remove';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import type {
  EmployeeReadinessItemStatus,
  EmployeeReadinessRequirementType,
} from '../shared/employeeReadinessItemV1';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/** MUI Chip color values this helper emits. */
export type ReadinessChipColor = 'success' | 'warning' | 'error' | 'info' | 'default';

/** Render context — controls N/A handling and tooltip phrasing. */
export type ReadinessDisplayContext = 'chip' | 'list' | 'matrix' | 'tooltip';

/**
 * Input shape — a structural subset of `EmployeeReadinessItem` plus a few
 * cross-cutting fields the helper needs for tooltip composition. All are
 * optional except `requirementType` and `status` so callers can pass a
 * partial item or hand-built test input.
 */
export interface ReadinessItemDisplayInput {
  /** Canonical requirement type. Spec's descriptive names are aliased. */
  requirementType: EmployeeReadinessRequirementType | string;
  /** Canonical status. Unknown values fall back to `incomplete` semantics. */
  status: EmployeeReadinessItemStatus | string;
  /**
   * Whether this item is a hard-block. Mirrors `EmployeeReadinessItem.blocking`.
   * Only matters when `status === 'blocked'` — drives the `hardBlock` flag.
   */
  blocking?: boolean;
  /**
   * For the tooltip footer — "Synced from Everee {timeAgo}". Accepts ISO
   * string, ms-since-epoch number, `Date`, or anything with a `toMillis()`
   * method (Firestore `Timestamp`). `null`/`undefined` omits the footer.
   */
  lastEvereeSyncAt?: string | number | Date | { toMillis(): number } | null;
  /**
   * True if the item's status came from the Everee mirror snapshot. Drives
   * the tooltip's "Synced from Everee" label vs a generic "Last updated"
   * fallback. Set this from the caller's source-of-truth knowledge — the
   * helper can't infer it from `requirementType` alone (e.g.
   * `direct_deposit` can come from either Everee mirror or legacy).
   */
  evereeSourced?: boolean;
  /**
   * Optional per-item label override — used when the item is a `custom`
   * type or when a tenant overrides the canonical display string.
   */
  requirementLabel?: string | null;
}

/** Result returned by `getReadinessItemDisplay`. */
export interface ReadinessItemDisplay {
  /** Full chip label, e.g. "Direct deposit: Set up". */
  label: string;
  /** Compact label for dense surfaces (matrix cells, popover rows). */
  shortLabel: string;
  /** MUI `<Chip color={...}>` value. */
  color: ReadinessChipColor;
  /** MUI icon to render inside the chip. `null` if no icon is appropriate. */
  icon: React.ReactNode | null;
  /**
   * `true` when the surface should render NOTHING for this item. Set per the
   * `context` rules in the file header.
   */
  hidden: boolean;
  /**
   * Multi-line tooltip:
   *   - title line (the `label`)
   *   - optional body (action prompt for blocked / next-step copy)
   *   - optional footer ("Synced from Everee {timeAgo}.")
   * Surfaces should render with `whiteSpace: 'pre-line'` to preserve the
   * line breaks.
   */
  tooltip: string;
  /**
   * `true` when this item is currently a hard-block (status === 'blocked'
   * AND blocking flag set). Surfaces should pin these to the top of any
   * sorted list and render with extra prominence.
   */
  hardBlock: boolean;
  /**
   * Higher = render earlier in a sorted list. Spans 0 (not_applicable)
   * to 100 (hard-blocked). Stable across types so sort is consistent
   * across mixed-type chip strips.
   */
  severityRank: number;
}

/** Options for `getReadinessItemDisplay`. */
export interface ReadinessItemDisplayOptions {
  /** Render context — drives N/A handling. Default `'chip'`. */
  context?: ReadinessDisplayContext;
}

// ─────────────────────────────────────────────────────────────────────────
// Feature flag — USE_E4_DISPLAY_MAPPING
// ─────────────────────────────────────────────────────────────────────────

const USE_E4_DISPLAY_MAPPING_DEFAULT = true;

/**
 * Returns true when the new E.4 display mapping is active. Defaults to
 * `true`; flip to `false` (or set `REACT_APP_USE_E4_DISPLAY_MAPPING=false`)
 * to fall back to the pre-E.4 humanize+basic-color path.
 *
 * Synchronous + cheap on purpose — every consumer is a render-time gate.
 * Mirrors the pattern in `workAuthCollectionFlag.ts`.
 */
export function isE4DisplayMappingEnabled(): boolean {
  const envValue =
    typeof process !== 'undefined' && process.env
      ? process.env.REACT_APP_USE_E4_DISPLAY_MAPPING
      : undefined;
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return USE_E4_DISPLAY_MAPPING_DEFAULT;
}

// ─────────────────────────────────────────────────────────────────────────
// Type alias normalization (spec descriptive names → canonical types)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Map E.4-spec descriptive type names to canonical types. The spec uses
 * `i9_worker_portion`, `w4`, `w9`, `handbook`, `policies` — none of which
 * match the canonical union. We accept either form so future code that
 * follows the spec verbatim still gets the right display.
 */
const TYPE_ALIASES: Record<string, EmployeeReadinessRequirementType> = {
  i9_worker_portion: 'i9_section_1',
  i9_employer_portion: 'i9_section_2',
  w4: 'tax_w4',
  w9: 'tax_w9',
  handbook: 'handbook_acknowledgement',
  policies: 'policy_acknowledgement',
  tin: 'tin_verification',
};

export function aliasRequirementType(
  type: EmployeeReadinessRequirementType | string,
): EmployeeReadinessRequirementType | string {
  return TYPE_ALIASES[type as string] ?? type;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-item display tables
// ─────────────────────────────────────────────────────────────────────────

/**
 * Base label for a requirement type — the part before the colon. Pure;
 * exported for tests + advanced surfaces that want to compose their own
 * label suffix.
 */
export function getRequirementTypeBaseLabel(
  type: EmployeeReadinessRequirementType | string,
): string {
  const canonical = aliasRequirementType(type);
  switch (canonical) {
    case 'direct_deposit':
      return 'Direct deposit';
    case 'i9_section_1':
      return 'I-9 (worker)';
    case 'i9_section_2':
      return 'I-9 (employer)';
    case 'tax_w4':
      return 'W-4';
    case 'tax_w9':
      return 'W-9';
    case 'tax_1099_consent':
      return '1099 consent';
    case 'handbook_acknowledgement':
      return 'Handbook';
    case 'policy_acknowledgement':
      return 'Policies';
    case 'tin_verification':
      return 'SSN';
    case 'e_verify':
      return 'E-Verify';
    case 'background_check':
      return 'Background check';
    case 'drug_screen':
      return 'Drug screen';
    case 'ic_agreement':
      return 'IC agreement';
    case 'everee_profile':
      return 'Everee profile';
    case 'profile_photo':
      return 'Profile photo';
    case 'phone_verified':
      return 'Phone';
    case 'emergency_contact':
      return 'Emergency contact';
    case 'address_confirmed':
      return 'Address';
    case 'custom':
      return 'Other';
    default:
      // Mirror the existing `humanizeRequirementType` fallback so unknown
      // types still render legibly ("foo_bar_baz" → "Foo Bar Baz").
      return humanizeFallback(String(type));
  }
}

/**
 * Status suffix + chip color + icon for a (type × status) pair. Pure;
 * exported for tests. Returns `null` for `not_applicable` to signal "no
 * suffix appropriate" (the caller decides whether to hide the chip
 * entirely or render "(N/A)" per the surface rules).
 */
function getStatusVisualsForType(
  canonicalType: EmployeeReadinessRequirementType | string,
  status: EmployeeReadinessItemStatus | string,
): { suffix: string | null; color: ReadinessChipColor; icon: React.ReactNode | null } {
  // tin_verification gets bespoke 4-state copy per the spec table — its
  // status mapping (E.3) is the only one with separate `in_progress` and
  // `blocked` states that warrant distinct copy.
  if (canonicalType === 'tin_verification') {
    switch (status) {
      case 'complete_pass':
      case 'complete':
        return {
          suffix: 'IRS verified',
          color: 'success',
          icon: <CheckCircleIcon fontSize="small" />,
        };
      case 'in_progress':
        return {
          suffix: 'Submitted to IRS',
          color: 'info',
          icon: <HourglassTopIcon fontSize="small" />,
        };
      case 'blocked':
        return {
          suffix: 'IRS rejected — needs correction',
          color: 'error',
          icon: <ErrorOutlineIcon fontSize="small" />,
        };
      case 'incomplete':
        return {
          suffix: 'Not submitted',
          color: 'default',
          icon: <RemoveIcon fontSize="small" />,
        };
      case 'not_applicable':
        return { suffix: null, color: 'default', icon: null };
      // Other statuses (needs_review / expired / complete_fail) aren't
      // expected from the Everee TIN state machine. Fall through to the
      // generic mapping for forward-compat.
      default:
        break;
    }
  }

  // Per the spec table: I-9 / W-4 / W-9 missing renders as `warning`
  // (these block payroll and the worker can't earn), while
  // direct_deposit / handbook / policies missing renders as `default`
  // (informational, doesn't hard-block onboarding).
  const isMissingWarningType =
    canonicalType === 'i9_section_1' ||
    canonicalType === 'i9_section_2' ||
    canonicalType === 'tax_w4' ||
    canonicalType === 'tax_w9';

  switch (status) {
    case 'complete_pass':
    case 'complete':
      return {
        suffix: getCompleteSuffix(canonicalType),
        color: 'success',
        icon: <CheckCircleIcon fontSize="small" />,
      };
    case 'complete_fail':
      return {
        suffix: 'Failed',
        color: 'error',
        icon: <CancelIcon fontSize="small" />,
      };
    case 'in_progress':
      return {
        suffix: 'In progress',
        color: 'info',
        icon: <HourglassTopIcon fontSize="small" />,
      };
    case 'needs_review':
      return {
        suffix: 'Needs review',
        color: 'warning',
        icon: <RateReviewIcon fontSize="small" />,
      };
    case 'expired':
      return {
        suffix: 'Expired',
        color: 'warning',
        icon: <ScheduleIcon fontSize="small" />,
      };
    case 'blocked':
      return {
        suffix: 'Blocked',
        color: 'error',
        icon: <ErrorOutlineIcon fontSize="small" />,
      };
    case 'not_applicable':
      return { suffix: null, color: 'default', icon: null };
    case 'incomplete':
    default:
      return {
        suffix: 'Not started',
        color: isMissingWarningType ? 'warning' : 'default',
        icon: isMissingWarningType ? (
          <WarningAmberIcon fontSize="small" />
        ) : (
          <RemoveIcon fontSize="small" />
        ),
      };
  }
}

/**
 * Per-type wording for the `complete_pass` state — the spec uses different
 * verbs depending on the artifact ("Set up" for direct deposit, "Signed"
 * for I-9 / W-9 / handbook / policies, "Filed" for W-4, "Authorized" for
 * E-Verify). Centralized so a future copy edit is one-line.
 */
function getCompleteSuffix(canonicalType: EmployeeReadinessRequirementType | string): string {
  switch (canonicalType) {
    case 'direct_deposit':
      return 'Set up';
    case 'tax_w4':
      return 'Filed';
    case 'i9_section_1':
    case 'i9_section_2':
    case 'tax_w9':
    case 'handbook_acknowledgement':
    case 'policy_acknowledgement':
    case 'ic_agreement':
      return 'Signed';
    case 'e_verify':
      return 'Authorized';
    case 'background_check':
    case 'drug_screen':
      return 'Cleared';
    case 'tin_verification':
      // Handled by the tin_verification-specific branch above; included
      // here for total coverage in case a caller invokes
      // getCompleteSuffix directly.
      return 'IRS verified';
    case 'profile_photo':
    case 'phone_verified':
    case 'emergency_contact':
    case 'address_confirmed':
    case 'everee_profile':
      return 'Done';
    case 'tax_1099_consent':
      return 'Consented';
    case 'custom':
    default:
      return 'Complete';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tooltip composition
// ─────────────────────────────────────────────────────────────────────────

/**
 * Body copy for `blocked` items — actionable next-step the recruiter / CSA
 * needs to take. Returns `null` for items with no specific next-step copy
 * (caller should fall back to the generic "Action needed" footer).
 */
function getBlockedTooltipBody(
  canonicalType: EmployeeReadinessRequirementType | string,
): string | null {
  if (canonicalType === 'tin_verification') {
    return (
      'The IRS could not verify this worker’s SSN against their records. ' +
      'Please ask the worker to confirm their SSN spelling and update via ' +
      'the Everee onboarding portal.'
    );
  }
  if (canonicalType === 'e_verify') {
    return (
      'E-Verify returned a non-confirmed result. Adjudicate via the ' +
      'E-Verify drawer.'
    );
  }
  return null;
}

/**
 * Body copy for `needs_review` — vendor returned a signal needing human
 * adjudication (AccuSource DISCREPANCY, E-Verify TNC).
 */
function getNeedsReviewTooltipBody(
  canonicalType: EmployeeReadinessRequirementType | string,
): string | null {
  if (canonicalType === 'background_check' || canonicalType === 'drug_screen') {
    return 'Vendor reported a result that needs CSA review. Open the order to adjudicate.';
  }
  if (canonicalType === 'e_verify') {
    return 'E-Verify returned a Tentative Non-Confirmation (TNC). Notify the worker so they can contest or accept.';
  }
  return null;
}

/**
 * Compose the multiline tooltip per the spec:
 *   line 1 — full label
 *   line 2 — optional action / context body
 *   line 3 — optional sync footer
 */
function composeTooltip(args: {
  label: string;
  status: EmployeeReadinessItemStatus | string;
  canonicalType: EmployeeReadinessRequirementType | string;
  context: ReadinessDisplayContext;
  evereeSourced: boolean;
  syncedAt: Date | null;
}): string {
  const { label, status, canonicalType, context, evereeSourced, syncedAt } = args;

  const lines: string[] = [label];

  if (status === 'blocked') {
    const body = getBlockedTooltipBody(canonicalType);
    if (body) lines.push(body);
    else lines.push('Action needed — this item is blocking onboarding.');
  } else if (status === 'needs_review') {
    const body = getNeedsReviewTooltipBody(canonicalType);
    if (body) lines.push(body);
  } else if (status === 'not_applicable' && context === 'tooltip') {
    // Per the spec, tooltip context surfaces N/A explicitly so it's not
    // confused with "missing" — chip context just hides the row.
    lines.push('Not applicable for this worker type.');
  }

  if (syncedAt) {
    const ago = formatRelativeTime(syncedAt);
    if (evereeSourced) {
      lines.push(`Synced from Everee ${ago}.`);
    } else {
      lines.push(`Last updated ${ago}.`);
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Severity / sort
// ─────────────────────────────────────────────────────────────────────────

function getSeverityRank(
  status: EmployeeReadinessItemStatus | string,
  hardBlock: boolean,
): number {
  if (hardBlock) return 100;
  switch (status) {
    case 'blocked':
      return 80;
    case 'complete_fail':
      return 70;
    case 'needs_review':
      return 60;
    case 'expired':
      return 50;
    case 'incomplete':
      return 40;
    case 'in_progress':
      return 30;
    case 'complete_pass':
    case 'complete':
      return 10;
    case 'not_applicable':
      return 0;
    default:
      return 20;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Map a readiness item to its visual display. See file header for the
 * full design rationale.
 *
 * **Pure** modulo `icon: ReactNode` (which is a JSX element). Safe to call
 * during render; result is fully memoizable on `(input, opts)` shallow eq.
 */
export function getReadinessItemDisplay(
  input: ReadinessItemDisplayInput,
  opts: ReadinessItemDisplayOptions = {},
): ReadinessItemDisplay {
  const context: ReadinessDisplayContext = opts.context ?? 'chip';

  if (!isE4DisplayMappingEnabled()) {
    return getLegacyReadinessItemDisplay(input, context);
  }

  const canonicalType = aliasRequirementType(input.requirementType);
  const status = input.status as EmployeeReadinessItemStatus;

  const baseLabel =
    typeof input.requirementLabel === 'string' && input.requirementLabel.trim().length > 0
      ? input.requirementLabel.trim()
      : getRequirementTypeBaseLabel(canonicalType);

  const visuals = getStatusVisualsForType(canonicalType, status);

  const label =
    visuals.suffix == null ? baseLabel : `${baseLabel}: ${visuals.suffix}`;

  // Short label: just the type for compact surfaces (matrix). For
  // complete_pass we keep just the base — the green chip color carries
  // the "done" semantic in dense layouts.
  const shortLabel =
    status === 'complete_pass' || status === 'complete'
      ? baseLabel
      : visuals.suffix == null
        ? baseLabel
        : `${baseLabel} · ${visuals.suffix}`;

  const hardBlock = status === 'blocked' && input.blocking === true;

  // Per-context N/A handling.
  const isNA = status === 'not_applicable';
  let hidden = false;
  if (isNA) {
    if (context === 'chip' || context === 'list') hidden = true;
    // 'matrix' and 'tooltip' keep the slot so the column stays consistent.
  }

  // For matrix N/A cells, render a muted dash via icon override.
  let icon = visuals.icon;
  let displayLabel = label;
  let color = visuals.color;
  if (isNA && context === 'matrix') {
    displayLabel = '—';
    icon = null;
    color = 'default';
  }

  const syncedAt = coerceSyncDate(input.lastEvereeSyncAt);

  const tooltip = composeTooltip({
    label,
    status,
    canonicalType,
    context,
    evereeSourced: input.evereeSourced === true,
    syncedAt,
  });

  return {
    label: displayLabel,
    shortLabel,
    color,
    icon,
    hidden,
    tooltip,
    hardBlock,
    severityRank: getSeverityRank(status, hardBlock),
  };
}

/**
 * Convenience predicate — should this item appear at all in the given
 * context? Surfaces typically use this in a `.filter()` before mapping
 * over items so they don't render placeholder Boxes for hidden items.
 */
export function shouldRenderReadinessItem(
  input: ReadinessItemDisplayInput,
  opts: ReadinessItemDisplayOptions = {},
): boolean {
  return !getReadinessItemDisplay(input, opts).hidden;
}

// ─────────────────────────────────────────────────────────────────────────
// Sync-time formatting (relative time for tooltip footer)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Coerce a heterogeneous "synced-at" input to a `Date`, or `null` when no
 * usable value can be extracted. Mirrors the `toMs` tolerance pattern in
 * `queueRow.ts` (Firestore `Timestamp` / ISO string / ms number / `Date`).
 */
function coerceSyncDate(
  value: ReadinessItemDisplayInput['lastEvereeSyncAt'],
): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? new Date(t) : null;
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try {
      const ms = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(ms) ? new Date(ms) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * "2 minutes ago" / "1 hour ago" / "3 days ago" — short, human-readable
 * relative time for tooltips. Pure; exported for tests.
 *
 * `now` is injectable so tests don't depend on `Date.now()`.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const ms = now.getTime() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return 'just now';
  }
  const sec = Math.round(ms / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min === 1) return '1 minute ago';
  if (min < 60) return `${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr === 1) return '1 hour ago';
  if (hr < 24) return `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return '1 day ago';
  if (day < 30) return `${day} days ago`;
  const month = Math.round(day / 30);
  if (month === 1) return '1 month ago';
  if (month < 12) return `${month} months ago`;
  const year = Math.round(month / 12);
  return year === 1 ? '1 year ago' : `${year} years ago`;
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy fallback (USE_E4_DISPLAY_MAPPING === false)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pre-E.4 display path — humanized type name + basic status→color map.
 * Kept callable for ~1 week post-rollout per the spec rollback plan.
 * Surfaces consuming the helper get the legacy display when the flag is
 * off without any per-call branching.
 */
function getLegacyReadinessItemDisplay(
  input: ReadinessItemDisplayInput,
  context: ReadinessDisplayContext,
): ReadinessItemDisplay {
  const baseLabel =
    typeof input.requirementLabel === 'string' && input.requirementLabel.trim().length > 0
      ? input.requirementLabel.trim()
      : humanizeFallback(String(input.requirementType));

  const status = input.status as EmployeeReadinessItemStatus;
  const color = legacyColorForStatus(status);
  const isNA = status === 'not_applicable';
  const hidden = isNA && (context === 'chip' || context === 'list');

  const label = isNA ? `${baseLabel} (N/A)` : baseLabel;

  return {
    label,
    shortLabel: baseLabel,
    color,
    icon: null,
    hidden,
    tooltip: label,
    hardBlock: status === 'blocked' && input.blocking === true,
    severityRank: getSeverityRank(status, status === 'blocked' && input.blocking === true),
  };
}

function legacyColorForStatus(
  status: EmployeeReadinessItemStatus | string,
): ReadinessChipColor {
  switch (status) {
    case 'complete_pass':
    case 'complete':
      return 'success';
    case 'complete_fail':
    case 'blocked':
      return 'error';
    case 'in_progress':
      return 'info';
    case 'needs_review':
    case 'expired':
      return 'warning';
    default:
      return 'default';
  }
}

/**
 * Lift of `humanizeRequirementType`'s logic (kept inline so this file has
 * no runtime dep on `readinessQueue/`). Used as the "I have no idea what
 * this type is" fallback.
 */
function humanizeFallback(raw: string): string {
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
