/**
 * Server-side screening package resolution + satisfied evaluation.
 * Keep aligned with src/pages/UserProfile/components/backgroundsComplianceModel.ts
 */

import * as admin from 'firebase-admin';

const Timestamp = admin.firestore.Timestamp;

export interface ScreeningPackageMergeResult {
  packageName: string;
  packageId: string;
  nameSource: 'job_order' | 'location_defaults' | 'account' | null;
  idSource: 'job_order' | 'location_defaults' | 'account' | null;
}

function readPackageNameLayer(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const top = d.screeningPackageName ?? d.backgroundPackageName ?? d.packageName;
  if (top != null && String(top).trim()) return String(top).trim();
  const def = d.defaults as Record<string, unknown> | undefined;
  if (def) {
    const v = def.screeningPackageName ?? def.backgroundPackageName ?? def.packageName;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const od = d.orderDefaults as Record<string, unknown> | undefined;
  if (od && typeof od === 'object') {
    const v =
      (od as Record<string, unknown>).screeningPackageName ??
      (od as Record<string, unknown>).backgroundPackageName ??
      (od as Record<string, unknown>).packageName;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function readPackageIdLayer(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const top = d.screeningPackageId ?? d.packageId ?? d.requestedPackageId;
  if (top != null && String(top).trim()) return String(top).trim();
  const def = d.defaults as Record<string, unknown> | undefined;
  if (def) {
    const v = def.screeningPackageId ?? def.packageId;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const od = d.orderDefaults as Record<string, unknown> | undefined;
  if (od && typeof od === 'object') {
    const v =
      (od as Record<string, unknown>).screeningPackageId ?? (od as Record<string, unknown>).packageId;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export function mergeScreeningPackageFromLayers(
  jobOrder: Record<string, unknown> | undefined,
  locationDefaults: Record<string, unknown> | undefined,
  account: Record<string, unknown> | undefined
): ScreeningPackageMergeResult {
  const jn = readPackageNameLayer(jobOrder);
  const ji = readPackageIdLayer(jobOrder);
  const ln = readPackageNameLayer(locationDefaults);
  const li = readPackageIdLayer(locationDefaults);
  const an = readPackageNameLayer(account);
  const ai = readPackageIdLayer(account);
  const packageName = jn || ln || an;
  const packageId = ji || li || ai;
  return {
    packageName,
    packageId,
    nameSource: jn ? 'job_order' : ln ? 'location_defaults' : an ? 'account' : null,
    idSource: ji ? 'job_order' : li ? 'location_defaults' : ai ? 'account' : null,
  };
}

export function screeningLocationKeyCandidates(
  jobOrderData: Record<string, unknown>,
  accountId: string,
  locationId: string,
  companyId: string
): string[] {
  return [
    typeof jobOrderData.locationKey === 'string' ? jobOrderData.locationKey : '',
    accountId && locationId ? `${accountId}_${locationId}` : '',
    companyId && locationId ? `${companyId}_${locationId}` : '',
  ].filter(Boolean);
}

export const PLACEHOLDER_SCREENING_VALIDITY_DAYS = 365;

export type BgLike = {
  orderCompleted?: boolean;
  hrxStatus?: string | null;
  requestedPackageId?: string | number | null;
  requestedPackageName?: string | null;
  updatedAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp | null;
};

function timestampToMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (ts instanceof Timestamp) {
    try {
      return ts.toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

export function screeningEquivalencyKeyFromRecord(r: BgLike): string {
  const id = r.requestedPackageId != null ? String(r.requestedPackageId).trim() : '';
  if (id) return `id:${id}`;
  const name = String(r.requestedPackageName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return 'unknown';
}

export function requestedEquivalencyKey(packageId: string, packageName: string): string {
  const pid = String(packageId || '').trim();
  if (pid) return `id:${pid}`;
  const pn = String(packageName || '').trim().toLowerCase();
  if (pn) return `name:${pn}`;
  return 'unknown';
}

export interface ScreeningSatisfiedEvaluation {
  satisfied: boolean;
  equivalencyKey: string;
  expiresAtMs: number | null;
  /** Plain-language reason for operators / disputes (audit trail). */
  decisionDetail: string;
}

export function evaluateScreeningSatisfiedServer(
  r: BgLike,
  opts?: { requestedEquivalencyKey?: string; enforceEquivalency?: boolean; enforceValidityWindow?: boolean }
): ScreeningSatisfiedEvaluation {
  const equivalencyKey = screeningEquivalencyKeyFromRecord(r);
  const completedMs = timestampToMillis(r.updatedAt) ?? timestampToMillis(r.createdAt) ?? null;

  const statusSatisfied =
    !!r.orderCompleted || r.hrxStatus === 'completed' || r.hrxStatus === 'report_ready';

  if (!statusSatisfied) {
    return {
      satisfied: false,
      equivalencyKey,
      expiresAtMs: null,
      decisionDetail: `Not satisfied: order not in a completed state (hrxStatus=${String(r.hrxStatus ?? 'null')}, orderCompleted=${Boolean(r.orderCompleted)}; need completed|report_ready or orderCompleted).`,
    };
  }

  if (opts?.enforceEquivalency && opts.requestedEquivalencyKey) {
    if (equivalencyKey !== opts.requestedEquivalencyKey) {
      return {
        satisfied: false,
        equivalencyKey,
        expiresAtMs: null,
        decisionDetail: `Not satisfied: package equivalency mismatch — existing order key "${equivalencyKey}" does not equal required resolved key "${opts.requestedEquivalencyKey}".`,
      };
    }
  }

  const expiresAtMs =
    completedMs != null ? completedMs + PLACEHOLDER_SCREENING_VALIDITY_DAYS * 86_400_000 : null;

  if (opts?.enforceValidityWindow && expiresAtMs != null && Date.now() > expiresAtMs) {
    return {
      satisfied: false,
      equivalencyKey,
      expiresAtMs,
      decisionDetail: `Not satisfied: outside assumed validity window (expiresAtMs=${expiresAtMs}).`,
    };
  }

  return {
    satisfied: true,
    equivalencyKey,
    expiresAtMs,
    decisionDetail: `Satisfied: status is complete/report-ready, package key "${equivalencyKey}" matches required "${opts?.requestedEquivalencyKey ?? equivalencyKey}".`,
  };
}

export function packageFingerprint(packageName: string, packageId: string): string {
  return `${String(packageName || '').trim()}|${String(packageId || '').trim()}`;
}
