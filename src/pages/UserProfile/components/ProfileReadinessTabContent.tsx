/**
 * Readiness (V1) on User Profile — per assignment when placements exist; otherwise entity-level onboarding from
 * `entity_employments` / pipeline (no assignment required).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  List,
  ListItemButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { format, parseISO, isValid } from 'date-fns';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import {
  JobReadinessChip,
  ReadinessCsaActionsSection,
} from '../../../components/recruiter/readiness';
import { EverifyCaseDrawer } from '../../../components/recruiter/everify';
import { BackgroundCheckCaseDrawer } from '../../../components/recruiter/backgroundCheck';
import type {
  JobReadinessChipContributor,
  JobReadinessChipData,
} from '../../../shared/jobReadinessChip/types';
import type { ReadinessSnapshotV1Firestore } from '../../../shared/readinessSnapshotV1';
import type { EmployeeReadinessItem } from '../../../types/employeeReadinessItemV1';
import { useAuth } from '../../../contexts/AuthContext';

import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { getWorkAuthorizedStatus } from '../../../utils/workAuthorizedDisplay';
import type { BackgroundCheckRecord, AccusourceLineVerdict } from '../../../types/backgroundCheck';
import { accusourceScreeningLineItems } from '../../../utils/accusourceScreeningLineItems';
import type { WorkerComplianceItem } from '../../../types/compliance';
import { getComplianceTypeLabel } from '../../../types/compliance';
import {
  buildAssignmentReadiness,
  type AssignmentReadinessAssignmentInput,
  type AssignmentReadinessCertItem,
  type AssignmentReadinessScreeningInput,
  type AssignmentReadinessUserInput,
  type BuildAssignmentReadinessResult,
  type OverallReadinessState,
  type ReadinessRequirement,
} from '../../../utils/buildAssignmentReadiness';
import {
  complianceItemRelevantToAssignment,
  fetchReadinessEntityBundle,
  hiringEntityIdForAssignment,
  resolveAssignmentEntityKey,
  type ReadinessEntityBundle,
  type ReadinessEntityBundleWeb,
  type EmploymentEntityKey,
} from '../../../utils/readinessEntityContext';
import { assignmentReadinessEmploymentFromPipeline } from '../../../utils/employmentMinimalChecklistModel';
import {
  enrichUserAssignmentRow,
  JOB_ORDER_CERT_DEMAND_KEY,
} from '../../../utils/enrichAssignmentRowForDisplay';
import { mergeJobOrderSyntheticCertificationDemands } from '../../../shared/jobOrderSyntheticCertificationDemands';

/** Sentinel assignment id — not a real Firestore assignment; drives entity-scoped readiness when the worker has no placements. */
const ENTITY_ONBOARDING_ASSIGNMENT_ID = '__hrx_entity_onboarding__';

/** Readiness rows that are satisfied on Employment (not duplicated here). */
function readinessRequirementKeyLinksToEmploymentI9(key: string): boolean {
  if (key === 'work_authorization' || key === 'i9' || key === 'i9_form') return true;
  if (key.startsWith('i9_')) return true;
  return false;
}

function pickPrimaryEntityKeyForEntityReadiness(bundle: ReadinessEntityBundleWeb | null): EmploymentEntityKey {
  if (!bundle) return 'select';
  const order: EmploymentEntityKey[] = ['select', 'workforce', 'events'];
  for (const ek of order) {
    const ee = bundle.employmentsByKey[ek];
    if (!ee) continue;
    const st = String((ee as { employmentState?: string; status?: string }).employmentState ?? (ee as { status?: string }).status ?? '')
      .trim()
      .toLowerCase();
    if (st && !['active', 'ready', 'inactive', 'terminated', 'none', 'not_started', ''].includes(st)) {
      return ek;
    }
  }
  for (const ek of order) {
    if (bundle.employmentsByKey[ek] || bundle.pipelinesByKey[ek]) return ek;
  }
  return 'select';
}

export interface ProfileReadinessTabContentProps {
  uid: string;
  tenantId: string | null;
}

/**
 * **R.7** — element-id pattern for the requirement row anchor used by the
 * R.4 chip drill-in (`?tab=readiness&type=&itemId=...`). Keep stable; the
 * URL flow scrolls to this id and applies the flash highlight.
 */
function readinessRequirementRowElementId(key: string): string {
  return `readiness-requirement-row-${key}`;
}

function ReadinessRequirementRow(props: {
  req: ReadinessRequirement;
  onNavigateEmploymentI9: () => void;
  /**
   * **R.7** — when true, renders a flash-highlight on the row and exposes
   * the anchor id so the drill-in `useEffect` can `scrollIntoView`. Reset
   * after ~3s by the parent (matches the existing background-compliance
   * highlight pattern in `UserProfile/index.tsx`).
   */
  highlighted?: boolean;
}) {
  const { req, onNavigateEmploymentI9, highlighted = false } = props;
  const linkEmployment = readinessRequirementKeyLinksToEmploymentI9(req.key);
  const anchorId = readinessRequirementRowElementId(req.key);
  const highlightSx = highlighted
    ? {
        bgcolor: 'warning.lighter',
        outline: '2px solid',
        outlineColor: 'warning.main',
        borderRadius: 1,
        transition: 'background-color 0.5s ease, outline-color 0.5s ease',
      }
    : { transition: 'background-color 0.5s ease, outline-color 0.5s ease' };
  const rowContent = (
    <Stack direction="row" alignItems="flex-start" gap={1.25} sx={{ width: '100%' }}>
      <Box sx={{ pt: 0.2 }}>{statusIcon(req)}</Box>
      <Typography variant="body2" sx={{ lineHeight: 1.45, flex: 1, minWidth: 0 }}>
        {requirementDisplayLine(req)}
      </Typography>
      {linkEmployment ? (
        <ChevronRightIcon sx={{ fontSize: 20, color: 'action.active', mt: 0.15, flexShrink: 0 }} aria-hidden />
      ) : null}
    </Stack>
  );
  if (linkEmployment) {
    return (
      <ListItemButton
        id={anchorId}
        onClick={onNavigateEmploymentI9}
        aria-label="Open Employment tab for I-9 and work authorization"
        sx={{
          borderRadius: 1,
          py: 0.75,
          px: 1,
          alignItems: 'flex-start',
          ...highlightSx,
        }}
      >
        {rowContent}
      </ListItemButton>
    );
  }
  return (
    <Stack id={anchorId} sx={{ py: 0.5, px: 0.75, ...highlightSx }}>
      {rowContent}
    </Stack>
  );
}

/** Small status icon for an individual AccuSource screening line item,
 *  colored by its adjudication verdict. Matches the header SCREENING
 *  column vocabulary (PASSED=green, FAILED=red, NEEDS_REVIEW=amber,
 *  PENDING/other=muted). */
function screeningVerdictIcon(verdict: AccusourceLineVerdict): React.ReactNode {
  switch (verdict) {
    case 'PASSED':
      return <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} titleAccess="Passed" />;
    case 'FAILED':
      return <CancelIcon sx={{ fontSize: 20, color: 'error.main' }} titleAccess="Failed" />;
    case 'NEEDS_REVIEW':
      return <WarningAmberIcon sx={{ fontSize: 20, color: 'warning.main' }} titleAccess="Needs review" />;
    default:
      return <WarningAmberIcon sx={{ fontSize: 20, color: 'text.disabled' }} titleAccess="Pending" />;
  }
}

/**
 * Parse the worker's AccuSource background-check record into its
 * individual screening line items (Social Security Locator, CrimNet,
 * County Criminal, 4 Panel Quick Test, Quest Drug Screen, …) for the
 * selected assignment. Prefers a check linked to THIS assignment
 * (`automationAssignmentId`); falls back to the worker's most recent
 * check overall (screening is typically worker-level). Returns the
 * package name + parsed line items, or null when no check exists.
 */
