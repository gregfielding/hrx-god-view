/**
 * Normalized compliance UI model for BackgroundsComplianceTab (C1 Select E-Verify + AccuSource).
 * E-Verify rows in the tab are filtered to Select-linked cases in the tab component; screening rows are unchanged.
 */

import { Timestamp } from 'firebase/firestore';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
import { resolveApplicantPortalUrl } from '../../../utils/backgroundCheckApplicantPortal';
import type { TenantRole } from '../../../contexts/AuthContext';
import type { Role, SecurityLevel } from '../../../utils/AccessRoles';
import { viewerCanStaffManageI9SupportingDocuments } from '../../../utils/i9SupportingDocumentsUi';

/**
 * Same rules as I-9 supporting docs + `canManageOnboarding` / E-Verify callables:
 * JWT Recruiter/Manager/Admin or HRX; else Firestore `tenantIds[tenant]` role / securityLevel (≥ 4 includes 5–7).
 *
 * Pass `viewerUid` + `profileUserId` (and optional Firestore fallbacks) for full parity with the server.
 * A legacy 3-arg call `(isHRX, tenantId, claimsRoles)` is treated as JWT role check only.
 */
export function canManageEverifyFromClaims(
  isHRX: boolean,
  tenantId: string | null | undefined,
  claimsRoles: { [tid: string]: TenantRole | undefined },
  viewerUid?: string | undefined,
  profileUserId?: string,
  tenantRolesFromProfile?: { [tid: string]: { role: Role; securityLevel: SecurityLevel } } | null,
  legacyUserSecurityLevel?: SecurityLevel | null,
  legacyUserRole?: string | null,
): boolean {
  if (profileUserId !== undefined && viewerUid !== undefined) {
    return viewerCanStaffManageI9SupportingDocuments(
      tenantId,
      profileUserId,
      viewerUid,
      isHRX,
      claimsRoles,
      tenantRolesFromProfile ?? undefined,
      legacyUserSecurityLevel ?? undefined,
      legacyUserRole ?? undefined,
    );
  }
  if (isHRX) return true;
  if (!tenantId) return false;
  const tenantRole = claimsRoles?.[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  return false;
}

/**
 * Mirrors `resolveAccusourceRoleAndSecurityLevel` in accusourceAdminGate.ts.
 * System Access and tenant flows store `securityLevel` / `role` under `tenantIds.{tenantId}`;
 * top-level `role: 'Tenant'` is often a legacy default — use tenant scope when `tenantId` matches.
 */
export function canAccusourceAdminFromUserDoc(
  data: Record<string, unknown> | null | undefined,
  tenantId?: string | null
): boolean {
  if (!data) return false;
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const active =
    typeof data.activeTenantId === 'string' && data.activeTenantId.trim() !== ''
      ? data.activeTenantId.trim()
      : null;
  const tid =
    (typeof tenantId === 'string' && tenantId.trim() !== '' ? tenantId.trim() : null) || active;
  const nested = tid && tenantIds?.[tid] ? tenantIds[tid] : undefined;

  const role = String(
    nested && nested.role != null && String(nested.role).trim() !== ''
      ? nested.role
      : data.role ?? ''
  ).toLowerCase();
  const securityLevelRaw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const securityLevel = Number.parseInt(String(securityLevelRaw || '0'), 10) || 0;
  const isAdminRole = role === 'admin' || role === 'super_admin' || role === 'manager';
  if (isAdminRole) return true;
  return securityLevel >= 5;
}

export type ComplianceChannel = 'everify' | 'screening';

export type ComplianceStatusTone = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface NormalizedComplianceRow {
  key: string;
  channel: ComplianceChannel;
  packageLabel: string;
  statusPrimary: string;
  statusSecondary: string;
  submittedAt: unknown;
  providerLabel: string;
  actionNeeded: string | null;
  statusTone: ComplianceStatusTone;
  drugReportReady: boolean;
  finalReportReady: boolean;
  /** E-Verify row payload when channel === 'everify' */
  everify?: { id: string; data: Record<string, unknown> };
  /** Screening row payload when channel === 'screening' */
  screening?: BackgroundCheckRecord;
}

function everifyPublicStatus(data: Record<string, unknown>): string {
  return String(
    (data.status as string) || (data.public as { status?: string } | undefined)?.status || ''
  );
}

/** Single source for E-Verify “action needed” copy (summary + table). */
export function everifyActionNeeded(data: Record<string, unknown>): string | null {
  const st = everifyPublicStatus(data);
  if (['tnc', 'further_action_required', 'dhs_verification_in_process'].includes(st)) {
    return 'Follow-up required';
  }
  if (st === 'error' || data.error) return 'Error / retry';
  return null;
}

/** Single source for screening “action needed” copy (summary + table). */
export function screeningActionNeeded(r: BackgroundCheckRecord): string | null {
  if (r.syncError) return String(r.syncError).slice(0, 80);
  if (r.hrxStatus === 'awaiting_applicant') return 'Applicant action (portal)';
  if (r.hrxStatus === 'error') return 'Sync error';
  return null;
}

export function statusToneFromStatusString(s: string | undefined): ComplianceStatusTone {
  const x = String(s || '').toLowerCase();
  if (['employment_authorized', 'completed', 'report_ready', 'closed'].some((k) => x.includes(k))) return 'success';
  if (['error', 'tnc', 'final_nonconfirmation', 'failed'].some((k) => x.includes(k))) return 'error';
  if (['pending', 'submitted', 'awaiting', 'in_progress', 'further_action'].some((k) => x.includes(k))) return 'warning';
  return 'default';
}

function bgStatusLabel(r: BackgroundCheckRecord): string {
  return [r.hrxStatus, r.providerStatus].filter(Boolean).join(' · ') || '—';
}

export function normalizeEverifyRow(id: string, data: Record<string, unknown>): NormalizedComplianceRow {
  const st = everifyPublicStatus(data) || '—';
  const providerSt = String(data.providerStatus || '—');
  const caseNum = String(data.everifyCaseNumber || data.providerCaseNumber || id);
  return {
    key: `ev-${id}`,
    channel: 'everify',
    packageLabel: caseNum,
    statusPrimary: st,
    statusSecondary: providerSt,
    submittedAt: data.submittedAt || data.createdAt,
    providerLabel: 'USCIS / E-Verify',
    actionNeeded: everifyActionNeeded(data),
    statusTone: statusToneFromStatusString(st),
    drugReportReady: false,
    finalReportReady: false,
    everify: { id, data },
  };
}

export function normalizeScreeningRow(r: BackgroundCheckRecord): NormalizedComplianceRow {
  const label = bgStatusLabel(r);
  const portalUrl = resolveApplicantPortalUrl(r);
  const statusSecondary =
    r.hrxStatus === 'awaiting_applicant' && portalUrl
      ? 'Applicant setup link ready'
      : r.hrxStatus === 'awaiting_applicant' && !portalUrl
        ? 'Awaiting applicant setup link'
        : '';
  return {
    key: `bg-${r.id}`,
    channel: 'screening',
    packageLabel: [r.requestedPackageName, r.requestedPackageId].filter(Boolean).join(' · ') || '—',
    statusPrimary: label,
    statusSecondary,
    submittedAt: r.createdAt,
    providerLabel: 'AccuSource',
    actionNeeded: screeningActionNeeded(r),
    statusTone: statusToneFromStatusString(r.hrxStatus),
    drugReportReady: !!r.drugReportReady,
    finalReportReady: !!r.finalReportReady,
    screening: r,
  };
}

export interface ComplianceSummaryModel {
  evStatusLabel: string;
  bgStatusLabel: string;
  drugSummaryLabel: string;
  additionalSummaryLabel: string;
  maxMillis: number;
  actionNeeded: boolean;
}

export function buildComplianceSummary(
  everifyRows: Array<{ id: string; data: Record<string, unknown> }>,
  screeningRows: BackgroundCheckRecord[]
): ComplianceSummaryModel {
  const latestEv = everifyRows[0];
  const evStatusLabel = latestEv ? everifyPublicStatus(latestEv.data) || '—' : 'No case';
  const latestBg = screeningRows[0];
  const bgStatusLabel = latestBg?.hrxStatus || '—';
  const drugSummaryLabel = screeningRows.some((r) => r.drugReportReady) ? 'Ready / Reported' : 'See orders';
  const additionalSummaryLabel = screeningRows.some(
    (r) =>
      (Array.isArray((r as { requestedServices?: string[] }).requestedServices) &&
        (r as { requestedServices?: string[] }).requestedServices!.length > 0) ||
      r.lastServiceComponent?.serviceName
  )
    ? 'See screening orders'
    : '—';

  const lastTs = [
    ...everifyRows.map((r) => (r.data.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0),
    ...screeningRows.map((r) => (r.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0),
  ];
  const maxMillis = Math.max(0, ...lastTs);

  const normalizedEv = everifyRows.map((r) => normalizeEverifyRow(r.id, r.data));
  const normalizedBg = screeningRows.map(normalizeScreeningRow);
  const actionNeeded = [...normalizedEv, ...normalizedBg].some((row) => row.actionNeeded != null);

  return {
    evStatusLabel,
    bgStatusLabel,
    drugSummaryLabel,
    additionalSummaryLabel,
    maxMillis,
    actionNeeded,
  };
}

// --- Screening package resolution: Job order → location_defaults → account (first non-empty field wins) ---

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

/** Same candidate order as AssignmentDetails location defaults lookup. */
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

// --- “Already satisfied” — structured for future validity windows + package equivalency ---

/** Policy placeholder: when validity rules ship, compare `Date.now()` to `expiresAtMs`. */
export const PLACEHOLDER_SCREENING_VALIDITY_DAYS = 365;

export type ScreeningSatisfiedReasonCode =
  | 'none'
  | 'order_completed'
  | 'status_completed'
  | 'status_report_ready'
  | 'within_validity_window'
  | 'equivalent_package';

export interface ScreeningSatisfiedEvaluation {
  satisfied: boolean;
  reasonCode: ScreeningSatisfiedReasonCode;
  /** Stable key for “same screening product” comparisons (extend when server stores package codes). */
  equivalencyKey: string;
  /** Best-effort completion time for future validity math. */
  completedAtMs: number | null;
  /** Placeholder end of assumed validity; not enforced until policy hooks are enabled. */
  expiresAtMs: number | null;
  detail?: string;
}

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

export function screeningEquivalencyKey(r: BackgroundCheckRecord): string {
  const id = r.requestedPackageId != null ? String(r.requestedPackageId).trim() : '';
  if (id) return `id:${id}`;
  const name = String(r.requestedPackageName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return 'unknown';
}

/**
 * Whether an existing order counts as “satisfied” for duplicate-order warnings / modal copy.
 * Validity window + equivalency against a requested package are stubbed for future rules.
 */
export function evaluateScreeningSatisfied(
  r: BackgroundCheckRecord,
  opts?: { requestedEquivalencyKey?: string; enforceEquivalency?: boolean; enforceValidityWindow?: boolean }
): ScreeningSatisfiedEvaluation {
  const equivalencyKey = screeningEquivalencyKey(r);
  const completedMs =
    timestampToMillis(r.updatedAt) ?? timestampToMillis(r.createdAt) ?? null;

  const statusSatisfied =
    !!r.orderCompleted || r.hrxStatus === 'completed' || r.hrxStatus === 'report_ready';

  if (!statusSatisfied) {
    return {
      satisfied: false,
      reasonCode: 'none',
      equivalencyKey,
      completedAtMs: completedMs,
      expiresAtMs: null,
    };
  }

  if (opts?.enforceEquivalency && opts.requestedEquivalencyKey) {
    if (equivalencyKey !== opts.requestedEquivalencyKey) {
      return {
        satisfied: false,
        reasonCode: 'none',
        equivalencyKey,
        completedAtMs: completedMs,
        expiresAtMs: null,
        detail: 'Package does not match requested equivalency key',
      };
    }
  }

  const expiresAtMs =
    completedMs != null ? completedMs + PLACEHOLDER_SCREENING_VALIDITY_DAYS * 86_400_000 : null;

  if (opts?.enforceValidityWindow && expiresAtMs != null && Date.now() > expiresAtMs) {
    return {
      satisfied: false,
      reasonCode: 'none',
      equivalencyKey,
      completedAtMs: completedMs,
      expiresAtMs,
      detail: 'Outside assumed validity window',
    };
  }

  let reasonCode: ScreeningSatisfiedReasonCode = 'status_completed';
  if (r.orderCompleted) reasonCode = 'order_completed';
  else if (r.hrxStatus === 'report_ready') reasonCode = 'status_report_ready';

  return {
    satisfied: true,
    reasonCode,
    equivalencyKey,
    completedAtMs: completedMs,
    expiresAtMs,
  };
}

