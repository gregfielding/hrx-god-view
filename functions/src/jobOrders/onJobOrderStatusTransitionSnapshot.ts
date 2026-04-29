/**
 * **R.16.1** — Snapshot cascade values when a JO transitions out of `draft`.
 *
 * Fires on writes to `tenants/{tid}/job_orders/{joId}`. When the JO
 * moves from `draft` to anything other than `cancelled`, this trigger
 * resolves every cascade field whose registry entry is marked
 * `propagation: 'snapshot-on-activation'` (or `'live-until-active'`)
 * and writes the resolved values into a frozen `jo.snapshot.{...}`
 * envelope on the same JO doc.
 *
 * Why a separate trigger (not folded into R.11):
 *   - Single-purpose, single-responsibility — easy to disable / roll
 *     back without affecting drift detection or any other JO trigger.
 *   - Fingerprint is `before.status === 'draft' AND after.status !==
 *     'draft' AND after.status !== 'cancelled'`. Drift-detection
 *     trigger fires on `screeningPackageId` change. They never collide.
 *
 * Shape locks:
 *   - **L1** — snapshot lives under `jo.snapshot.{fieldKey}`, never
 *     written as flat overrides on the JO doc. Reads use
 *     `getEffectiveJobOrderField()` (Phase 7) to prefer snapshot for
 *     non-draft JOs.
 *   - **L6** — fires once at the *first* draft→non-cancelled
 *     transition; cancellation never fires (no-op).
 *   - **L7** — idempotent: `capturedAt` is set exactly once. Repeat
 *     fires (after a JO bounces draft↔active) short-circuit on
 *     `existing.snapshot?.capturedAt`. Re-snapshotting is the
 *     Push-to-Active callable's job (Phase 5), not the trigger's.
 *   - **L10** — every snapshot write produces an audit entry under
 *     `tenants/{tid}/cascadeAuditLog/{auditId}`.
 *
 * Pure decision unit (`decideShouldSnapshot`) is exported for unit
 * tests; the orchestrator (`runSnapshotPassForJo`) is exported for
 * the backfill migration (Phase 4) so the same code path produces
 * trigger-time and migration-time snapshots.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md L1, L6, L7, L10
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  CASCADE_REGISTRY,
  type CascadingFieldKey,
} from '../shared/cascade/registry';
import { resolveCascadedField } from '../shared/cascade/resolveCascadedField';
import {
  createLoaderContext,
  loadCascadeChain,
} from '../shared/cascade/loaders';
import type { CascadeFieldSpec } from '../shared/cascade/types';
import { isSnapshotPolicy } from '../shared/cascade/types';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────
// Pure decision unit — testable without admin SDK mocks.
// ─────────────────────────────────────────────────────────────────────

export type ShouldSnapshotDecision =
  | { kind: 'snapshot' }
  | { kind: 'skip_unchanged' }
  | { kind: 'skip_not_activating'; reason: string }
  | { kind: 'skip_cancelled' }
  | { kind: 'skip_already_snapshotted' }
  | { kind: 'skip_jo_deleted' };

export interface DecideShouldSnapshotArgs {
  /** JO status BEFORE the write. `null` for create events. */
  beforeStatus: string | null | undefined;
  /** JO status AFTER the write. `null` if the JO was deleted. */
  afterStatus: string | null | undefined;
  /**
   * Whether the AFTER doc already carries `snapshot.capturedAt`.
   * Source of truth for idempotency — once stamped, never re-stamped
   * by this trigger (Push-to-Active is the explicit re-write path).
   */
  alreadySnapshotted: boolean;
}

/**
 * **R.16.1** — Decide whether the snapshot trigger should fire for
 * a given JO write. Pure. No I/O. Order of checks reflects the spec
 * priority: deletes first, then idempotency, then transition shape.
 */