function screeningPackageForAssignment(
  assignmentId: string,
  records: BackgroundCheckRecord[],
): { packageName: string | null; items: ReturnType<typeof accusourceScreeningLineItems> } | null {
  if (!assignmentId || records.length === 0) return null;
  const linked = records.filter((r) => r.automationAssignmentId === assignmentId);
  const pool = linked.length > 0 ? linked : records;
  const toMillis = (r: BackgroundCheckRecord): number =>
    (r.updatedAt as { toMillis?: () => number } | null | undefined)?.toMillis?.() ?? 0;
  const bg = [...pool].sort((a, b) => toMillis(b) - toMillis(a))[0];
  if (!bg) return null;
  const items = accusourceScreeningLineItems(bg);
  if (items.length === 0) return null;
  const packageName =
    String(bg.requestedPackageName || bg.requestedPackageId || '').trim() || null;
  return { packageName, items };
}

/**
 * Load the worker's job applications as readiness rows — same `{ id, data }`
 * shape as assignments — so the Readiness panel can show "applied to" jobs
 * above their assignments and compute identical readiness for each.
 *
 * `users/{uid}.applicationIds` holds `"{tenantId}_{jobId}"` strings; the app
 * doc lives at `tenants/{tid}/applications/{uid}_{jobId}`. We resolve the
 * `jobOrderId` from the app doc (or its job_posting), inject it, and run the
 * SAME `enrichUserAssignmentRow` enrichment assignments use — which resolves
 * the JO's display name, hiring entity, screening package, and cert demand.
 * Row ids are prefixed `app_` so they never collide with assignment ids.
 */
async function loadReadinessApplicationRows(
  tenantId: string,
  uid: string,
  applicationIds: string[],
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const appId of applicationIds) {
    const [appTenantId, jobId] = String(appId).split('_');
    if (appTenantId !== tenantId || !jobId) continue;
    try {
      const appSnap = await getDoc(doc(db, 'tenants', tenantId, 'applications', `${uid}_${jobId}`));
      if (!appSnap.exists()) continue;
      const appData = appSnap.data() as Record<string, unknown>;
      let jobOrderId =
        typeof appData.jobOrderId === 'string' ? appData.jobOrderId.trim() : '';
      if (!jobOrderId) {
        try {
          const postingSnap = await getDoc(doc(db, 'tenants', tenantId, 'job_postings', jobId));
          if (postingSnap.exists()) {
            const pj = postingSnap.data() as Record<string, unknown>;
            jobOrderId = typeof pj.jobOrderId === 'string' ? pj.jobOrderId.trim() : '';
          }
        } catch {
          /* ignore — enrichment still shows the app's own fields */
        }
      }
      const mergedData: Record<string, unknown> = { ...appData };
      if (jobOrderId) mergedData.jobOrderId = jobOrderId;
      // `enrichUserAssignmentRow` only reads `.id` + `.data()`, so a minimal
      // faux snapshot is sufficient.
      const fauxSnap = {
        id: `${uid}_${jobId}`,
        data: () => mergedData,
      } as unknown as QueryDocumentSnapshot<DocumentData>;
      const enriched = await enrichUserAssignmentRow(tenantId, fauxSnap);
      // Carry the application status through for display.
      enriched.applicationStatus = appData.status ?? null;
      rows.push({ id: `app_${jobId}`, data: enriched });
    } catch {
      /* skip unreadable application */
    }
  }
  return rows;
}

function screeningForAssignment(
  assignmentId: string,
  records: BackgroundCheckRecord[],
): AssignmentReadinessScreeningInput {
  const linked = records.filter((r) => r.automationAssignmentId === assignmentId);
  if (!linked.length) return {};

  const bgComplete = linked.some(
    (r) => r.hrxStatus === 'completed' || r.orderCompleted === true || r.finalReportReady === true,
  );
  const bgOrdered = linked.some((r) => {
    const st = r.hrxStatus || '';
    return st && !['draft', 'completed', 'canceled'].includes(st);
  });

  const drugComplete = linked.some(
    (r) => r.drugReportReady === true || r.hrxStatus === 'drug_report_ready',
  );
  const drugOrdered = linked.some((r) => {
    const pkg = String(r.requestedPackageName || '').toLowerCase();
    if (pkg.includes('drug')) return r.hrxStatus !== 'completed' && r.hrxStatus !== 'canceled';
    return r.drugReportReady === false && r.hrxStatus && !['draft', 'completed', 'canceled'].includes(r.hrxStatus);
  });

  return {
    backgroundComplete: bgComplete,
    backgroundOrdered: bgOrdered || bgComplete,
    drugScreenComplete: drugComplete,
    drugScreenOrdered: drugOrdered || drugComplete,
  };
}

function assignmentDisplayName(data: Record<string, unknown>): string {
  const parts = [
    data.shiftTitle,
    data.jobTitle,
    data.roleTitle,
    data.companyDisplayName,
    data.companyName,
    data.customerName,
  ]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
  return parts[0] || 'Assignment';
}

function assignmentStartDateShort(data: Record<string, unknown>): string {
  const raw = String(data.startDate || '').trim();
  if (!raw) return '—';
  try {
    const d = parseISO(raw);
    if (isValid(d)) return format(d, 'MMM d, yyyy');
  } catch {
    /* keep raw */
  }
  return raw;
}

function displayDetail(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return s || '—';
}

function assignmentInputFromRow(row: { id: string; data: Record<string, unknown> }): AssignmentReadinessAssignmentInput {
  const d = row.data;
  return {
    id: row.id,
    name: assignmentDisplayName(d),
    status: String(d.status || d.assignmentStatus || d.confirmationStatus || '—'),
    requiresBackgroundCheck: Boolean(d.showBackgroundChecks ?? d.backgroundCheckRequired),
    requiresDrugScreen: Boolean(d.drugScreenRequired ?? d.showDrugScreening),
  };
}

function certificationsForAssignmentRow(
  assignmentId: string,
  assignmentData: Record<string, unknown>,
  bundle: ReadinessEntityBundle | null,
  complianceItemsRaw: Array<WorkerComplianceItem & { id: string }>,
): AssignmentReadinessCertItem[] {
  if (!bundle) return [];
  const ek = resolveAssignmentEntityKey(assignmentData, bundle);
  const ee = ek ? bundle.employmentsByKey[ek] : null;
  const hiringEntityId = hiringEntityIdForAssignment(assignmentData, bundle);
  const jobOrderId = String(assignmentData.jobOrderId || '').trim() || null;
  const ctx = {
    assignmentId,
    jobOrderId,
    entityEmploymentId: ee?.id ?? null,
    hiringEntityId,
  };
  const fromCompliance = complianceItemsRaw
    .filter((row) => complianceItemRelevantToAssignment(row, ctx))
    .map((row) => {
      const st = String(row.status || '').toLowerCase();
      const legacyDone = Boolean((row as { completed?: boolean }).completed);
      const done = st === 'complete' || st === 'approved' || legacyDone;
      return {
        key: row.id,
        label: complianceItemDisplayLabel(row),
        complete: done,
      };
    });

  const jobOrderCertDemandPayload = assignmentData[JOB_ORDER_CERT_DEMAND_KEY] as
    | Record<string, unknown>
    | undefined;
  return mergeJobOrderSyntheticCertificationDemands(jobOrderCertDemandPayload ?? null, fromCompliance);
}

function readinessBadgeColor(state: OverallReadinessState): 'success' | 'warning' | 'error' | 'default' {
  switch (state) {
    case 'READY':
      return 'success';
    case 'READY_WITH_WARNINGS':
      return 'warning';
    case 'BLOCKED':
      return 'error';
    default:
      return 'default';
  }
}

