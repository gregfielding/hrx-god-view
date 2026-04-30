/**
 * RD.1 — shared row normalizer + filter helpers for the assignment-driven
 * CSA sections (Section 1 "Upcoming first shifts" and Section 2 "Recently
 * completed first shifts").
 *
 * The `assignments` collection schema is mid-migration (see
 * `ASSIGNMENTS_REQUIREMENTS_AND_IMPLEMENTATION.md`): some rows have
 * `startDate` as an ISO string, others as a Firestore Timestamp, and a
 * handful of legacy rows nest the worker uid under `candidateId` instead
 * of `userId`. We absorb all that variance here so the section hooks +
 * components only deal with one clean shape.
 *
 * Pure functions only — no Firestore client. The hooks own subscription
 * lifecycles; this module is the in-memory row + filter layer.
 */

/** Stable row shape every CSA-section table component consumes. */
export interface CsaAssignmentRow {
  /** Firestore doc id of the assignment. */
  id: string;
  /** Worker uid — coalesces `userId` then `candidateId` for legacy rows. */
  workerUid: string;
  status: string;
  /** Start time in ms-since-epoch, or null when not parseable. */
  startMs: number | null;
  /** End time in ms-since-epoch, or null when not parseable / not present. */
  endMs: number | null;
  /** Denormalized worker name (best-effort — fall back to lookup map). */
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Hiring entity / company display name (denormalized at create time). */
  companyName: string;
  companyId: string;
  /** Job + location flavor for the shift-details column. */
  jobTitle: string;
  shiftTitle: string;
  worksiteName: string;
  /**
   * Future row-color coding (AI-predicted show-up likelihood for upcoming
   * shifts, work-again likelihood for completed). Wired through end-to-end
   * so the consumer doesn't have to add a column later; the predictor lands
   * when the messaging cadence engagement signals flow. The full union
   * matches the spec so future code can switch on `severity` without
   * widening the type.
   *
   * v1 always emits `'normal'`. TODO RD.1 phase 2: compute red/yellow/green
   * from cadence engagement signals.
   */
  severity: 'normal' | 'red' | 'yellow' | 'green';
}

/**
 * Coerce a raw Firestore field that may be:
 *   - ISO 8601 string (`'2026-04-29T17:00:00Z'`)
 *   - millis number (`1714410000000`)
 *   - Firestore Timestamp (`{ toDate(): Date }`) — duck-typed to keep this
 *     module free of `firebase/firestore` imports for testability
 *   - JS Date
 *   - undefined / null
 * into ms-since-epoch, returning `null` for unparseable values.
 */
export function coerceToMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof raw === 'object') {
    // Firestore Timestamp duck-type (`{ toDate(): Date }`). Don't import
    // the SDK type so this stays trivially testable in node.
    const maybeTs = raw as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        const d = maybeTs.toDate();
        return d instanceof Date ? d.getTime() : null;
      } catch {
        return null;
      }
    }
    if (typeof maybeTs.seconds === 'number') {
      // Bare `{ seconds, nanoseconds }` (Timestamp.toJSON() output).
      return maybeTs.seconds * 1000 + Math.floor((maybeTs.nanoseconds ?? 0) / 1e6);
    }
  }
  return null;
}

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/**
 * Build a CsaAssignmentRow from a raw Firestore doc. Returns `null` when
 * we can't even resolve a worker uid — those rows get silently dropped
 * since they're useless to the CSA (no row to render). Logging is left to
 * the snapshot-error path; bad-shape rows are quietly skipped to avoid
 * spamming the console for known-legacy data.
 */
export function normalizeAssignmentRow(
  id: string,
  data: Record<string, unknown>,
): CsaAssignmentRow | null {
  const workerUid = asString(data.userId) || asString(data.candidateId);
  if (!workerUid) return null;

  return {
    id,
    workerUid,
    status: asString(data.status),
    startMs: coerceToMs(data.startDate ?? data.startTime ?? data.startTimestamp),
    endMs: coerceToMs(data.endDate ?? data.endTime ?? data.endTimestamp),
    firstName: asString(data.firstName),
    lastName: asString(data.lastName),
    email: asString(data.email),
    phone: asString(data.phone) || asString(data.phoneE164),
    companyName: asString(data.companyName) || asString(data.companyTitle),
    companyId: asString(data.companyId),
    jobTitle: asString(data.jobTitle),
    shiftTitle: asString(data.shiftTitle),
    worksiteName: asString(data.locationNickname) || asString(data.worksiteName),
    severity: 'normal',
  };
}

/** Date-window filter spec — keyed by which timestamp field to compare. */
export type CsaAssignmentDateWindow =
  | { kind: 'startsBetween'; fromMs: number; toMs: number }
  | { kind: 'endsBetween'; fromMs: number; toMs: number };

/**
 * Pure filter — keep rows whose start (or end, depending on `kind`) falls
 * within `[fromMs, toMs)`. Rows with a null relevant timestamp are dropped:
 *   - Section 1 (startsBetween) needs a start time to be actionable.
 *   - Section 2 (endsBetween) without an end time is either still running
 *     or legacy data missing the denorm; either way, not a clean
 *     "just finished" candidate.
 */
export function filterAssignmentsByDateWindow(
  rows: ReadonlyArray<CsaAssignmentRow>,
  window: CsaAssignmentDateWindow,
): CsaAssignmentRow[] {
  const out: CsaAssignmentRow[] = [];
  for (const row of rows) {
    const ts = window.kind === 'startsBetween' ? row.startMs : row.endMs;
    if (ts == null) continue;
    if (ts >= window.fromMs && ts < window.toMs) out.push(row);
  }
  return out;
}

/**
 * Intersect rows with `myWorkerUids`. Pass `null` to skip the filter
 * entirely (used by the All-Users scope).
 */
export function filterAssignmentsByWorkerSet(
  rows: ReadonlyArray<CsaAssignmentRow>,
  myWorkerUids: ReadonlySet<string> | null,
): CsaAssignmentRow[] {
  if (myWorkerUids == null) return rows.slice();
  if (myWorkerUids.size === 0) return [];
  return rows.filter((row) => myWorkerUids.has(row.workerUid));
}
