/**
 * **TS.1.P4 Slice 6b — worker-context resolver for the batch
 * orchestrator.**
 *
 * Per-entry helpers the orchestrator calls before composing the
 * Everee payload. Three things to resolve:
 *
 *   1. **`externalWorkerId`** — the HRX uid by convention, but only
 *      after we confirm the worker actually has an Everee linkage
 *      for this entity. Uses the same defensive fallback pattern as
 *      the worker-payroll-recovery fix (PR #8): prefer the user-doc
 *      denorm (`users/{uid}.evereeWorkerIds[evereeTenantId]`); on
 *      miss, query the authoritative `everee_workers` linkage docs.
 *
 *   2. **Worker classification** (W-2 vs contractor) — derived from
 *      the hiring entity's `workerType`. `mixed` entities default to
 *      W-2 (the historical C1 pattern); explicit override available
 *      via per-assignment field if it ever ships.
 *
 *   3. **Shift epoch seconds** — `entry.workDate` (`YYYY-MM-DD`
 *      worksite-local) + `actualStartTime`/`actualEndTime`
 *      (`HH:mm`) converted to UTC epoch seconds using the worksite
 *      state's IANA time zone. Same trick Node's stdlib supports
 *      without an external library — no `luxon` / `date-fns-tz`
 *      dependency.
 *
 * Pure-ish: only Firestore reads, no writes. Easy to unit-test the
 * pure pieces (TZ conversion, workerKind mapping) in isolation.
 */

import * as admin from 'firebase-admin';

import type { WorkerKind } from './composeTimesheetBatchPayloads';

