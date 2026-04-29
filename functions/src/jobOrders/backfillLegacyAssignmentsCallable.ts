/**
 * **R.4.2 — Legacy Assignment Backfill** — Admin callable that fixes
 * pre-R.1 assignments stuck on the `'legacy_review'` (or `'computing'`)
 * Job Readiness chip.
 *
 * Two-stage data-only repair, run per page:
 *
 *   **Stage A — stamp `assignment.hiringEntityId`.**
 *     Resolution path (per **L.4.2.1 — option C**):
 *       1. JO chain — `joDoc.hiringEntityId`, then
 *          `accounts/{recruiterAccountId}.hiringEntityId`. Mirrors the
 *          read-time helper `fetchJobOrderBrief` so write-time and
 *          read-time agree when both paths can resolve.
 *       2. Worker entity_employments fallback — for the legacy
 *          population whose JO chain is genuinely empty, walk
 *          `tenants/{tid}/entity_employments` keyed by
 *          `assignment.userId`/`candidateId`, prefer the record whose
 *          `entityKey` matches `assignment.entityKey`, fall back to
 *          the lone record when only one exists.
 *       3. Unresolved — emit a per-assignment audit row with
 *          `outcome: 'skipped_unresolvable_hiring_entity_id'`,
 *          `stageAResolvedVia: 'unresolved'`, and SKIP Stage B. The
 *          `'legacy_review'` chip we shipped in R.4.3 IS the manual
 *          queue (operators see gray → know to investigate). Per
 *          **L.4.2.2 — option B**.
 *
 *   **Stage B — run the standard auto-seed pipeline.**
 *     Calls the shared helper `seedReadinessForExistingAssignment`
 *     extracted in L.4.2.4. The seeder runner is idempotent — a re-run
 *     reports `itemsCreated: 0, itemsSkippedExisting: N`.
 *
 * Stages are independent + idempotent (per **L.4.2.3 — option B**):
 * Stage A writes the assignment doc + audit row; Stage B fires
 * regardless of whether Stage A actually wrote anything (e.g. when
 * `hiringEntityId` was already set the resolver returns `'already_set'`
 * and Stage B still re-seeds, idempotently). On a partial failure
 * (Stage A succeeded, Stage B threw), the audit row records
 * `outcome: 'stamped_only_seed_failed'` and a re-run picks Stage B
 * back up from where it failed. Re-runs of fully-completed assignments
 * land in `'stage_a_only_stage_b_no_op'`.
 *
 * **Bucket rename (R.4.2-F1, 2026-04-29):** the post-Stage-B "no new
 * items" outcome was originally labeled `'skipped_already_complete'`,
 * which conflated two cases — true already-complete (Stage A no-op +
 * Stage B no-op) and Stage A wrote + Stage B no-op. In production this
 * union is dominated by the latter (the page driver pre-filters truly
 * healthy assignments, so any candidate processed needs at least Stage
 * A or Stage B work). Renamed to `'stage_a_only_stage_b_no_op'` to
 * match the dominant operational reality. **Pre-2026-04-29 audit rows
 * in `cascadeAuditLog` may still carry the old `'skipped_already_complete'`
 * label** — historic rows are not migrated; new rows use the new label.
 *
 * Audit trail:
 *   - One `cascadeAuditLog` row per assignment, regardless of outcome.
 *   - Action: `'backfill_legacy_assignment_r4_2'` (snake_case to match
 *     the existing union convention — `snapshot_via_backfill`,
 *     `snapshot_on_activation`). Per **L.4.2.5a — option B**.
 *   - Lives in the same `cascadeAuditLog` collection as R.16.1's
 *     `snapshot_via_backfill`. Per **L.4.2.5b — option A**.
 *
 * Out-of-scope (per L.4.2.6):
 *   - `--force` flag (re-stamp + re-seed). Avoid foot-gun on a 29-row
 *     one-shot. File as R.4.2.1 if needed.
 *   - Manual-queue UI. The `'legacy_review'` chip IS the queue.
 *
 * Ops shape (mirrors R.16.1 backfill):
 *   - `dryRun: true` is the default. Per-assignment `would_*` buckets;
 *     no Firestore writes (other than dry-run audit rows are NOT emitted).
 *   - `dryRun: false` actually writes both stages.
 *   - Pagination via doc-id cursor (`pageToken`). `limit` defaults to
 *     1000, capped at 5000.
 *   - Caller must be HRX-staff (security level 7) on the requested
 *     tenant. CLI bypasses by design (service-account creds).
 *
 * @see docs/R4_2_LEGACY_BACKFILL_HANDOFF.md (full spec, all six locks)
 * @see functions/src/readiness/seedReadinessForExistingAssignment.ts (Stage B)
 * @see functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts (audit shape)
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import {
  writeCascadeAuditEntry,
  type CascadeAuditEntry,
} from './onJobOrderStatusTransitionSnapshot';
import {
  seedReadinessForExistingAssignment,
  type SeedReadinessOutcome,
} from '../readiness/seedReadinessForExistingAssignment';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const PASS_CONCURRENCY = 5;

interface BackfillLegacyAssignmentsRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  /** Doc-id cursor from a previous response's `nextPageToken`. */
  pageToken?: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Stage A — Pure resolver. Exported for unit tests.
