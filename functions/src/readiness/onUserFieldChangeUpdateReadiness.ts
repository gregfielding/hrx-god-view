/**
 * Phase A trigger — bridge `users/{uid}` writes into the four profile-
 * basic readiness items: `profile_photo`, `phone_verified`,
 * `emergency_contact`, `address_confirmed`.
 *
 * Closes Critical hole #1 (user-fields branch) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * These four items are the only readiness items derived from
 * top-level user fields rather than a vendor / onboarding-step source.
 * The seed runner stamps them as `incomplete` when an entity_employments
 * doc is created; this trigger reconciles them whenever the underlying
 * field changes on the user doc — e.g. worker uploads a profile photo
 * after onboarding.
 *
 * Multi-tenant fan-out: `users` is top-level, but the readiness items
 * live under `tenants/{tid}/employee_readiness_items`. We use a
 * collection-group query on `entity_employments` filtered by uid to
 * find every (tenant × hiring entity) pair this user belongs to.
 *
 * Heavy short-circuit: this trigger fires on every user write. We only
 * run the fan-out when one of the four watched fields actually changed.
 *
 * @see updateReadinessItemStatus.ts
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import type { EmployeeReadinessItemStatus } from '../shared/employeeReadinessItemV1';
import { updateReadinessItemStatusForEntities } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface ProfileFieldsSnapshot {
  profilePhoto: boolean;
  phoneVerified: boolean;
  emergencyContact: boolean;
  addressConfirmed: boolean;
}

/** Each field is a "is the data present" boolean — the readiness item's
 *  status mirrors that. No vendor / pass-fail nuance applies here. */
function snapshotProfileFields(data: Record<string, unknown> | null): ProfileFieldsSnapshot {
  if (!data) {
    return {
      profilePhoto: false,
      phoneVerified: false,
      emergencyContact: false,
      addressConfirmed: false,
    };
  }

  const photoUrl = (data.profilePhotoUrl ?? data.avatarUrl ?? data.avatar) as
    | string
    | null
    | undefined;
  const phoneVerifiedAt = (data.phoneVerifiedAt ?? null) as unknown;
  const ec = data.emergencyContact as Record<string, unknown> | null | undefined;
  const address = data.address as Record<string, unknown> | null | undefined;

  return {
    profilePhoto: typeof photoUrl === 'string' && photoUrl.trim().length > 0,
    phoneVerified: phoneVerifiedAt !== null && phoneVerifiedAt !== undefined,
    emergencyContact:
      !!ec &&
      typeof ec.name === 'string' &&
      ec.name.trim().length > 0 &&
      typeof ec.phone === 'string' &&
      ec.phone.trim().length > 0,
    addressConfirmed:
      !!address &&
      ((address.coordinates !== null && address.coordinates !== undefined) ||
        (typeof address.line1 === 'string' && address.line1.trim().length > 0)),
  };
}

function snapshotsEqual(a: ProfileFieldsSnapshot, b: ProfileFieldsSnapshot): boolean {
  return (
    a.profilePhoto === b.profilePhoto &&
    a.phoneVerified === b.phoneVerified &&
    a.emergencyContact === b.emergencyContact &&
    a.addressConfirmed === b.addressConfirmed
  );
}

function fieldStatus(present: boolean): EmployeeReadinessItemStatus {
  return present ? 'complete_pass' : 'incomplete';
}

/**
 * Resolve every (tenantId, hiringEntityId) pair this worker has an
 * `entity_employments` doc under. Uses a collection-group query keyed on
 * `userId` so we don't have to enumerate tenants. Falls back to a
 * second collection-group query on `candidateId` for legacy docs.
 */
async function loadTenantEntityPairs(
  workerUid: string,
): Promise<Array<{ tenantId: string; hiringEntityId: string }>> {
  const cg = db.collectionGroup('entity_employments');
  const [byUserId, byCandidateId] = await Promise.all([
    cg.where('userId', '==', workerUid).get(),
    cg.where('candidateId', '==', workerUid).get(),
  ]);

  const pairs = new Map<string, { tenantId: string; hiringEntityId: string }>();
  for (const snap of [byUserId, byCandidateId]) {
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const tenantId =
        typeof data.tenantId === 'string'
          ? data.tenantId.trim()
          : doc.ref.path.split('/')[1] ?? '';
      const hiringEntityId =
        (typeof data.hiringEntityId === 'string' && data.hiringEntityId.trim()) ||
        (typeof data.entityId === 'string' && data.entityId.trim()) ||
        '';
      if (!tenantId || !hiringEntityId) continue;
      const key = `${tenantId}::${hiringEntityId}`;
      if (!pairs.has(key)) {
        pairs.set(key, { tenantId, hiringEntityId });
      }
    }
  }
  return Array.from(pairs.values());
}

export const onUserFieldChangeUpdateReadiness = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 10,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const uid = String(event.params.uid);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) return; // user deleted — don't roll back items

    const before = snapshotProfileFields(beforeData);
    const after = snapshotProfileFields(afterData);
    if (snapshotsEqual(before, after)) return;

    // Only resolve tenant × entity pairs once we know we have work.
    const pairs = await loadTenantEntityPairs(uid);
    if (pairs.length === 0) return;

    // Group by tenant so we issue one set of writes per tenant rather
    // than per-pair (the helper's `forEntities` form batches per tenant).
    const byTenant = new Map<string, string[]>();
    for (const p of pairs) {
      const arr = byTenant.get(p.tenantId) ?? [];
      arr.push(p.hiringEntityId);
      byTenant.set(p.tenantId, arr);
    }

    type FieldUpdate = {
      requirementType:
        | 'profile_photo'
        | 'phone_verified'
        | 'emergency_contact'
        | 'address_confirmed';
      changed: boolean;
      newStatus: EmployeeReadinessItemStatus;
    };

    const fieldUpdates: FieldUpdate[] = [
      { requirementType: 'profile_photo', changed: before.profilePhoto !== after.profilePhoto, newStatus: fieldStatus(after.profilePhoto) },
      { requirementType: 'phone_verified', changed: before.phoneVerified !== after.phoneVerified, newStatus: fieldStatus(after.phoneVerified) },
      { requirementType: 'emergency_contact', changed: before.emergencyContact !== after.emergencyContact, newStatus: fieldStatus(after.emergencyContact) },
      { requirementType: 'address_confirmed', changed: before.addressConfirmed !== after.addressConfirmed, newStatus: fieldStatus(after.addressConfirmed) },
    ];

    let totalChanged = 0;
    for (const [tenantId, entityIds] of byTenant.entries()) {
      for (const fu of fieldUpdates) {
        if (!fu.changed) continue;
        const results = await updateReadinessItemStatusForEntities(
          {
            tenantId,
            workerUid: uid,
            requirementType: fu.requirementType,
            newStatus: fu.newStatus,
            source: 'user_field_change',
            externalRef: uid,
          },
          entityIds,
        );
        totalChanged += results.filter((r) => r.changed).length;
      }
    }

    logger.info('onUserFieldChangeUpdateReadiness: reconciled', {
      uid,
      tenantsTouched: byTenant.size,
      fieldsChanged: fieldUpdates.filter((f) => f.changed).map((f) => f.requirementType),
      totalChanged,
    });
  },
);
