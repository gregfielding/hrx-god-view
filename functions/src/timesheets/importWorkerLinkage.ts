/**
 * importWorkerLinkage — resolve a worker's Everee linkage + an actionable
 * "not linked" reason for the CSV-import flow.
 *
 * This is the linkage/block half of what `importTimesheetMatchWorkers` does
 * per row, factored out so the Grid's "reassign worker" callable
 * (`reassignImportEntryWorker`) can recompute exactly the same state when a
 * recruiter swaps an import row to a different HRX worker (e.g. picks the
 * onboarded "Marquis Dennis" over a same-name unlinked one).
 *
 * It deliberately does NOT re-resolve pay / WC / worksite — those follow the
 * WORK (site, role, date), not the worker identity, so the reassign callable
 * carries them over from the existing entry untouched.
 *
 * The reason text mirrors the match callable's `buildNotLinkedReason` so the
 * Grid and Import tab show the same message. (The match callable keeps its own
 * cached closure version for batch performance; this is the single-row form.)
 */

import * as admin from 'firebase-admin';

import { evereePaths } from '../integrations/everee/evereeConfig';
import { extractEvereeHomeAddressFromUserDoc } from '../integrations/everee/evereeUserAddress';
import {
  resolveExternalWorkerId,
  resolveEvereeWorkerUuid,
} from '../payroll/workerContextResolver';

export interface ImportWorkerLinkage {
  evereeLinked: boolean;
  /** Everee-internal worker UUID for this entity (null when unlinked). */
  evereeWorkerId: string | null;
  /** Actionable reason when NOT linked; null when linked. */
  blockReason: string | null;
}

/** Onboarding state of a worker on a SPECIFIC entity, read from the Everee
 *  worker mirror doc. Used to point a "not linked here" reason at where the
 *  worker IS set up. */
async function entityEvereeState(
  db: admin.firestore.Firestore,
  tenantId: string,
  entityId: string,
  userId: string,
): Promise<'complete' | 'provisioned' | 'none'> {
  try {
    const snap = await db.doc(evereePaths.worker(tenantId, entityId, userId)).get();
    if (!snap.exists) return 'none';
    const d = (snap.data() || {}) as Record<string, any>;
    const mirror = (d.readinessMirror || {}) as Record<string, unknown>;
    return mirror.onboardingComplete === true ||
      String(d.status || '').trim().toLowerCase() === 'onboarding_complete' ||
      d.apiObservedOnboardingCompleteAt != null
      ? 'complete'
      : 'provisioned';
  } catch {
    return 'none';
  }
}

/** Build the same actionable "isn't linked to {entity}" message the match
 *  callable shows — surfacing onboarding elsewhere + an incomplete home
 *  address so a dead-end "needs onboarding" becomes a next step. */
async function buildNotLinkedReason(
  db: admin.firestore.Firestore,
  args: { tenantId: string; hiringEntityId: string; entityLabel: string; userId: string; displayName: string },
): Promise<string> {
  const { tenantId, hiringEntityId, entityLabel, userId, displayName } = args;
  const who = displayName || 'This worker';
  let reason = `${who} isn't linked to Everee for ${entityLabel} — needs onboarding.`;
  try {
    const empSnap = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', userId)
      .limit(10)
      .get();
    let completeElsewhere: string | null = null;
    let onboardingElsewhere: string | null = null;
    for (const d of empSnap.docs) {
      const e = d.data() as Record<string, any>;
      const eId = String(e.entityId || '').trim();
      if (!eId || eId === String(hiringEntityId || '').trim()) continue;
      const label =
        String(e.entityName || '').trim() || String(e.entityKey || '').trim() || 'another entity';
      // eslint-disable-next-line no-await-in-loop
      const state = await entityEvereeState(db, tenantId, eId, userId);
      if (state === 'complete' && !completeElsewhere) completeElsewhere = label;
      else if (state === 'provisioned' && !onboardingElsewhere) onboardingElsewhere = label;
    }
    if (completeElsewhere) {
      reason = `${who} is set up on ${completeElsewhere}, not ${entityLabel} — likely the wrong paying entity (or needs ${entityLabel} onboarding).`;
    } else if (onboardingElsewhere) {
      reason = `${who} isn't linked to ${entityLabel}. Onboarding on ${onboardingElsewhere} (not finished).`;
    }
    const userSnap = await db.doc(`users/${userId}`).get();
    const addr = userSnap.exists ? extractEvereeHomeAddressFromUserDoc(userSnap.data()) : null;
    if (!addr) {
      reason += " Profile home address is incomplete — can't provision to Everee until it's set.";
    }
  } catch {
    /* keep the base reason */
  }
  return reason;
}

/**
 * Resolve a worker's Everee linkage for one entity, with a block reason when
 * unlinked. When the entity has no Everee config (`evereeTenantId` null) the
 * worker can't be linked anywhere — return the entity-not-configured reason.
 */
export async function resolveImportWorkerLinkage(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    hiringEntityId: string;
    entityLabel: string;
    evereeTenantId: string | null;
    userId: string;
    displayName: string;
  },
): Promise<ImportWorkerLinkage> {
  const { tenantId, hiringEntityId, entityLabel, evereeTenantId, userId, displayName } = args;
  if (!evereeTenantId) {
    return {
      evereeLinked: false,
      evereeWorkerId: null,
      blockReason: 'Selected hiring entity is not configured for Everee payroll.',
    };
  }
  const ext = await resolveExternalWorkerId(tenantId, userId, evereeTenantId);
  const evereeLinked = !!ext;
  if (!evereeLinked) {
    return {
      evereeLinked: false,
      evereeWorkerId: null,
      blockReason: await buildNotLinkedReason(db, {
        tenantId,
        hiringEntityId,
        entityLabel,
        userId,
        displayName,
      }),
    };
  }
  const evereeWorkerId = await resolveEvereeWorkerUuid(tenantId, userId, evereeTenantId);
  return { evereeLinked: true, evereeWorkerId, blockReason: null };
}