export function decideShouldSnapshot(
  args: DecideShouldSnapshotArgs,
): ShouldSnapshotDecision {
  const { beforeStatus, afterStatus, alreadySnapshotted } = args;

  // Deleted JO — nothing to snapshot, no audit entry, no error log.
  if (afterStatus === null || afterStatus === undefined) {
    return { kind: 'skip_jo_deleted' };
  }

  // Idempotency: once captured, the trigger never re-stamps. Re-runs
  // can come from JO bounce-restore (cancelled → reopened), repeated
  // status writes within a few seconds, etc.
  if (alreadySnapshotted) {
    return { kind: 'skip_already_snapshotted' };
  }

  // Snapshot only fires on a transition OUT of draft.
  if (beforeStatus === afterStatus) {
    return { kind: 'skip_unchanged' };
  }

  if (beforeStatus !== 'draft') {
    return {
      kind: 'skip_not_activating',
      reason: `before.status was "${beforeStatus ?? '<missing>'}" — only draft→* fires snapshot`,
    };
  }

  // L6: cancelled JOs never snapshot. A cancelled JO is terminal —
  // no consumers will ever read snapshot fields on it.
  if (afterStatus === 'cancelled') {
    return { kind: 'skip_cancelled' };
  }

  return { kind: 'snapshot' };
}

// ─────────────────────────────────────────────────────────────────────
// Server-side cascade resolver for snapshot-policy fields.
// ─────────────────────────────────────────────────────────────────────

/**
 * The set of cascade field keys whose registry entries declare a
 * propagation policy that should be frozen at activation. Includes
 * both `'snapshot-on-activation'` and `'live-until-active'`. Computed
 * once at module load — the registry is `as const`, so this is
 * deterministic.
 */
export const SNAPSHOT_POLICY_FIELDS: ReadonlyArray<CascadingFieldKey> =
  Object.entries(CASCADE_REGISTRY)
    .filter(([, spec]) => isSnapshotPolicy((spec as CascadeFieldSpec).propagation))
    .map(([key]) => key as CascadingFieldKey);

/**
 * Subset of `SNAPSHOT_POLICY_FIELDS` that map to top-level keys on
 * `JobOrderSnapshot`. Excludes `positions` because that one needs
 * special handling (the resolver must filter by `selectedPositionIds`
 * and reshape from `Record<string, unknown>` to `ResolvedPositionSnapshot`).
 */
const TOP_LEVEL_SNAPSHOT_FIELDS: ReadonlyArray<CascadingFieldKey> =
  SNAPSHOT_POLICY_FIELDS.filter((k) => k !== 'positions' && k !== 'selectedPositionIds');

/** Sub-fields of `positions` that map to `ResolvedPositionSnapshot`. */
const POSITION_SNAPSHOT_FIELDS = [
  'jobTitle',
  'jobDescription',
  'rateMode',
  'payRate',
  'billRate',
  'futa',
  'suta',
  'workersCompRate',
  'markupPercentage',
] as const;

export interface ResolvedSnapshotEnvelope {
  /**
   * The flat field map written under `jo.snapshot.{...}`.
   * Top-level fields plus `selectedPositionIds` and `positions[]`.
   * `undefined` values are dropped before the Firestore write.
   */
  envelope: Record<string, unknown>;
  /**
   * Names of the snapshot fields that resolved to a defined value.
   * Used in the audit entry so an admin can see at a glance what
   * the trigger captured.
   */
  fieldsCaptured: string[];
}

/**
 * Resolve every `snapshot-on-activation` / `live-until-active`
 * registry field for a JO and produce the envelope to write under
 * `jo.snapshot`. Pure relative to the loader context — no Firestore
 * writes, no audit, no decision-making about whether to snapshot.
 *
 * Caller is responsible for:
 *   - building the `LoaderContext` (we accept it so tests can inject a fake)
 *   - merging `capturedAt`/`capturedBy` onto the envelope
 *   - the actual `db.doc(...).set({ snapshot: envelope }, { merge: true })`
 */
