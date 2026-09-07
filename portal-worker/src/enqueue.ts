/**
 * Producer helper for the worker itself and its CLIs — the same semantics as
 * functions/src/integrations/portalActions/enqueuePortalAction.ts (open rows
 * returned as-is, succeeded rows only re-run with `force`, terminal rows
 * reset), re-implemented here so this package has no build dependency on
 * functions/.
 */
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
} from '../../shared/portalActions.ts';
import { Timestamp, type Firestore } from './firebase.ts';
import { actionsCollection } from './queue.ts';

export interface EnqueueInput<A extends PortalActionType = PortalActionType> {
  tenantId: string;
  action: A;
  payload: PortalActionPayloadMap[A];
  provider?: PortalProvider;
  refs?: PortalActionRefs;
  createdBy: PortalActionCreatedBy;
  keyParts?: Array<string | number | null | undefined>;
  priority?: number;
  maxAttempts?: number;
  notBefore?: Date | null;
  force?: boolean;
}

export interface EnqueueResult {
  id: string;
  created: boolean;
  status: PortalActionStatus;
  existingStatus?: PortalActionStatus;
}

export async function enqueuePortalAction<A extends PortalActionType>(db: Firestore, input: EnqueueInput<A>): Promise<EnqueueResult> {
  const provider = providerForAction(input.action, input.provider);
  const keyParts = input.keyParts ?? defaultPortalActionKeyParts(input.action, input.payload);
  let id = buildPortalActionId(provider, input.action, keyParts);
  if (input.action === 'smoke_test' && !input.keyParts) id = `${id}__${Date.now()}`;
  const ref = actionsCollection(db, input.tenantId).doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    const base: PortalActionDoc = {
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
      notBefore: input.notBefore ? Timestamp.fromDate(input.notBefore) : null,
      lease: null,
      lastError: null,
      result: null,
      history: [{ at: nowIso, status: 'pending', note: `enqueued by ${input.createdBy.kind}:${input.createdBy.id ?? '?'}` }],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    if (snap.exists) {
      const existing = snap.data() as PortalActionDoc;
      if (PORTAL_ACTION_OPEN_STATUSES.includes(existing.status)) {
        return { id, created: false, status: existing.status, existingStatus: existing.status };
      }
      if (existing.status === 'succeeded' && !input.force) {
        return { id, created: false, status: existing.status, existingStatus: existing.status };
      }
      tx.set(ref, {
        ...base,
        history: [
          ...(existing.history || []),
          { at: nowIso, status: 'pending', note: `re-enqueued (was ${existing.status})${input.force ? ' [force]' : ''}` },
        ].slice(-PORTAL_ACTION_HISTORY_CAP),
      });
      return { id, created: true, status: 'pending', existingStatus: existing.status };
    }
    tx.set(ref, base);
    return { id, created: true, status: 'pending' };
  });
}
