/**
 * **R.16.1 Phase 5** — Push-to-Active callables.
 *
 * The snapshot trigger freezes cascade-policy fields at activation;
 * it does NOT push subsequent Account/Child edits down onto active
 * JOs. Push-to-Active is the explicit, audited path for that:
 *
 *   1. Account admin edits a snapshot-policy field on the parent
 *      Account (e.g. flips `eVerifyRequired`, raises a position's
 *      `markupPercentage`).
 *   2. The Account form's `PushToActiveBanner` (Phase 8) detects a
 *      dirty snapshot-policy field, opens `PushToActiveDialog`, and
 *      calls `previewPushToActiveCallable` to render the affected-JO
 *      list with current-vs-new diffs.
 *   3. Admin selects which JOs to push to, types a non-empty reason
 *      (max 2000 chars), and submits. The dialog calls
 *      `pushToActiveJobOrdersCallable`, which re-runs the preview
 *      server-side, writes the new value into each selected JO's
 *      `jo.snapshot.{fieldKey}` (or `jo.snapshot.positions[i].{sub}`
 *      for per-position pushes), bumps `snapshot.lastPushedAt`, and
 *      emits one `cascadeAuditLog` row per JO + one summary row.
 *
 * Why a separate file from `onJobOrderStatusTransitionSnapshot.ts`:
 *   - Different blast radius. The snapshot trigger writes once per
 *     JO at activation; Push-to-Active writes on demand and can
 *     touch dozens of JOs in one call. Keeping the codepaths
 *     separate makes the audit + transaction shape easier to reason
 *     about.
 *   - Different security gate. The trigger fires for any user whose
 *     write activates a JO; the callable is HRX-staff (security
 *     level ≥ 7). Mirrors the backfill callable's ops gate.
 *
 * §L9 field surface (V1 — locked):
 *   - Top-level: `hiringEntityId`, `eVerifyRequired`, `workersCompCode`,
 *     `screeningPackageId`, `additionalScreenings`.
 *   - Per-position (requires `positionId`): `jobTitle`, `jobDescription`,
 *     `rateMode`, `payRate`, `billRate`, `futa`, `suta`,
 *     `workersCompRate`, `markupPercentage`.
 *   - Out of V1: wholesale `positions` replace, `selectedPositionIds`
 *     push, and any non-snapshot-policy field. The dialog must
 *     refuse to call this with anything outside the locked surface.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L2, §L9, §L10
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { writeCascadeAuditEntry } from './onJobOrderStatusTransitionSnapshot';

if (!admin.apps.length) {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────
// Locked field surface (§L9).
// ─────────────────────────────────────────────────────────────────────

export const PUSH_TOP_LEVEL_FIELDS = [
  'hiringEntityId',
  'eVerifyRequired',
  'workersCompCode',
  'screeningPackageId',
  'additionalScreenings',
] as const;

export const PUSH_POSITION_FIELDS = [
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

export type PushTopLevelField = (typeof PUSH_TOP_LEVEL_FIELDS)[number];
export type PushPositionField = (typeof PUSH_POSITION_FIELDS)[number];
export type PushFieldKey = PushTopLevelField | PushPositionField;

/** Statuses where Push-to-Active is meaningful. Anything else (draft / cancelled) is excluded. */
const ACTIVE_STATUSES = new Set([
  'open',
  'on_hold',
  'filled',
  'completed',
  'in_progress',
]);

/** Maximum number of selected JOs the write callable will accept in one call. */
const MAX_SELECTED_JOS = 200;
/** Maximum characters in `reason`. */
const MAX_REASON_LEN = 2000;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported for tests.
// ─────────────────────────────────────────────────────────────────────

export function isPushTopLevelField(key: string): key is PushTopLevelField {
  return (PUSH_TOP_LEVEL_FIELDS as readonly string[]).includes(key);
}

export function isPushPositionField(key: string): key is PushPositionField {
  return (PUSH_POSITION_FIELDS as readonly string[]).includes(key);
}