export async function resolveSnapshotEnvelope(args: {
  tenantId: string;
  jobOrderId: string;
  preloadedJoData: Record<string, unknown>;
  loaderCtx: ReturnType<typeof createLoaderContext>;
}): Promise<ResolvedSnapshotEnvelope> {
  const { tenantId, jobOrderId, preloadedJoData, loaderCtx } = args;

  const chain = await loadCascadeChain(loaderCtx, {
    tenantId,
    jobOrderId,
    preloadedJoData,
  });

  const envelope: Record<string, unknown> = {};
  const fieldsCaptured: string[] = [];

  // Top-level fields.
  for (const field of TOP_LEVEL_SNAPSHOT_FIELDS) {
    const { value } = resolveCascadedField(field, chain);
    if (value !== undefined) {
      envelope[field] = value;
      fieldsCaptured.push(field);
    }
  }

  // selectedPositionIds — needed both as a snapshot field AND as the
  // filter for the `positions` blob.
  const selectedIdsResult = resolveCascadedField('selectedPositionIds', chain);
  const selectedIds = Array.isArray(selectedIdsResult.value)
    ? (selectedIdsResult.value as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.trim() !== '',
      )
    : [];
  if (selectedIdsResult.value !== undefined) {
    envelope.selectedPositionIds = selectedIds;
    fieldsCaptured.push('selectedPositionIds');
  }

  // positions — resolve full keyed_list, then filter+reshape by
  // selectedPositionIds. If selectedPositionIds is empty we still
  // capture an empty array so the snapshot is unambiguous (vs. "not
  // captured because the cascade had no data").
  const positionsResult = resolveCascadedField('positions', chain);
  const allPositions = Array.isArray(positionsResult.value)
    ? (positionsResult.value as Array<Record<string, unknown>>)
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const p of allPositions) {
    const id = typeof p.positionId === 'string' ? p.positionId : '';
    if (id) byId.set(id, p);
  }
  const positions: Array<Record<string, unknown>> = [];
  for (const id of selectedIds) {
    const merged = byId.get(id);
    if (!merged) continue;
    const reshape: Record<string, unknown> = { positionId: id };
    for (const sub of POSITION_SNAPSHOT_FIELDS) {
      if (sub in merged) reshape[sub] = merged[sub];
    }
    positions.push(reshape);
  }
  envelope.positions = positions;
  fieldsCaptured.push('positions');

  return { envelope, fieldsCaptured };
}

// ─────────────────────────────────────────────────────────────────────
// Audit log helper. Reused by Push-to-Active (Phase 5) and the
// backfill migration (Phase 4).
// ─────────────────────────────────────────────────────────────────────

export type CascadeAuditAction =
  | 'snapshot_on_activation'
  | 'snapshot_via_backfill'
  | 'push_to_active'
  | 'push_to_active_summary'
  | 'snapshot_skipped'
  // **R.4.2 / L.4.2.5** — per-assignment row emitted by the legacy
  // hiringEntityId + readiness-seed backfill. One row per assignment
  // touched by `runBackfillLegacyAssignmentsPage`, regardless of
  // outcome (success, stage-A-only-stage-B-no-op, unresolvable, error).
  // See docs/R4_2_LEGACY_BACKFILL_HANDOFF.md §L.4.2.5.
  | 'backfill_legacy_assignment_r4_2'
  // **R.4.2-F3 (2026-04-29)** — per-assignment row emitted by the
  // status-spelling normalizer (`normalizeAssignmentStatusSpellingCallable`
  // / `scripts/normalizeAssignmentStatusSpelling.js`). One row per
  // assignment whose `status` field was rewritten from `'canceled'` →
  // `'cancelled'` (British spelling — the canonical form in the
  // dataset). Out-of-scope for migration: anything other than the
  // exact `'canceled'` literal. See docs/R4_2_FOLLOWUPS.md §R.4.2-F3.
  | 'normalize_status_spelling';

export interface CascadeAuditEntry {
  action: CascadeAuditAction;
  tenantId: string;
  /**
   * Set on per-JO rows. Omitted on summary rows of multi-JO actions
   * (`push_to_active_summary`) — the rolled-up list lives in
   * `affectedJoIds` instead. Also omitted on R.4.2 per-assignment
   * rows when the assignment doesn't carry a JO id (rare but legal).
   */
  jobOrderId?: string;
  /**
   * **R.4.2 / L.4.2.5** — Set on per-assignment rows
   * (`backfill_legacy_assignment_r4_2` action). Mirror of
   * `jobOrderId`'s collection-key narrowing — lets audit queries
   * filter "every R.4.2 row touching assignment X".
   */
  assignmentId?: string;
  /** `'system'` for triggers, `uid` for callables. */
  triggeredBy: string;
  /** Free-form short context — e.g. `'draft→open'`, `'manual reorder'`. */
  context?: string;
  /** Names of snapshot fields written. */
  fieldsCaptured?: string[];
  /** For Push-to-Active: the exact field+value pushed. */
  pushedField?: { fieldKey: string; positionId?: string | null; value: unknown };
  /** Status before/after for snapshot transitions. */
  beforeStatus?: string | null;
  afterStatus?: string | null;
  /**
   * Mandatory reason for Push-to-Active (Phase 5). Captured on every
   * per-JO row + the summary row so an audit query can filter by
   * reason without joining tables.
   */
  reason?: string;
  /** Decision-skip kind so admins can filter audit history. */
  skipKind?: string;
  /** Error string if the action failed. */
  error?: string;

