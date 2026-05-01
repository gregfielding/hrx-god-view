/**
 * Minimal in-memory Firestore double for unit tests in this directory.
 *
 * Supports the surface the gig-JO trigger / backfill / cron actually
 * exercise:
 *   - `.doc(path).get() / .set() / .update() / .ref` (via doc())
 *   - `.collection(path).doc()` (auto-id generator) + `.doc(id)`
 *   - `.collection(path).where(field, '==', v).limit(N).get()`
 *   - `.collection(path).count().get()`
 *   - `runTransaction(fn)` with `tx.get / tx.set / tx.update`
 *
 * Anything beyond this would be over-engineering for the helpers'
 * concrete usage today. Tests should add to this file (rather than
 * forking copies) when new query patterns are needed.
 */

import * as admin from 'firebase-admin';

export interface FakeState {
  store: Map<string, Record<string, unknown>>;
  autoIdSeq: number;
  reads: string[];
  writes: Array<{ path: string; data: Record<string, unknown> }>;
  updates: Array<{ path: string; updates: Record<string, unknown> }>;
}

interface WhereClause {
  field: string;
  op: '==';
  value: unknown;
}

export function newState(): FakeState {
  return {
    store: new Map(),
    autoIdSeq: 0,
    reads: [],
    writes: [],
    updates: [],
  };
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const segs = path.split('.');
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function whereMatches(clause: WhereClause, value: unknown): boolean {
  return value === clause.value;
}

interface FakeFs {
  doc: (path: string) => unknown;
  collection: (path: string) => unknown;
  runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
}

/**
 * Build a fake Firestore against the given mutable state. Subsequent
 * calls to the returned object read/write into `state.store` and append
 * to `state.reads / .writes / .updates` so tests can inspect activity.
 */
export function makeFakeFirestore(state: FakeState): FakeFs {
  function makeDocRef(path: string) {
    return {
      path,
      id: path.split('/').pop() ?? '',
      async get() {
        state.reads.push(path);
        const data = state.store.get(path);
        return {
          exists: data !== undefined,
          data: () => data,
          id: path.split('/').pop() ?? '',
          ref: makeDocRef(path),
        };
      },
      async set(data: Record<string, unknown>) {
        state.writes.push({ path, data });
        state.store.set(path, data);
      },
      async update(updates: Record<string, unknown>) {
        const existing = state.store.get(path) ?? {};
        state.updates.push({ path, updates });
        state.store.set(path, { ...existing, ...updates });
      },
      async create(data: Record<string, unknown>) {
        // Match Admin SDK semantics: `create` throws if the doc
        // already exists. The cron's per-day idempotency relies on
        // this contract.
        if (state.store.get(path) !== undefined) {
          throw new Error(`already_exists: ${path}`);
        }
        state.writes.push({ path, data });
        state.store.set(path, data);
      },
    };
  }

  function makeQueryRef(path: string, wheres: WhereClause[], lim?: number) {
    return {
      _path: path,
      where(field: string, _op: '==', value: unknown) {
        return makeQueryRef(
          path,
          [...wheres, { field, op: '==', value }],
          lim,
        );
      },
      limit(n: number) {
        return makeQueryRef(path, wheres, n);
      },
      count() {
        return {
          async get() {
            const prefix = `${path}/`;
            let count = 0;
            for (const key of state.store.keys()) {
              if (
                key.startsWith(prefix) &&
                !key.slice(prefix.length).includes('/')
              ) {
                count += 1;
              }
            }
            return { data: () => ({ count }) };
          },
        };
      },
      async get() {
        const prefix = `${path}/`;
        const matchingPaths: string[] = [];
        for (const key of state.store.keys()) {
          if (
            key.startsWith(prefix) &&
            !key.slice(prefix.length).includes('/')
          ) {
            matchingPaths.push(key);
          }
        }
        matchingPaths.sort();

        let docs = matchingPaths
          .map((p) => ({
            id: p.slice(prefix.length),
            ref: makeDocRef(p),
            data: () => state.store.get(p) as Record<string, unknown>,
            exists: true,
          }))
          .filter((d) => {
            const data = d.data();
            return wheres.every((w) =>
              whereMatches(w, getNested(data, w.field)),
            );
          });
        if (lim != null) docs = docs.slice(0, lim);

        return { size: docs.length, docs, empty: docs.length === 0 };
      },
    };
  }

  function makeCollectionRef(path: string) {
    return Object.assign(makeQueryRef(path, []), {
      doc(id?: string) {
        if (id) return makeDocRef(`${path}/${id}`);
        state.autoIdSeq += 1;
        return makeDocRef(`${path}/auto_${state.autoIdSeq}`);
      },
    });
  }

  function makeTxn() {
    const pendingSets: Array<{ path: string; data: Record<string, unknown> }> = [];
    const pendingUpdates: Array<{
      path: string;
      updates: Record<string, unknown>;
    }> = [];
    return {
      tx: {
        async get(ref: { path: string }) {
          state.reads.push(`${ref.path}#tx`);
          const data = state.store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref: { path: string }, data: Record<string, unknown>) {
          pendingSets.push({ path: ref.path, data });
        },
        update(ref: { path: string }, updates: Record<string, unknown>) {
          pendingUpdates.push({ path: ref.path, updates });
        },
      },
      commit() {
        for (const s of pendingSets) {
          state.writes.push({ path: s.path, data: s.data });
          state.store.set(s.path, s.data);
        }
        for (const u of pendingUpdates) {
          const existing = state.store.get(u.path) ?? {};
          // Resolve `FieldValue.increment(N)` sentinels (we stub them
          // as `{ _delta: N }` below). serverTimestamp passes through
          // as a marker string — tests don't assert on its resolution.
          const next = { ...existing };
          for (const [k, v] of Object.entries(u.updates)) {
            if (
              v &&
              typeof v === 'object' &&
              (v as { _delta?: number })._delta !== undefined
            ) {
              const cur = typeof next[k] === 'number' ? (next[k] as number) : 0;
              next[k] = cur + (v as { _delta: number })._delta;
            } else {
              next[k] = v;
            }
          }
          state.updates.push({ path: u.path, updates: u.updates });
          state.store.set(u.path, next);
        }
      },
    };
  }

  return {
    doc: (path: string) => makeDocRef(path),
    collection: (path: string) => makeCollectionRef(path),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const txWrap = makeTxn();
      const result = await fn(txWrap.tx);
      txWrap.commit();
      return result;
    },
  };
}

/**
 * Stub `admin.firestore.FieldValue.serverTimestamp` and `.increment`
 * with sentinels the fake Firestore can resolve. Idempotent — calling
 * twice is a no-op the second time. Call once at module load in tests.
 */
export function installFieldValueStubs(): void {
  (
    admin.firestore.FieldValue as unknown as {
      serverTimestamp: () => unknown;
    }
  ).serverTimestamp = (() =>
    '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;
  (
    admin.firestore.FieldValue as unknown as {
      increment: (n: number) => unknown;
    }
  ).increment = ((n: number) => ({
    _delta: n,
  })) as unknown as typeof admin.firestore.FieldValue.increment;
}
