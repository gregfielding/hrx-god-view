/**
 * One-shot callable: push cascaded **staff instructions** down onto existing
 * job orders.
 *
 * Why this exists
 * ---------------
 * Staff instructions cascade Account → Child → Location → JO via the registry
 * `merge_deep` strategy, but the JO Staff-Instructions tab reads the JO doc's
 * own top-level `staffInstructions` field directly (it does NOT resolve the
 * cascade at read time). The auto-gig-JO creation path stamps the resolved
 * value at birth (`gigJobOrderFromChildAccount.ts`), so NEW gig JOs inherit it.
 * But JOs created before that fix — or any JO that existed before the account's
 * instructions were filled in — show blank, and editing the account afterwards
 * never reaches them. This callable closes that gap on demand.
 *
 * Semantics — 3-way merge per instruction section (firstDay / parking / …)
 * ------------------------------------------------------------------------
 * Let A = the value resolved from the ACCOUNT CHAIN ONLY (account ⊕ child ⊕
 * location, excluding the JO/shift levels), J = the JO's current section value,
 * and S = the snapshot of A captured the last time we synced this JO
 * (`cascadeStaffInstructionsSnapshot`). For each section key present in A:
 *   - J is blank        → take A           (fill)
 *   - J deep-equals S   → take A           (J still holds the cascaded value, so
 *                                            refresh it to the account's latest)
 *   - otherwise         → keep J           (recruiter hand-edited the JO; never
 *                                            clobber a deliberate override)
 * Sections only present on the JO (manual additions) are always preserved.
 * We only write when the merged result actually differs from J, and re-stamp
 * the snapshot to A on every write so future account edits keep propagating.
 *
 * Scope:
 *   - national account → its own JOs + every child account's JOs
 *   - child / standalone account → just that account's JOs
 *
 * Auth: tenant security level 5+ (same gate as the national cascade sync).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import isEqual from 'lodash/isEqual';

import { gateTenantStaffMinLevel } from './pushToActive';
import { resolveCascadedField } from '../shared/cascade';
import type { AncestorLevel } from '../shared/cascade';
import {
  createLoaderContext,
  loadCascadeChain,
  type LoaderContext,
} from '../shared/cascade/loaders';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

const SYSTEM_ACTOR = 'system_sync_staff_instructions';
const MAX_AUDIT = 500;
const FIRESTORE_IN_CHUNK = 30;

/** JO doc field that holds the last-synced copy of the account-chain value. */
export const CASCADE_SI_SNAPSHOT_FIELD = 'cascadeStaffInstructionsSnapshot';

type SIMap = Record<string, unknown>;

// ---- Pure helpers (unit-testable) ---------------------------------

/** Firestore rejects `undefined`; the cascade engine never emits it, but strip
 *  defensively. `null` is a legal stored value (explicit clear) — keep it. */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Pull the English/admin text out of a section value, tolerating the legacy
 *  shapes the UI also handles (`string`, `{ text }`, `{ text: { en } }`, `{ en }`). */
function sectionText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (o.text && typeof o.text === 'object') {
      const t = o.text as Record<string, unknown>;
      if (typeof t.en === 'string') return t.en;
    }
    if (typeof o.en === 'string') return o.en;
  }
  return '';
}

function sectionFileCount(v: unknown): number {
  if (v && typeof v === 'object') {
    const files = (v as Record<string, unknown>).files;
    if (Array.isArray(files)) return files.length;
  }
  return 0;
}

/** A section carries no instruction text and no attachments. */
function isBlankSection(v: unknown): boolean {
  return sectionText(v).trim() === '' && sectionFileCount(v) === 0;
}

function asMap(v: unknown): SIMap {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as SIMap) : {};
}

export interface MergeResult {
  merged: SIMap;
  changed: boolean;
  filledKeys: string[];
  refreshedKeys: string[];
  preservedKeys: string[];
}

/**
 * 3-way merge of the account-chain value (A) onto the JO's current value (J),
 * using the last-synced snapshot (S) to tell a still-cascaded section apart
 * from a hand-edited override. See the file header for the rules.
 */