  // ── Push-to-Active specific (Phase 5) ─────────────────────────────
  /** Account whose edit triggered the push. */
  accountId?: string;
  /** Effective value before the push (per-JO row). */
  oldValue?: unknown;
  /** Effective value after the push (per-JO row + summary row). */
  newValue?: unknown;
  /**
   * Set on `push_to_active_summary` rows. Lists every JO touched by
   * the push (both ones that changed and ones that no-op'd because
   * preview re-validation said `wouldChange=false`).
   */
  affectedJoIds?: string[];
  /** Summary-only: number of per-JO rows actually written. */
  updatedCount?: number;
  /** Summary-only: number of selected JOs that no-op'd on re-validation. */
  skippedCount?: number;

  // ── R.4.2 legacy-assignment backfill specific (L.4.2.5) ───────────
  /**
   * R.4.2 per-assignment outcome bucket. One of:
   *   `'stamped_and_seeded'` — Stage A wrote hiringEntityId AND Stage B seeded.
   *   `'stamped_only'`              — Stage A wrote, Stage B seeded zero items
   *                                   (JO had no requirements).
   *   `'stamped_only_seed_failed'`  — Stage A succeeded, Stage B threw.
   *   `'stage_a_only_stage_b_no_op'` — Stage B reported zero new items.
   *                                   Disambiguate via `stageAResolvedVia`:
   *                                   `'already_set'` ⇒ Stage A no-op'd too
   *                                   (true already-complete);
   *                                   anything else ⇒ Stage A wrote and
   *                                   Stage B found pre-existing items
   *                                   from another code path (cadence
   *                                   trigger, prior partial seed, etc.).
   *                                   **R.4.2-F1 (2026-04-29):** renamed
   *                                   from `'skipped_already_complete'`.
   *                                   Pre-2026-04-29 audit rows may
   *                                   carry the old label; this field
   *                                   is `string` (not a typed union)
   *                                   so historical rows still parse.
   *   `'skipped_unresolvable_hiring_entity_id'` — Stage A returned `'unresolved'`.
   *   `'skipped_already_set'`       — hiringEntityId was set; Stage B re-ran
   *                                   (and itself produced an outcome).
   *   `'error'`                     — any unexpected exception.
   */
  outcome?: string;
  /**
   * R.4.2 — which path Stage A's resolver used. One of:
   *   `'jo_chain'` · `'worker_employment'` · `'unresolved'` · `'already_set'`.
   */
  stageAResolvedVia?: string;
  /**
   * R.4.2 — the value Stage A wrote into `assignment.hiringEntityId`.
   * `null` on `'unresolved'` rows.
   */
  stageAStampedHiringEntityId?: string | null;
  /** R.4.2 — number of new items the seeder wrote. */
  stageBItemsCreated?: number;
  /**
   * R.4.2 — number of items the seeder skipped because they already
   * existed (idempotent re-run signature).
   */
  stageBItemsSkippedExisting?: number;

  // ── R.4.2-F3 status-spelling normalizer specific ──────────────────
  /**
   * R.4.2-F3 — value of `assignment.status` BEFORE the rewrite.
   * Should always be `'canceled'` (the only literal the normalizer
   * targets); recorded as a string anyway so future variants
   * (`'cancelld'` etc.) can be added without a schema change.
   */
  beforeAssignmentStatus?: string;
  /**
   * R.4.2-F3 — value of `assignment.status` AFTER the rewrite.
   * Should always be `'cancelled'` (British spelling, dataset canon).
   */
  afterAssignmentStatus?: string;
}

