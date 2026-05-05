/**
 * **Cascade-compliance backfill for already-spawned auto-Gig JOs.**
 *
 * Companion to the going-forward fix in
 * `gigJobOrderFromChildAccount.ts`. Pre-2026-05-05 auto-JOs were created
 * without:
 *
 *   - Account-level Compliance Defaults (`physicalRequirements`,
 *     `skillsRequired`, `licensesCerts`, `languagesRequired`,
 *     `educationRequired`, `experienceRequired`, `ppeRequirements`,
 *     `dressCode`, `customUniformRequirements`, `requirementPackId`).
 *   - File uploads (`attachments.files`).
 *   - The widened-fallback-chain `jobDescription` (which previously only
 *     read `parentAccount.defaultGigJobDescription` and
 *     `defaultPosition.jobDescription`).
 *   - The `jo.snapshot.{...}` envelope that snapshot-aware readers
 *     (`getEffectiveJobOrderField`) expect.
 *
 * **Idempotent + non-destructive** — for every auto-JO it looks at:
 *   - "Empty" fields on the JO get filled with the cascade-resolved
 *     value. Definition of "empty": missing key OR value is `''` /
 *     `[]` / `{ files: [] }` / `null`. Recruiter-edited values (any
 *     non-empty string / non-empty array) are NEVER overwritten unless
 *     `force: true` is passed.
 *   - The snapshot envelope is re-resolved and written when missing
 *     (`jo.snapshot.capturedAt` undefined) or when `force: true`. We
 *     don't recompute the audit log; the per-JO `audit[]` returned by
 *     this callable is the trace.
 *
 * **Scope cases** (in priority order, only one applies):
 *   - `jobOrderId` set → patch exactly that JO (debugging path).
 *   - `nationalAccountId` set → walk auto-JOs whose `recruiterAccountId`
 *     is a child of that National.
 *   - Otherwise → scan every auto-JO in the tenant
 *     (`autoCreatedFrom == 'autoCreateGigJobOrders'`).
 *
 * **Permissioning** mirrors `backfillAutoUserGroupAttachments`: HRX
 * staff OR a Recruiter / Manager / Admin scoped to the tenant.
 *
 * Output `summary` counters + per-JO `audit` list (clamped at 500
 * entries to keep the callable response under the Cloud Functions 10MB
 * cap).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  AUTO_CREATED_FROM_MARKER,
  buildGigJobOrderFromChildAccount,
  loadWorksiteFromChildLocation,
  resolveGigJobOrderCascade,
  stripUndefined,
  type AccountDoc,
} from './gigJobOrderFromChildAccount';
import {
  createLoaderContext,
} from '../shared/cascade/loaders';
import { resolveSnapshotEnvelope } from './onJobOrderStatusTransitionSnapshot';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system_auto_gig_jo_compliance_backfill';
const MAX_AUDIT_ENTRIES = 500;

// ─────────────────────────────────────────────────────────────────────
// Permission helper — mirrors `backfillAutoUserGroupAttachments`. We
// duplicate rather than import because keeping these tiny and inline
// has been the pattern across the AG.0 / AG.1 callables, and avoids
// accidental coupling to other callables' permission policies.
// ─────────────────────────────────────────────────────────────────────

interface AuthContext {
  uid: string;
  token: Record<string, unknown>;
}

function assertTenantStaff(auth: AuthContext | undefined, tenantId: string): void {
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (auth.token.hrx === true) return;
  const roles = auth.token.roles as Record<string, { role?: string }> | undefined;
  const role = roles?.[tenantId]?.role;
  if (role && ['Recruiter', 'Manager', 'Admin'].includes(role)) return;
  throw new HttpsError(
    'permission-denied',
    'Recruiter or Manager access required for this tenant',
  );
}

// ─────────────────────────────────────────────────────────────────────
// "Empty for backfill purposes" predicate. Centralised so future fields
// added to the patch list inherit the same definition.
// ─────────────────────────────────────────────────────────────────────

/**
 * Treat a field as eligible for backfill when it's:
 *   - missing entirely (undefined / not in the doc),
 *   - explicitly null,
 *   - the empty string,
 *   - the empty array,
 *   - the empty object `{}`,
 *   - the `attachments` shape `{ files: [] }` (auto-JO default we wrote
 *     pre-fix when the cascade had no files; recruiter never typed
 *     anything here).
 *
 * Anything else — a populated array, a non-empty string, an object with
 * keys other than an empty `files` — is treated as recruiter-edited
 * content and left alone (unless `force` is true).
 */