/** Display labels only — underlying `OverallReadinessState` unchanged. */
function readinessBadgeLabel(state: OverallReadinessState): string {
  switch (state) {
    case 'READY':
      return 'Ready';
    case 'READY_WITH_WARNINGS':
      return 'Ready (Needs Attention)';
    case 'BLOCKED':
      return 'Not Ready';
    case 'PENDING_INITIALIZATION':
      return 'Not Ready';
    default:
      return state;
  }
}

function statusIcon(req: ReadinessRequirement) {
  if (req.status === 'complete') {
    return <CheckCircleIcon sx={{ fontSize: 22, color: 'success.main' }} titleAccess="Complete" />;
  }
  if (req.status === 'in_progress') {
    return <WarningAmberIcon sx={{ fontSize: 22, color: 'warning.main' }} titleAccess="Warning" />;
  }
  return <CancelIcon sx={{ fontSize: 22, color: 'error.main' }} titleAccess="Missing" />;
}

function requirementShortLabel(req: ReadinessRequirement): string {
  switch (req.key) {
    case 'handbook':
      return 'Handbook';
    case 'policies':
      return 'Policies';
    case 'tax_form':
      return 'Tax Form';
    case 'i9':
      return 'I-9 Form';
    case 'work_authorization':
      return 'Work Authorization';
    case 'payroll_setup':
      return 'Payroll Setup';
    case 'background_check':
      return 'Background Check';
    case 'drug_screen':
      return 'Drug Screen';
    default:
      if (req.key.startsWith('cert_')) return req.label;
      return req.label;
  }
}

function requirementStatusPhrase(req: ReadinessRequirement): string {
  if (req.status === 'complete') {
    return 'Complete';
  }
  if (req.status === 'in_progress') {
    if (req.key === 'payroll_setup') {
      return 'Invite sent, not completed';
    }
    if (req.key === 'background_check' || req.key === 'drug_screen') {
      return 'Ordered, pending results';
    }
    return 'In progress';
  }
  switch (req.key) {
    case 'work_authorization':
      return 'Missing';
    case 'i9':
      return 'Missing';
    case 'tax_form':
      return 'Not started';
    case 'handbook':
      return 'Not signed';
    case 'policies':
      return 'Not signed';
    case 'payroll_setup':
      return 'Not started';
    case 'background_check':
      return 'Not started';
    case 'drug_screen':
      return 'Not started';
    default:
      if (req.key.startsWith('cert_')) return 'Missing';
      return 'Not started';
  }
}

function requirementDisplayLine(req: ReadinessRequirement): string {
  return `${requirementShortLabel(req)} (${requirementStatusPhrase(req)})`;
}

/**
 * **R.7** — map a `JobReadinessChipContributor.requirementType` (and the
 * source side of the contributor) to the `ReadinessRequirement.key`s that
 * surface on this tab. Used to decide which row(s) to highlight on a
 * drill-in.
 *
 * The current `buildAssignmentReadiness` synthesizes its requirements with
 * keys like `'background_check'`, `'work_authorization'`, `'cert_<docId>'`
 * — none of which line up 1:1 with the readiness-item Firestore IDs the
 * chip carries. So matching is by-type rather than by-itemId. Future PR
 * (when we read raw items into this tab) can do exact `itemId` matching.
 */
function highlightedKeysForRequirementType(
  requirementType: string | null | undefined,
): (key: string) => boolean {
  if (!requirementType) return () => false;
  switch (requirementType) {
    case 'background_check':
    case 'screening_package_match':
      return (k) => k === 'background_check';
    case 'drug_screen':
      return (k) => k === 'drug_screen';
    case 'e_verify':
      // E-Verify rows surface on this tab as `work_authorization` / `i9`.
      // Highlight both — drill-in shouldn't second-guess which one the
      // user needs to look at.
      return (k) => k === 'work_authorization' || k === 'i9' || k.startsWith('i9_');
    case 'cert_match':
    case 'required_certification':
      // Multiple cert rows; highlight all so the user spots the failing one.
      return (k) => k.startsWith('cert_');
    case 'license_match':
      return (k) => k.startsWith('license_');
    default:
      // Willingness items + skill / education / orientation / safety
      // briefing / shift_confirmation / ppe_acknowledgement / custom — none
      // currently surface as their own row on this tab. The chip popover
      // remains useful but no row is highlighted.
      return () => false;
  }
}

type PrioritySectionId = 'must' | 'important' | 'admin';

const SORT_KEY_ORDER: string[] = [
  'work_authorization',
  'i9',
  'payroll_setup',
  'tax_form',
  'background_check',
  'drug_screen',
  'handbook',
  'policies',
];

