/**
 * R.1 — Admin-callable backfill for `tenants/{tid}/assignmentReadinessItems`.
 *
 * Stamps the new R.1 fields onto pre-existing readiness items:
 *
 *   1. `severity` (required by the schema as of R.1) — derived from
 *      `DEFAULT_REQUIREMENT_SEVERITY[requirementType]`. The audit script
 *      (`scripts/auditAssignmentReadinessStatuses.js`) surfaces conflicts
 *      where the existing `blocking` flag disagrees with this default; this
 *      callable does **not** rewrite `blocking` (D5.R1) — historical
 *      consistency wins, and the audit report is the operator's signal that
 *      a separate ticket is needed.
 *
 *   2. `resolutionMethod` — derived per the locked priority chain (D6.R1):
 *
 *        external > CSA history > auto inference > null
 *
 *      Concretely:
 *        - `requirementType ∈ {background_check, drug_screen, e_verify,
 *           screening_package_match}` → `'external'`
 *        - `requirementType ∈ {education_match, language_match, skill_match,
 *           license_match, cert_match}` → `'auto'` (these are the Phase B
 *           matcher pathways)
 *        - Everything else (`shift_confirmation`, `ppe_acknowledgement`,
 *           `safety_briefing`, `orientation`, `custom`,
 *           `required_certification`) → leave unset (R.2 wires
 *           `'self_attest'` for willingness items; R.3 generalises CSA)
 *
 * Idempotency: an item that already has `severity` and `resolutionMethod` set
 * is skipped entirely. An item with one but not the other gets only the
 * missing field stamped. Re-running the callable on a completed tenant is a
 * no-op.
 *
 * Dry-run is the default. Set `dryRun: false` to actually write.
 *
 * Pagination uses doc-id cursor identical to R.0c
 * (`backfillWorkerAttestationsCallable`). Default `limit: 1000`, max `5000`.
 *
 * Ops note (per Greg, 2026-04-26): this callable ships deployable but should
 * **not** run with `dryRun: false` in production until the dry-run report is
 * signed off. Match the same safety pattern as R.0c.
 *
 * See: docs/READINESS_R1_R2_HANDOFF.md (PR 1)
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  DEFAULT_REQUIREMENT_SEVERITY,
} from './shared/seedAssignmentReadinessItems';
import type {
  AssignmentReadinessRequirementType,
  AssignmentReadinessResolutionMethod,
  AssignmentReadinessSeverity,
} from './shared/assignmentReadinessItemV1';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

interface BackfillRequest {
  tenantId?: string;
  dryRun?: boolean;
  limit?: number;
  /** Doc-id cursor from a previous response's `nextPageToken`. */
  pageToken?: string | null;
}

interface BackfillReport {
  tenantId: string;
  dryRun: boolean;
  limit: number;
  scanned: number;
  candidates: number;
  written: number;
  wouldWrite: number;
  skipped_already_complete: number;
  skipped_unknown_type: number;
  stampedSeverity: number;
  stampedResolutionMethod: number;
  resolutionMethodBreakdown: {
    auto: number;
    external: number;
    leftUnset: number;
  };
  errors: Array<{ itemId: string; error: string }>;
  truncated: boolean;
  nextPageToken: string | null;
}

const EXTERNAL_TYPES = new Set<AssignmentReadinessRequirementType>([
  'background_check',
  'drug_screen',
  'e_verify',
  'screening_package_match',
]);

const AUTO_TYPES = new Set<AssignmentReadinessRequirementType>([
  'education_match',
  'language_match',
  'skill_match',
  'license_match',
  'cert_match',
]);

/**
 * Apply the D6.R1 priority chain. Returns `null` for types that R.1 doesn't
 * own (R.2 / R.3 will fill these in via `'self_attest'` / `'csa_confirmed'`).
 *
 * The "CSA history" tier from D6.R1 is currently a no-op: as of R.1 there is
 * no CSA manual-mark surface for `assignmentReadinessItems` (Q-R1-3). When R.3
 * adds it, this function should grow a check against an audit / actor field
 * before the auto-inference step.
 */