// ─────────────────────────────────────────────────────────────────────

/** Which path Stage A took to find (or fail to find) hiringEntityId. */
export type StageAResolvedVia =
  | 'jo_chain'
  | 'worker_employment'
  | 'unresolved'
  | 'already_set';

export interface StageAResolveResult {
  resolvedHiringEntityId: string | null;
  resolvedVia: StageAResolvedVia;
}

/**
 * **L.4.2.1 — option C** — JO chain first, then worker entity_employments,
 * then fail. Per-assignment audit row records which path won.
 *
 * The JO chain mirrors the read-time `fetchJobOrderBrief` helper in
 * `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`:
 *   - Try `tenants/{tid}/job_orders/{joId}` first (snake_case canon),
 *     then `tenants/{tid}/recruiter_jobOrders/{joId}` (R.16-era
 *     fallback). The auto-seed trigger reads from the camelCase
 *     `jobOrders` collection but the chip resolver reads from
 *     snake_case `job_orders`; we walk both for robustness.
 *   - On the JO doc, look at `hiringEntityId` direct.
 *   - If null, fall through to `accounts/{recruiterAccountId}.hiringEntityId`.
 *
 * The worker fallback walks `tenants/{tid}/entity_employments` keyed
 * by both legacy `userId` and modern `candidateId` (matches
 * `loadHiringEntityIds` in `onBackgroundCheckWriteUpdateReadiness.ts`).
 * Records carry `hiringEntityId` (or fall back to `entityId`). When
 * the assignment carries a usable `entityKey`, prefer the record
 * whose `entityKey` matches; otherwise pick the lone record when
 * only one resolves a non-empty hiringEntityId.
 */
export async function resolveLegacyAssignmentHiringEntityId(args: {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
}): Promise<StageAResolveResult> {
  const { fdb, tenantId, assignmentData } = args;

  // 0. Already set? Caller will still run Stage B (idempotent re-seed).
  const existingHid = pickStringField(assignmentData, ['hiringEntityId']);
  if (existingHid) {
    return { resolvedHiringEntityId: existingHid, resolvedVia: 'already_set' };
  }

  const jobOrderId = pickStringField(assignmentData, ['jobOrderId']);
  const workerUid = pickStringField(assignmentData, ['userId', 'candidateId', 'workerUid']);
  const assignmentEntityKey = normalizeEntityKey(assignmentData.entityKey);

  // 1. JO chain.
  const joChainHid = await tryResolveFromJoChain({ fdb, tenantId, jobOrderId });
  if (joChainHid) {
    return { resolvedHiringEntityId: joChainHid, resolvedVia: 'jo_chain' };
  }

  // 2. Worker entity_employments fallback.
  if (workerUid) {
    const workerHid = await tryResolveFromWorkerEmployments({
      fdb,
      tenantId,
      workerUid,
      assignmentEntityKey,
    });
    if (workerHid) {
      return { resolvedHiringEntityId: workerHid, resolvedVia: 'worker_employment' };
    }
  }

  return { resolvedHiringEntityId: null, resolvedVia: 'unresolved' };
}

