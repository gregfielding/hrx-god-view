/**
 * **E.3** — Pure decision helper for `onEvereeWorkerWriteUpdateReadiness`.
 *
 * Given the before/after `everee_workers` doc, decide:
 *   - Should the trigger fire at all? (fingerprint short-circuit)
 *   - Which `employeeReadinessItems` should be updated, and to what
 *     status?
 *
 * Splitting this out keeps the trigger thin (just I/O) and lets us
 * exercise the full update-plan matrix without spinning up admin SDK
 * mocks. Mirrors the pattern used by `evereeReadinessMirror.ts` (pure
 * compute) + `evereeReconcileWorker.ts` (I/O wrapper).
 *
 * Source-of-truth rules (E.3 spec §3):
 *   - `everee_profile` is always sourced from the legacy translator
 *     (`evereeToReadinessStatus` over `status`). The mirror doesn't
 *     express overall onboarding state in a single field.
 *   - `direct_deposit` is mirror-driven when the mirror is present;
 *     otherwise falls back to the legacy translator's
 *     `bankAccount.verified` heuristic. Mirror is more authoritative
 *     because it considers Everee's `availablePaymentMethods.directDeposit`
 *     flag, not just whether a bank account exists.
 *   - `i9_section_1`, `tax_w4`, `tax_w9`, `handbook_acknowledgement`,
 *     `policy_acknowledgement`, `tin_verification` are mirror-driven
 *     when the mirror is present; otherwise NOT touched (legacy
 *     onboarding-step trigger continues to feed them).
 */

import {
  evereeToReadinessStatus,
  type EvereeWorkerStatus,
} from '../shared/readinessStatusFromEveree';
import {
  evereeMirrorToReadinessStatuses,
  type EvereeReadinessMirrorLike,
} from '../shared/readinessStatusFromEvereeMirror';
import type {
  EmployeeReadinessItemStatus,
  EmployeeReadinessRequirementType,
} from '../shared/employeeReadinessItemV1';

/**
 * Permissive shape — we read defensively from the raw Firestore doc
 * data, not from a strict TS type, because the doc evolves with the
 * webhook handler + reconciler.
 */
export interface EvereeWorkerDocLike {
  status?: unknown;
  bankAccount?: { verified?: unknown } | null;
  bankAccountVerified?: unknown;
  readinessMirror?: unknown;
}

export interface PlannedReadinessUpdate {
  requirementType: EmployeeReadinessRequirementType;
  newStatus: EmployeeReadinessItemStatus;
  /** Where the status came from — useful for the trigger's log line. */
  source: 'legacy' | 'mirror';
}

export interface EvereeWorkerReadinessPlan {
  /**
   * `true` when the trigger should perform the update dispatch.
   * `false` when nothing semantically changed and the trigger should
   * short-circuit.
   */
  shouldFire: boolean;
  /**
   * The dispatch plan. Empty when `shouldFire === false`. Each entry
   * is one `updateReadinessItemStatus` call.
   */
  updates: PlannedReadinessUpdate[];
  /** Debug fields included in the trigger log. */
  debug: {
    legacyFingerprintChanged: boolean;
    mirrorFingerprintChanged: boolean;
    mirrorPresent: boolean;
  };
}

/** Fingerprint the legacy `status` + bank-verified inputs. */
function legacyFingerprint(data: EvereeWorkerDocLike | null): string {
  if (!data) return '';
  const status = typeof data.status === 'string' ? data.status : '';
  const bankVerified = pickBankVerified(data);
  return `${status}::${bankVerified === undefined ? '' : String(bankVerified)}`;
}

/**
 * Fingerprint ONLY the mirror fields the translator reads. Provenance
 * fields like `lastEvereeSyncAt` / `lastEvereeSyncSource` are deliberately
 * excluded so a no-op reconcile (cron sweep that re-stamps provenance
 * but finds no semantic change) doesn't re-fire the trigger.
 */
function mirrorFingerprint(mirror: EvereeReadinessMirrorLike | null): string {
  if (!mirror) return '';
  return JSON.stringify({
    dd: mirror.directDepositReady,
    i9: mirror.i9SignedAt != null,
    i9app: mirror.i9Applicable,
    w4: mirror.w4SignedAt != null,
    w4app: mirror.w4Applicable,
    w9: mirror.w9SignedAt != null,
    w9app: mirror.w9Applicable,
    hb: mirror.handbookSignedAt != null,
    pol: mirror.policiesSignedCount,
    tin: mirror.tinVerificationStatus ?? null,
  });
}

function pickBankVerified(data: EvereeWorkerDocLike): boolean | undefined {
  const ba = data.bankAccount;
  if (ba && typeof ba.verified === 'boolean') return ba.verified;
  if (typeof data.bankAccountVerified === 'boolean') return data.bankAccountVerified;
  return undefined;
}

/**
 * Coerce the raw `readinessMirror` field into the shape the translator
 * expects. Returns `null` when the mirror is absent or structurally
 * invalid (rather than throwing — the trigger should still update the
 * legacy-derived items in that case).
 */