/**
 * Deep-ish equality for the value types the snapshot envelope holds:
 * primitives, `null`, and arrays of primitives (e.g.
 * `additionalScreenings`). Sorts arrays before comparison so a
 * reordered list doesn't register as a real change.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Treat `undefined` and `null` as equal so a JO whose snapshot
  // never captured the field doesn't get pushed against a parent
  // that's also `null` — there's nothing to push.
  if ((a === undefined || a === null) && (b === undefined || b === null)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const aa = [...a].sort();
    const bb = [...b].sort();
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }
  return false;
}

export interface ValidatePushArgsInput {
  tenantId: unknown;
  accountId: unknown;
  fieldKey: unknown;
  positionId: unknown;
  newValue: unknown;
  selectedJoIds?: unknown;
  reason?: unknown;
  /** True for the write callable; relaxes the `selectedJoIds`/`reason` requirement when false. */
  isWrite: boolean;
}

export type ValidatedPushArgs = {
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
  newValue: unknown;
  selectedJoIds: string[];
  reason: string;
};

/**
 * Validate caller-supplied arguments for both preview and write.
 * Pure — no I/O — so the caller can wrap it in HttpsError mapping
 * once. Throws strings that the caller wraps; we don't import
 * `HttpsError` here so the unit tests don't need to stub functions
 * runtime.
 */
export function validatePushArgs(input: ValidatePushArgsInput): ValidatedPushArgs {
  const tenantId = String(input.tenantId ?? '').trim();
  const accountId = String(input.accountId ?? '').trim();
  const fieldKeyRaw = String(input.fieldKey ?? '').trim();
  const positionIdRaw =
    typeof input.positionId === 'string' && input.positionId.trim() !== ''
      ? input.positionId.trim()
      : null;

  if (!tenantId) throw new Error('tenantId is required.');
  if (!accountId) throw new Error('accountId is required.');
  if (!fieldKeyRaw) throw new Error('fieldKey is required.');

  if (!isPushTopLevelField(fieldKeyRaw) && !isPushPositionField(fieldKeyRaw)) {
    throw new Error(
      `fieldKey "${fieldKeyRaw}" is not push-eligible. ` +
        'See PUSH_TOP_LEVEL_FIELDS / PUSH_POSITION_FIELDS for the locked V1 surface.',
    );
  }

  if (isPushPositionField(fieldKeyRaw) && !positionIdRaw) {
    throw new Error(`positionId is required when pushing per-position field "${fieldKeyRaw}".`);
  }
  if (isPushTopLevelField(fieldKeyRaw) && positionIdRaw) {
    throw new Error(
      `positionId must be omitted when pushing top-level field "${fieldKeyRaw}".`,
    );
  }

  // Type-shape validation per field. We refuse to write a string
  // into a numeric field even if Firestore would accept it, because
  // it would silently break downstream consumers.
  validateNewValueShape(fieldKeyRaw, input.newValue);

  let selectedJoIds: string[] = [];
  if (input.isWrite) {
    if (!Array.isArray(input.selectedJoIds)) {
      throw new Error('selectedJoIds must be a non-empty array of JO IDs.');
    }
    selectedJoIds = (input.selectedJoIds as unknown[])
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim());
    if (selectedJoIds.length === 0) {
      throw new Error('selectedJoIds must include at least one JO ID.');
    }
    if (selectedJoIds.length > MAX_SELECTED_JOS) {
      throw new Error(
        `selectedJoIds exceeds maximum (${MAX_SELECTED_JOS}). ` +
          'Split the push into multiple submissions.',
      );
    }
  } else if (input.selectedJoIds !== undefined && Array.isArray(input.selectedJoIds)) {
    selectedJoIds = (input.selectedJoIds as unknown[])
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim());
  }

  let reason = '';
  if (input.isWrite) {
    if (typeof input.reason !== 'string') {
      throw new Error('reason is required and must be a non-empty string.');
    }
    reason = input.reason.trim();
    if (reason.length === 0) {
      throw new Error('reason cannot be empty.');
    }
    if (reason.length > MAX_REASON_LEN) {
      throw new Error(`reason exceeds maximum length (${MAX_REASON_LEN} chars).`);
    }
  }

  return {
    tenantId,
    accountId,
    fieldKey: fieldKeyRaw as PushFieldKey,
    positionId: positionIdRaw,
    newValue: input.newValue,
    selectedJoIds,
    reason,
  };
}

