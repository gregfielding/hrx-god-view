/**
 * When a national recruiter account opts in, new company locations under the linked CRM company
 * auto-create a child account (future locations only; trigger runs on location create).
 *
 * Rename behavior: child display names follow "{parentName} {locationDisplayName}" only when the
 * location's display name changes. Child account names do NOT update when the parent account name
 * changes — only location name changes trigger rename (and only when the child name still matches
 * the exact previously generated title).
 */
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

const FieldValue = admin.firestore.FieldValue;

const LOG = {
  created: 'autoChildAccount: child_account_created',
  skippedDuplicate: 'autoChildAccount: skipped_duplicate',
  skippedIdempotent: 'autoChildAccount: skipped_idempotent_doc_exists',
  skippedToggleOff: 'autoChildAccount: skipped_toggle_off',
  skippedNonNational: 'autoChildAccount: skipped_non_national',
  renameApplied: 'autoChildAccount: rename_applied',
  renameSkippedManual: 'autoChildAccount: rename_skipped_manual_edit',
} as const;

function logEvent(msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ msg, ...fields }));
}

export function locationDisplayName(loc: Record<string, unknown> | undefined | null): string {
  if (!loc) return 'Location';
  const nick = loc.nickname != null ? String(loc.nickname).trim() : '';
  if (nick) return nick;
  const name = loc.name != null ? String(loc.name).trim() : '';
  return name || 'Location';
}

type AccountDoc = Record<string, unknown>;

/**
 * Stable id for idempotent creates: derived from parent + company + location (locationId alone is only unique per company).
 * User-facing key concept: parentAccountId + companyLocationId; companyId included to avoid collisions.
 */
function deterministicAutoChildAccountDocId(
  parentAccountId: string,
  companyId: string,
  companyLocationId: string
): string {
  const h = crypto
    .createHash('sha256')
    .update(`autoChildLoc|${parentAccountId}|${companyId}|${companyLocationId}`)
    .digest('hex')
    .slice(0, 32);
  return `autoLoc_${h}`;
}

async function findExistingChildForLocation(
  db: Firestore,
  tenantId: string,
  parentAccountId: string,
  companyId: string,
  locationId: string
): Promise<string | null> {
  const accountsCol = db.collection(`tenants/${tenantId}/accounts`);

  const byMeta = await accountsCol
    .where('parentAccountId', '==', parentAccountId)
    .where('companyId', '==', companyId)
    .where('companyLocationId', '==', locationId)
    .limit(1)
    .get();
  if (!byMeta.empty) return byMeta.docs[0].id;

  const parentSnap = await accountsCol.doc(parentAccountId).get();
  const childIds = (parentSnap.data()?.childAccountIds as string[] | undefined) ?? [];
  if (childIds.length === 0) return null;

  const chunkSize = 30;
  for (let i = 0; i < childIds.length; i += chunkSize) {
    const chunk = childIds.slice(i, i + chunkSize);
    const refs = chunk.map((id) => accountsCol.doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() as AccountDoc;
      const locs = (d.associations as { locations?: Array<{ companyId?: string; locationId?: string }> } | undefined)?.locations;
      if (locs?.some((l) => l.companyId === companyId && l.locationId === locationId)) {
        return s.id;
      }
    }
  }
  return null;
}

function generatedChildAccountName(parentName: string, locationDisplayName: string): string {
  return `${parentName} ${locationDisplayName}`.replace(/\s+/g, ' ').trim();
}

export type TryCreateChildAccountOutcome =
  | 'created'
  | 'skipped_duplicate'
  | 'skipped_idempotent'
  | 'skipped_toggle'
  | 'skipped_not_national'
  | 'aborted'
  | 'transaction_failed';

/**
 * Single location → child account for one national parent. Used by Firestore trigger and backfill callable.
 * @param requireAutoCreateToggle — when true (automation), parent must have autoCreateChildAccountsForLocations.
 *   When false (manual backfill), only national + linked company are required.
 */