function deriveResolutionMethod(
  requirementType: AssignmentReadinessRequirementType,
): AssignmentReadinessResolutionMethod | null {
  if (EXTERNAL_TYPES.has(requirementType)) return 'external';
  if (AUTO_TYPES.has(requirementType)) return 'auto';
  return null;
}

function deriveSeverity(
  requirementType: AssignmentReadinessRequirementType,
): AssignmentReadinessSeverity | null {
  if (requirementType === 'custom') {
    // Custom items can't have a default severity (D3.R1 explicitly excludes
    // them from the table). Operator must edit these by hand if any exist.
    return null;
  }
  // `required_certification` is in the deprecated bucket; it has no entry in
  // DEFAULT_REQUIREMENT_SEVERITY. Treat as unknown so the audit catches it.
  const severity = (DEFAULT_REQUIREMENT_SEVERITY as Record<string, AssignmentReadinessSeverity>)[
    requirementType
  ];
  return severity ?? null;
}

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

interface ProcessOutcome {
  outcome:
    | 'skipped_already_complete'
    | 'skipped_unknown_type'
    | 'wrote'
    | 'would_write';
  stampedSeverity: boolean;
  stampedResolutionMethod: boolean;
  derivedResolutionMethod: AssignmentReadinessResolutionMethod | null;
}

