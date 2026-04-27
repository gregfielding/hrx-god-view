/**
 * R.0b — Server-side safety net for the application → worker-profile attestation sync.
 *
 * Wizard.tsx (`src/components/apply/Wizard.tsx:2447`) writes the canonical
 * `workerAttestations.*` patch to the user doc client-side BEFORE writing the
 * application doc at `tenants/{tenantId}/applications/{appId}`. If the network
 * drops between those two writes (or the client crashes mid-flight), the
 * application exists but the profile is stale.
 *
 * This trigger fires on submitted-status transitions (create OR update) and
 * replays the canonical mapping server-side. Idempotent: D2 "profile-wins-once-set"
 * filters out fields that already have a value on the profile, so re-runs and
 * re-applications are no-ops for already-attested fields.
 *
 * See: docs/READINESS_R0_HANDOFF.md (PR 2)
 *
 * TODO(R.0+): consolidate the form-key → canonical-path mapping below into a
 * shared package (e.g. `packages/contracts`) so this trigger and
 * `src/utils/workerReadinessWriteModel.ts` import the same source of truth. For
 * R.0b we duplicate inline; the schema is small and the client/server SDK split
 * (client `serverTimestamp` vs admin `FieldValue.serverTimestamp`) makes shared
 * code awkward without an abstraction.
 */

import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

export type AttestationSource =
  | 'application'
  | 'application_backfill'
  | 'worker_edit'
  | 'csa_override';

/**
 * Server-side attestedAt values can be a real `Timestamp` (R.0c backfill,
 * which sources from `application.submittedAt`) or `FieldValue.serverTimestamp()`
 * (R.0b live trigger, which fires at write-time). Both are valid Firestore
 * field values.
 */
export type AttestationAttestedAt =
  | admin.firestore.FieldValue
  | admin.firestore.Timestamp
  | Date;

/**
 * Maps the wizard's `formData.requirements.<formKey>` answers directly to the
 * canonical `workerAttestations.<field>` path. Skips the legacy `comfortable*`
 * intermediary that the client-side `buildCanonicalWorkerProfileWritePatch`
 * uses (it has to handle both legacy and form keys; we only ever see form keys
 * here because we read straight from the application doc).
 */
const REQUIREMENT_FORM_KEY_TO_CANONICAL: Record<string, string> = {
  drugScreeningComfort: 'workerAttestations.drugScreeningWillingness',
  drugExplanation: 'workerAttestations.drugScreeningNotes',
  backgroundScreeningComfort: 'workerAttestations.backgroundCheckWillingness',
  backgroundExplanation: 'workerAttestations.backgroundCheckNotes',
  eVerifyComfort: 'workerAttestations.eVerifyWillingness',
  languagesComfort: 'workerAttestations.languageRequirementWillingness',
  physicalRequirementsComfort: 'workerAttestations.physicalRequirementWillingness',
  uniformRequirementsComfort: 'workerAttestations.uniformRequirementWillingness',
  customUniformRequirementsComfort:
    'workerAttestations.customUniformRequirementWillingness',
  requiredPpeComfort: 'workerAttestations.requiredPpeWillingness',
};

/**
 * Free-text explanation fields don't get provenance stamps — they're notes
 * attached to a willingness answer. Mirrors `ATTESTATION_NOTE_KEYS` in
 * `src/utils/workerReadinessWriteModel.ts`.
 */
const ATTESTATION_NOTE_CANONICAL_KEYS = new Set<string>([
  'workerAttestations.drugScreeningNotes',
  'workerAttestations.backgroundCheckNotes',
]);

const SUBMITTED_STATUS = 'submitted';

function lowerStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isAttestationSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  // Defensive: any other truthy value (number, object) counts as set.
  return Boolean(value);
}

interface BuildPatchArgs {
  applicationDoc: Record<string, unknown>;
  existingAttestations: Record<string, unknown>;
  source: AttestationSource;
  attestedAt: AttestationAttestedAt;
}

/**
 * Build the dotted-path patch (admin SDK; merge-true compatible) of the
 * application's attestation answers, filtered by D2 profile-wins-once-set.
 *
 * Returns an empty object when nothing needs to be written. Callers should
 * skip the Firestore write in that case.
 */
