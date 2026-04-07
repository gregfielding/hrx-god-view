/**
 * Readiness (V1) on User Profile — per assignment when placements exist; otherwise entity-level onboarding from
 * `entity_employments` / pipeline (no assignment required).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  List,
  ListItemButton,
  Paper,
  Stack,
  Typography,
  Alert,
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
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { getWorkAuthorizedStatus } from '../../../utils/workAuthorizedDisplay';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
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

function ReadinessRequirementRow(props: {
  req: ReadinessRequirement;
  onNavigateEmploymentI9: () => void;
}) {
  const { req, onNavigateEmploymentI9 } = props;
  const linkEmployment = readinessRequirementKeyLinksToEmploymentI9(req.key);
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
        onClick={onNavigateEmploymentI9}
        aria-label="Open Employment tab for I-9 and work authorization"
        sx={{
          borderRadius: 1,
          py: 0.75,
          px: 1,
          alignItems: 'flex-start',
        }}
      >
        {rowContent}
      </ListItemButton>
    );
  }
  return (
    <Stack sx={{ py: 0.25, px: 0.5 }}>
      {rowContent}
    </Stack>
  );
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

type PrioritySectionId = 'must' | 'important' | 'admin';

function requirementPrioritySection(req: ReadinessRequirement): PrioritySectionId {
  if (req.severity === 'hard_block') return 'must';
  if (req.category === 'employment' || req.category === 'screening') return 'important';
  return 'admin';
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backgroundChecks, setBackgroundChecks] = useState<BackgroundCheckRecord[]>([]);
  const [complianceItemsRaw, setComplianceItemsRaw] = useState<Array<WorkerComplianceItem & { id: string }>>([]);
  const [entityBundle, setEntityBundle] = useState<ReadinessEntityBundleWeb | null>(null);

  const load = useCallback(async () => {
    if (!uid || !tenantId) {
      setLoading(false);
      setAssignments([]);
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
      setSelectedId((prev) => {
        if (assignRows.length > 0) {
          if (prev && prev !== ENTITY_ONBOARDING_ASSIGNMENT_ID && assignRows.some((r) => r.id === prev)) return prev;
          return assignRows[0]!.id;
        }
        return ENTITY_ONBOARDING_ASSIGNMENT_ID;
      });

      const bundle = await fetchReadinessEntityBundle(tenantId, uid, assignRows);
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
    if (assignments.length === 0 && selectedId === ENTITY_ONBOARDING_ASSIGNMENT_ID) return entityScopeSyntheticRow;
    return assignments.find((a) => a.id === selectedId) ?? null;
  }, [assignments, selectedId, entityScopeSyntheticRow]);

  const isEntityScopeReadiness = assignments.length === 0;

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
    for (const row of assignments) {
      const r = buildReadinessForAssignmentRow(row, args);
      map.set(row.id, r.readiness);
    }
    return map;
  }, [assignments, userInput, entityBundle, complianceItemsRaw, backgroundChecks]);

  const nextActions = useMemo(
    () => computeNextActions(readinessResult.requirements, 3),
    [readinessResult.requirements],
  );

  const requirementsMust = useMemo(
    () => sortRequirementsForSection(
      readinessResult.requirements.filter((r) => requirementPrioritySection(r) === 'must'),
      'must',
    ),
    [readinessResult.requirements],
  );
  const requirementsImportant = useMemo(
    () => sortRequirementsForSection(
      readinessResult.requirements.filter((r) => requirementPrioritySection(r) === 'important'),
      'important',
    ),
    [readinessResult.requirements],
  );
  const requirementsAdmin = useMemo(
    () => sortRequirementsForSection(
      readinessResult.requirements.filter((r) => requirementPrioritySection(r) === 'admin'),
      'admin',
    ),
    [readinessResult.requirements],
  );

  const renderRequirementRows = (reqs: ReadinessRequirement[]) => (
    <Stack spacing={0.35}>
      {reqs.map((req) => (
        <ReadinessRequirementRow key={req.key} req={req} onNavigateEmploymentI9={goToEmploymentI9} />
      ))}
    </Stack>
  );

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

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 1 }}>
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
                  {assignments.map((a) => {
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
                  })}
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
                    <Chip
                      label={readinessBadgeLabel(readinessResult.readiness)}
                      color={readinessBadgeColor(readinessResult.readiness)}
                      size="medium"
                      sx={{ fontWeight: 700 }}
                    />
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

                  {requirementsMust.length > 0 && (
                    <Box sx={{ mb: 3.5 }}>
                      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                        Must complete
                      </Typography>
                      {renderRequirementRows(requirementsMust)}
                    </Box>
                  )}

                  {requirementsImportant.length > 0 && (
                    <Box sx={{ mb: 3.5 }}>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                        Important
                      </Typography>
                      {renderRequirementRows(requirementsImportant)}
                    </Box>
                  )}

                  {requirementsAdmin.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.25, letterSpacing: 0.02 }}>
                        Admin / compliance
                      </Typography>
                      {renderRequirementRows(requirementsAdmin)}
                    </Box>
                  )}
                </>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default ProfileReadinessTabContent;