function validateNewValueShape(fieldKey: string, value: unknown): void {
  // `null` is always acceptable — push-to-active can deliberately
  // clear a field on every selected JO.
  if (value === null) return;

  switch (fieldKey) {
    case 'hiringEntityId':
    case 'workersCompCode':
    case 'screeningPackageId':
    case 'jobTitle':
    case 'jobDescription':
    case 'rateMode':
      if (typeof value !== 'string') {
        throw new Error(`newValue for "${fieldKey}" must be a string or null.`);
      }
      return;

    case 'eVerifyRequired':
      if (typeof value !== 'boolean') {
        throw new Error(`newValue for "${fieldKey}" must be a boolean or null.`);
      }
      return;

    case 'additionalScreenings':
      if (
        !Array.isArray(value) ||
        !value.every((s) => typeof s === 'string')
      ) {
        throw new Error(`newValue for "${fieldKey}" must be a string array or null.`);
      }
      return;

    case 'payRate':
    case 'billRate':
    case 'futa':
    case 'suta':
    case 'workersCompRate':
    case 'markupPercentage':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`newValue for "${fieldKey}" must be a finite number or null.`);
      }
      return;

    default:
      throw new Error(`Unsupported fieldKey "${fieldKey}" passed shape validation.`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot reads.
// ─────────────────────────────────────────────────────────────────────

export interface JoLikeForPush {
  id: string;
  status?: unknown;
  snapshot?: Record<string, unknown> | null;
}

/**
 * Read the current effective value of a snapshot-policy field
 * directly from a JO doc. Mirrors `getEffectiveJobOrderField` in
 * principle but tailored to server-side push: we only care about
 * the snapshot envelope (the live cascade isn't authoritative for
 * non-draft JOs once a snapshot has been captured), and a missing
 * snapshot is treated as `undefined` not `null`.
 */
export function readCurrentSnapshotValue(
  jo: JoLikeForPush,
  fieldKey: PushFieldKey,
  positionId: string | null,
): { value: unknown; reason: 'snapshot' | 'no_snapshot' | 'no_position' } {
  const snap = jo.snapshot;
  if (!snap || typeof snap !== 'object' || snap.capturedAt === undefined) {
    return { value: undefined, reason: 'no_snapshot' };
  }

  if (isPushTopLevelField(fieldKey)) {
    return { value: (snap as Record<string, unknown>)[fieldKey], reason: 'snapshot' };
  }

  // Per-position field.
  if (!positionId) {
    return { value: undefined, reason: 'no_position' };
  }
  const positions = (snap as { positions?: unknown }).positions;
  if (!Array.isArray(positions)) {
    return { value: undefined, reason: 'no_position' };
  }
  const match = positions.find(
    (p): p is Record<string, unknown> =>
      typeof p === 'object' &&
      p !== null &&
      (p as { positionId?: unknown }).positionId === positionId,
  );
  if (!match) {
    return { value: undefined, reason: 'no_position' };
  }
  return { value: match[fieldKey], reason: 'snapshot' };
}

// ─────────────────────────────────────────────────────────────────────
// Preview — pure-ish (does Firestore reads, no writes).
// ─────────────────────────────────────────────────────────────────────

/** Why a JO is NOT eligible to receive a push-to-active. */
export type IneligibilityReason =
  | 'status_excluded' // status is `draft` / `cancelled` / unknown
  | 'no_snapshot' // active JO that predates §16.1 — backfill required first
  | 'no_position'; // per-position push, JO's snapshot doesn't include this positionId

export interface AffectedJoSummary {
  jobOrderId: string;
  status: string;
  /** Snapshot's current value for the requested field, or `null`/`undefined` if absent. */
  currentValue: unknown;
  /** True iff `currentValue !== newValue` AND the JO is eligible. */
  wouldChange: boolean;
  /** Set when `wouldChange` is false because the JO is ineligible. */
  ineligibleReason?: IneligibilityReason;
}

export interface PreviewPushReport {
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
  newValue: unknown;
  affectedJobOrders: AffectedJoSummary[];
  totals: {
    totalScanned: number;
    eligible: number;
    wouldChange: number;
    alreadyMatching: number;
    missingSnapshot: number;
    missingPosition: number;
  };
}

export interface RunPreviewArgs {
  validated: ValidatedPushArgs;
  fdb: admin.firestore.Firestore;
}

export async function runPreviewPushToActive(
  args: RunPreviewArgs,
): Promise<PreviewPushReport> {
  const { validated, fdb } = args;
  const { tenantId, accountId, fieldKey, positionId, newValue } = validated;

  const snap = await fdb
    .collection(`tenants/${tenantId}/job_orders`)
    .where('recruiterAccountId', '==', accountId)
    .get();

  const affected: AffectedJoSummary[] = [];
  const totals = {
    totalScanned: snap.size,
    eligible: 0,
    wouldChange: 0,
    alreadyMatching: 0,
    missingSnapshot: 0,
    missingPosition: 0,
  };

  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : '';

    if (!ACTIVE_STATUSES.has(status)) {
      // `draft` / `cancelled` / unknown — silently excluded; not in the report.
      continue;
    }

    const jo: JoLikeForPush = {
      id: doc.id,
      status,
      snapshot: (data.snapshot ?? null) as Record<string, unknown> | null,
    };

    const { value: currentValue, reason } = readCurrentSnapshotValue(
      jo,
      fieldKey,
      positionId,
    );

    if (reason === 'no_snapshot') {
      totals.missingSnapshot += 1;
      affected.push({
        jobOrderId: doc.id,
        status,
        currentValue,
        wouldChange: false,
        ineligibleReason: 'no_snapshot',
      });
      continue;
    }
    if (reason === 'no_position') {
      totals.missingPosition += 1;
      affected.push({
        jobOrderId: doc.id,
        status,
        currentValue,
        wouldChange: false,
        ineligibleReason: 'no_position',
      });
      continue;
    }

    totals.eligible += 1;
    const equal = valuesEqual(currentValue, newValue);
    if (equal) {
      totals.alreadyMatching += 1;
      affected.push({
        jobOrderId: doc.id,
        status,
        currentValue,
        wouldChange: false,
      });
    } else {
      totals.wouldChange += 1;
      affected.push({
        jobOrderId: doc.id,
        status,
        currentValue,
        wouldChange: true,
      });
    }
  }

  return {
    tenantId,
    accountId,
    fieldKey,
    positionId,
    newValue,
    affectedJobOrders: affected,
    totals,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Write — single-JO push, transactional.
// ─────────────────────────────────────────────────────────────────────

export interface WritePushOneArgs {
  tenantId: string;
  jobOrderId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
  newValue: unknown;
  fdb: admin.firestore.Firestore;
}

export type PushOneOutcome =
  | { kind: 'pushed'; oldValue: unknown }
  | { kind: 'skipped_not_eligible'; reason: IneligibilityReason }
  | { kind: 'skipped_no_change' }
  | { kind: 'skipped_status_changed' };

/**
 * Write the new snapshot value for one JO. Transactional: re-reads
 * inside the transaction so a JO that's been re-snapshotted (or
 * cancelled) since the preview can't be silently overwritten.
 */
export async function writePushToActiveOne(
  args: WritePushOneArgs,
): Promise<PushOneOutcome> {
  const { tenantId, jobOrderId, fieldKey, positionId, newValue, fdb } = args;
  const joRef = fdb.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);

  return fdb.runTransaction<PushOneOutcome>(async (tx) => {
    const fresh = await tx.get(joRef);
    if (!fresh.exists) {
      return { kind: 'skipped_status_changed' };
    }
    const data = (fresh.data() ?? {}) as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : '';
    if (!ACTIVE_STATUSES.has(status)) {
      return { kind: 'skipped_status_changed' };
    }

    const jo: JoLikeForPush = {
      id: jobOrderId,
      status,
      snapshot: (data.snapshot ?? null) as Record<string, unknown> | null,
    };
    const { value: oldValue, reason } = readCurrentSnapshotValue(
      jo,
      fieldKey,
      positionId,
    );

    if (reason === 'no_snapshot') {
      return { kind: 'skipped_not_eligible', reason: 'no_snapshot' };
    }
    if (reason === 'no_position') {
      return { kind: 'skipped_not_eligible', reason: 'no_position' };
    }
    if (valuesEqual(oldValue, newValue)) {
      return { kind: 'skipped_no_change' };
    }

    if (isPushTopLevelField(fieldKey)) {
      // Top-level snapshot field. Use a flat field path so we don't
      // overwrite sibling snapshot fields. `lastPushedAt` always
      // bumps; `capturedAt` / `capturedBy` are preserved.
      const updates: Record<string, unknown> = {
        [`snapshot.${fieldKey}`]: newValue,
        'snapshot.lastPushedAt': admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.update(joRef, updates);
    } else {
      // Per-position. Re-emit the full positions array with the
      // matching entry's sub-field replaced. Firestore can't update
      // an array element by id natively without read-modify-write.
      const positions = jo.snapshot?.positions;
      if (!Array.isArray(positions)) {
        // Re-validation race: snapshot.positions disappeared between
        // the eligibility check above and this read. Treat as
        // ineligible rather than throwing — the preview re-run on a
        // subsequent push attempt will surface it again.
        return { kind: 'skipped_not_eligible', reason: 'no_position' };
      }
      const nextPositions = positions.map((p) => {
        if (
          typeof p === 'object' &&
          p !== null &&
          (p as { positionId?: unknown }).positionId === positionId
        ) {
          return { ...(p as Record<string, unknown>), [fieldKey]: newValue };
        }
        return p;
      });
      tx.update(joRef, {
        'snapshot.positions': nextPositions,
        'snapshot.lastPushedAt': admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { kind: 'pushed', oldValue };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Page driver — orchestrates preview re-run + per-JO writes + audit.
// ─────────────────────────────────────────────────────────────────────

export interface RunPushArgs {
  validated: ValidatedPushArgs;
  triggeredBy: string;
  fdb: admin.firestore.Firestore;
}

export interface PushPageReport {
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
  newValue: unknown;
  reason: string;
  /** Number of `selectedJoIds` that were actually written. */
  updatedCount: number;
  /** Selected JOs that didn't change (re-validation said no, or already-matching). */
  skippedCount: number;
  /**
   * One per selected JO. Always populated — the dialog renders a
   * row-level result so the operator can see which pushes landed
   * and which short-circuited.
   */
  perJobOrder: Array<{
    jobOrderId: string;
    outcome: PushOneOutcome['kind'];
    skipReason?: IneligibilityReason | 'preview_excluded' | 'no_change' | 'status_changed';
    oldValue?: unknown;
  }>;
  durationMs: number;
}

export async function runPushToActivePage(args: RunPushArgs): Promise<PushPageReport> {
  const { validated, triggeredBy, fdb } = args;
  const start = Date.now();
  const { tenantId, accountId, fieldKey, positionId, newValue, selectedJoIds, reason } =
    validated;

  // Server-side preview re-run gates which `selectedJoIds` are
  // actually written. A client could submit stale or made-up IDs;
  // we never trust that list directly.
  const preview = await runPreviewPushToActive({ validated, fdb });
  const previewById = new Map(
    preview.affectedJobOrders.map((row) => [row.jobOrderId, row] as const),
  );

  const perJobOrder: PushPageReport['perJobOrder'] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const joId of selectedJoIds) {
    const previewRow = previewById.get(joId);
    if (!previewRow) {
      // JO isn't under this account at all (or status filter
      // dropped it). Refuse to write.
      perJobOrder.push({
        jobOrderId: joId,
        outcome: 'skipped_not_eligible',
        skipReason: 'preview_excluded',
      });
      skippedCount += 1;
      continue;
    }
    if (!previewRow.wouldChange) {
      // Already-matching or ineligible per the live preview. Skip
      // without a write or a per-JO audit row.
      perJobOrder.push({
        jobOrderId: joId,
        outcome: previewRow.ineligibleReason
          ? 'skipped_not_eligible'
          : 'skipped_no_change',
        skipReason: previewRow.ineligibleReason ?? 'no_change',
      });
      skippedCount += 1;
      continue;
    }

    let outcome: PushOneOutcome;
    try {
      outcome = await writePushToActiveOne({
        tenantId,
        jobOrderId: joId,
        fieldKey,
        positionId,
        newValue,
        fdb,
      });
    } catch (err) {
      logger.error('[R.16.1][pushToActive] writePushToActiveOne failed', {
        tenantId,
        jobOrderId: joId,
        err: err instanceof Error ? err.message : String(err),
      });
      perJobOrder.push({
        jobOrderId: joId,
        outcome: 'skipped_status_changed',
        skipReason: 'status_changed',
      });
      skippedCount += 1;
      continue;
    }

    if (outcome.kind === 'pushed') {
      updatedCount += 1;
      perJobOrder.push({
        jobOrderId: joId,
        outcome: 'pushed',
        oldValue: outcome.oldValue,
      });

      await writeCascadeAuditEntry(
        {
          action: 'push_to_active',
          tenantId,
          jobOrderId: joId,
          triggeredBy,
          accountId,
          pushedField: { fieldKey, positionId, value: newValue },
          oldValue: outcome.oldValue,
          newValue,
          reason,
        },
        fdb,
      );
    } else {
      skippedCount += 1;
      perJobOrder.push({
        jobOrderId: joId,
        outcome: outcome.kind,
        skipReason:
          outcome.kind === 'skipped_not_eligible'
            ? outcome.reason
            : outcome.kind === 'skipped_no_change'
            ? 'no_change'
            : 'status_changed',
      });
    }
  }

  // Summary row — emitted regardless of how many JOs landed so the
  // forensic record is always present. Per L10 this is the
  // operator-friendly "what happened in this push" entry.
  await writeCascadeAuditEntry(
    {
      action: 'push_to_active_summary',
      tenantId,
      triggeredBy,
      accountId,
      pushedField: { fieldKey, positionId, value: newValue },
      newValue,
      reason,
      affectedJoIds: selectedJoIds,
      updatedCount,
      skippedCount,
    },
    fdb,
  );

  return {
    tenantId,
    accountId,
    fieldKey,
    positionId,
    newValue,
    reason,
    updatedCount,
    skippedCount,
    perJobOrder,
    durationMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auth helpers — same shape as the backfill callable.
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
  const tenantSettings = (user.tenantIds as Record<string, unknown> | undefined)?.[
    activeTenantId
  ] as Record<string, unknown> | undefined;
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }
  return normalizeSecurityLevel(user.securityLevel);
}

async function gatePushCallable(
  request: { auth?: { uid?: string } | null },
  tenantId: string,
): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User record not found.');
  }
  const callerUser = userSnap.data() ?? {};
  const callerLevel = getSecurityLevelForActiveTenant(callerUser);
  const callerActiveTenantId =
    typeof callerUser.activeTenantId === 'string' ? callerUser.activeTenantId : null;
  if (callerActiveTenantId !== tenantId || callerLevel < 7) {
    throw new HttpsError(
      'permission-denied',
      'Insufficient permissions. Push-to-Active requires security level 7 on the requested tenant.',
    );
  }
  return uid;
}

// ─────────────────────────────────────────────────────────────────────
// Callables.
// ─────────────────────────────────────────────────────────────────────

export const previewPushToActiveCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 4,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (request): Promise<PreviewPushReport> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    await gatePushCallable(request, tenantId);

    let validated: ValidatedPushArgs;
    try {
      validated = validatePushArgs({
        tenantId,
        accountId: data.accountId,
        fieldKey: data.fieldKey,
        positionId: data.positionId,
        newValue: data.newValue,
        isWrite: false,
      });
    } catch (e) {
      throw new HttpsError(
        'invalid-argument',
        e instanceof Error ? e.message : String(e),
      );
    }

    const fdb = admin.firestore();
    const report = await runPreviewPushToActive({ validated, fdb });
    logger.info('[R.16.1][previewPushToActive] complete', {
      tenantId,
      accountId: validated.accountId,
      fieldKey: validated.fieldKey,
      positionId: validated.positionId,
      totals: report.totals,
    });
    return report;
  },
);

export const pushToActiveJobOrdersCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 2,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<PushPageReport> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    const uid = await gatePushCallable(request, tenantId);

    let validated: ValidatedPushArgs;
    try {
      validated = validatePushArgs({
        tenantId,
        accountId: data.accountId,
        fieldKey: data.fieldKey,
        positionId: data.positionId,
        newValue: data.newValue,
        selectedJoIds: data.selectedJoIds,
        reason: data.reason,
        isWrite: true,
      });
    } catch (e) {
      throw new HttpsError(
        'invalid-argument',
        e instanceof Error ? e.message : String(e),
      );
    }

    const fdb = admin.firestore();
    const report = await runPushToActivePage({
      validated,
      triggeredBy: uid,
      fdb,
    });
    logger.info('[R.16.1][pushToActiveJobOrders] complete', {
      tenantId,
      accountId: validated.accountId,
      fieldKey: validated.fieldKey,
      positionId: validated.positionId,
      selectedCount: validated.selectedJoIds.length,
      updatedCount: report.updatedCount,
      skippedCount: report.skippedCount,
      durationMs: report.durationMs,
      callerUid: uid,
    });
    return report;
  },
);