export function buildAttestationsSyncPatchFromApplication(
  args: BuildPatchArgs,
): Record<string, unknown> {
  const data = (args.applicationDoc?.data ?? {}) as Record<string, unknown>;
  const requirements = (data.requirements ?? {}) as Record<string, unknown>;
  const existing = args.existingAttestations ?? {};
  const existingScreenings = (existing.additionalScreenings ?? {}) as Record<
    string,
    unknown
  >;

  const patch: Record<string, unknown> = {};

  const writeStatic = (canonicalKey: string, value: unknown) => {
    if (!isAttestationSet(value)) return;
    const fieldKey = canonicalKey.replace(/^workerAttestations\./, '');
    if (isAttestationSet(existing[fieldKey])) return;
    patch[canonicalKey] = value;
    if (ATTESTATION_NOTE_CANONICAL_KEYS.has(canonicalKey)) return;
    patch[`workerAttestations._meta.${fieldKey}.attestedAt`] = args.attestedAt;
    patch[`workerAttestations._meta.${fieldKey}.source`] = args.source;
  };

  for (const [formKey, canonicalKey] of Object.entries(
    REQUIREMENT_FORM_KEY_TO_CANONICAL,
  )) {
    if (requirements[formKey] !== undefined) {
      writeStatic(canonicalKey, requirements[formKey]);
    }
  }

  // additionalScreenings is a Record<screeningName, AttestationWillingness>.
  // Write per-name (NOT replacing the whole map) so existing entries on the
  // profile aren't clobbered. Mirrors the client-side `additionalScreenings`
  // path in `buildCanonicalWorkerProfileWritePatch`, including stamping
  // `_meta.<screeningName>` per entry.
  const additionalScreenings = requirements.additionalScreenings;
  if (additionalScreenings && typeof additionalScreenings === 'object') {
    for (const [screeningName, value] of Object.entries(
      additionalScreenings as Record<string, unknown>,
    )) {
      if (!isAttestationSet(value)) continue;
      if (isAttestationSet(existingScreenings[screeningName])) continue;
      patch[`workerAttestations.additionalScreenings.${screeningName}`] = value;
      patch[`workerAttestations._meta.${screeningName}.attestedAt`] = args.attestedAt;
      patch[`workerAttestations._meta.${screeningName}.source`] = args.source;
    }
  }

  return patch;
}

export const onApplicationSubmittedSyncProfile = onDocumentWritten(
  'tenants/{tenantId}/applications/{appId}',
  async (event) => {
    const { tenantId, appId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Document deleted — nothing to sync.
    if (!after) return;

    // Only fire on the transition INTO `submitted`. Drafts (`in_progress`)
    // and post-submit status changes (`reviewing`, `interviewing`, `hired`)
    // are no-ops. Mirrors the gating used by `onApplicationStatusChanged`
    // in `applicationSmsTriggers.ts`.
    const newlySubmitted =
      lowerStatus(after.status) === SUBMITTED_STATUS &&
      lowerStatus(before?.status) !== SUBMITTED_STATUS;
    if (!newlySubmitted) return;

    const uid =
      typeof after.userId === 'string'
        ? after.userId
        : typeof after.workerId === 'string'
          ? after.workerId
          : typeof after.uid === 'string'
            ? after.uid
            : null;

    if (!uid) {
      logger.warn(
        '[R.0b][onApplicationSubmittedSyncProfile] missing uid on application',
        { tenantId, appId },
      );
      return;
    }

    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      logger.warn(
        '[R.0b][onApplicationSubmittedSyncProfile] user doc missing — skipping sync',
        { tenantId, appId, uid },
      );
      return;
    }

    const existingAttestations = ((userSnap.data() ?? {}).workerAttestations ??
      {}) as Record<string, unknown>;

    const patch = buildAttestationsSyncPatchFromApplication({
      applicationDoc: after,
      existingAttestations,
      source: 'application',
      attestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (Object.keys(patch).length === 0) {
      logger.info('[R.0b][onApplicationSubmittedSyncProfile] no-op (D2 filter)', {
        tenantId,
        appId,
        uid,
      });
      return;
    }

    // CRITICAL: Use `update()`, NOT `set(..., { merge: true })`.
    //
    // The Firebase Admin SDK has opposite semantics from the Web Client SDK
    // for dotted-string keys:
    //   - Admin SDK `update({ 'a.b': v })`        → nested `a.b = v` ✓
    //   - Admin SDK `set({ 'a.b': v }, merge)`    → LITERAL field "a.b" ✗ (bug we hit)
    //   - Web Client `setDoc({ 'a.b': v }, merge)` → nested `a.b = v` ✓ (different SDK)
    //
    // `buildAttestationsSyncPatchFromApplication` returns dotted-path keys
    // (e.g. `workerAttestations.eVerifyWillingness`,
    // `workerAttestations._meta.eVerifyWillingness.source`). Those need to be
    // interpreted as field paths, which is what `update()` does. The
    // `userSnap.exists` guard above ensures `update()` won't fail with
    // NOT_FOUND.
    //
    // See: docs/READINESS_R0_HANDOFF.md (post-mortem section, Apr 26 2026).
    await userRef.update(patch);

    logger.info('[R.0b][onApplicationSubmittedSyncProfile] synced', {
      tenantId,
      appId,
      uid,
      fieldsWritten: Object.keys(patch).length,
    });
  },
);