async function tryResolveFromJoChain(args: {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  jobOrderId: string;
}): Promise<string | null> {
  const { fdb, tenantId, jobOrderId } = args;
  if (!jobOrderId) return null;

  // Walk both JO collection shapes — same fallback order as the
  // read-time `fetchJobOrderBrief` helper.
  const candidates = [
    `tenants/${tenantId}/job_orders/${jobOrderId}`,
    `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
    `tenants/${tenantId}/jobOrders/${jobOrderId}`,
  ];
  let joData: Record<string, unknown> | null = null;
  for (const path of candidates) {
    try {
      const snap = await fdb.doc(path).get();
      if (snap.exists) {
        joData = (snap.data() ?? {}) as Record<string, unknown>;
        break;
      }
    } catch {
      // Continue walking — tolerate a per-doc read failure.
    }
  }
  if (!joData) return null;

  const direct = pickStringField(joData, ['hiringEntityId']);
  if (direct) return direct;

  const recAcc = pickStringField(joData, ['recruiterAccountId']);
  if (!recAcc) return null;
  try {
    const accSnap = await fdb.doc(`tenants/${tenantId}/accounts/${recAcc}`).get();
    if (!accSnap.exists) return null;
    const accData = (accSnap.data() ?? {}) as Record<string, unknown>;
    return pickStringField(accData, ['hiringEntityId']) || null;
  } catch {
    return null;
  }
}

async function tryResolveFromWorkerEmployments(args: {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  workerUid: string;
  assignmentEntityKey: string | null;
}): Promise<string | null> {
  const { fdb, tenantId, workerUid, assignmentEntityKey } = args;

  // Mirror `loadHiringEntityIds` from
  // `onBackgroundCheckWriteUpdateReadiness.ts` — walk both userId and
  // candidateId variants since the collection's history holds both.
  const ref = fdb.collection(`tenants/${tenantId}/entity_employments`);
  let byUserSnap: admin.firestore.QuerySnapshot;
  let byCandidateSnap: admin.firestore.QuerySnapshot;
  try {
    [byUserSnap, byCandidateSnap] = await Promise.all([
      ref.where('userId', '==', workerUid).get(),
      ref.where('candidateId', '==', workerUid).get(),
    ]);
  } catch {
    return null;
  }

  type Record_ = {
    id: string;
    entityKey: string | null;
    hiringEntityId: string | null;
  };
  const dedup = new Map<string, Record_>();
  for (const snap of [byUserSnap, byCandidateSnap]) {
    for (const doc of snap.docs) {
      if (dedup.has(doc.id)) continue;
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const hid =
        pickStringField(data, ['hiringEntityId']) ||
        pickStringField(data, ['entityId']);
      if (!hid) continue;
      dedup.set(doc.id, {
        id: doc.id,
        entityKey: normalizeEntityKey(data.entityKey ?? deriveEntityKeyFromDocId(doc.id, workerUid)),
        hiringEntityId: hid,
      });
    }
  }

  const records = Array.from(dedup.values());
  if (records.length === 0) return null;

  // Prefer the record matching the assignment's entityKey when set.
  if (assignmentEntityKey) {
    const match = records.find((r) => r.entityKey === assignmentEntityKey);
    if (match) return match.hiringEntityId;
  }

  // Sole-record fallback: when there's only one entity_employment
  // record with a non-empty hiringEntityId, use it regardless of key.
  if (records.length === 1) return records[0].hiringEntityId;

  return null;
}

function pickStringField(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function normalizeEntityKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const k = v.toLowerCase().trim();
  if (k === 'select' || k === 'workforce' || k === 'events') return k;
  return null;
}

function deriveEntityKeyFromDocId(docId: string, workerUid: string): string | null {
  const prefix = `${workerUid}__`;
  if (!docId.startsWith(prefix)) return null;
  const tail = docId.slice(prefix.length).toLowerCase();
  if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Per-assignment classifier + processor.
// ─────────────────────────────────────────────────────────────────────

export type LegacyAssignmentBucket =
  /**
   * Stage B reported zero newly-created items — covers BOTH Stage A
   * no-op + Stage B no-op (assignment already fully healthy) AND Stage
   * A wrote + Stage B no-op (Stage B found pre-existing items from
   * another code path: cadence trigger, prior partial seed, the
   * `syncAssignmentReadinessV1OnAssignmentWrite` companion). Disambiguate
   * the two via the audit row's `stageAResolvedVia` (`'already_set'` ⇒
   * the former, anything else ⇒ the latter).
   *
   * **R.4.2-F1 (2026-04-29):** renamed from `'skipped_already_complete'`.
   * Pre-2026-04-29 audit rows in `cascadeAuditLog` may carry the old
   * label; new rows use the new label going forward.
   */
  | 'stage_a_only_stage_b_no_op'
  /** Stage A returned 'unresolved'; Stage B was skipped. */
  | 'skipped_unresolvable_hiring_entity_id'
  // ── dry-run-only buckets ────────────────────────────────────────
  | 'would_stamp_and_seed'
  | 'would_stamp_only'
  | 'would_skip_already_complete'
  | 'would_skip_unresolvable_hiring_entity_id'
  // ── write-mode buckets ──────────────────────────────────────────
  | 'stamped_and_seeded'
  /** Stage A wrote, Stage B reported zero items (JO had no requirements). */
  | 'stamped_only'
  /** Stage A succeeded, Stage B threw. */
  | 'stamped_only_seed_failed'
  /** Unexpected exception. */
  | 'error';

export interface LegacyAssignmentPerRow {
  assignmentId: string;
  jobOrderId: string | null;
  workerUid: string | null;
  bucket: LegacyAssignmentBucket;
  resolvedHiringEntityId: string | null;
  resolvedVia: StageAResolvedVia;
  stageBItemsCreated: number;
  stageBItemsSkippedExisting: number;
  error?: string;
}

export interface ProcessOneArgs {
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
  dryRun: boolean;
  fdb: admin.firestore.Firestore;
}

/**
 * Run Stage A + Stage B for a single assignment. Always emits exactly
 * one `cascadeAuditLog` row in write mode (none in dry-run, by
 * design — the dry-run report is the audit). Throws ONLY for
 * unexpected exceptions in the orchestrator itself; Stage B failures
 * are caught and routed to `'stamped_only_seed_failed'`.
 */
export async function processOneLegacyAssignmentForBackfill(
  args: ProcessOneArgs,
): Promise<LegacyAssignmentPerRow> {
  const { tenantId, assignmentId, assignmentData, dryRun, fdb } = args;

  const jobOrderId = pickStringField(assignmentData, ['jobOrderId']) || null;
  const workerUid =
    pickStringField(assignmentData, ['userId', 'candidateId', 'workerUid']) || null;

  const resolve = await resolveLegacyAssignmentHiringEntityId({
    fdb,
    tenantId,
    assignmentId,
    assignmentData,
  });

  // Unresolvable — bucket + skip Stage B (per L.4.2.2 option B).
  if (resolve.resolvedVia === 'unresolved') {
    const bucket: LegacyAssignmentBucket = dryRun
      ? 'would_skip_unresolvable_hiring_entity_id'
      : 'skipped_unresolvable_hiring_entity_id';
    if (!dryRun) {
      await safeWriteR4_2Audit(fdb, {
        tenantId,
        assignmentId,
        jobOrderId: jobOrderId ?? undefined,
        outcome: 'skipped_unresolvable_hiring_entity_id',
        stageAResolvedVia: 'unresolved',
        stageAStampedHiringEntityId: null,
        stageBItemsCreated: 0,
        stageBItemsSkippedExisting: 0,
      });
    }
    return {
      assignmentId,
      jobOrderId,
      workerUid,
      bucket,
      resolvedHiringEntityId: null,
      resolvedVia: 'unresolved',
      stageBItemsCreated: 0,
      stageBItemsSkippedExisting: 0,
    };
  }

  // Resolved (jo_chain | worker_employment | already_set).
  // Probe whether seeded items already exist — needed both for the
  // dry-run `would_skip_already_complete` short-circuit AND for the
  // post-Stage-B `'stage_a_only_stage_b_no_op'` bucket on re-runs
  // (renamed from `'skipped_already_complete'` per R.4.2-F1).
  const itemsExistedBefore = await assignmentItemsExist(fdb, tenantId, assignmentId);
  const stampNeeded = resolve.resolvedVia !== 'already_set';

  if (dryRun) {
    if (!stampNeeded && itemsExistedBefore) {
      return {
        assignmentId,
        jobOrderId,
        workerUid,
        bucket: 'would_skip_already_complete',
        resolvedHiringEntityId: resolve.resolvedHiringEntityId,
        resolvedVia: resolve.resolvedVia,
        stageBItemsCreated: 0,
        stageBItemsSkippedExisting: 0,
      };
    }
    return {
      assignmentId,
      jobOrderId,
      workerUid,
      bucket: stampNeeded ? 'would_stamp_and_seed' : 'would_stamp_only',
      resolvedHiringEntityId: resolve.resolvedHiringEntityId,
      resolvedVia: resolve.resolvedVia,
      stageBItemsCreated: 0,
      stageBItemsSkippedExisting: 0,
    };
  }

  // ── Write mode ──
  // Stage A — stamp the assignment doc when we actually have a new value.
  if (stampNeeded && resolve.resolvedHiringEntityId) {
    try {
      await fdb
        .doc(`tenants/${tenantId}/assignments/${assignmentId}`)
        .set({ hiringEntityId: resolve.resolvedHiringEntityId }, { merge: true });
    } catch (err) {
      // Stamp failed — bucket as error and audit. We deliberately
      // don't attempt Stage B because the seed pipeline depends on
      // the stamp landing first.
      const message = err instanceof Error ? err.message : String(err);
      await safeWriteR4_2Audit(fdb, {
        tenantId,
        assignmentId,
        jobOrderId: jobOrderId ?? undefined,
        outcome: 'error',
        stageAResolvedVia: resolve.resolvedVia,
        stageAStampedHiringEntityId: resolve.resolvedHiringEntityId,
        stageBItemsCreated: 0,
        stageBItemsSkippedExisting: 0,
        error: `stage_a_stamp_failed: ${message}`,
      });
      return {
        assignmentId,
        jobOrderId,
        workerUid,
        bucket: 'error',
        resolvedHiringEntityId: resolve.resolvedHiringEntityId,
        resolvedVia: resolve.resolvedVia,
        stageBItemsCreated: 0,
        stageBItemsSkippedExisting: 0,
        error: message,
      };
    }
  }

  // Stage B — seed (always, even when Stage A no-op'd).
  // The merge above means subsequent reads inside Stage B see the
  // stamped value; we forward the resolved value so Stage B doesn't
  // need to re-read the doc.
  const stagedAssignmentData = stampNeeded
    ? { ...assignmentData, hiringEntityId: resolve.resolvedHiringEntityId }
    : assignmentData;

  let stageBOutcome: SeedReadinessOutcome;
  try {
    stageBOutcome = await seedReadinessForExistingAssignment({
      tenantId,
      assignmentId,
      assignmentData: stagedAssignmentData,
      fdb,
      callSiteTag: 'backfillLegacyAssignmentsR4_2',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeWriteR4_2Audit(fdb, {
      tenantId,
      assignmentId,
      jobOrderId: jobOrderId ?? undefined,
      outcome: 'stamped_only_seed_failed',
      stageAResolvedVia: resolve.resolvedVia,
      stageAStampedHiringEntityId: resolve.resolvedHiringEntityId,
      stageBItemsCreated: 0,
      stageBItemsSkippedExisting: 0,
      error: message,
    });
    return {
      assignmentId,
      jobOrderId,
      workerUid,
      bucket: 'stamped_only_seed_failed',
      resolvedHiringEntityId: resolve.resolvedHiringEntityId,
      resolvedVia: resolve.resolvedVia,
      stageBItemsCreated: 0,
      stageBItemsSkippedExisting: 0,
      error: message,
    };
  }

  // Stage B succeeded — classify by outcome.
  // NOTE (R.4.2-F1, 2026-04-29): the post-Stage-B "no new items"
  // bucket was renamed from `'skipped_already_complete'` to
  // `'stage_a_only_stage_b_no_op'`. The label change is purely
  // operational — the underlying truth (whether Stage A actually
  // wrote) is recoverable from the audit row's `stageAResolvedVia`
  // (`'already_set'` ⇒ Stage A no-op'd; anything else ⇒ Stage A wrote).
  let bucket: LegacyAssignmentBucket;
  let itemsCreated = 0;
  let itemsSkipped = 0;
  let outcomeName: string;
  if (stageBOutcome.kind === 'seeded') {
    itemsCreated = stageBOutcome.result.itemsCreated;
    itemsSkipped = stageBOutcome.result.itemsSkippedExisting;
    if (itemsCreated === 0 && itemsSkipped === 0) {
      bucket = stampNeeded ? 'stamped_only' : 'stage_a_only_stage_b_no_op';
      outcomeName = bucket;
    } else if (itemsCreated === 0 && itemsSkipped > 0) {
      bucket = 'stage_a_only_stage_b_no_op';
      outcomeName = 'stage_a_only_stage_b_no_op';
    } else {
      bucket = 'stamped_and_seeded';
      outcomeName = 'stamped_and_seeded';
    }
  } else if (stageBOutcome.kind === 'skipped_no_requirements') {
    bucket = stampNeeded ? 'stamped_only' : 'stage_a_only_stage_b_no_op';
    outcomeName = bucket;
  } else {
    bucket = stampNeeded ? 'stamped_only' : 'stage_a_only_stage_b_no_op';
    outcomeName = bucket;
  }

  await safeWriteR4_2Audit(fdb, {
    tenantId,
    assignmentId,
    jobOrderId: jobOrderId ?? undefined,
    outcome: outcomeName,
    stageAResolvedVia: resolve.resolvedVia,
    stageAStampedHiringEntityId: resolve.resolvedHiringEntityId,
    stageBItemsCreated: itemsCreated,
    stageBItemsSkippedExisting: itemsSkipped,
  });

  return {
    assignmentId,
    jobOrderId,
    workerUid,
    bucket,
    resolvedHiringEntityId: resolve.resolvedHiringEntityId,
    resolvedVia: resolve.resolvedVia,
    stageBItemsCreated: itemsCreated,
    stageBItemsSkippedExisting: itemsSkipped,
  };
}

async function assignmentItemsExist(
  fdb: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string,
): Promise<boolean> {
  try {
    const snap = await fdb
      .collection(`tenants/${tenantId}/assignmentReadinessItems`)
      .where('assignmentId', '==', assignmentId)
      .limit(1)
      .get();
    return !snap.empty;
  } catch {
    return false;
  }
}

async function safeWriteR4_2Audit(
  fdb: admin.firestore.Firestore,
  partial: Omit<CascadeAuditEntry, 'action' | 'triggeredBy' | 'context'> & {
    triggeredBy?: string;
    context?: string;
  },
): Promise<void> {
  await writeCascadeAuditEntry(
    {
      action: 'backfill_legacy_assignment_r4_2',
      triggeredBy: partial.triggeredBy ?? 'backfill',
      context: partial.context ?? 'r4_2 legacy backfill',
      ...partial,
    },
    fdb,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page driver — applied per-page so a tenant with thousands of legacy
// assignments is paginated by the operator (matches R.16.1 ops shape).
// ─────────────────────────────────────────────────────────────────────

export interface LegacyAssignmentBuckets {
  /**
   * R.4.2-F1 (2026-04-29) — renamed from `skipped_already_complete`.
   * Old key intentionally absent from this interface so a typo would
   * surface as a TypeScript error rather than a silent zero counter.
   */
  stage_a_only_stage_b_no_op: number;
  skipped_unresolvable_hiring_entity_id: number;
  would_stamp_and_seed: number;
  would_stamp_only: number;
  would_skip_already_complete: number;
  would_skip_unresolvable_hiring_entity_id: number;
  stamped_and_seeded: number;
  stamped_only: number;
  stamped_only_seed_failed: number;
  errors_count: number;
}

export interface BackfillLegacyAssignmentsReport {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  scanned: number;
  /** Assignments that actually entered Stage A (had no hiringEntityId OR forced re-seed). */
  candidatesProcessed: number;
  /** Assignments skipped at scan time because they have hiringEntityId AND items exist (out-of-scope). */
  preFilteredFullyHealthy: number;
  buckets: LegacyAssignmentBuckets;
  manualQueue: Array<{ assignmentId: string; jobOrderId: string | null; workerUid: string | null }>;
  perAssignment: LegacyAssignmentPerRow[];
  errors: Array<{ assignmentId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
  durationMs: number;
}

export interface RunBackfillLegacyAssignmentsPageArgs {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  pageToken: string | null;
  fdb: admin.firestore.Firestore;
}

function emptyBuckets(): LegacyAssignmentBuckets {
  return {
    stage_a_only_stage_b_no_op: 0,
    skipped_unresolvable_hiring_entity_id: 0,
    would_stamp_and_seed: 0,
    would_stamp_only: 0,
    would_skip_already_complete: 0,
    would_skip_unresolvable_hiring_entity_id: 0,
    stamped_and_seeded: 0,
    stamped_only: 0,
    stamped_only_seed_failed: 0,
    errors_count: 0,
  };
}

export async function runBackfillLegacyAssignmentsPage(
  args: RunBackfillLegacyAssignmentsPageArgs,
): Promise<BackfillLegacyAssignmentsReport> {
  const { tenantId, dryRun, limit, pageToken, fdb } = args;
  const startMs = Date.now();

  let q = fdb
    .collection(`tenants/${tenantId}/assignments`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit) as admin.firestore.Query;
  if (pageToken) q = q.startAfter(pageToken);
  const snap = await q.get();

  const report: BackfillLegacyAssignmentsReport = {
    tenantId,
    dryRun,
    limit,
    scanned: snap.size,
    candidatesProcessed: 0,
    preFilteredFullyHealthy: 0,
    buckets: emptyBuckets(),
    manualQueue: [],
    perAssignment: [],
    errors: [],
    truncated: snap.size === limit,
    nextPageToken: snap.size === limit ? snap.docs[snap.docs.length - 1].id : null,
    durationMs: 0,
  };

  // Two-pass: pre-filter the page so we only invoke the heavy Stage
  // A+B pipeline on assignments that aren't already fully healthy.
  // R.4.2 explicitly targets the legacy stuck population; stomping on
  // healthy assignments is wasted IO and pollutes the audit log. The
  // pre-filter is conservative — only short-circuits when the doc
  // ALREADY has hiringEntityId set; assignments with hiringEntityId
  // missing always get processed even if items happen to exist
  // (defensive — that combination is exactly the R.4.2 target shape).
  type Candidate = { id: string; data: Record<string, unknown> };
  const candidates: Candidate[] = [];
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const hid = pickStringField(data, ['hiringEntityId']);
    if (hid) {
      // Doc has hiringEntityId set — short-circuit unless it's
      // missing items (in which case the page driver still picks it
      // up). Cheaper to count + skip than to invoke the resolver.
      const itemsExist = await assignmentItemsExist(fdb, tenantId, doc.id);
      if (itemsExist) {
        report.preFilteredFullyHealthy += 1;
        continue;
      }
    }
    candidates.push({ id: doc.id, data });
  }
  report.candidatesProcessed = candidates.length;

  for (let i = 0; i < candidates.length; i += PASS_CONCURRENCY) {
    const chunk = candidates.slice(i, i + PASS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (cand) => {
        try {
          const out = await processOneLegacyAssignmentForBackfill({
            tenantId,
            assignmentId: cand.id,
            assignmentData: cand.data,
            dryRun,
            fdb,
          });
          return { ok: true as const, row: out };
        } catch (e) {
          return {
            ok: false as const,
            assignmentId: cand.id,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ assignmentId: item.assignmentId, error: item.error });
        report.buckets.errors_count += 1;
        continue;
      }
      const row = item.row;
      report.perAssignment.push(row);

      // Map the per-assignment bucket onto the report counter. Some
      // buckets (`error`) collapse onto `errors_count`.
      switch (row.bucket) {
        case 'error':
          report.buckets.errors_count += 1;
          if (row.error) report.errors.push({ assignmentId: row.assignmentId, error: row.error });
          break;
        case 'stage_a_only_stage_b_no_op':
        case 'skipped_unresolvable_hiring_entity_id':
        case 'would_stamp_and_seed':
        case 'would_stamp_only':
        case 'would_skip_already_complete':
        case 'would_skip_unresolvable_hiring_entity_id':
        case 'stamped_and_seeded':
        case 'stamped_only':
        case 'stamped_only_seed_failed':
          report.buckets[row.bucket] += 1;
          break;
      }

      if (
        row.bucket === 'skipped_unresolvable_hiring_entity_id' ||
        row.bucket === 'would_skip_unresolvable_hiring_entity_id'
      ) {
        report.manualQueue.push({
          assignmentId: row.assignmentId,
          jobOrderId: row.jobOrderId,
          workerUid: row.workerUid,
        });
      }
    }
  }

  report.durationMs = Date.now() - startMs;
  return report;
}

// ─────────────────────────────────────────────────────────────────────
// Callable wrapper — the deployable surface.
// ─────────────────────────────────────────────────────────────────────

function normalizeSecurityLevel(level: unknown): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return Math.min(Math.max(level, 1), 7);
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

function getSecurityLevelForActiveTenant(user: Record<string, unknown>): number {
  const activeTenantId = user.activeTenantId as string | undefined;
  if (!activeTenantId) return normalizeSecurityLevel(user.securityLevel);
  const tenantSettings = (user.tenantIds as Record<string, unknown> | undefined)?.[activeTenantId] as
    | Record<string, unknown>
    | undefined;
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }
  return normalizeSecurityLevel(user.securityLevel);
}

export const backfillLegacyAssignmentsCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<BackfillLegacyAssignmentsReport> => {
    const data = (request.data ?? {}) as BackfillLegacyAssignmentsRequest;
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

    const dryRun = data.dryRun !== false; // default TRUE
    const requestedLimit = Number(data.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const pageToken =
      typeof data.pageToken === 'string' && data.pageToken.trim().length > 0
        ? data.pageToken.trim()
        : null;

    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'User record not found.');
    }
    const callerUser = userSnap.data() ?? {};
    const callerSecurityLevel = getSecurityLevelForActiveTenant(callerUser);
    const callerActiveTenantId =
      typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;

    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. R.4.2 backfill requires security level 7 on the requested tenant.',
      );
    }

    const report = await runBackfillLegacyAssignmentsPage({
      tenantId,
      dryRun,
      limit,
      pageToken,
      fdb: db,
    });

    logger.info('[R.4.2][backfillLegacyAssignmentsCallable] complete', {
      tenantId,
      dryRun,
      limit,
      scanned: report.scanned,
      candidatesProcessed: report.candidatesProcessed,
      preFilteredFullyHealthy: report.preFilteredFullyHealthy,
      buckets: report.buckets,
      manualQueueCount: report.manualQueue.length,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      durationMs: report.durationMs,
      callerUid: uid,
    });

    return report;
  },
);
