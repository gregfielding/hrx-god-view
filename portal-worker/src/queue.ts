/**
 * Consumer side of tenants/{tenantId}/portal_actions.
 *
 * Claiming is a transaction on the single candidate doc (status must still be
 * 'pending'), so several workers can poll the same queue safely. A lease with
 * an expiry protects against a worker dying mid-action: the sweeper requeues
 * expired leases (or escalates when attempts are exhausted).
 *
 * Query shape is deliberately index-free: `where status == pending` (single
 * field) with the notBefore / provider / priority filtering done in memory on
 * a bounded page. Queue volume is dozens per day, not thousands.
 */
import {
  PORTAL_ACTION_HISTORY_CAP,
  nextStatusAfterError,
  portalActionRetryDelayMs,
  type PortalActionDoc,
  type PortalActionError,
  type PortalActionHistoryEntry,
  type PortalActionStatus,
  type PortalProvider,
} from '../../shared/portalActions.ts';
import { Timestamp, type DocRef, type Firestore, type FirestoreTimestamp } from './firebase.ts';
import { log } from './logger.ts';

export interface ClaimedAction {
  id: string;
  ref: DocRef;
  doc: PortalActionDoc;
}

const CANDIDATE_PAGE = 50;

export function actionsCollection(db: Firestore, tenantId: string) {
  return db.collection('tenants').doc(tenantId).collection('portal_actions');
}

function tsToMillis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function pushHistory(history: PortalActionHistoryEntry[] | undefined, entry: PortalActionHistoryEntry) {
  return [...(history || []), entry].slice(-PORTAL_ACTION_HISTORY_CAP);
}

function isRunnable(doc: PortalActionDoc, providers: Set<PortalProvider>, nowMs: number): boolean {
  if (doc.status !== 'pending') return false;
  if (!providers.has(doc.provider)) return false;
  const nb = tsToMillis(doc.notBefore);
  return nb === null || nb <= nowMs;
}

/** Try to claim the best runnable pending action. Returns null when the queue is empty. */
export async function claimNext(
  db: Firestore,
  tenantId: string,
  workerId: string,
  providers: PortalProvider[],
  leaseMs: number,
): Promise<ClaimedAction | null> {
  const providerSet = new Set(providers);
  const nowMs = Date.now();
  const snap = await actionsCollection(db, tenantId).where('status', '==', 'pending').limit(CANDIDATE_PAGE).get();
  if (snap.empty) return null;

  const candidates = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, doc: d.data() as PortalActionDoc }))
    .filter((c) => isRunnable(c.doc, providerSet, nowMs))
    .sort((a, b) => {
      const p = (a.doc.priority ?? 100) - (b.doc.priority ?? 100);
      if (p !== 0) return p;
      return (tsToMillis(a.doc.createdAt) ?? 0) - (tsToMillis(b.doc.createdAt) ?? 0);
    });

  for (const c of candidates) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(c.ref);
      if (!fresh.exists) return null;
      const doc = fresh.data() as PortalActionDoc;
      if (!isRunnable(doc, providerSet, Date.now())) return null;
      const now = Timestamp.now();
      const nowIso = now.toDate().toISOString();
      const lease = {
        workerId,
        claimedAt: nowIso,
        expiresAt: new Date(now.toMillis() + leaseMs).toISOString(),
      };
      const attempts = (doc.attempts ?? 0) + 1;
      const update = {
        status: 'claimed' as const,
        lease,
        attempts,
        updatedAt: now,
        history: pushHistory(doc.history, { at: nowIso, status: 'claimed', workerId, note: `attempt ${attempts}` }),
      };
      tx.update(c.ref, update);
      return { ...doc, ...update };
    });
    if (claimed) return { id: c.id, ref: c.ref, doc: claimed };
  }
  return null;
}

export async function markRunning(ref: DocRef, doc: PortalActionDoc, workerId: string): Promise<void> {
  const now = Timestamp.now();
  await ref.update({
    status: 'running',
    startedAt: now,
    updatedAt: now,
    history: pushHistory(doc.history, { at: now.toDate().toISOString(), status: 'running', workerId }),
  });
}

export async function renewLease(ref: DocRef, workerId: string, leaseMs: number): Promise<void> {
  const now = Timestamp.now();
  await ref.update({
    'lease.expiresAt': new Date(now.toMillis() + leaseMs).toISOString(),
    'lease.workerId': workerId,
    updatedAt: now,
  });
}

