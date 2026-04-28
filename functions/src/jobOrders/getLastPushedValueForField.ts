/**
 * **R.16.3 (interim — "Option B")** — Look up the most recent
 * Push-to-Active history for a single (account, fieldKey, positionId?)
 * tuple so the manual "Sync to active" button can reuse the existing
 * Push-to-Active dialog with `previousValue` pre-populated.
 *
 * Wire shape:
 *   1. The admin clicks the "Sync to active" icon next to a snapshot-
 *      policy field on a Recruiter Account form (e.g. Hiring Entity,
 *      AccuSource Screening Package).
 *   2. The button calls `getLastPushedValueForFieldCallable` to fetch
 *      the value from the last `push_to_active_summary` row for that
 *      account+field. If history exists, that value becomes
 *      `previousValue` for the new push session — meaning the dialog
 *      will only mark a JO as `wouldChange=true` if its snapshot
 *      matches the last pushed value AND differs from the current
 *      parent value (catches stragglers without overwriting child-
 *      level overrides).
 *   3. If no push history exists, the callable returns
 *      `hasHistory: false` and the button opens the dialog with
 *      `previousValue=undefined` (V1 push semantics — operator
 *      reviews and deselects per the R.16.1.1 mitigation pattern).
 *
 * Why "summary" rows specifically:
 *   - The summary row records what the operator actually pushed
 *     (`pushedField.value` / `newValue`), regardless of how many
 *     selected JOs no-op'd on server-side re-validation. That's the
 *     account-wide "what value did we last try to propagate" — the
 *     right thing to use as `previousValue` for the next push.
 *   - Per-JO rows would also work but require more reads and risk
 *     missing the field if the most-recent push had zero matching
 *     JOs (unlikely but defensible).
 *
 * Out of scope (R.16.3 proper):
 *   - Drift detection (three-way classification: in_sync /
 *     stale_value / child_override). The interim button still
 *     surfaces every active JO via the existing dialog; classification
 *     is the operator's job.
 *   - Unified "Audit & Sync" panel.
 *   - Scheduled drift reports.
 *
 * Security: same gate as `pushToActiveJobOrdersCallable` —
 * `securityLevel === 7` on the requested tenant. The manual button
 * is functionally equivalent to a Push-to-Active session, so it
 * shares the audit + permission model.
 *
 * @see docs/CASCADE_R16.3_HANDOFF.md (Path 1 / Option B notes)
 * @see functions/src/jobOrders/pushToActive.ts
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import {
  gatePushCallable,
  isPushPositionField,
  isPushTopLevelField,
  type PushFieldKey,
} from './pushToActive';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * How many recent summary rows to scan when looking for a match for
 * the requested (fieldKey, positionId) pair. The audit-log query
 * filters by `(action, accountId)` only — composite-index-free —
 * then walks results in memory to find the first matching field.
 *
 * 50 is generous: the most active accounts in production push
 * <5 times per field over their lifetime, and per-field pushes
 * are interleaved across many fields, so 50 covers many years of
 * realistic activity. If we ever exceed this in practice, the
 * cleaner answer is to add a composite index on
 * `(accountId, action, pushedField.fieldKey, pushedField.positionId, timestamp)`
 * and query directly — but that's overkill for the interim.
 */
const RECENT_SCAN_LIMIT = 50;

export interface GetLastPushedValueInput {
  tenantId: unknown;
  accountId: unknown;
  fieldKey: unknown;
  positionId?: unknown;
}

export interface ValidatedLookupArgs {
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
}

export interface LastPushedValueResult {
  /**
   * The value pushed in the most recent matching summary row, or
   * `null` when `hasHistory === false`. The button forwards this as
   * `previousValue` to `previewPushToActiveCallable` — `null`
   * specifically because the dialog's `previousValue` prop expects
   * a value of the field's domain shape (`null` is valid for every
   * snapshot-policy field, e.g. clearing a screening package).
   */
  previousValue: unknown;
  /**
   * ISO-8601 timestamp of the most recent matching summary row.
   * Useful for surfacing "Last synced X ago" in the button tooltip.
   * `null` when `hasHistory === false`.
   */
  lastPushedAt: string | null;
  /** True if any matching summary row was found within the scan window. */
  hasHistory: boolean;
}