/**
 * Write a row to `tenants/{tid}/cascadeAuditLog/{auto-id}`. Best-
 * effort: failures here are logged but don't abort the calling
 * operation. The audit log is a forensic aid, not a transactional
 * record.
 */
export async function writeCascadeAuditEntry(
  entry: CascadeAuditEntry,
  fdb: admin.firestore.Firestore = db,
): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      ...entry,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
    await fdb
      .collection(`tenants/${entry.tenantId}/cascadeAuditLog`)
      .add(row);
  } catch (err) {
    logger.warn('[R.16.1] writeCascadeAuditEntry failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
      entry,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// I/O orchestrator — also called by the backfill migration (Phase 4).
// ─────────────────────────────────────────────────────────────────────

export interface SnapshotPassResult {
  decision: ShouldSnapshotDecision;
  fieldsCaptured: string[];
  durationMs: number;
}

/**
 * **R.16.1** — Run the full snapshot pipeline for one JO.
 *
 * Orchestrates: decision → resolve envelope → write transactionally
 * → audit. Returns a structured result for the trigger / backfill to
 * log + report on.
 *
 * The Firestore write is a `transaction` (not a plain set) for two
 * reasons: (1) we re-read the JO inside the transaction to avoid a
 * write-after-write race where another trigger has just stamped the
 * snapshot from a concurrent activation, and (2) the transaction
 * fails the snapshot if the post-status was rolled back to draft
 * after we made the decision.
 */
export async function runSnapshotPassForJo(args: {
  tenantId: string;
  jobOrderId: string;
  beforeStatus: string | null | undefined;
  afterStatus: string | null | undefined;
  /** Use 'trigger' for the Firestore trigger; 'backfill' for the migration. */
  capturedBy: 'trigger' | 'backfill';
  /** Pre-fetched JO data from `change.after.data()`. Avoids a re-read. */
  preloadedJoData: Record<string, unknown> | null;
  /** Optional fake Firestore for tests. */
  fdb?: admin.firestore.Firestore;
  /**
   * **R.16.1 §L7 force path** — re-snapshot even when the JO already
   * carries `snapshot.capturedAt`. Only the backfill `--force` flag
   * uses this. The trigger never passes `force`. When set:
   *   - `decideShouldSnapshot` is fed `alreadySnapshotted: false` so
   *     it returns `'snapshot'` despite the existing capture.
   *   - The transaction-time idempotency guard is bypassed so the
   *     write actually lands.
   *   - The audit entry's `context` is suffixed with `' (forced)'`
   *     so an operator can trace the override.
   */
  force?: boolean;
}): Promise<SnapshotPassResult> {
  const fdb = args.fdb ?? db;
  const { tenantId, jobOrderId, beforeStatus, afterStatus, capturedBy } = args;
  const force = args.force === true;
  const start = Date.now();

  const trulyAlreadySnapshotted = Boolean(
    args.preloadedJoData &&
      typeof args.preloadedJoData === 'object' &&
      args.preloadedJoData !== null &&
      isPlainObject((args.preloadedJoData as Record<string, unknown>).snapshot) &&
      (args.preloadedJoData as { snapshot?: { capturedAt?: unknown } }).snapshot
        ?.capturedAt !== undefined,
  );
  // Force flips `alreadySnapshotted` to false for the decision unit
  // so the transition matrix can return `'snapshot'` even on a JO
  // that's been previously frozen. The transaction-time guard
  // (below) is also bypassed when `force` is true.
  const alreadySnapshotted = force ? false : trulyAlreadySnapshotted;

  const decision = decideShouldSnapshot({
    beforeStatus,
    afterStatus,
    alreadySnapshotted,
  });

  if (decision.kind !== 'snapshot') {
    if (decision.kind !== 'skip_unchanged' && decision.kind !== 'skip_jo_deleted') {
      // Audit only the meaningful skips. `skip_unchanged` is just a
      // re-fire of the same write; `skip_jo_deleted` is the trigger
      // refusing to act on a tombstone.
      await writeCascadeAuditEntry(
        {
          action: 'snapshot_skipped',
          tenantId,
          jobOrderId,
          triggeredBy: capturedBy === 'trigger' ? 'system' : 'backfill',
          beforeStatus: beforeStatus ?? null,
          afterStatus: afterStatus ?? null,
          skipKind: decision.kind,
          context:
            decision.kind === 'skip_not_activating' ? decision.reason : undefined,
        },
        fdb,
      );
    }
    return {
      decision,
      fieldsCaptured: [],
      durationMs: Date.now() - start,
    };
  }

  const preloaded = args.preloadedJoData ?? {};
  const loaderCtx = createLoaderContext({ db: fdb });

  const resolved = await resolveSnapshotEnvelope({
    tenantId,
    jobOrderId,
    preloadedJoData: preloaded,
    loaderCtx,
  });

  // Transactional write: re-read inside the transaction so a
  // concurrent snapshot wins the idempotency race.
  const joRef = fdb.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  await fdb.runTransaction(async (tx) => {
    const fresh = await tx.get(joRef);
    if (!fresh.exists) return; // JO was deleted between the trigger and the txn.
    const freshData = fresh.data() as Record<string, unknown> | undefined;
    const existingSnapshot = freshData?.snapshot;
    if (
      !force &&
      isPlainObject(existingSnapshot) &&
      (existingSnapshot as Record<string, unknown>).capturedAt !== undefined
    ) {
      // Concurrent snapshot already won. Treat as a no-op.
      // Skipped when `force` is true (backfill --force path) so an
      // operator can explicitly refresh a frozen envelope.
      return;
    }

    const snapshotPayload: Record<string, unknown> = {
      ...resolved.envelope,
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      capturedBy,
      lastPushedAt: null,
    };
    tx.set(joRef, { snapshot: snapshotPayload }, { merge: true });
  });

  await writeCascadeAuditEntry(
    {
      action:
        capturedBy === 'backfill'
          ? 'snapshot_via_backfill'
          : 'snapshot_on_activation',
      tenantId,
      jobOrderId,
      triggeredBy: capturedBy === 'trigger' ? 'system' : 'backfill',
      beforeStatus: beforeStatus ?? null,
      afterStatus: afterStatus ?? null,
      fieldsCaptured: resolved.fieldsCaptured,
      context: `${beforeStatus ?? '<none>'}→${afterStatus ?? '<none>'}${
        force ? ' (forced)' : ''
      }`,
    },
    fdb,
  );

  return {
    decision,
    fieldsCaptured: resolved.fieldsCaptured,
    durationMs: Date.now() - start,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickStatus(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const v = data.status;
  return typeof v === 'string' ? v : null;
}

// ─────────────────────────────────────────────────────────────────────
// Firestore trigger registration.
// ─────────────────────────────────────────────────────────────────────

export const onJobOrderStatusTransitionSnapshot = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const jobOrderId = String(event.params.jobOrderId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      // JO deleted — nothing to snapshot.
      return;
    }

    const beforeStatus = pickStatus(beforeData);
    const afterStatus = pickStatus(afterData);

    try {
      const result = await runSnapshotPassForJo({
        tenantId,
        jobOrderId,
        beforeStatus,
        afterStatus,
        capturedBy: 'trigger',
        preloadedJoData: afterData,
      });

      if (result.decision.kind === 'snapshot') {
        logger.info('[R.16.1] snapshot captured', {
          tenantId,
          jobOrderId,
          beforeStatus,
          afterStatus,
          fieldsCaptured: result.fieldsCaptured,
          durationMs: result.durationMs,
        });
      } else {
        logger.debug('[R.16.1] snapshot skipped', {
          tenantId,
          jobOrderId,
          beforeStatus,
          afterStatus,
          decision: result.decision.kind,
          durationMs: result.durationMs,
        });
      }
    } catch (err) {
      // Don't rethrow — the snapshot trigger is informational/
      // protective. A failure here shouldn't crash the JO write or
      // trigger a retry storm. Audit + log + move on. Operators
      // diagnose via `cascadeAuditLog` and Cloud Logging.
      logger.error('[R.16.1] snapshot trigger failed', {
        tenantId,
        jobOrderId,
        beforeStatus,
        afterStatus,
        err: err instanceof Error ? err.message : String(err),
      });
      await writeCascadeAuditEntry({
        action: 'snapshot_skipped',
        tenantId,
        jobOrderId,
        triggeredBy: 'system',
        beforeStatus,
        afterStatus,
        skipKind: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