export function mergeStaffInstructionsForJo(args: {
  accountResolved: SIMap;
  current: SIMap;
  lastSnapshot: SIMap;
}): MergeResult {
  const { accountResolved: A, current: J, lastSnapshot: S } = args;
  const merged: SIMap = { ...J };
  const filledKeys: string[] = [];
  const refreshedKeys: string[] = [];
  const preservedKeys: string[] = [];

  for (const key of Object.keys(A)) {
    const aVal = A[key];
    const jVal = J[key];
    if (isBlankSection(jVal)) {
      if (!isEqual(jVal, aVal)) {
        merged[key] = aVal;
        filledKeys.push(key);
      }
    } else if (isEqual(jVal, S[key])) {
      // JO still holds exactly what we last cascaded → refresh to A's latest.
      if (!isEqual(jVal, aVal)) {
        merged[key] = aVal;
        refreshedKeys.push(key);
      }
    } else {
      // Recruiter overrode this section on the JO — leave it untouched.
      preservedKeys.push(key);
    }
  }

  return {
    merged,
    changed: !isEqual(merged, J),
    filledKeys,
    refreshedKeys,
    preservedKeys,
  };
}

// ---- Cascade resolution -------------------------------------------

/**
 * Resolve `staffInstructions` for a JO from the ACCOUNT CHAIN ONLY (drop the
 * JO + shift levels) so the result is the pure inherited value, independent of
 * whatever the JO currently stores. Returns `{}` when nothing cascades.
 */
async function resolveAccountChainStaffInstructions(
  ctx: LoaderContext,
  tenantId: string,
  jobOrderId: string,
  joData: SIMap,
): Promise<SIMap> {
  const chain = await loadCascadeChain(ctx, {
    tenantId,
    jobOrderId,
    preloadedJoData: joData,
  });
  if (chain.length === 0) return {};
  const accountChain: AncestorLevel[] = chain.filter(
    (lvl) => lvl.levelType !== 'jo' && lvl.levelType !== 'shift',
  );
  if (accountChain.length === 0) return {};
  const { value } = resolveCascadedField('staffInstructions', accountChain);
  return asMap(value);
}

// ---- Orchestrator -------------------------------------------------

export interface SyncStaffInstructionsJobOrderAuditEntry {
  jobOrderId: string;
  displayName: string;
  action: 'updated' | 'skipped_no_cascade' | 'skipped_unchanged' | 'failed';
  filled?: string[];
  refreshed?: string[];
  preserved?: string[];
  reason?: string;
}

export interface SyncStaffInstructionsResult {
  summary: {
    accountId: string;
    accountType: string;
    accountsScanned: number;
    jobOrdersScanned: number;
    jobOrdersUpdated: number;
    jobOrdersSkippedNoCascade: number;
    jobOrdersSkippedUnchanged: number;
    jobOrdersFailed: number;
  };
  audit: SyncStaffInstructionsJobOrderAuditEntry[];
}