/**
 * Validate inputs. Mirrors the field-key locking from `validatePushArgs`
 * but without the write-only fields (`selectedJoIds`, `reason`,
 * `newValue`) since this is a pure lookup.
 */
export function validateLookupArgs(input: GetLastPushedValueInput): ValidatedLookupArgs {
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
    throw new Error(`positionId is required when looking up per-position field "${fieldKeyRaw}".`);
  }
  if (isPushTopLevelField(fieldKeyRaw) && positionIdRaw) {
    throw new Error(
      `positionId must be omitted when looking up top-level field "${fieldKeyRaw}".`,
    );
  }

  return {
    tenantId,
    accountId,
    fieldKey: fieldKeyRaw as PushFieldKey,
    positionId: positionIdRaw,
  };
}

/**
 * Pure-ish lookup. Queries `cascadeAuditLog` for the most recent
 * `push_to_active_summary` rows under `accountId`, then walks them
 * in memory to find the first row matching the requested field.
 *
 * Exported for tests + future direct-call use (e.g. an "Audit & Sync"
 * panel that fetches lookups for many fields at once and wants to
 * batch them).
 */
export async function lookupLastPushedValue(args: {
  validated: ValidatedLookupArgs;
  fdb: admin.firestore.Firestore;
}): Promise<LastPushedValueResult> {
  const { tenantId, accountId, fieldKey, positionId } = args.validated;

  const snap = await args.fdb
    .collection(`tenants/${tenantId}/cascadeAuditLog`)
    .where('accountId', '==', accountId)
    .where('action', '==', 'push_to_active_summary')
    .orderBy('timestamp', 'desc')
    .limit(RECENT_SCAN_LIMIT)
    .get();

  if (snap.empty) {
    return { previousValue: null, lastPushedAt: null, hasHistory: false };
  }

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const pushedField = (data.pushedField ?? null) as
      | { fieldKey?: unknown; positionId?: unknown; value?: unknown }
      | null;
    if (!pushedField || typeof pushedField !== 'object') continue;
    if (pushedField.fieldKey !== fieldKey) continue;
    // Normalize so a stored `undefined`/missing positionId compares
    // equal to the caller's `null` (top-level fields).
    const rowPositionId =
      typeof pushedField.positionId === 'string' && pushedField.positionId.trim() !== ''
        ? pushedField.positionId.trim()
        : null;
    if (rowPositionId !== positionId) continue;

    const previousValue =
      'value' in pushedField ? pushedField.value : (data.newValue as unknown);

    const ts = data.timestamp;
    let lastPushedAt: string | null = null;
    if (ts && typeof (ts as { toDate?: unknown }).toDate === 'function') {
      lastPushedAt = (ts as { toDate: () => Date }).toDate().toISOString();
    } else if (ts instanceof Date) {
      lastPushedAt = ts.toISOString();
    }

    return {
      previousValue: previousValue ?? null,
      lastPushedAt,
      hasHistory: true,
    };
  }

  return { previousValue: null, lastPushedAt: null, hasHistory: false };
}

export const getLastPushedValueForFieldCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 4,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request): Promise<LastPushedValueResult> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const tenantId = String(data.tenantId ?? '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }
    await gatePushCallable(request, tenantId);

    let validated: ValidatedLookupArgs;
    try {
      validated = validateLookupArgs({
        tenantId,
        accountId: data.accountId,
        fieldKey: data.fieldKey,
        positionId: data.positionId,
      });
    } catch (e) {
      throw new HttpsError(
        'invalid-argument',
        e instanceof Error ? e.message : String(e),
      );
    }

    const fdb = admin.firestore();
    const result = await lookupLastPushedValue({ validated, fdb });
    logger.info('[R.16.3-interim][getLastPushedValueForField] complete', {
      tenantId,
      accountId: validated.accountId,
      fieldKey: validated.fieldKey,
      positionId: validated.positionId,
      hasHistory: result.hasHistory,
    });
    return result;
  },
);