export async function markSucceeded(
  ref: DocRef,
  doc: PortalActionDoc,
  workerId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const now = Timestamp.now();
  await ref.update({
    status: 'succeeded',
    result,
    lease: null,
    lastError: null,
    finishedAt: now,
    updatedAt: now,
    history: pushHistory(doc.history, { at: now.toDate().toISOString(), status: 'succeeded', workerId }),
  });
}

/**
 * Record an error and move the action to its next status per policy:
 * retryable + attempts left → pending with backoff; exhausted → needs_human;
 * non-retryable → failed or needs_human.
 */
export async function markErrored(
  ref: DocRef,
  doc: PortalActionDoc,
  workerId: string,
  error: PortalActionError,
): Promise<PortalActionStatus> {
  const attempts = doc.attempts ?? 1;
  const maxAttempts = doc.maxAttempts ?? 3;
  const next = nextStatusAfterError(error.code, attempts, maxAttempts);
  const now = Timestamp.now();
  const nowIso = now.toDate().toISOString();
  const update: Record<string, unknown> = {
    status: next,
    lastError: { ...error, workerId },
    lease: null,
    updatedAt: now,
    history: pushHistory(doc.history, {
      at: nowIso,
      status: next,
      workerId,
      note: `${error.code}: ${error.message}`.slice(0, 300),
    }),
  };
  if (next === 'pending') {
    const delay = portalActionRetryDelayMs(attempts);
    update.notBefore = Timestamp.fromMillis(now.toMillis() + delay);
  } else {
    update.finishedAt = now;
  }
  await ref.update(update);
  return next;
}

/** Hand an in-flight action back to the queue (graceful shutdown). Does not count as an attempt. */
export async function releaseForShutdown(ref: DocRef, doc: PortalActionDoc, workerId: string): Promise<void> {
  const now = Timestamp.now();
  await ref.update({
    status: 'pending',
    lease: null,
    attempts: Math.max(0, (doc.attempts ?? 1) - 1),
    updatedAt: now,
    history: pushHistory(doc.history, {
      at: now.toDate().toISOString(),
      status: 'pending',
      workerId,
      note: 'released on worker shutdown',
    }),
  });
}

/** Requeue claimed/running actions whose lease expired (dead worker). */
export async function sweepExpiredLeases(db: Firestore, tenantId: string, workerId: string): Promise<number> {
  const snap = await actionsCollection(db, tenantId).where('status', 'in', ['claimed', 'running']).limit(100).get();
  if (snap.empty) return 0;
  const nowIso = new Date().toISOString();
  let swept = 0;
  for (const d of snap.docs) {
    const doc = d.data() as PortalActionDoc;
    const expiresAt = doc.lease?.expiresAt;
    if (!expiresAt || expiresAt > nowIso) continue;
    const did = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists) return false;
      const cur = fresh.data() as PortalActionDoc;
      if (!['claimed', 'running'].includes(cur.status)) return false;
      if (!cur.lease?.expiresAt || cur.lease.expiresAt > new Date().toISOString()) return false;
      const attempts = cur.attempts ?? 1;
      const next = nextStatusAfterError('LEASE_EXPIRED', attempts, cur.maxAttempts ?? 3);
      const now = Timestamp.now();
      const error: PortalActionError = {
        code: 'LEASE_EXPIRED',
        message: `lease held by ${cur.lease.workerId} expired at ${cur.lease.expiresAt}`,
        at: now.toDate().toISOString(),
        workerId,
      };
      tx.update(d.ref, {
        status: next,
        lease: null,
        lastError: error,
        updatedAt: now,
        ...(next === 'pending' ? { notBefore: null } : { finishedAt: now }),
        history: pushHistory(cur.history, { at: error.at, status: next, workerId, note: error.message }),
      });
      return true;
    });
    if (did) swept += 1;
  }
  if (swept) log.warn('requeued expired leases', { swept });
  return swept;
}

export interface QueueCounts {
  pending: number;
  claimed: number;
  running: number;
  needsHuman: number;
  failed: number;
}

export async function queueCounts(db: Firestore, tenantId: string): Promise<QueueCounts> {
  const col = actionsCollection(db, tenantId);
  const count = async (status: PortalActionStatus) => (await col.where('status', '==', status).count().get()).data().count;
  const [pending, claimed, running, needsHuman, failed] = await Promise.all([
    count('pending'),
    count('claimed'),
    count('running'),
    count('needs_human'),
    count('failed'),
  ]);
  return { pending, claimed, running, needsHuman, failed };
}

export function describeAction(doc: PortalActionDoc): Record<string, unknown> {
  return {
    provider: doc.provider,
    action: doc.action,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    refs: doc.refs,
  };
}

export type { FirestoreTimestamp };
