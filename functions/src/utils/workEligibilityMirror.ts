/**
 * Server-side mirror writer for `users.workEligibility` /
 * `users.workEligibilityAttestation` from authoritative sources.
 *
 * Why this exists (W.1 — work-auth-removal-audit Phase 1)
 * --------------------------------------------------------
 * The audit recommends Option C ("server-side mirror") + Option B contractor
 * variant: HRX should stop collecting work-authorization attestations from
 * workers directly. The authoritative sources are:
 *
 *   - **Everee I-9 completion** for W-2 employees → `source: 'everee_i9'`
 *   - **Federal contractor rule** (1099 workers don't need I-9) → `source: 'contractor_no_i9_required'`
 *
 * Existing display surfaces and gates already read `users.workEligibility` and
 * `users.workEligibilityAttestation`, so populating them server-side keeps the
 * UI green without any client-side changes (W.3 owns hiding the wizard
 * collection step; W.5 owns soft-deprecating the gates).
 *
 * Design rules (locked in W.1; downstream phases can revisit):
 *
 *   1. **Use `update()` not `set({merge:true})`.** Per the R.0c-fix lesson,
 *      Admin SDK `set+merge` with dotted-string keys creates literal
 *      top-level fields with embedded dots — see
 *      `__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts`. We write
 *      whole nested maps, but use `update()` for consistency + safety.
 *
 *   2. **Preserve operator-collected fields.** `requireSponsorship`, plus the
 *      EEO fields (`gender`, `veteranStatus`, `disabilityStatus`) currently
 *      living on the attestation map are kept as-is across mirror writes.
 *      W.3 / W.6 own EEO field removal; we don't pre-empt them here.
 *
 *   3. **Idempotent.** If `workEligibility === true` and `attestation.source`
 *      already matches the target, we skip the write entirely. Important
 *      because every write to either field re-fires
 *      `didRelevantUserFieldsChange` (see
 *      `functions/src/utils/didRelevantUserFieldsChange.ts:13-15`), which
 *      cascades into readiness/snapshot recomputes for the worker.
 *
 *   4. **Upgrade rule (no-clobber-of-data).** If existing
 *      `attestation.source` is different from the target (e.g., empty,
 *      `'self_attested'`, or the OTHER system source), we DO write — but we
 *      preserve `requireSponsorship` and EEO fields from the existing
 *      attestation. Net effect: a worker who already self-attested keeps
 *      every actual *answer* they gave; only `source` and `attestedAt` move
 *      to the system value. The audit recommends the system source become
 *      authoritative going forward; this rule honors that without losing
 *      historical answers. See ADR / discussion in PR for W.1.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

/** Authoritative-source values understood by this mirror. */
export type WorkEligibilitySource = 'everee_i9' | 'contractor_no_i9_required';

const SYSTEM_SOURCES: ReadonlySet<string> = new Set<WorkEligibilitySource>([
  'everee_i9',
  'contractor_no_i9_required',
]);

export interface MirrorWorkEligibilityArgs {
  /** Firebase auth uid of the worker. */
  userId: string;
  /** Authoritative source telling us this worker is authorized to work in the US. */
  source: WorkEligibilitySource;
  /**
   * Free-form caller identifier for log correlation
   * (e.g. `'mirrorEvereeOnboardingCompleteToEmployments'`).
   */
  callerContext: string;
  /** Optional context for log correlation. */
  tenantId?: string;
  /** Optional context for log correlation. */
  entityId?: string;
}

export type MirrorWorkEligibilityReason =
  | 'wrote'
  | 'already_at_target'
  | 'user_doc_missing'
  | 'missing_userid'
  | 'invalid_source'
  | 'write_failed';

export interface MirrorWorkEligibilityResult {
  written: boolean;
  reason: MirrorWorkEligibilityReason;
  /** The previous `attestation.source` we replaced, when applicable. */
  previousSource?: string;
}

