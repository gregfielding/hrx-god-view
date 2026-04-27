/**
 * Ownership mutations for readiness queue items — claim, reassign, release.
 *
 * **Provenance:** extracted from `RecruiterMyQueue.tsx` (in-production
 * ownership controls). D.1 doesn't surface these in the UI yet (Workforce
 * D.1 ships read-only); D.3 wires them into the action drawer. Extracting
 * now keeps the eventual D.3 patch minimal and ensures the legacy
 * `RecruiterMyQueue` and the new Workforce surface mutate the data the
 * exact same way.
 *
 * Per Greg's 2026-04-25 D.1 directive answer (`csa_action_permissions =
 * full_action_with_audit`): any CSA can call these on any item. The history
 * entry records `actorUid` so audits show actor != owner mismatches.
 *
 * @see ../../shared/actionItemOwnership.ts for the ownership model.
 */

import {
  arrayUnion,
  doc,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

import type { QueueRow } from './queueRow';

/**
 * Map a `QueueRow.kind` to its firestore subcollection. Centralised so we
 * only have one place to update if the data model ever splits further.
 */
function collectionForKind(kind: QueueRow['kind']): string {
  return kind === 'employee' ? 'employeeReadinessItems' : 'assignmentReadinessItems';
}

export interface ClaimItemArgs {
  db: Firestore;
  tenantId: string;
  row: Pick<QueueRow, 'id' | 'kind'>;
  actorUid: string;
}

/** Pool → primary. Idempotent: claiming an already-owned item is a no-op-ish update. */
export async function claimQueueItem(args: ClaimItemArgs): Promise<void> {
  const { db, tenantId, row, actorUid } = args;
  const ref = doc(db, 'tenants', tenantId, collectionForKind(row.kind), row.id);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    'ownership.primaryRecruiterId': actorUid,
    'ownership.primarySource': 'manual',
    'ownership.visibleRecruiterIds': arrayUnion(actorUid),
    'ownership.history': arrayUnion({
      at: nowIso,
      actorUid,
      action: 'claimed',
      from: null,
      to: actorUid,
      reason: 'Claimed from unassigned pool',
    }),
    updatedAt: serverTimestamp(),
  });
}

export interface ReassignItemArgs {
  db: Firestore;
  tenantId: string;
  row: Pick<QueueRow, 'id' | 'kind' | 'primaryRecruiterId'>;
  /** Caller. Recorded in the history entry — may differ from `targetUid`. */
  actorUid: string;
  targetUid: string;
  reason?: string;
}

/**
 * Move primary ownership to another recruiter. The teammate must be in the
 * item's `visibleRecruiterIds` per ownership-model rules (§6a) — we don't
 * pre-check client-side because the resolver's visibility list can change
 * server-side between render and submit; firestore rules are the real gate.
 */
export async function reassignQueueItem(args: ReassignItemArgs): Promise<void> {
  const { db, tenantId, row, actorUid, targetUid, reason } = args;
  const ref = doc(db, 'tenants', tenantId, collectionForKind(row.kind), row.id);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    'ownership.primaryRecruiterId': targetUid,
    'ownership.primarySource': 'manual',
    'ownership.visibleRecruiterIds': arrayUnion(targetUid),
    'ownership.history': arrayUnion({
      at: nowIso,
      actorUid,
      action: 'reassigned',
      from: row.primaryRecruiterId,
      to: targetUid,
      reason: reason?.trim() || `Reassigned by ${actorUid}`,
    }),
    updatedAt: serverTimestamp(),
  });
}

export interface ReleaseItemArgs {
  db: Firestore;
  tenantId: string;
  row: Pick<QueueRow, 'id' | 'kind' | 'primaryRecruiterId'>;
  actorUid: string;
  reason?: string;
}

/**
 * Release the item back to the unassigned pool. Clears
 * `primaryRecruiterId`; leaves `visibleRecruiterIds` alone so released
 * items still show up in everyone's pool view.
 */
export async function releaseQueueItem(args: ReleaseItemArgs): Promise<void> {
  const { db, tenantId, row, actorUid, reason } = args;
  const ref = doc(db, 'tenants', tenantId, collectionForKind(row.kind), row.id);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    'ownership.primaryRecruiterId': null,
    'ownership.primarySource': 'unassigned',
    'ownership.history': arrayUnion({
      at: nowIso,
      actorUid,
      action: 'released',
      from: row.primaryRecruiterId,
      to: null,
      reason: reason?.trim() || 'Released to pool',
    }),
    updatedAt: serverTimestamp(),
  });
}