function pickMirror(data: EvereeWorkerDocLike | null): EvereeReadinessMirrorLike | null {
  if (!data) return null;
  const raw = data.readinessMirror;
  if (!raw || typeof raw !== 'object') return null;
  const mirror = raw as Record<string, unknown>;
  // Required-field shape check. We don't validate the date fields
  // (they're `unknown | null` in the translator interface) but every
  // boolean/number/applicability field must be present and the right
  // type — otherwise the mirror is half-written and we should bail.
  if (typeof mirror.directDepositReady !== 'boolean') return null;
  if (typeof mirror.i9Applicable !== 'boolean') return null;
  if (typeof mirror.w4Applicable !== 'boolean') return null;
  if (typeof mirror.w9Applicable !== 'boolean') return null;
  if (typeof mirror.policiesSignedCount !== 'number') return null;
  return {
    directDepositReady: mirror.directDepositReady,
    i9SignedAt: mirror.i9SignedAt ?? null,
    i9Applicable: mirror.i9Applicable,
    w4SignedAt: mirror.w4SignedAt ?? null,
    w4Applicable: mirror.w4Applicable,
    w9SignedAt: mirror.w9SignedAt ?? null,
    w9Applicable: mirror.w9Applicable,
    handbookSignedAt: mirror.handbookSignedAt ?? null,
    policiesSignedCount: mirror.policiesSignedCount,
    tinVerificationStatus:
      typeof mirror.tinVerificationStatus === 'string'
        ? mirror.tinVerificationStatus
        : mirror.tinVerificationStatus == null
          ? null
          : null,
  };
}

/**
 * Pure planner — given before/after doc data, produce the dispatch plan.
 *
 * Semantics:
 *   - If neither the legacy fingerprint nor the mirror fingerprint
 *     changed, return `shouldFire: false` (no-op).
 *   - Otherwise, build the update list:
 *       - Always include `everee_profile` (legacy translator).
 *       - Include `direct_deposit`: mirror value when mirror present,
 *         else legacy value.
 *       - When mirror present, include the other 6 mirror-owned items.
 */
export function planEvereeWorkerReadinessUpdates(args: {
  before: EvereeWorkerDocLike | null;
  after: EvereeWorkerDocLike | null;
}): EvereeWorkerReadinessPlan {
  const { before, after } = args;

  if (!after) {
    // Doc deleted — caller already short-circuits, but be explicit.
    return {
      shouldFire: false,
      updates: [],
      debug: { legacyFingerprintChanged: false, mirrorFingerprintChanged: false, mirrorPresent: false },
    };
  }

  const beforeMirror = pickMirror(before);
  const afterMirror = pickMirror(after);

  const legacyFp = {
    before: legacyFingerprint(before),
    after: legacyFingerprint(after),
  };
  const mirrorFp = {
    before: mirrorFingerprint(beforeMirror),
    after: mirrorFingerprint(afterMirror),
  };
  const legacyChanged = legacyFp.before !== legacyFp.after;
  const mirrorChanged = mirrorFp.before !== mirrorFp.after;

  if (!legacyChanged && !mirrorChanged) {
    return {
      shouldFire: false,
      updates: [],
      debug: {
        legacyFingerprintChanged: false,
        mirrorFingerprintChanged: false,
        mirrorPresent: afterMirror != null,
      },
    };
  }

  const legacy = evereeToReadinessStatus({
    status: (after.status as EvereeWorkerStatus | null | undefined) ?? null,
    bankAccountVerified: pickBankVerified(after),
  });

  const updates: PlannedReadinessUpdate[] = [
    {
      requirementType: 'everee_profile',
      newStatus: legacy.evereeProfile,
      source: 'legacy',
    },
  ];

  if (afterMirror) {
    const mirrorMap = evereeMirrorToReadinessStatuses(afterMirror);
    updates.push(
      { requirementType: 'direct_deposit', newStatus: mirrorMap.direct_deposit, source: 'mirror' },
      { requirementType: 'i9_section_1', newStatus: mirrorMap.i9_section_1, source: 'mirror' },
      { requirementType: 'tax_w4', newStatus: mirrorMap.tax_w4, source: 'mirror' },
      { requirementType: 'tax_w9', newStatus: mirrorMap.tax_w9, source: 'mirror' },
      {
        requirementType: 'handbook_acknowledgement',
        newStatus: mirrorMap.handbook_acknowledgement,
        source: 'mirror',
      },
      {
        requirementType: 'policy_acknowledgement',
        newStatus: mirrorMap.policy_acknowledgement,
        source: 'mirror',
      },
      {
        requirementType: 'tin_verification',
        newStatus: mirrorMap.tin_verification,
        source: 'mirror',
      },
    );
  } else {
    // No mirror yet — fall back to the legacy translator for direct_deposit.
    updates.push({
      requirementType: 'direct_deposit',
      newStatus: legacy.directDeposit,
      source: 'legacy',
    });
  }

  return {
    shouldFire: true,
    updates,
    debug: {
      legacyFingerprintChanged: legacyChanged,
      mirrorFingerprintChanged: mirrorChanged,
      mirrorPresent: afterMirror != null,
    },
  };
}