export async function tryCreateChildAccountForNationalParent(params: {
  db: Firestore;
  tenantId: string;
  parentAccountId: string;
  companyId: string;
  locationId: string;
  locationData: Record<string, unknown>;
  requireAutoCreateToggle: boolean;
  /** When set, stored on child/parent writes for audit (backfill). */
  actorUid?: string;
  /** When true, omit routine skip logs (bulk backfill). */
  quiet?: boolean;
}): Promise<TryCreateChildAccountOutcome> {
  const {
    db,
    tenantId,
    parentAccountId: parentId,
    companyId,
    locationId,
    locationData,
    requireAutoCreateToggle,
    actorUid,
    quiet,
  } = params;

  const accountsCol = db.collection(`tenants/${tenantId}/accounts`);
  const parentSnap = await accountsCol.doc(parentId).get();
  if (!parentSnap.exists) return 'aborted';
  const parentData = parentSnap.data() as AccountDoc;

  if (parentData.accountType !== 'national') {
    if (!quiet) logEvent(LOG.skippedNonNational, { tenantId, companyId, locationId, parentId });
    return 'skipped_not_national';
  }
  if (requireAutoCreateToggle && parentData.autoCreateChildAccountsForLocations !== true) {
    if (!quiet) logEvent(LOG.skippedToggleOff, { tenantId, companyId, locationId, parentId });
    return 'skipped_toggle';
  }

  const existingId = await findExistingChildForLocation(db, tenantId, parentId, companyId, locationId);
  if (existingId) {
    if (!quiet) logEvent(LOG.skippedDuplicate, { tenantId, companyId, locationId, parentId, existingChildAccountId: existingId });
    return 'skipped_duplicate';
  }

  const deterministicId = deterministicAutoChildAccountDocId(parentId, companyId, locationId);
  const parentName = String(parentData.name ?? '').trim() || 'Account';
  const locDisplay = locationDisplayName(locationData);
  const childName = generatedChildAccountName(parentName, locDisplay);

  const auditTag = actorUid ? `national_location_backfill:${actorUid}` : 'system_auto_child_account';

  const txOutcome: { status: 'created' | 'idempotent' | 'aborted' } = { status: 'aborted' };
  try {
    await db.runTransaction(async (tx) => {
      const childRef = accountsCol.doc(deterministicId);
      const parentRef = accountsCol.doc(parentId);

      const existingChild = await tx.get(childRef);
      if (existingChild.exists) {
        txOutcome.status = 'idempotent';
        return;
      }

      const parentFresh = await tx.get(parentRef);
      if (!parentFresh.exists) return;
      const pd = parentFresh.data() as AccountDoc;
      if (pd.accountType !== 'national') return;
      if (requireAutoCreateToggle && pd.autoCreateChildAccountsForLocations !== true) return;
      const assoc = pd.associations as { companyIds?: string[] } | undefined;
      const cids = Array.isArray(assoc?.companyIds) ? assoc!.companyIds! : [];
      if (!cids.includes(companyId)) return;

      const childPayload: AccountDoc = {
        name: childName,
        active: pd.active !== false,
        accountType: 'child',
        parentAccountId: parentId,
        childAccountIds: [],
        hiringEntityId: pd.hiringEntityId ?? null,
        mspAccountIds: [],
        autoCreatedFromCompanyLocation: true,
        autoCreatedFromLocationDisplayName: locDisplay,
        companyId,
        companyLocationId: locationId,
        associations: {
          companyIds: [companyId],
          locations: [{ companyId, locationId }],
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: auditTag,
        updatedBy: auditTag,
      };

      if (pd.defaults && typeof pd.defaults === 'object') {
        childPayload.defaults = pd.defaults;
      }
      if (pd.orderDefaults && typeof pd.orderDefaults === 'object') {
        childPayload.orderDefaults = pd.orderDefaults;
      }
      if (pd.pricing && typeof pd.pricing === 'object') {
        childPayload.pricing = pd.pricing;
      }

      tx.set(childRef, childPayload);
      tx.update(parentRef, {
        childAccountIds: FieldValue.arrayUnion(deterministicId),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auditTag,
      });
      txOutcome.status = 'created';
    });
  } catch (e: any) {
    console.error(
      JSON.stringify({
        msg: 'autoChildAccount: transaction_failed',
        tenantId,
        companyId,
        locationId,
        parentId,
        error: String(e?.message || e),
      })
    );
    return 'transaction_failed';
  }

  if (txOutcome.status === 'idempotent') {
    if (!quiet) logEvent(LOG.skippedIdempotent, { tenantId, companyId, locationId, parentId, childAccountId: deterministicId });
    return 'skipped_idempotent';
  }
  if (txOutcome.status === 'created') {
    logEvent(LOG.created, {
      tenantId,
      companyId,
      locationId,
      parentId,
      childAccountId: deterministicId,
    });
    return 'created';
  }
  return 'aborted';
}

/**
 * Called from onCompanyLocationCreated (must run even when state/mirror logic is skipped).
 */
export async function maybeAutoCreateChildAccountForNewLocation(params: {
  tenantId: string;
  companyId: string;
  locationId: string;
  locationData: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, companyId, locationId, locationData } = params;
  const db = admin.firestore();

  const accountsCol = db.collection(`tenants/${tenantId}/accounts`);
  const linkedParents = await accountsCol.where('associations.companyIds', 'array-contains', companyId).get();

  for (const docSnap of linkedParents.docs) {
    const parentId = docSnap.id;
    await tryCreateChildAccountForNationalParent({
      db,
      tenantId,
      parentAccountId: parentId,
      companyId,
      locationId,
      locationData,
      requireAutoCreateToggle: true,
    });
  }
}

/**
 * When a location display name changes, rename auto-created child accounts only if the name was never manually edited.
 *
 * Child account names do NOT update when parent account name changes — only location-driven titles
 * are updated here, and only when `name` still equals the exact prior generated title for the prior location display name.
 */
export async function maybeSyncAutoChildAccountNameOnLocationUpdate(params: {
  tenantId: string;
  companyId: string;
  locationId: string;
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
}): Promise<void> {
  const { tenantId, companyId, locationId, before, after } = params;
  if (!after) return;
  const prevName = locationDisplayName(before);
  const nextName = locationDisplayName(after);
  if (prevName === nextName) return;

  const db = admin.firestore();
  const accountsCol = db.collection(`tenants/${tenantId}/accounts`);

  const q = await accountsCol
    .where('autoCreatedFromCompanyLocation', '==', true)
    .where('companyId', '==', companyId)
    .where('companyLocationId', '==', locationId)
    .get();

  for (const d of q.docs) {
    const data = d.data() as AccountDoc;
    if (data.autoCreatedFromCompanyLocation !== true) continue;

    const parentId = data.parentAccountId as string | undefined;
    if (!parentId) continue;

    const parentSnap = await accountsCol.doc(parentId).get();
    if (!parentSnap.exists) continue;
    const parentName = String((parentSnap.data() as AccountDoc).name ?? '').trim() || 'Account';

    const previousGeneratedName = generatedChildAccountName(parentName, prevName);
    const currentName = String(data.name ?? '').trim();

    if (currentName !== previousGeneratedName) {
      logEvent(LOG.renameSkippedManual, {
        tenantId,
        companyId,
        locationId,
        childAccountId: d.id,
        parentId,
        currentName,
        expectedExact: previousGeneratedName,
      });
      continue;
    }

    const newChildName = generatedChildAccountName(parentName, nextName);

    await d.ref.update({
      name: newChildName,
      autoCreatedFromLocationDisplayName: nextName,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system_auto_child_account',
    });
    logEvent(LOG.renameApplied, {
      tenantId,
      companyId,
      locationId,
      childAccountId: d.id,
      parentId,
      previousGeneratedName,
      newName: newChildName,
    });
  }
}