async function processOneItem(args: {
  tenantId: string;
  itemRef: FirebaseFirestore.DocumentReference;
  itemData: Record<string, unknown>;
  dryRun: boolean;
}): Promise<ProcessOutcome> {
  const { itemData } = args;
  const requirementType = itemData.requirementType as
    | AssignmentReadinessRequirementType
    | undefined;

  if (!requirementType || typeof requirementType !== 'string') {
    return {
      outcome: 'skipped_unknown_type',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  const hasSeverity = itemData.severity === 'hard' || itemData.severity === 'soft';
  const hasResolutionMethod = 'resolutionMethod' in itemData;

  // Idempotency: nothing to do.
  if (hasSeverity && hasResolutionMethod) {
    return {
      outcome: 'skipped_already_complete',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  const patch: Record<string, unknown> = {};

  let stampedSeverity = false;
  if (!hasSeverity) {
    const severity = deriveSeverity(requirementType);
    if (severity) {
      patch.severity = severity;
      stampedSeverity = true;
    }
    // If we couldn't derive (custom / required_certification), leave it
    // unset; the audit report already lists these as `missingSeverity`.
  }

  let stampedResolutionMethod = false;
  let derivedResolutionMethod: AssignmentReadinessResolutionMethod | null = null;
  if (!hasResolutionMethod) {
    derivedResolutionMethod = deriveResolutionMethod(requirementType);
    if (derivedResolutionMethod !== null) {
      patch.resolutionMethod = derivedResolutionMethod;
      stampedResolutionMethod = true;
    }
    // If the chain resolves to null (R.2/R.3 territory), leave the field
    // missing rather than writing `null` explicitly. The schema treats
    // missing and explicit-null identically (both fall back to the chip
    // aggregator's default), and leaving it missing makes the doc cheaper
    // for follow-up backfills (R.2/R.3) to detect.
  }

  if (Object.keys(patch).length === 0) {
    // We had something missing but couldn't derive it → record as already-
    // complete from this callable's perspective (audit catches the residue).
    return {
      outcome: 'skipped_already_complete',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  // Bookkeeping: R.1 stamp ⇒ also bump `updatedAt` so downstream consumers
  // (UI, future change-feeds) see the touch. We don't update `actor` because
  // this isn't a user-driven status change — only a metadata fill-in.
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  if (!args.dryRun) {
    await args.itemRef.set(patch, { merge: true });
    return {
      outcome: 'wrote',
      stampedSeverity,
      stampedResolutionMethod,
      derivedResolutionMethod,
    };
  }
  return {
    outcome: 'would_write',
    stampedSeverity,
    stampedResolutionMethod,
    derivedResolutionMethod,
  };
}

export const backfillAssignmentReadinessItemsCallable = onCall(
  {
    cors: true,
    invoker: 'public',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request): Promise<BackfillReport> => {
    const requestData = (request.data ?? {}) as BackfillRequest;
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

    const tenantId = String(requestData.tenantId ?? '').trim();
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const dryRun = requestData.dryRun !== false; // default TRUE
    const requestedLimit = Number(requestData.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const pageToken =
      typeof requestData.pageToken === 'string' && requestData.pageToken.trim().length > 0
        ? requestData.pageToken.trim()
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

    // R.1 mirrors the R.0c gate exactly: HRX-staff (security level 7) on the
    // requested tenant. Backfill writes ride directly on production data, so
    // we use the strictest existing convention.
    if (callerActiveTenantId !== tenantId || callerSecurityLevel < 7) {
      throw new HttpsError(
        'permission-denied',
        'Insufficient permissions. Backfill requires security level 7 on the requested tenant.',
      );
    }

    let itemsQuery = db
      .collection(`tenants/${tenantId}/assignmentReadinessItems`)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
    if (pageToken) {
      itemsQuery = itemsQuery.startAfter(pageToken);
    }

    const items = await itemsQuery.get();

    const report: BackfillReport = {
      tenantId,
      dryRun,
      limit,
      scanned: items.size,
      candidates: 0,
      written: 0,
      wouldWrite: 0,
      skipped_already_complete: 0,
      skipped_unknown_type: 0,
      stampedSeverity: 0,
      stampedResolutionMethod: 0,
      resolutionMethodBreakdown: { auto: 0, external: 0, leftUnset: 0 },
      errors: [],
      truncated: items.size === limit,
      nextPageToken: items.size === limit ? items.docs[items.docs.length - 1].id : null,
    };

    for (let i = 0; i < items.docs.length; i += WRITE_CONCURRENCY) {
      const chunk = items.docs.slice(i, i + WRITE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (itemDoc) => {
          try {
            const result = await processOneItem({
              tenantId,
              itemRef: itemDoc.ref,
              itemData: itemDoc.data() ?? {},
              dryRun,
            });
            return { ok: true as const, itemId: itemDoc.id, result };
          } catch (e) {
            return {
              ok: false as const,
              itemId: itemDoc.id,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );

      for (const item of results) {
        if (!item.ok) {
          report.errors.push({ itemId: item.itemId, error: item.error });
          continue;
        }
        const {
          outcome,
          stampedSeverity,
          stampedResolutionMethod,
          derivedResolutionMethod,
        } = item.result;
        switch (outcome) {
          case 'skipped_already_complete':
            report.skipped_already_complete += 1;
            break;
          case 'skipped_unknown_type':
            report.skipped_unknown_type += 1;
            break;
          case 'wrote':
            report.candidates += 1;
            report.written += 1;
            if (stampedSeverity) report.stampedSeverity += 1;
            if (stampedResolutionMethod) {
              report.stampedResolutionMethod += 1;
              if (derivedResolutionMethod === 'auto') {
                report.resolutionMethodBreakdown.auto += 1;
              } else if (derivedResolutionMethod === 'external') {
                report.resolutionMethodBreakdown.external += 1;
              }
            } else {
              report.resolutionMethodBreakdown.leftUnset += 1;
            }
            break;
          case 'would_write':
            report.candidates += 1;
            report.wouldWrite += 1;
            if (stampedSeverity) report.stampedSeverity += 1;
            if (stampedResolutionMethod) {
              report.stampedResolutionMethod += 1;
              if (derivedResolutionMethod === 'auto') {
                report.resolutionMethodBreakdown.auto += 1;
              } else if (derivedResolutionMethod === 'external') {
                report.resolutionMethodBreakdown.external += 1;
              }
            } else {
              report.resolutionMethodBreakdown.leftUnset += 1;
            }
            break;
        }
      }
    }

    logger.info('[R.1][backfillAssignmentReadinessItemsCallable] complete', {
      tenantId,
      dryRun,
      limit,
      scanned: report.scanned,
      candidates: report.candidates,
      written: report.written,
      wouldWrite: report.wouldWrite,
      stampedSeverity: report.stampedSeverity,
      stampedResolutionMethod: report.stampedResolutionMethod,
      resolutionMethodBreakdown: report.resolutionMethodBreakdown,
      skipped_already_complete: report.skipped_already_complete,
      skipped_unknown_type: report.skipped_unknown_type,
      errorCount: report.errors.length,
      truncated: report.truncated,
      nextPageToken: report.nextPageToken,
      callerUid: uid,
    });

    return report;
  },
);