export function isFieldEmptyForBackfill(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return true;
    if (keys.length === 1 && keys[0] === 'files') {
      const files = (value as { files?: unknown }).files;
      return Array.isArray(files) && files.length === 0;
    }
    return false;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────

export type BackfillCascadeAuditAction =
  | 'patched'
  | 'snapshot_only'
  | 'skipped_already_complete'
  | 'skipped_no_parent'
  | 'skipped_not_auto_created'
  | 'failed';

export interface BackfillCascadeAuditEntry {
  jobOrderId: string;
  jobOrderNumber?: string;
  recruiterAccountId?: string;
  action: BackfillCascadeAuditAction;
  /** Top-level field keys patched onto the JO (excludes `snapshot`). */
  fieldsPatched?: string[];
  /** True when `jo.snapshot` was (re-)written this pass. */
  snapshotWritten?: boolean;
  reason?: string;
}

export interface BackfillAutoGigJobOrderComplianceResult {
  summary: {
    scanned: number;
    patched: number;
    snapshotOnly: number;
    alreadyComplete: number;
    skippedNoParent: number;
    skippedNotAuto: number;
    failed: number;
  };
  /** Per-JO outcomes. Clamped at 500 — older entries dropped first. */
  audit: BackfillCascadeAuditEntry[];
}

// ─────────────────────────────────────────────────────────────────────
// Per-JO patch builder — pure(ish): the only IO is the cascade resolve
// + parent/child loads which are passed as args, plus the snapshot
// envelope resolve. Returns the patch + which fields we touched.
// ─────────────────────────────────────────────────────────────────────

/**
 * Field keys on the JO doc that this backfill is allowed to write.
 * Aligned with the new fan-out in `buildGigJobOrderFromChildAccount`
 * (2026-05-05). `snapshot` is handled separately because it's an
 * envelope merge, not a flat field replace.
 */
export const BACKFILL_TARGET_FIELDS: readonly string[] = [
  // Compliance arrays (RecruiterOrderDetailsData)
  'physicalRequirements',
  'skillsRequired',
  'licensesCerts',
  'requiredCertifications',
  'languagesRequired',
  'ppeRequirements',
  'ppeProvidedBy',
  'dressCode',
  // Compliance scalars
  'educationRequired',
  'experienceRequired',
  'customUniformRequirements',
  'requirementPackId',
  // File uploads (cascade `attachments` field)
  'attachments',
  // Job description — widened fallback chain in 2026-05-05.
  // CC.B (2026-05-05 PM): cascade-resolved description writes to
  // `jobDescriptionFromClient` (the prompt input). Auto-create now leaves
  // `jobDescription` (the AI-generated public-facing copy) empty, but we
  // keep it in the target list so an auto-JO that already has '' for
  // `jobDescription` is a no-op and one with stale content gets skipped
  // by the `isFieldEmptyForBackfill` guard (recruiter content preserved).
  'jobDescription',
  'jobDescriptionFromClient',
] as const;

/**
 * Build the targeted update patch for one JO.
 *
 * Pure-ish: the IO of resolving the cascade chain + snapshot envelope
 * happens here, but the diff logic against the existing JO doc is
 * straightforward. Tests can inject a fake Firestore via the `db` arg.
 */
export async function computeBackfillPatchForJo(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  jobOrderId: string;
  jobOrderData: Record<string, unknown>;
  childAccount: AccountDoc;
  parentAccount: AccountDoc;
  /** When true, overwrite even non-empty recruiter-edited values. */
  force: boolean;
}): Promise<{
  patch: Record<string, unknown>;
  fieldsPatched: string[];
  snapshotWritten: boolean;
}> {
  const { db, tenantId, jobOrderId, jobOrderData, childAccount, parentAccount, force } =
    args;

  // Re-resolve the cascade against today's parent/child doc state.
  const cascade = await resolveGigJobOrderCascade({
    db,
    tenantId,
    childAccountId: jobOrderId, // ignored — not used for child doc lookup at this layer
    childAccount,
    parentAccount,
  });

  // Hydrate the worksite so the pure builder can produce the correct
  // `worksiteAddress` shape even though we won't write that field
  // (recruiters might have edited it). The worksite doesn't gate any of
  // the compliance fields we backfill.
  const worksite = await loadWorksiteFromChildLocation(db, tenantId, childAccount);

  // Run the same pure builder the auto-create trigger uses to produce
  // the "what should this JO look like today" reference shape.
  const childAccountIdForBuild =
    typeof jobOrderData.recruiterAccountId === 'string' &&
    jobOrderData.recruiterAccountId.trim()
      ? (jobOrderData.recruiterAccountId as string).trim()
      : 'unknown_child';
  const { jobOrderData: desired } = buildGigJobOrderFromChildAccount({
    tenantId,
    childAccount: { ...childAccount, id: childAccountIdForBuild } as AccountDoc & {
      id: string;
    },
    parentAccount: {
      ...parentAccount,
      id:
        typeof jobOrderData.parentAccountId === 'string'
          ? (jobOrderData.parentAccountId as string).trim()
          : '',
    } as AccountDoc & { id: string },
    cascade,
    worksite,
    jobOrderSeq:
      typeof jobOrderData.jobOrderSeq === 'number' ? jobOrderData.jobOrderSeq : 0,
    jobOrderNumber:
      typeof jobOrderData.jobOrderNumber === 'string' ? jobOrderData.jobOrderNumber : '',
    source: 'backfill',
  });

  // Diff against the existing JO. Only patch fields whose existing
  // value is "empty for backfill purposes" (or always when `force`).
  const patch: Record<string, unknown> = {};
  const fieldsPatched: string[] = [];
  for (const key of BACKFILL_TARGET_FIELDS) {
    const desiredValue = (desired as Record<string, unknown>)[key];
    if (desiredValue === undefined) continue;
    if (!force && !isFieldEmptyForBackfill(jobOrderData[key])) continue;
    patch[key] = desiredValue;
    fieldsPatched.push(key);
  }

  // Re-stamp the snapshot envelope when missing (or always under `force`).
  // Construct a "post-patch" preloaded view so cascade chain extraction
  // sees the same shape the live JO will have after the patch lands.
  let snapshotWritten = false;
  const existingSnapshot = jobOrderData.snapshot as
    | { capturedAt?: unknown }
    | undefined;
  const snapshotMissing =
    !existingSnapshot ||
    typeof existingSnapshot !== 'object' ||
    existingSnapshot.capturedAt === undefined;
  if (snapshotMissing || force) {
    try {
      const merged: Record<string, unknown> = { ...jobOrderData, ...patch };
      const loaderCtx = createLoaderContext({ db });
      const { envelope } = await resolveSnapshotEnvelope({
        tenantId,
        jobOrderId,
        preloadedJoData: merged,
        loaderCtx,
      });
      patch.snapshot = stripUndefined({
        ...envelope,
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
        capturedBy: 'compliance_backfill',
        lastPushedAt: null,
      });
      snapshotWritten = true;
    } catch (err) {
      // Don't throw — snapshot stamp is non-fatal. The flat field
      // patch (if any) still goes through. The audit row reflects
      // `snapshotWritten: false` so an operator can see what got skipped.
      logger.warn('backfillAutoGigJobOrderCompliance: snapshot_resolve_failed', {
        tenantId,
        jobOrderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { patch, fieldsPatched, snapshotWritten };
}

// ─────────────────────────────────────────────────────────────────────
// Core orchestrator — split out so tests can inject a fake Firestore.
// ─────────────────────────────────────────────────────────────────────

export async function runBackfillAutoGigJobOrderCompliance(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  /** Single-JO debugging path. Beats `nationalAccountId` when set. */
  jobOrderId?: string | null;
  /** When set, scope to JOs under children of this National. */
  nationalAccountId?: string | null;
  /** Don't write — only audit what would change. */
  dryRun?: boolean;
  /** Overwrite recruiter-edited values too. Use sparingly. */
  force?: boolean;
}): Promise<BackfillAutoGigJobOrderComplianceResult> {
  const { db, tenantId } = args;
  const dryRun = args.dryRun === true;
  const force = args.force === true;
  const explicitJobOrderId = (args.jobOrderId || '').trim() || null;
  const nationalAccountId = explicitJobOrderId
    ? null
    : (args.nationalAccountId || '').trim() || null;

  // Resolve the candidate JO id list.
  let candidateDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  if (explicitJobOrderId) {
    const single = await db
      .doc(`tenants/${tenantId}/job_orders/${explicitJobOrderId}`)
      .get();
    if (!single.exists) {
      throw new HttpsError('not-found', 'Job order not found');
    }
    candidateDocs = [single as admin.firestore.QueryDocumentSnapshot];
  } else {
    const baseQuery = db
      .collection(`tenants/${tenantId}/job_orders`)
      .where('autoCreatedFrom', '==', AUTO_CREATED_FROM_MARKER);
    const allAuto = await baseQuery.get();
    candidateDocs = allAuto.docs;
  }

  // Optional in-process scope filter — Firestore can't `where('parentAccountId',...)`
  // through a JO doc, so we filter against children of the National.
  let childAccountIdFilter: Set<string> | null = null;
  if (nationalAccountId) {
    const parentSnap = await db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`).get();
    if (!parentSnap.exists) {
      throw new HttpsError('not-found', 'National account not found');
    }
    if (parentSnap.data()?.accountType !== 'national') {
      throw new HttpsError('failed-precondition', 'Account must be a National Account');
    }
    const childrenSnap = await db
      .collection(`tenants/${tenantId}/accounts`)
      .where('parentAccountId', '==', nationalAccountId)
      .get();
    childAccountIdFilter = new Set(childrenSnap.docs.map((d) => d.id));
  }

  const result: BackfillAutoGigJobOrderComplianceResult = {
    summary: {
      scanned: 0,
      patched: 0,
      snapshotOnly: 0,
      alreadyComplete: 0,
      skippedNoParent: 0,
      skippedNotAuto: 0,
      failed: 0,
    },
    audit: [],
  };
  const pushAudit = (entry: BackfillCascadeAuditEntry): void => {
    result.audit.push(entry);
    if (result.audit.length > MAX_AUDIT_ENTRIES) result.audit.shift();
  };

  // Per-pass account doc cache keyed by `${childId}|${parentId ?? ''}` so a
  // 50-JO tenant under one National makes two account reads, not 100.
  const childAccountCache = new Map<string, AccountDoc | null>();
  const parentAccountCache = new Map<string, AccountDoc | null>();

  const loadAccountCached = async (
    cache: Map<string, AccountDoc | null>,
    accountId: string,
  ): Promise<AccountDoc | null> => {
    if (cache.has(accountId)) return cache.get(accountId) ?? null;
    const snap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
    const data = snap.exists ? ((snap.data() ?? null) as AccountDoc | null) : null;
    cache.set(accountId, data);
    return data;
  };

  for (const jobOrderDoc of candidateDocs) {
    const jobOrderId = jobOrderDoc.id;
    const data = jobOrderDoc.data() as Record<string, unknown>;
    const jobOrderNumber =
      typeof data.jobOrderNumber === 'string' ? data.jobOrderNumber : undefined;

    // Single-JO mode skips the auto-marker check (operator may be
    // patching a manually-created JO that nonetheless inherits cascade).
    // National-scoped + tenant-wide modes trust the marker query, but
    // still re-assert the child filter here.
    if (!explicitJobOrderId) {
      // Already filtered by `where('autoCreatedFrom', '==', ...)` — no
      // re-check needed.
    } else if (data.autoCreatedFrom !== AUTO_CREATED_FROM_MARKER) {
      result.summary.skippedNotAuto += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        action: 'skipped_not_auto_created',
        reason: `autoCreatedFrom=${String(data.autoCreatedFrom)}`,
      });
      continue;
    }

    const recruiterAccountId =
      typeof data.recruiterAccountId === 'string' ? data.recruiterAccountId.trim() : '';
    if (childAccountIdFilter && (!recruiterAccountId || !childAccountIdFilter.has(recruiterAccountId))) {
      continue;
    }

    result.summary.scanned += 1;

    if (!recruiterAccountId) {
      result.summary.skippedNoParent += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        action: 'skipped_no_parent',
        reason: 'recruiterAccountId missing',
      });
      continue;
    }

    const parentAccountId =
      typeof data.parentAccountId === 'string' ? data.parentAccountId.trim() : '';

    let childAccount: AccountDoc | null;
    let parentAccount: AccountDoc | null;
    try {
      childAccount = await loadAccountCached(childAccountCache, recruiterAccountId);
      parentAccount = parentAccountId
        ? await loadAccountCached(parentAccountCache, parentAccountId)
        : null;
    } catch (err) {
      result.summary.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('backfillAutoGigJobOrderCompliance: account_load_failed', {
        tenantId,
        jobOrderId,
        recruiterAccountId,
        parentAccountId,
        error: reason,
      });
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'failed',
        reason: `account_load_failed: ${reason}`,
      });
      continue;
    }

    if (!childAccount) {
      result.summary.skippedNoParent += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'skipped_no_parent',
        reason: 'child account doc missing',
      });
      continue;
    }
    // `parentAccount` may legitimately be `null` for stand-alone children.
    // The pure builder + cascade resolver tolerate that — pass an empty
    // doc rather than refusing to backfill.
    const effectiveParent: AccountDoc = parentAccount ?? {};

    let computed: Awaited<ReturnType<typeof computeBackfillPatchForJo>>;
    try {
      computed = await computeBackfillPatchForJo({
        db,
        tenantId,
        jobOrderId,
        jobOrderData: data,
        childAccount,
        parentAccount: effectiveParent,
        force,
      });
    } catch (err) {
      result.summary.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('backfillAutoGigJobOrderCompliance: compute_failed', {
        tenantId,
        jobOrderId,
        recruiterAccountId,
        error: reason,
      });
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'failed',
        reason: `compute_failed: ${reason}`,
      });
      continue;
    }

    const { patch, fieldsPatched, snapshotWritten } = computed;
    const hasFlatPatch = fieldsPatched.length > 0;

    if (!hasFlatPatch && !snapshotWritten) {
      result.summary.alreadyComplete += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'skipped_already_complete',
      });
      continue;
    }

    if (!dryRun) {
      try {
        await jobOrderDoc.ref.set(
          {
            ...patch,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR,
          },
          { merge: true },
        );
      } catch (err) {
        result.summary.failed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('backfillAutoGigJobOrderCompliance: write_failed', {
          tenantId,
          jobOrderId,
          recruiterAccountId,
          error: reason,
        });
        pushAudit({
          jobOrderId,
          jobOrderNumber,
          recruiterAccountId,
          action: 'failed',
          reason: `write_failed: ${reason}`,
        });
        continue;
      }
    }

    if (hasFlatPatch) {
      result.summary.patched += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'patched',
        fieldsPatched,
        snapshotWritten,
      });
    } else {
      result.summary.snapshotOnly += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'snapshot_only',
        snapshotWritten,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Callable entry point
// ─────────────────────────────────────────────────────────────────────

export const backfillAutoGigJobOrderCompliance = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    const data = (request.data || {}) as {
      tenantId?: string;
      nationalAccountId?: string | null;
      jobOrderId?: string | null;
      dryRun?: boolean;
      force?: boolean;
    };
    const tenantId = (data.tenantId || '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    assertTenantStaff(request.auth as AuthContext | undefined, tenantId);

    const db = admin.firestore();
    const result = await runBackfillAutoGigJobOrderCompliance({
      db,
      tenantId,
      nationalAccountId: data.nationalAccountId ?? null,
      jobOrderId: data.jobOrderId ?? null,
      dryRun: data.dryRun === true,
      force: data.force === true,
    });

    logger.info('backfillAutoGigJobOrderCompliance: done', {
      tenantId,
      nationalAccountId: data.nationalAccountId ?? null,
      jobOrderId: data.jobOrderId ?? null,
      dryRun: data.dryRun === true,
      force: data.force === true,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);