export async function runSyncStaffInstructionsToJobOrders(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  accountId: string;
}): Promise<SyncStaffInstructionsResult> {
  const { db, tenantId, accountId } = args;

  const accRef = db.doc(`tenants/${tenantId}/accounts/${accountId}`);
  const accSnap = await accRef.get();
  if (!accSnap.exists) {
    throw new HttpsError('not-found', 'Account not found');
  }
  const acc = accSnap.data() ?? {};
  const accountType =
    typeof acc.accountType === 'string' ? acc.accountType : 'unknown';
  const isNational = accountType === 'national';

  // Build the set of recruiterAccountIds whose JOs we scan.
  const accountIds: string[] = [accountId];
  if (isNational) {
    const childrenSnap = await db
      .collection(`tenants/${tenantId}/accounts`)
      .where('parentAccountId', '==', accountId)
      .get();
    for (const childDoc of childrenSnap.docs) {
      if ((childDoc.data() ?? {}).accountType === 'national') continue;
      accountIds.push(childDoc.id);
    }
  }

  const summary: SyncStaffInstructionsResult['summary'] = {
    accountId,
    accountType,
    accountsScanned: accountIds.length,
    jobOrdersScanned: 0,
    jobOrdersUpdated: 0,
    jobOrdersSkippedNoCascade: 0,
    jobOrdersSkippedUnchanged: 0,
    jobOrdersFailed: 0,
  };
  const audit: SyncStaffInstructionsJobOrderAuditEntry[] = [];
  const pushAudit = (entry: SyncStaffInstructionsJobOrderAuditEntry): void => {
    audit.push(entry);
    if (audit.length > MAX_AUDIT) audit.shift();
  };

  // One shared loader context → account-chain docs are read once and cached
  // across every JO under the same account.
  const ctx = createLoaderContext({ db });

  const chunks: string[][] = [];
  for (let i = 0; i < accountIds.length; i += FIRESTORE_IN_CHUNK) {
    chunks.push(accountIds.slice(i, i + FIRESTORE_IN_CHUNK));
  }

  for (const chunk of chunks) {
    let jobOrdersSnap;
    try {
      // eslint-disable-next-line no-await-in-loop
      jobOrdersSnap = await db
        .collection(`tenants/${tenantId}/job_orders`)
        .where('recruiterAccountId', 'in', chunk)
        .get();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('syncStaffInstructions: job_order_chunk_failed', {
        tenantId,
        accountId,
        chunk,
        error: reason,
      });
      summary.jobOrdersFailed += 1;
      pushAudit({
        jobOrderId: chunk.join(','),
        displayName: `chunk(${chunk.length})`,
        action: 'failed',
        reason,
      });
      continue;
    }

    for (const joDoc of jobOrdersSnap.docs) {
      summary.jobOrdersScanned += 1;
      const jo = (joDoc.data() ?? {}) as SIMap;
      const joName =
        (typeof jo.jobOrderName === 'string' && jo.jobOrderName.trim()) ||
        (typeof jo.jobTitle === 'string' && jo.jobTitle.trim()) ||
        (typeof jo.title === 'string' && jo.title.trim()) ||
        joDoc.id;

      try {
        // eslint-disable-next-line no-await-in-loop
        const accountResolved = await resolveAccountChainStaffInstructions(
          ctx,
          tenantId,
          joDoc.id,
          jo,
        );
        if (Object.keys(accountResolved).length === 0) {
          summary.jobOrdersSkippedNoCascade += 1;
          pushAudit({
            jobOrderId: joDoc.id,
            displayName: joName,
            action: 'skipped_no_cascade',
          });
          continue;
        }

        const { merged, changed, filledKeys, refreshedKeys, preservedKeys } =
          mergeStaffInstructionsForJo({
            accountResolved,
            current: asMap(jo.staffInstructions),
            lastSnapshot: asMap(jo[CASCADE_SI_SNAPSHOT_FIELD]),
          });

        if (!changed) {
          summary.jobOrdersSkippedUnchanged += 1;
          pushAudit({
            jobOrderId: joDoc.id,
            displayName: joName,
            action: 'skipped_unchanged',
            preserved: preservedKeys,
          });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await joDoc.ref.update({
          staffInstructions: stripUndefinedDeep(merged),
          [CASCADE_SI_SNAPSHOT_FIELD]: stripUndefinedDeep(accountResolved),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR,
          staffInstructionsCascadedFromAccountAt: FieldValue.serverTimestamp(),
          staffInstructionsCascadedFromAccountId: accountId,
        });
        summary.jobOrdersUpdated += 1;
        pushAudit({
          jobOrderId: joDoc.id,
          displayName: joName,
          action: 'updated',
          filled: filledKeys,
          refreshed: refreshedKeys,
          preserved: preservedKeys,
        });
      } catch (err) {
        summary.jobOrdersFailed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('syncStaffInstructions: job_order_failed', {
          tenantId,
          accountId,
          jobOrderId: joDoc.id,
          error: reason,
        });
        pushAudit({
          jobOrderId: joDoc.id,
          displayName: joName,
          action: 'failed',
          reason,
        });
      }
    }
  }

  return { summary, audit };
}

export const syncStaffInstructionsToJobOrdersCallable = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    cors: true,
    invoker: 'public',
  },
  async (request): Promise<SyncStaffInstructionsResult> => {
    const data = (request.data || {}) as {
      tenantId?: string;
      accountId?: string;
    };
    const tenantId = data.tenantId?.trim() || '';
    const accountId = data.accountId?.trim() || '';
    if (!tenantId || !accountId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId and accountId are required',
      );
    }
    await gateTenantStaffMinLevel(
      request,
      tenantId,
      5,
      'Insufficient permissions. Syncing staff instructions to job orders requires security level 5+ on the requested tenant.',
    );

    const db = admin.firestore();
    const result = await runSyncStaffInstructionsToJobOrders({
      db,
      tenantId,
      accountId,
    });

    logger.info('syncStaffInstructions: done', {
      tenantId,
      accountId,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);