function sortRequirementsForSection(reqs: ReadinessRequirement[], _section: PrioritySectionId): ReadinessRequirement[] {
  const rank = (k: string): number => {
    const i = SORT_KEY_ORDER.indexOf(k);
    if (i >= 0) return i;
    if (k.startsWith('cert_')) return 900;
    return 800;
  };
  return [...reqs].sort((a, b) => {
    const ra = rank(a.key);
    const rb = rank(b.key);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

const NEXT_ACTION_ORDER: string[] = [
  'work_authorization',
  'i9',
  'payroll_setup',
  'tax_form',
  'background_check',
  'drug_screen',
  'handbook',
  'policies',
];

function nextActionPhrase(req: ReadinessRequirement): string {
  if (req.status === 'complete') return '';
  switch (req.key) {
    case 'work_authorization':
      return 'Confirm work authorization';
    case 'i9':
      return 'Complete I-9 Form';
    case 'tax_form':
      return 'Complete Tax Form';
    case 'payroll_setup':
      return req.status === 'in_progress' ? 'Finish payroll setup' : 'Complete payroll setup';
    case 'handbook':
      return 'Sign handbook';
    case 'policies':
      return 'Sign policies';
    case 'background_check':
      return 'Complete background check';
    case 'drug_screen':
      return 'Complete drug screen';
    default:
      if (req.key.startsWith('cert_')) return `Complete ${req.label}`;
      return `Complete ${requirementShortLabel(req)}`;
  }
}

function computeNextActions(requirements: ReadinessRequirement[], max = 3): string[] {
  const incomplete = requirements.filter((r) => r.status !== 'complete');
  const rank = (r: ReadinessRequirement): number => {
    const tier = r.severity === 'hard_block' ? 0 : 1;
    const idx = NEXT_ACTION_ORDER.indexOf(r.key);
    const ord = idx >= 0 ? idx : 500;
    return tier * 1000 + ord;
  };
  incomplete.sort((a, b) => rank(a) - rank(b));
  const out: string[] = [];
  for (const r of incomplete) {
    const p = nextActionPhrase(r);
    if (p) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

function buildReadinessForAssignmentRow(
  row: { id: string; data: Record<string, unknown> },
  args: {
    userInput: AssignmentReadinessUserInput;
    entityBundle: ReadinessEntityBundleWeb | null;
    complianceItemsRaw: Array<WorkerComplianceItem & { id: string }>;
    backgroundChecks: BackgroundCheckRecord[];
  },
): BuildAssignmentReadinessResult {
  const assignIn = assignmentInputFromRow(row);
  const screening = screeningForAssignment(row.id, args.backgroundChecks);
  const certifications = certificationsForAssignmentRow(
    row.id,
    row.data,
    args.entityBundle,
    args.complianceItemsRaw,
  );

  if (!args.entityBundle) {
    return buildAssignmentReadiness({
      user: args.userInput,
      employment: {},
      assignment: assignIn,
      screening,
      certifications,
    });
  }

  const ek = resolveAssignmentEntityKey(row.data, args.entityBundle);
  const ee = ek ? args.entityBundle.employmentsByKey[ek] : null;
  const pipe = ek ? args.entityBundle.pipelinesByKey[ek] : null;
  const payroll = ek ? args.entityBundle.payrollByKey[ek] : null;
  const entityWt = ek ? args.entityBundle.entityWorkerTypeRawByKey[ek] : null;

  const employment =
    ek != null
      ? assignmentReadinessEmploymentFromPipeline({
          entityKey: ek,
          entityEmployment: ee,
          workerOnboarding: pipe,
          entityWorkerTypeRaw: entityWt,
          workerPayrollAccount: payroll,
        })
      : {};

  return buildAssignmentReadiness({
    user: args.userInput,
    employment,
    assignment: assignIn,
    screening,
    certifications,
  });
}

function complianceItemDisplayLabel(item: WorkerComplianceItem): string {
  const t = String(item.title || '').trim();
  if (t) return t;
  return getComplianceTypeLabel(item.type);
}

const ProfileReadinessTabContent: React.FC<ProfileReadinessTabContentProps> = ({ uid, tenantId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isHRX, claimsRoles, tenantRolesFromProfile, securityLevel } = useAuth();
  /**
   * **R.5** — gate the recruiter-only drawer affordances. We deliberately
   * mirror the Admin Ops gate (`isHRX || tenant Admin`) rather than the
   * worker-self gate used by `EverifyComplianceCard`'s create-case button —
   * the readiness tab is a recruiter surface even when the worker views
   * their own profile.
   */
  const canManageEverify = useMemo(() => {
    if (isHRX) return true;
    if (!tenantId) return false;
    return claimsRoles?.[tenantId]?.role === 'Admin';
  }, [isHRX, tenantId, claimsRoles]);
  /**
   * **R.6** — gate AccuSource adjudication actions. Mirrors the backend
   * `ensureAccusourceAdmin` gate: admin / super_admin / manager role OR
   * security level ≥5 in the active tenant. Falls back to the top-level
   * user-doc `securityLevel` when the tenant slot omits one (matches
   * `resolveAccusourceRoleAndSecurityLevel` server-side).
   */
  const canManageBgCheck = useMemo(() => {
    if (isHRX) return true;
    if (!tenantId) return false;
    const claimsRole = String(claimsRoles?.[tenantId]?.role ?? '').toLowerCase();
    if (['admin', 'super_admin', 'manager'].includes(claimsRole)) return true;
    const profile = tenantRolesFromProfile?.[tenantId];
    if (profile) {
      const role = String(profile.role ?? '').toLowerCase();
      if (['admin', 'super_admin', 'manager'].includes(role)) return true;
      const sl = Number.parseInt(String(profile.securityLevel ?? '0'), 10) || 0;
      if (sl >= 5) return true;
    }
    const sl = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
    return sl >= 5;
  }, [isHRX, tenantId, claimsRoles, tenantRolesFromProfile, securityLevel]);
  const goToEmploymentI9 = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.set('tab', 'employment');
    params.set('focus', 'i9');
    navigate(`${location.pathname}?${params.toString()}`);
  }, [navigate, location.pathname, location.search]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [assignments, setAssignments] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [applications, setApplications] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backgroundChecks, setBackgroundChecks] = useState<BackgroundCheckRecord[]>([]);
  const [complianceItemsRaw, setComplianceItemsRaw] = useState<Array<WorkerComplianceItem & { id: string }>>([]);
  const [entityBundle, setEntityBundle] = useState<ReadinessEntityBundleWeb | null>(null);

  /**
   * **R.7** — per-assignment Job Readiness chip data, sourced from
   * `assignments/{id}.readinessSnapshotV1.jobReadinessChip` (R.4 persisted
   * shape). `null` value = snapshot exists but chip not yet computed (older
   * snapshot from before R.4 deploy, or write hasn't landed yet); missing
   * key = no snapshot at all → chip renders `'computing'`.
   */
  const [chipDataByAssignmentId, setChipDataByAssignmentId] = useState<
    Map<string, JobReadinessChipData | null>
  >(() => new Map());

  /**
   * **R.7** — drill-in highlight state, set from URL params on mount /
   * navigation. Holds the `requirementType` only — the actual matched
   * `req.key`s are computed via `highlightedKeysForRequirementType` in the
   * render path so we don't recompute on every keystroke.
   */
  const [highlightRequirementType, setHighlightRequirementType] = useState<string | null>(null);
  /** ditto — set from URL `itemId` for a future exact-match upgrade. Currently
   * only used for diagnostics + as the cleanup trigger on URL params. */
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const handledDeepLinkRef = useRef(false);

  /**
   * **R.5 + R.6** — vendor-backed employee readiness items for this worker.
   *
   * Originally R.5 only loaded `e_verify` rows for the TNC banner.
   * R.6 broadens to also surface `background_check` / `drug_screen`
   * for the AccuSource adjudication banner + chip drill-in. We keep
   * a single live listener and split into per-channel memos below
   * (`everifyItems`, `bgEmployeeItems`) so we don't pay for two
   * snapshot subscriptions on the same worker × tenant index.
   */
  const [vendorEmployeeItems, setVendorEmployeeItems] = useState<
    Array<EmployeeReadinessItem & { id: string }>
  >([]);
  /** **R.5** — case id currently rendered in `EverifyCaseDrawer` (or null when closed). */
  const [drawerCaseId, setDrawerCaseId] = useState<string | null>(null);
  /** **R.6** — `backgroundChecks/{checkId}` currently rendered in `BackgroundCheckCaseDrawer` (or null when closed). */
  const [drawerCheckId, setDrawerCheckId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid || !tenantId) {
      setLoading(false);
      setAssignments([]);
      setApplications([]);
      setEntityBundle(null);
      setComplianceItemsRaw([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [userSnap, assignmentDocs, bgSnap, complianceSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)),
        (async (): Promise<QueryDocumentSnapshot<DocumentData>[]> => {
          const col = collection(db, p.assignments(tenantId));
          try {
            const assignSnap = await getDocs(query(col, where('userId', '==', uid), orderBy('startDate', 'desc')));
            return assignSnap.docs;
          } catch {
            const snap = await getDocs(query(col, where('userId', '==', uid)));
            return snap.docs.slice().sort((a, b) => {
              const sa = String((a.data() as { startDate?: string }).startDate || '');
              const sb = String((b.data() as { startDate?: string }).startDate || '');
              return sb.localeCompare(sa);
            });
          }
        })(),
        getDocs(
          query(
            collection(db, 'backgroundChecks'),
            where('candidateId', '==', uid),
            where('tenantId', '==', tenantId),
            limit(120),
          ),
        ),
        getDocs(query(collection(db, p.workerComplianceItems(tenantId)), where('userId', '==', uid), limit(80))),
      ]);

      setUserData(userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {});

      const assignRows = await Promise.all(
        assignmentDocs.map(async (d) => ({
          id: d.id,
          data: await enrichUserAssignmentRow(tenantId, d),
        })),
      );
      setAssignments(assignRows);

      // Applications the worker has applied to — shown above assignments
      // with identical readiness. Sourced from `users/{uid}.applicationIds`.
      const applicationIds: string[] = Array.isArray(
        (userSnap.data() as Record<string, unknown> | undefined)?.applicationIds,
      )
        ? ((userSnap.data() as Record<string, unknown>).applicationIds as string[])
        : [];
      const appRows = await loadReadinessApplicationRows(tenantId, uid, applicationIds);
      setApplications(appRows);

      setSelectedId((prev) => {
        const allIds = [...assignRows.map((r) => r.id), ...appRows.map((r) => r.id)];
        if (allIds.length > 0) {
          if (prev && prev !== ENTITY_ONBOARDING_ASSIGNMENT_ID && allIds.includes(prev)) return prev;
          // Default to the first assignment when present, else first application.
          return assignRows[0]?.id ?? appRows[0]!.id;
        }
        return ENTITY_ONBOARDING_ASSIGNMENT_ID;
      });

      // Resolve hiring-entity employment for every entity referenced by an
      // assignment OR an application, so application rows get real
      // employment-readiness too.
      const bundle = await fetchReadinessEntityBundle(tenantId, uid, [...assignRows, ...appRows]);
      setEntityBundle(bundle);

      setBackgroundChecks(
        bgSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BackgroundCheckRecord, 'id'>) })),
      );

      setComplianceItemsRaw(
        complianceSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WorkerComplianceItem, 'id'>),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load readiness data');
    } finally {
      setLoading(false);
    }
  }, [uid, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * **R.7** — live-subscribe to `readinessSnapshotV1.jobReadinessChip` for
   * every visible assignment. The R.4 snapshot writer (`syncHrxReadinessSnapshotV1`,
   * invoked further down on `selectedId` change) writes the chip onto the
   * same doc; the listener picks up the writeback so the lg chip in the
   * header transitions from `'computing'` to its real state without a
   * manual refresh.
   *
   * One listener per assignment — fine at the cardinality this tab sees
   * (single worker × tenant; usually <= 10 assignments). If we ever need
   * to scale this up the right move is to batch-`getDoc` instead of
   * subscribing.
   */
  useEffect(() => {
    if (!tenantId || assignments.length === 0) {
      setChipDataByAssignmentId(new Map());
      return;
    }
    const unsubs: Array<() => void> = [];
    for (const a of assignments) {
      const ref = doc(db, p.assignments(tenantId), a.id);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const v = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
          const snapshotV1 = (v?.readinessSnapshotV1 ?? null) as ReadinessSnapshotV1Firestore | null;
          const chip = snapshotV1?.jobReadinessChip ?? null;
          setChipDataByAssignmentId((prev) => {
            const next = new Map(prev);
            next.set(a.id, chip);
            return next;
          });
        },
        (err) => {
          console.warn('ProfileReadinessTabContent: jobReadinessChip listener failed', a.id, err);
        },
      );
      unsubs.push(unsub);
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [tenantId, assignments]);

  /**
   * **R.5 + R.6** — live-subscribe to `employeeReadinessItems` for this
   * worker. Filters by `workerUid` server-side (cheap index hit) and
   * narrows to vendor-backed types client-side (`e_verify`,
   * `background_check`, `drug_screen`) — the universe is tiny per worker
   * (single-digit rows) so the client filter is safe. Drives:
   *   - R.5: the TNC banner + `EverifyCaseDrawer` deep-link fallback.
   *   - R.6: the AccuSource adjudication banner + `BackgroundCheckCaseDrawer`
   *          deep-link fallback.
   */
  useEffect(() => {
    if (!tenantId || !uid) {
      setVendorEmployeeItems([]);
      return undefined;
    }
    const ref = collection(db, 'tenants', tenantId, 'employeeReadinessItems');
    const q = query(ref, where('workerUid', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setVendorEmployeeItems(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as EmployeeReadinessItem) }))
            .filter(
              (row) =>
                row.requirementType === 'e_verify' ||
                row.requirementType === 'background_check' ||
                row.requirementType === 'drug_screen',
            ),
        );
      },
      (err) => {
        console.warn('ProfileReadinessTabContent: vendor employee items listener failed', err);
      },
    );
    return unsub;
  }, [tenantId, uid]);

  /**
   * **R.5** — `e_verify` slice of the broader vendor employee items.
   * Memoised so consumers (`tncItem`, `resolveEverifyCaseId`, etc.)
   * keep stable references across unrelated re-renders.
   */
  const everifyItems = useMemo(
    () => vendorEmployeeItems.filter((it) => it.requirementType === 'e_verify'),
    [vendorEmployeeItems],
  );

  /**
   * **R.6** — `background_check` + `drug_screen` slice. Drives the BG
   * adjudication banner + chip drill-in. We treat both types as one
   * channel because AccuSource bundles them on the same order
   * (`onBackgroundCheckWriteUpdateReadiness` writes the same
   * `externalRef` checkId to both).
   */
  const bgEmployeeItems = useMemo(
    () =>
      vendorEmployeeItems.filter(
        (it) =>
          it.requirementType === 'background_check' || it.requirementType === 'drug_screen',
      ),
    [vendorEmployeeItems],
  );

  /**
   * **R.7** — consume R.4's drill-in URL params:
   *   `?tab=readiness&assignmentId=<aid>&itemId=<iid>&type=<rtype>&source=<assignment|employee>`
   *
   * The outer `UserProfile/index.tsx` already consumes `tab=readiness` to
   * select this tab and strips the `tab` key. We consume the rest:
   *   - auto-select `assignmentId` if it matches a loaded assignment;
   *   - stash `type` for the highlight pass (`highlightRequirementType`);
   *   - stash `itemId` for diagnostics / future exact match;
   *   - clear all four params from the URL once handled so a refresh
   *     doesn't re-flash the highlight.
   *
   * We gate on `loading` to make sure assignments are loaded before we try
   * to match — otherwise the auto-select would no-op.
   */
  useEffect(() => {
    if (handledDeepLinkRef.current) return;
    if (loading) return;
    const aid = searchParams.get('assignmentId');
    const iid = searchParams.get('itemId');
    const rtype = searchParams.get('type');
    /**
     * **R.5 + R.6** — explicit `caseId` (preferred) carried by the chip
     * drill-in. The same query parameter is used for both vendor channels
     * (E-Verify and AccuSource) — `requirementType` decides which drawer
     * the id is routed into. Falls back to `externalRef` lookup on the
     * matching item (covers older snapshots written before chip plumbing
     * landed for that vendor).
     */
    const caseIdParam = searchParams.get('caseId');
    if (!aid && !iid && !rtype && !caseIdParam) return;
    if (rtype === 'e_verify') {
      const fallback =
        everifyItems.find((it) => typeof it.externalRef === 'string' && it.externalRef.length > 0)
          ?.externalRef ?? null;
      const resolved = caseIdParam ?? fallback;
      if (resolved) {
        setDrawerCaseId(resolved);
      } else if (!caseIdParam && everifyItems.length === 0) {
        // Items listener hasn't fired yet — defer finalising so the next
        // re-run (with `everifyItems` populated) can resolve the caseId.
        return;
      }
    }
    if (rtype === 'background_check' || rtype === 'drug_screen') {
      const fallback =
        bgEmployeeItems.find(
          (it) => typeof it.externalRef === 'string' && it.externalRef.length > 0,
        )?.externalRef ?? null;
      const resolved = caseIdParam ?? fallback;
      if (resolved) {
        setDrawerCheckId(resolved);
      } else if (!caseIdParam && bgEmployeeItems.length === 0) {
        // Same defer pattern as the e_verify branch — let the listener
        // fire before deciding we have nothing to open.
        return;
      }
    }
    if (aid && assignments.some((a) => a.id === aid)) {
      setSelectedId(aid);
    }
    if (iid) setHighlightItemId(iid);
    if (rtype) setHighlightRequirementType(rtype);
    handledDeepLinkRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('assignmentId');
    next.delete('itemId');
    next.delete('type');
    next.delete('source');
    next.delete('caseId');
    setSearchParams(next, { replace: true });
  }, [searchParams, loading, assignments, setSearchParams, everifyItems, bgEmployeeItems]);

  /**
   * **R.7** — flash the highlighted requirement row(s), then clear the
   * highlight after ~3.5s. Matches the existing `employmentI9SectionFlash`
   * / `backgroundComplianceHighlightId` pattern in `UserProfile/index.tsx`.
   * Also scrolls the first matching row into view once the requirements
   * have been computed.
   */
  useEffect(() => {
    if (!highlightRequirementType) return;
    // Scroll into view on next frame so the row has mounted.
    const matches = highlightedKeysForRequirementType(highlightRequirementType);
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        // Prefer the must / important / admin sort order — first match wins.
        const candidate = Array.from(
          document.querySelectorAll<HTMLElement>('[id^="readiness-requirement-row-"]'),
        ).find((el) => {
          const k = el.id.replace('readiness-requirement-row-', '');
          return matches(k);
        });
        candidate?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 220);
    });
    const t = window.setTimeout(() => {
      setHighlightRequirementType(null);
      setHighlightItemId(null);
    }, 3500);
    return () => window.clearTimeout(t);
  }, [highlightRequirementType]);

  /** Persist canonical `readinessSnapshotV1` on the assignment (server recomputes; idempotent). */
  useEffect(() => {
    if (!tenantId || !selectedId || loading || selectedId === ENTITY_ONBOARDING_ASSIGNMENT_ID) return;
    const t = window.setTimeout(() => {
      const fn = httpsCallable(functions, 'syncHrxReadinessSnapshotV1');
      void fn({ tenantId, assignmentId: selectedId }).catch((err) => {
        console.warn('ProfileReadinessTabContent: syncHrxReadinessSnapshotV1 failed', err);
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [tenantId, selectedId, loading]);

  const userInput: AssignmentReadinessUserInput = useMemo(
    () => ({ workAuthorization: getWorkAuthorizedStatus(userData) === 'yes' }),
    [userData],
  );

  const entityScopeSyntheticRow = useMemo(() => {
    const ek = pickPrimaryEntityKeyForEntityReadiness(entityBundle);
    const labels: Record<EmploymentEntityKey, string> = {
      select: 'C1 Select',
      workforce: 'C1 Workforce',
      events: 'C1 Events',
    };
    return {
      id: ENTITY_ONBOARDING_ASSIGNMENT_ID,
      data: {
        entityKey: ek,
        jobTitle: `Entity onboarding (${labels[ek]})`,
        status: 'No assignment in this tenant',
        showBackgroundChecks: false,
        drugScreenRequired: false,
      } as Record<string, unknown>,
    };
  }, [entityBundle]);

  const selectedAssignment = useMemo(() => {
    if (
      assignments.length === 0 &&
      applications.length === 0 &&
      selectedId === ENTITY_ONBOARDING_ASSIGNMENT_ID
    ) {
      return entityScopeSyntheticRow;
    }
    return (
      assignments.find((a) => a.id === selectedId) ??
      applications.find((a) => a.id === selectedId) ??
      null
    );
  }, [assignments, applications, selectedId, entityScopeSyntheticRow]);

  // Entity-scope (onboarding) view only when the worker has NEITHER
  // assignments nor applications in this tenant.
  const isEntityScopeReadiness = assignments.length === 0 && applications.length === 0;

  const certificationsForSelection = useMemo(() => {
    if (!selectedId || !selectedAssignment || !entityBundle) return [];
    return certificationsForAssignmentRow(selectedId, selectedAssignment.data, entityBundle, complianceItemsRaw);
  }, [selectedId, selectedAssignment, entityBundle, complianceItemsRaw]);

  const assignmentInput: AssignmentReadinessAssignmentInput | null = useMemo(() => {
    if (!selectedAssignment) return null;
    return assignmentInputFromRow(selectedAssignment);
  }, [selectedAssignment]);

  const screeningInput = useMemo(() => {
    if (!selectedId) return {};
    return screeningForAssignment(selectedId, backgroundChecks);
  }, [selectedId, backgroundChecks]);

  // Actual AccuSource package line items for this assignment (parsed from
  // the worker's background-check record) — drives the detailed
  // "Background & drug screenings" list.
  const screeningPackage = useMemo(() => {
    if (!selectedId) return null;
    return screeningPackageForAssignment(selectedId, backgroundChecks);
  }, [selectedId, backgroundChecks]);

  const readinessResult: BuildAssignmentReadinessResult = useMemo(() => {
    if (!selectedAssignment) {
      return {
        readiness: 'PENDING_INITIALIZATION',
        requirements: [],
        summary: { blockers: 0, warnings: 0, completed: 0 },
      };
    }
    return buildReadinessForAssignmentRow(selectedAssignment, {
      userInput,
      entityBundle,
      complianceItemsRaw,
      backgroundChecks,
    });
  }, [selectedAssignment, userInput, entityBundle, complianceItemsRaw, backgroundChecks]);

  const readinessByAssignmentId = useMemo(() => {
    const map = new Map<string, OverallReadinessState>();
    const args = {
      userInput,
      entityBundle,
      complianceItemsRaw,
      backgroundChecks,
    };
    // Cover both assignment rows and application rows — their ids are
    // disjoint (`app_` prefix) so a single map is unambiguous.
    for (const row of [...assignments, ...applications]) {
      const r = buildReadinessForAssignmentRow(row, args);
      map.set(row.id, r.readiness);
    }
    return map;
  }, [assignments, applications, userInput, entityBundle, complianceItemsRaw, backgroundChecks]);

  const nextActions = useMemo(
    () => computeNextActions(readinessResult.requirements, 3),
    [readinessResult.requirements],
  );

  // Three semantic sections (2026-06-03 request) — the panel now reads as
  // exactly three things:
  //   1. Employment readiness — is the worker onboarded with the
  //      assignment's hiring entity (work auth, I-9, payroll, tax).
  //   2. Background & drug screenings — required checks for this assignment.
  //   3. Certifications — required licenses / credentials.
  const requirementsEmployment = useMemo(
    () =>
      sortRequirementsForSection(
        readinessResult.requirements.filter(
          (r) => r.category === 'identity' || r.category === 'employment',
        ),
        'must',
      ),
    [readinessResult.requirements],
  );
  const requirementsScreening = useMemo(
    () =>
      sortRequirementsForSection(
        readinessResult.requirements.filter((r) => r.category === 'screening'),
        'important',
      ),
    [readinessResult.requirements],
  );
  const requirementsCertifications = useMemo(
    () =>
      sortRequirementsForSection(
        readinessResult.requirements.filter((r) => r.category === 'certification'),
        'admin',
      ),
    [readinessResult.requirements],
  );

  /**
   * **R.7** — predicate that decides which requirement rows render in the
   * highlighted state on this render pass. Memoised for stability; depends
   * on `highlightRequirementType` only.
   */
  const isRequirementHighlighted = useCallback(
    (key: string): boolean => {
      if (!highlightRequirementType) return false;
      return highlightedKeysForRequirementType(highlightRequirementType)(key);
    },
    [highlightRequirementType],
  );

  const renderRequirementRows = (reqs: ReadinessRequirement[]) => (
    <Stack spacing={0.35}>
      {reqs.map((req) => (
        <ReadinessRequirementRow
          key={req.key}
          req={req}
          onNavigateEmploymentI9={goToEmploymentI9}
          highlighted={isRequirementHighlighted(req.key)}
        />
      ))}
    </Stack>
  );

  /** A single selectable left-panel card — shared by the Applications and
   *  Assignments lists so both render identically. */
  const renderReadinessRow = (a: { id: string; data: Record<string, unknown> }) => {
    const title = assignmentDisplayName(a.data);
    const sel = a.id === selectedId;
    const rowState = readinessByAssignmentId.get(a.id) ?? 'PENDING_INITIALIZATION';
    return (
      <ListItemButton
        key={a.id}
        selected={sel}
        onClick={() => setSelectedId(a.id)}
        alignItems="flex-start"
      >
        <Box sx={{ minWidth: 0, width: '100%', pr: 0.5 }}>
          <Typography variant="body2" fontWeight={sel ? 700 : 500} title={title}>
            {title}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.35, lineHeight: 1.35 }}
          >
            {assignmentStartDateShort(a.data)}
          </Typography>
          <Stack spacing={0.2} sx={{ mt: 0.65 }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              <Box component="span" sx={{ fontWeight: 600, color: 'text.disabled' }}>
                Job order
              </Box>
              {': '}
              {displayDetail(a.data.jobOrderDisplayName)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              <Box component="span" sx={{ fontWeight: 600, color: 'text.disabled' }}>
                Account
              </Box>
              {': '}
              {displayDetail(a.data.companyDisplayName)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              <Box component="span" sx={{ fontWeight: 600, color: 'text.disabled' }}>
                Worksite
              </Box>
              {': '}
              {displayDetail(a.data.worksiteDisplayName)}
            </Typography>
          </Stack>
          <Chip
            label={readinessBadgeLabel(rowState)}
            color={readinessBadgeColor(rowState)}
            size="small"
            sx={{ mt: 0.75, fontWeight: 700, height: 'auto', py: 0.35, '& .MuiChip-label': { px: 1, whiteSpace: 'normal' } }}
          />
        </Box>
      </ListItemButton>
    );
  };

  /**
   * **R.5** — first `e_verify` employee item that the worker / recruiter
   * still owes action on. We treat `'needs_review'` as "TNC awaiting
   * recruiter action" because R.0c+R.1 normalised TNC into `needs_review`
   * (severity `hard`, resolutionMethod `recruiter_action`). The banner
   * uses this row's `externalRef` as the case id; if the trigger never
   * back-filled `externalRef` (legacy items pre-R.0c), the banner button
   * falls back to the first non-empty value across `everifyItems`.
   */
  const tncItem = useMemo(() => {
    return everifyItems.find((it) => it.status === 'needs_review') ?? null;
  }, [everifyItems]);

  const resolveEverifyCaseId = useCallback(
    (preferred?: string | null): string | null => {
      if (preferred && preferred.length > 0) return preferred;
      const candidates = everifyItems
        .map((it) => (typeof it.externalRef === 'string' ? it.externalRef : ''))
        .filter((s) => s.length > 0);
      return candidates[0] ?? null;
    },
    [everifyItems],
  );

  /**
   * **R.6** — first `background_check` / `drug_screen` employee item that
   * still owes adjudication action. AccuSource line-level reviews flow
   * through `'needs_review'` (severity `hard`, resolutionMethod
   * `recruiter_action` per the readiness writer in
   * `onBackgroundCheckWriteUpdateReadiness`). The banner we render off
   * this is the primary entry-point into `BackgroundCheckCaseDrawer` from
   * the readiness tab; the chip popover row also opens it via
   * `handleHeaderChipItemClick`.
   */
  const bgNeedsReviewItem = useMemo(() => {
    return bgEmployeeItems.find((it) => it.status === 'needs_review') ?? null;
  }, [bgEmployeeItems]);

  /**
   * **R.6** — resolve a `backgroundChecks/{checkId}` doc id from a
   * preferred value (typically `contributor.caseId` from the chip
   * popover) with fallback to the first non-empty `externalRef` across
   * the loaded BG/drug items. Mirrors `resolveEverifyCaseId`.
   */
  const resolveBgCheckId = useCallback(
    (preferred?: string | null): string | null => {
      if (preferred && preferred.length > 0) return preferred;
      const candidates = bgEmployeeItems
        .map((it) => (typeof it.externalRef === 'string' ? it.externalRef : ''))
        .filter((s) => s.length > 0);
      return candidates[0] ?? null;
    },
    [bgEmployeeItems],
  );

  /**
   * **R.7** — `JobReadinessChip` drill-in handler scoped to this tab. The
   * chip is rendered inline in the header; clicking a popover row fires
   * with the contributor — we map it to a row highlight + scroll using
   * the same machinery as the URL deep-link path.
   *
   * **R.5** — `e_verify` contributors open `EverifyCaseDrawer` directly,
   * since E-Verify lives only on the chip / banner / drawer surface (no
   * row in the requirements list). Uses contributor's `caseId` (R.5 chip
   * plumbing) with a fall-back to the first `everifyItems.externalRef`.
   *
   * **R.6** — `background_check` / `drug_screen` contributors open
   * `BackgroundCheckCaseDrawer` instead of (or in addition to) row-
   * highlighting. The contributor `caseId` is the
   * `backgroundChecks/{checkId}` doc id (writer in
   * `onBackgroundCheckWriteUpdateReadiness`). We *also* fall through to
   * the highlight path so the requirement row still flashes — useful
   * context when the recruiter dismisses the drawer.
   */
  const handleHeaderChipItemClick = useCallback(
    (contributor: JobReadinessChipContributor) => {
      if (contributor.requirementType === 'e_verify') {
        const caseId = resolveEverifyCaseId(contributor.caseId);
        if (caseId) {
          setDrawerCaseId(caseId);
          return;
        }
      }
      if (
        contributor.requirementType === 'background_check' ||
        contributor.requirementType === 'drug_screen'
      ) {
        const checkId = resolveBgCheckId(contributor.caseId);
        if (checkId) {
          setDrawerCheckId(checkId);
        }
      }
      setHighlightRequirementType(contributor.requirementType);
      setHighlightItemId(contributor.itemId);
    },
    [resolveEverifyCaseId, resolveBgCheckId],
  );

  /**
   * **R.7** — chip data for the currently-selected assignment. `null` while
   * the snapshot listener hasn't fired yet → renders `'computing'`. Suppressed
   * entirely on entity-scope (no per-shift chip applies).
   */
  const headerChipData = useMemo<JobReadinessChipData | null>(() => {
    if (!selectedId || selectedId === ENTITY_ONBOARDING_ASSIGNMENT_ID) return null;
    return chipDataByAssignmentId.get(selectedId) ?? null;
  }, [selectedId, chipDataByAssignmentId]);
  const showHeaderChip = !isEntityScopeReadiness && selectedId !== ENTITY_ONBOARDING_ASSIGNMENT_ID;

  return (
    <Box sx={{ pb: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Placement readiness when the worker has assignments; otherwise entity-level onboarding (I-9, payroll, tax, policies,
        etc.) from their C1 employment row.
      </Typography>

      {!tenantId && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Select a tenant to load assignments and readiness.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/**
        * **R.5** — TNC alert banner. Renders only when an `e_verify` item
        * is in `'needs_review'` AND the viewer can act on E-Verify (HRX
        * superadmin / tenant Admin). Worker self-views see no banner —
        * the worker-side action card lives in the Flutter app (R.9). The
        * banner is the primary entry-point into the drawer for tenant
        * Admins coming straight to the readiness tab; the chip popover
        * row also opens it via `handleHeaderChipItemClick`.
        */}
      {tncItem && canManageEverify && tenantId && (
        <Alert
          severity="error"
          icon={<WarningAmberIcon fontSize="inherit" />}
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                const cid = resolveEverifyCaseId(tncItem.externalRef ?? null);
                if (cid) setDrawerCaseId(cid);
              }}
            >
              Manage TNC
            </Button>
          }
        >
          E-Verify TNC requires action — the worker has a Tentative
          Non-Confirmation that must be resolved before the placement is
          job-ready.
        </Alert>
      )}

      {/**
        * **R.6** — AccuSource adjudication banner. Renders only when a
        * `background_check` or `drug_screen` employee item is in
        * `'needs_review'` AND the viewer can act on AccuSource (mirrors
        * the backend `ensureAccusourceAdmin` gate via `canManageBgCheck`).
        * The button opens `BackgroundCheckCaseDrawer` for the resolved
        * checkId — the chip popover row also opens it via
        * `handleHeaderChipItemClick`.
        */}
      {bgNeedsReviewItem && canManageBgCheck && tenantId && (
        <Alert
          severity="warning"
          icon={<WarningAmberIcon fontSize="inherit" />}
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                const cid = resolveBgCheckId(bgNeedsReviewItem.externalRef ?? null);
                if (cid) setDrawerCheckId(cid);
              }}
            >
              Adjudicate
            </Button>
          }
        >
          Background screening needs review — at least one service line
          requires recruiter adjudication before the placement is
          job-ready.
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 1 }}>
              {/* Applications — jobs the worker has applied to. Shown above
                  Assignments with identical readiness. Hidden when none. */}
              {applications.length > 0 && (
                <>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ px: 1, py: 1 }}>
                    Applications
                  </Typography>
                  <Divider />
                  <List dense disablePadding>
                    {applications.map((a) => renderReadinessRow(a))}
                  </List>
                  <Box sx={{ height: 12 }} />
                </>
              )}

              <Typography variant="subtitle2" fontWeight={700} sx={{ px: 1, py: 1 }}>
                Assignments
              </Typography>
              <Divider />
              {assignments.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No assignments for this worker in this tenant.
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45, display: 'block' }}>
                    The Readiness panel shows onboarding steps for the primary C1 entity (Select, then Workforce, then
                    Events) based on their employment and pipeline data.
                  </Typography>
                </Box>
              ) : (
                <List dense disablePadding>
                  {assignments.map((a) => renderReadinessRow(a))}
                </List>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12} md={8}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {!selectedAssignment || !assignmentInput ? (
                <Stack alignItems="center" gap={1} sx={{ py: 4 }}>
                  <HourglassEmptyIcon color="disabled" />
                  <Typography variant="body2" color="text.secondary">
                    Select an assignment to view readiness.
                  </Typography>
                </Stack>
              ) : (
                <>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" fontWeight={800}>
                        {assignmentInput.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {isEntityScopeReadiness ? 'Entity scope' : `Assignment status: ${assignmentInput.status}`}
                      </Typography>
                      {!isEntityScopeReadiness && (
                        <Stack spacing={0.25} sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>Job order</Box>
                            {': '}
                            {displayDetail(selectedAssignment.data.jobOrderDisplayName)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>Account</Box>
                            {': '}
                            {displayDetail(selectedAssignment.data.companyDisplayName)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>Worksite</Box>
                            {': '}
                            {displayDetail(selectedAssignment.data.worksiteDisplayName)}
                          </Typography>
                        </Stack>
                      )}
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                        {isEntityScopeReadiness
                          ? 'These steps come from the worker’s entity employment and onboarding pipeline. Assignment-specific screening appears once they have a placement.'
                          : 'Readiness reflects this specific assignment.'}
                      </Typography>
                    </Box>
                    {showHeaderChip ? (
                      // **R.7** — Job Readiness chip (lg variant of the same
                      // component that ships on placement tiles in R.4).
                      // Replaces the legacy 4-state badge here when the row
                      // is a real per-shift assignment; entity-scope rows
                      // keep the legacy badge below since the chip is
                      // per-shift only.
                      <JobReadinessChip
                        data={headerChipData}
                        size="lg"
                        onItemClick={handleHeaderChipItemClick}
                        popoverTitle={assignmentInput.name}
                      />
                    ) : (
                      <Chip
                        label={readinessBadgeLabel(readinessResult.readiness)}
                        color={readinessBadgeColor(readinessResult.readiness)}
                        size="medium"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                  </Stack>

                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, mb: 1.5 }}>
                    {readinessResult.summary.blockers} must-fix · {readinessResult.summary.warnings} need attention ·{' '}
                    {readinessResult.summary.completed} complete
                  </Typography>

                  {nextActions.length > 0 && (
                    <Box sx={{ mb: 3, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                        Next actions
                      </Typography>
                      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                        {nextActions.map((line, i) => (
                          <Typography key={`${i}-${line}`} component="li" variant="body2" sx={{ lineHeight: 1.45 }}>
                            {line}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  )}

                  <Divider sx={{ mb: 3 }} />

                  {/* 1. Employment readiness — onboarded with the
                      assignment's hiring entity. Always shown. */}
                  <Box sx={{ mb: 3.5 }}>
                    <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                      Employment readiness
                    </Typography>
                    {requirementsEmployment.length > 0 ? (
                      renderRequirementRows(requirementsEmployment)
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No employment items to show for this entity.
                      </Typography>
                    )}
                  </Box>

                  {/* 2. Background checks & drug screenings — the actual
                      AccuSource package line items (parsed from the
                      worker's background-check record), each with its own
                      status. Falls back to the generic background/drug
                      requirement rows when no parsed package exists, then
                      to an empty-state. */}
                  <Box sx={{ mb: 3.5 }}>
                    <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                      Background &amp; drug screenings
                    </Typography>
                    {screeningPackage ? (
                      <Box>
                        {screeningPackage.packageName ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.85 }}>
                            Package: {screeningPackage.packageName}
                          </Typography>
                        ) : null}
                        <Stack spacing={0.5}>
                          {screeningPackage.items.map((item) => (
                            <Stack key={item.id} direction="row" alignItems="flex-start" spacing={1}>
                              {screeningVerdictIcon(item.verdict)}
                              <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.45 }}>
                                {item.name}
                                {item.type ? ` (${item.type})` : ''}: {item.status}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    ) : requirementsScreening.length > 0 ? (
                      renderRequirementRows(requirementsScreening)
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No background check or drug screen required for this assignment.
                      </Typography>
                    )}
                  </Box>

                  {/* 3. Certifications — required licenses / credentials. */}
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                      Certifications
                    </Typography>
                    {requirementsCertifications.length > 0 ? (
                      renderRequirementRows(requirementsCertifications)
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No certifications required for this assignment.
                      </Typography>
                    )}
                  </Box>

                  {/**
                    * **R.3** — generalized CSA action surface for the
                    * non-vendor readiness items on this assignment
                    * (willingness types, *_match types, custom). E-Verify
                    * + AccuSource items are filtered out by the section
                    * (they have their own drawers above) and refused
                    * server-side as a defense-in-depth gate. The section
                    * self-suppresses when `canManage` is false or there
                    * are no eligible rows, so non-admins / single-vendor
                    * shifts never see the empty placeholder.
                    *
                    * Skipped on the entity-onboarding sentinel — those
                    * rows aren't backed by `assignmentReadinessItems`.
                    */}
                  {/* Recruiter actions (ReadinessCsaActionsSection) hidden
                      per 2026-06-03 request. The `false &&` guard keeps the
                      import referenced so the CI build (CI=true → unused
                      imports are errors) stays green. Remove the leading
                      `false && ` to restore. */}
                  {false && tenantId && !isEntityScopeReadiness && selectedAssignment && (
                    <ReadinessCsaActionsSection
                      tenantId={tenantId}
                      assignmentId={selectedAssignment.id}
                      canManage={canManageBgCheck}
                    />
                  )}
                </>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      {/**
        * **R.5** — single shared `EverifyCaseDrawer` instance for the
        * Readiness tab. Opened from (a) the TNC banner above, (b) the
        * `e_verify` row in the chip popover, and (c) the URL deep-link
        * (`?tab=readiness&type=e_verify[&caseId=…]`). Mounted at the
        * panel root so it overlays the whole tab regardless of which
        * assignment is selected. We pass `tenantId` only when defined to
        * match the prop shape and avoid spurious re-renders.
        */}
      {drawerCaseId && tenantId && (
        <EverifyCaseDrawer
          tenantId={tenantId}
          caseId={drawerCaseId}
          canManage={canManageEverify}
          open={Boolean(drawerCaseId)}
          onClose={() => setDrawerCaseId(null)}
        />
      )}

      {/**
        * **R.6** — single shared `BackgroundCheckCaseDrawer` instance.
        * Mirrors the `EverifyCaseDrawer` mounting pattern. Opened from
        * (a) the AccuSource adjudication banner above, (b) the
        * `background_check` / `drug_screen` chip popover row, and (c)
        * the URL deep-link
        * (`?tab=readiness&type=background_check[&caseId=…]` /
        * `…&type=drug_screen…`). `canManage` mirrors the backend
        * `ensureAccusourceAdmin` gate via `canManageBgCheck`; the
        * drawer additionally enforces a tenant fail-safe internally
        * (refuses write actions on cross-tenant deep-links).
        */}
      {drawerCheckId && tenantId && (
        <BackgroundCheckCaseDrawer
          tenantId={tenantId}
          checkId={drawerCheckId}
          canManage={canManageBgCheck}
          open={Boolean(drawerCheckId)}
          onClose={() => setDrawerCheckId(null)}
        />
      )}
    </Box>
  );
};

export default ProfileReadinessTabContent;