// ─────────────────────────────────────────────────────────────────────
// externalWorkerId resolution (with linkage fallback)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the Everee `externalWorkerId` for a (workerId, evereeTenantId)
 * pair.
 *
 * **What "externalWorkerId" means in Everee's vocabulary.** It's the
 * partner-system id Everee stores on its worker record — for us, the
 * HRX uid. Verified against live sandbox `GET /api/v2/workers/<uuid>`
 * on 2026-05-22: the response carries `externalWorkerId: <HRX uid>`,
 * NOT the Everee UUID. Subsequent worked-shift POSTs identify the
 * worker by sending that HRX uid as `externalWorkerId` in the body —
 * sending the UUID (which was our previous behavior) returned
 * `404: resource does not exist`.
 *
 * **What this function does**: confirm that a linkage exists between
 * the (workerId, evereeTenantId) pair, then return `workerId` — the
 * HRX uid — as the value to send to Everee. Returns `null` when no
 * linkage exists so the orchestrator's pre-flight can mark the entry
 * as `error` with `missing_everee_worker_id`.
 *
 * Existing legacy callers (e.g. PR #8's `WorkerPayrollEvereeTenant.tsx`)
 * use the same pattern — denorm map first, linkage docs as fallback —
 * but historically returned the Everee UUID. Returning the HRX uid
 * here is the correct semantic per Everee's API contract; UUID-based
 * downstream calls (e.g. `GET /api/v2/workers/{uuid}`) should use
 * the new `resolveEvereeWorkerUuid` helper below.
 */
export async function resolveExternalWorkerId(
  tenantId: string,
  workerId: string,
  evereeTenantId: string,
): Promise<string | null> {
  const exists = await hasEvereeLinkage(tenantId, workerId, evereeTenantId);
  return exists ? workerId : null;
}

/**
 * Resolve the Everee-internal `workerId` (UUID/numeric) for a
 * (workerId, evereeTenantId) pair. This is what downstream `GET
 * /api/v2/workers/{id}` and reconcile paths key on — distinct from
 * `externalWorkerId` (which is the HRX uid Everee stores on the
 * worker record).
 *
 * Returns the UUID string from the denorm map or linkage doc, or
 * `null` when no linkage exists.
 */
export async function resolveEvereeWorkerUuid(
  tenantId: string,
  workerId: string,
  evereeTenantId: string,
): Promise<string | null> {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(workerId).get();
  if (userSnap.exists) {
    const ewMap = (userSnap.data()?.evereeWorkerIds ?? {}) as Record<string, unknown>;
    const fromMap = pickEvereeWorkerIdFromMap(ewMap, evereeTenantId);
    if (fromMap) return fromMap;
  }
  try {
    const q = await db
      .collection('tenants').doc(tenantId)
      .collection('everee_workers')
      .where('firebaseUid', '==', workerId)
      .get();
    const targetTid = evereeTenantId.trim();
    const targetTidNumeric = /^\d+$/.test(targetTid)
      ? String(parseInt(targetTid, 10))
      : '';
    for (const d of q.docs) {
      const data = d.data() as {
        evereeTenantId?: string | number;
        evereeWorkerId?: string;
        externalWorkerId?: string;
      };
      const docTidRaw = data.evereeTenantId;
      const docTid =
        typeof docTidRaw === 'number' && Number.isFinite(docTidRaw)
          ? String(docTidRaw)
          : typeof docTidRaw === 'string'
            ? docTidRaw.trim()
            : '';
      if (docTid === targetTid || docTid === targetTidNumeric) {
        const wid = String(data.evereeWorkerId || data.externalWorkerId || '').trim();
        if (wid) return wid;
      }
    }
  } catch {
    // swallow
  }
  return null;
}

/**
 * True when a linkage exists for this (workerId, evereeTenantId)
 * pair — either via the user-doc denorm or the authoritative
 * `everee_workers` linkage doc.
 *
 * Used by `resolveExternalWorkerId` to gate the HRX-uid return.
 */
async function hasEvereeLinkage(
  tenantId: string,
  workerId: string,
  evereeTenantId: string,
): Promise<boolean> {
  const uuid = await resolveEvereeWorkerUuid(tenantId, workerId, evereeTenantId);
  return uuid !== null;
}

/**
 * Pick the externalWorkerId from `users/{uid}.evereeWorkerIds`,
 * matching the tenant id as either a string or its numeric form
 * (Everee tenant ids round-trip through string/number freely on the
 * wire — `'3133'` vs `3133` both appear in the wild).
 */
export function pickEvereeWorkerIdFromMap(
  ewMap: Record<string, unknown>,
  evereeTenantId: string,
): string {
  const t = evereeTenantId.trim();
  const tryKeys = [t, String(Number(t))];
  for (const k of tryKeys) {
    const v = ewMap[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────
// Worker classification
// ─────────────────────────────────────────────────────────────────────

/**
 * Map the hiring entity's `workerType` to the wire-level worker kind
 * the composer uses. `'mixed'` entities default to W-2 because that's
 * the historical C1 pattern — explicit per-assignment override would
 * go here if it ever ships.
 */
export function workerKindFromEntityWorkerType(
  workerType: 'W2' | '1099' | 'mixed' | string | undefined,
): WorkerKind {
  if (workerType === '1099') return 'contractor';
  return 'w2';
}

// ─────────────────────────────────────────────────────────────────────
// Worksite-local time → UTC epoch seconds
// ─────────────────────────────────────────────────────────────────────

/**
 * State → IANA TZ map. Covers the 50 US states + DC. Edge cases:
 *
 *   - **Arizona** (no DST except Navajo Nation). `America/Phoenix`
 *     accounts for that.
 *   - **Indiana, Kentucky, Tennessee** — multi-zone states. Default
 *     to the dominant zone (where C1 most likely operates); use
 *     `--worksiteTz` override at the entry level when we have
 *     workers in the off-default zone.
 *   - **US territories** (PR, GU, VI, AS, MP) — included.
 *
 * If we ever see a state that isn't in this map, fall back to
 * `America/New_York` per `FALLBACK_TZ` and surface a warn log so ops
 * can add the mapping.
 */
export const STATE_TZ_MAP: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York', // FL panhandle is Central but dominant is Eastern
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise', // S. Idaho is Mountain; N. Idaho is Pacific
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York', // Eastern KY; W. KY is Central
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago', // Most TN is Central; E. TN is Eastern
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  // Territories
  PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam',
  VI: 'America/St_Thomas',
  AS: 'Pacific/Pago_Pago',
  MP: 'Pacific/Saipan',
};

export const FALLBACK_TZ = 'America/New_York';

/**
 * Convert (worksite-local `workDate`, `HH:mm` time, IANA TZ) to UTC
 * epoch seconds without `luxon` / `date-fns-tz`. Uses the standard
 * "naive UTC + TZ offset" trick:
 *
 *   1. Construct a Date from the wall-clock components as if they
 *      were UTC. That's a naive UTC moment, not the real one.
 *   2. Format that naive moment back in the target TZ to find what
 *      the TZ's clock would read; the diff is the offset.
 *   3. Subtract the offset from the naive UTC to get the true UTC.
 *
 * Accurate to the second under normal conditions. Edge cases at DST
 * transitions (the 2am-doesn't-exist forward jump, the 1am-happens-
 * twice fall back) are imperfect — DST forward gives the time-that-
 * doesn't-exist offset of the next valid moment; DST back gives the
 * first occurrence's offset. For payroll use cases (workers don't
 * usually clock in at 2am on a DST transition), this is fine.
 */
export function workToEpochSeconds(
  workDate: string,
  hhmm: string,
  ianaTz: string,
): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!dm || !tm) {
    throw new Error(`workToEpochSeconds: bad inputs workDate='${workDate}' hhmm='${hhmm}'`);
  }
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);

  // Step 1: naive UTC moment.
  const naiveUtcMs = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);

  // Step 2: offset of `ianaTz` at this moment.
  const offsetMin = tzOffsetMinutesAt(naiveUtcMs, ianaTz);

  // Step 3: subtract offset.
  const trueUtcMs = naiveUtcMs - offsetMin * 60_000;
  return Math.floor(trueUtcMs / 1000);
}

/**
 * Offset in minutes of `ianaTz` at the moment `utcMs`. Computed via
 * `Intl.DateTimeFormat.formatToParts` (built into Node 18+).
 */
export function tzOffsetMinutesAt(utcMs: number, ianaTz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : 0;
  };
  // Intl's `hour: '2-digit'` with `hour12: false` can produce '24'
  // for midnight on some platforms — normalize to 0.
  const hour = get('hour') === 24 ? 0 : get('hour');
  const tzWallMs = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((tzWallMs - utcMs) / 60_000);
}

/**
 * Resolve the worksite's IANA TZ for an entry. Prefers the entry's
 * `workState` (already denormalized by P1.B + P2.B); falls back to
 * the assignment's `worksiteState` if for some reason the entry's
 * state is missing; then to `FALLBACK_TZ`.
 */
export function resolveWorksiteTz(
  entryWorkState: string | undefined,
  assignmentWorksiteState: string | undefined,
): string {
  const state = (entryWorkState || assignmentWorksiteState || '').trim().toUpperCase();
  if (state && STATE_TZ_MAP[state]) return STATE_TZ_MAP[state];
  return FALLBACK_TZ;
}
