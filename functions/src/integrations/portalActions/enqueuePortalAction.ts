/**
 * Producer side of the portal action queue (see shared/portalActions.ts).
 *
 * HRX code that wants the always-on portal worker to do something in the
 * Indeed Flex agency portal or SAP Fieldglass calls `enqueuePortalAction`.
 * The doc id is the idempotency key, so callers can fire-and-forget from
 * triggers/callables without double-booking: an open (pending/claimed/
 * running) action is returned as-is, a succeeded one is only re-run with
 * `force: true`, and failed/needs_human/cancelled rows are reset to pending.
 *
 * No Cloud Function is exported from here on purpose (Cloud Run service cap):
 * this is a library used by the hire flow, scratch scripts, and future
 * callables. The consumer lives in portal-worker/.
 */
import * as admin from 'firebase-admin';
import {
  PORTAL_ACTION_DEFAULT_MAX_ATTEMPTS,
  PORTAL_ACTION_DEFAULT_PRIORITY,
  PORTAL_ACTION_HISTORY_CAP,
  PORTAL_ACTION_OPEN_STATUSES,
  buildPortalActionId,
  defaultPortalActionKeyParts,
  providerForAction,
  type PortalActionCreatedBy,
  type PortalActionDoc,
  type PortalActionPayloadMap,
  type PortalActionRefs,
  type PortalActionStatus,
  type PortalActionType,
  type PortalProvider,
} from '../../shared/portalActions';

export interface EnqueuePortalActionInput<A extends PortalActionType = PortalActionType> {
  tenantId: string;
  action: A;
  payload: PortalActionPayloadMap[A];
  /** Required for smoke_test; inferred (and validated) for everything else. */
  provider?: PortalProvider;
  refs?: PortalActionRefs;
  createdBy: PortalActionCreatedBy;
  /** Override the natural-key parts (defaults come from defaultPortalActionKeyParts). */
  keyParts?: Array<string | number | null | undefined>;
  priority?: number;
  maxAttempts?: number;
  /** Do not run before this instant. */
  notBefore?: Date | null;
  /** Re-run even if an identical action already succeeded. */
  force?: boolean;
}

export interface EnqueuePortalActionResult {
  id: string;
  /** true when a new row was written (or a terminal row was reset). */
  created: boolean;
  status: PortalActionStatus;
  /** Set when an existing row was left untouched. */
  existingStatus?: PortalActionStatus;
}

export function portalActionsCollection(db: admin.firestore.Firestore, tenantId: string) {
  return db.collection('tenants').doc(tenantId).collection('portal_actions');
}

export async function enqueuePortalAction<A extends PortalActionType>(
  db: admin.firestore.Firestore,
  input: EnqueuePortalActionInput<A>,
): Promise<EnqueuePortalActionResult> {
  if (!input.tenantId) throw new Error('enqueuePortalAction: tenantId is required');
  const provider = providerForAction(input.action, input.provider);
  const keyParts = input.keyParts ?? defaultPortalActionKeyParts(input.action, input.payload);
  const id = buildPortalActionId(provider, input.action, keyParts);
  if (input.action === 'smoke_test' && !input.keyParts) {
    // smoke tests are not naturally idempotent — give each one its own row.
    return writeNew(db, input, provider, `${id}__${Date.now()}`);
  }
  const ref = portalActionsCollection(db, input.tenantId).doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data() as PortalActionDoc;
      if (PORTAL_ACTION_OPEN_STATUSES.includes(existing.status)) {
        return { id, created: false, status: existing.status, existingStatus: existing.status };
      }
      if (existing.status === 'succeeded' && !input.force) {
        return { id, created: false, status: existing.status, existingStatus: existing.status };
      }
      const now = admin.firestore.Timestamp.now();
      const history = [
        ...(existing.history || []),
        {
          at: now.toDate().toISOString(),
          status: 'pending' as const,
          note: `re-enqueued (was ${existing.status})${input.force ? ' [force]' : ''}`,
        },
      ].slice(-PORTAL_ACTION_HISTORY_CAP);
      tx.set(
        ref,
        {
          ...buildDoc(input, provider, id, now),
          attempts: 0,
          history,
        },
        { merge: false },
      );
      return { id, created: true, status: 'pending', existingStatus: existing.status };
    }
    const now = admin.firestore.Timestamp.now();
    tx.set(ref, buildDoc(input, provider, id, now));
    return { id, created: true, status: 'pending' };
  });
}

async function writeNew<A extends PortalActionType>(
  db: admin.firestore.Firestore,
  input: EnqueuePortalActionInput<A>,
  provider: PortalProvider,
  id: string,
): Promise<EnqueuePortalActionResult> {
  const now = admin.firestore.Timestamp.now();
  await portalActionsCollection(db, input.tenantId).doc(id).set(buildDoc(input, provider, id, now));
  return { id, created: true, status: 'pending' };
}

function buildDoc<A extends PortalActionType>(
  input: EnqueuePortalActionInput<A>,
  provider: PortalProvider,
  id: string,
  now: admin.firestore.Timestamp,
): PortalActionDoc<A> {
  const nowIso = now.toDate().toISOString();
  return {
    tenantId: input.tenantId,
    provider,
    action: input.action,
    status: 'pending',
    payload: input.payload,
    refs: input.refs ?? {},
    idempotencyKey: id,
    priority: input.priority ?? PORTAL_ACTION_DEFAULT_PRIORITY,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? PORTAL_ACTION_DEFAULT_MAX_ATTEMPTS,
    notBefore: input.notBefore ? admin.firestore.Timestamp.fromDate(input.notBefore) : null,
    lease: null,
    lastError: null,
    result: null,
    history: [{ at: nowIso, status: 'pending', note: 'enqueued' }],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

/** Cancel an open action (no-op if it already finished). */
export async function cancelPortalAction(
  db: admin.firestore.Firestore,
  tenantId: string,
  id: string,
  by: PortalActionCreatedBy,
  note?: string,
): Promise<{ cancelled: boolean; status: PortalActionStatus | null }> {
  const ref = portalActionsCollection(db, tenantId).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { cancelled: false, status: null };
    const doc = snap.data() as PortalActionDoc;
    if (!PORTAL_ACTION_OPEN_STATUSES.includes(doc.status)) return { cancelled: false, status: doc.status };
    const now = admin.firestore.Timestamp.now();
    tx.update(ref, {
      status: 'cancelled',
      lease: null,
      finishedAt: now,
      updatedAt: now,
      history: [
        ...(doc.history || []),
        { at: now.toDate().toISOString(), status: 'cancelled', note: note || `cancelled by ${by.kind}:${by.id || '?'}` },
      ].slice(-PORTAL_ACTION_HISTORY_CAP),
    });
    return { cancelled: true, status: 'cancelled' };
  });
}