/**
 * Idempotently mirror an authoritative `workEligibility` signal onto
 * `users/{userId}`. Returns a structured result so callers can branch on
 * whether a write happened (useful for tests + log volume).
 *
 * Throws nothing — failures are logged and returned as `{ written: false,
 * reason: 'write_failed' }`. Callers should treat the work-auth mirror as
 * non-blocking; the canonical Everee/onboarding flow must not fail because
 * the mirror failed.
 */
export async function mirrorWorkEligibilityFromAuthoritativeSource(
  args: MirrorWorkEligibilityArgs,
): Promise<MirrorWorkEligibilityResult> {
  const { userId, source, callerContext, tenantId, entityId } = args;
  if (!userId) {
    return { written: false, reason: 'missing_userid' };
  }
  if (!SYSTEM_SOURCES.has(source)) {
    return { written: false, reason: 'invalid_source' };
  }

  const db = admin.firestore();
  const userRef = db.doc(`users/${userId}`);

  let snap: FirebaseFirestore.DocumentSnapshot;
  try {
    snap = await userRef.get();
  } catch (e: unknown) {
    logger.warn('[workEligibilityMirror] read_failed', {
      surface: 'workEligibilityMirror' as const,
      callerContext,
      userId,
      source,
      tenantId,
      entityId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { written: false, reason: 'write_failed' };
  }

  if (!snap.exists) {
    // Don't synthesize a user doc — that's a different state machine. Just
    // surface the gap in logs so it can be diagnosed if it ever happens.
    logger.warn('[workEligibilityMirror] user_doc_missing', {
      surface: 'workEligibilityMirror' as const,
      callerContext,
      userId,
      source,
      tenantId,
      entityId,
    });
    return { written: false, reason: 'user_doc_missing' };
  }

  const data = (snap.data() || {}) as Record<string, unknown>;
  const attestation = (data.workEligibilityAttestation as Record<string, unknown> | undefined) ?? {};
  const workEligibility = data.workEligibility === true;
  const existingSource =
    typeof attestation.source === 'string' ? (attestation.source as string) : '';

  // Idempotency guard: skip when we'd be writing the same value we already
  // have. Important because the readiness/snapshot trigger fan-out reacts to
  // any change to `workEligibility` / `workEligibilityAttestation`.
  if (workEligibility && existingSource === source) {
    return { written: false, reason: 'already_at_target' };
  }

  // Build the new attestation map. Preserve operator-collected answers
  // (`requireSponsorship`, EEO fields) so a worker who self-attested keeps
  // their actual responses; only `source` + `attestedAt` move to the system
  // value. W.3 / W.6 own removal of the EEO fields.
  const newAttestation: Record<string, unknown> = {
    authorizedToWorkUS: true,
    requireSponsorship:
      typeof attestation.requireSponsorship === 'boolean'
        ? attestation.requireSponsorship
        : false,
    attestedAt: admin.firestore.FieldValue.serverTimestamp(),
    source,
  };
  if (attestation.gender !== undefined) newAttestation.gender = attestation.gender;
  if (attestation.veteranStatus !== undefined) {
    newAttestation.veteranStatus = attestation.veteranStatus;
  }
  if (attestation.disabilityStatus !== undefined) {
    newAttestation.disabilityStatus = attestation.disabilityStatus;
  }

  try {
    await userRef.update({
      workEligibility: true,
      workEligibilityAttestation: newAttestation,
    });
  } catch (e: unknown) {
    logger.warn('[workEligibilityMirror] update_failed', {
      surface: 'workEligibilityMirror' as const,
      callerContext,
      userId,
      source,
      tenantId,
      entityId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { written: false, reason: 'write_failed' };
  }

  logger.info('[workEligibilityMirror] wrote', {
    surface: 'workEligibilityMirror' as const,
    callerContext,
    userId,
    source,
    previousSource: existingSource || null,
    previousWorkEligibility: workEligibility,
    tenantId,
    entityId,
  });

  return { written: true, reason: 'wrote', previousSource: existingSource };
}
