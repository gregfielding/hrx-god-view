/**
 * Worker-facing "My Employment" entity detail.
 * Onboarding uses the same canonical path as admin (`buildOnboardingPathFromSettings` + worker filter + buckets).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import IconButton from '@mui/material/IconButton';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import { buildBlockersFromPipeline } from '../../../utils/employmentReadiness';
import {
  computeHasOpenOnboardingDemand,
  deriveDominantActionableForHeader,
  deriveEmploymentHeaderState,
  deriveEmploymentHeaderStateWorkerListFallback,
  employmentBlockerItemFromPathRow,
  employmentHeaderStateLabel,
  primaryAssignmentRowForHeader,
} from '../../../utils/deriveEmploymentHeaderState';
import { getWorkerPayrollAccount } from '../../../utils/workerPayrollAccount';
import { getPayrollStatusLabel } from '../../../types/payroll';
import { getComplianceTypeLabel, getComplianceStatusDisplayLabel } from '../../../types/compliance';
import { getExpirationState, hasExpiredCompliance, hasExpiringSoonCompliance } from '../../../utils/complianceExpiration';
import { getWorkerReadiness, type ReadinessStatus } from '../../../utils/workerReadiness';
import type { WorkerComplianceItem } from '../../../types/compliance';
import type {
  EmploymentAssignmentSummary,
  EmploymentEntityKey,
  EmploymentOnboardingRow,
  WorkerOnboardingPipeline,
} from '../../UserProfile/components/employment-v2/employmentV2Types';
import { normalizeEntityKey } from '../../../utils/employmentEntityPresentation';
import {
  buildOnboardingPathFromSettings,
  filterEntityRelationshipOnboardingPathGroups,
  isOnboardingPathRowBlocker,
  isOnboardingPathRowDone,
} from '../../../utils/employmentOnboardingPath';
import {
  enrichOnboardingPathGroupsWithNarratives,
  narrativeActorLabelForUi,
  automationDispatchBriefMatchesEntityTab,
  onboardingAutomationDispatchBriefFromRaw,
  onboardingNarrativeContextFromPathArgs,
} from '../../../utils/employmentOnboardingNarrative';
import { filterOnboardingPathGroupsForWorkerUi } from '../../../utils/employmentOnboardingRowVisibility';
import { loadBuildOnboardingPathArgsForWorkerEmployment } from '../../../utils/workerEmploymentOnboardingLoad';
import {
  dedupeWorkerOnboardingRows,
  deriveWorkerGroupKey,
  flattenFilteredWorkerGroups,
  partitionWorkerOnboardingRows,
  workerOnboardingRequirementLabel,
  workerOnboardingStatusChip,
  workerOnboardingSubtitle,
  workerPathCoversPayrollRow,
  workerPathCoversWorkAuthRows,
  type WorkerOnboardingBucketId,
} from '../../../utils/workerOnboardingPathPresentation';

interface EmploymentRecord {
  id: string;
  entityId?: string | null;
  entityName: string;
  entityKey: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  onboardingStartedAt?: { toDate: () => Date } | null;
  onboardingCompletedAt?: { toDate: () => Date } | null;
  onboardingPhase?: string | null;
  hiredAt?: { toDate: () => Date } | null;
  everifyStatus?: string;
  backgroundRequired?: boolean;
  drugScreenRequired?: boolean;
  employmentEntryMode?: string | null;
}

const EMPTY_BUCKETS: Record<WorkerOnboardingBucketId, EmploymentOnboardingRow[]> = {
  your_tasks: [],
  waiting_team: [],
  behind_scenes: [],
  completed: [],
};

/** Entity-level TempWorks URLs: setup (`onboardingUrl`) vs login portal (`portalUrl`). */
const WorkerEntityPayrollLinkButtons: React.FC<{
  payrollSignupUrl: string | null;
  payrollPortalLoginUrl: string | null;
  payrollComplete: boolean;
}> = ({ payrollSignupUrl, payrollPortalLoginUrl, payrollComplete }) => {
  const signup = payrollSignupUrl?.trim() || null;
  const portal = payrollPortalLoginUrl?.trim() || null;
  const same = Boolean(signup && portal && signup === portal);

  const setupHref = !payrollComplete ? signup || portal || null : null;
  const loginWhileOnboardingHref = !payrollComplete && portal && signup && !same ? portal : null;
  const portalAfterCompleteHref = payrollComplete ? portal || signup || null : null;

  if (!setupHref && !loginWhileOnboardingHref && !portalAfterCompleteHref) return null;

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
      {setupHref ? (
        <Button
          variant="contained"
          size="small"
          startIcon={<OpenInNewIcon />}
          href={setupHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
        >
          Open payroll setup
        </Button>
      ) : null}
      {loginWhileOnboardingHref ? (
        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenInNewIcon />}
          href={loginWhileOnboardingHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
        >
          Payroll login (existing account)
        </Button>
      ) : null}
      {portalAfterCompleteHref ? (
        <Button
          variant={setupHref || loginWhileOnboardingHref ? 'outlined' : 'contained'}
          size="small"
          startIcon={<OpenInNewIcon />}
          href={portalAfterCompleteHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
        >
          Open payroll portal
        </Button>
      ) : null}
    </Stack>
  );
};

/** Matches `employmentPathDebugEnv` / admin path card — inlined so worker bundle always resolves. */
function workerEmploymentPathDebugEnabled(): boolean {
  try {
    return process.env.REACT_APP_EMPLOYMENT_ONBOARDING_PATH_DEBUG === 'true';
  } catch {
    return false;
  }
}

function workerRequirementLabelHistorical(row: EmploymentOnboardingRow): string | null {
  if (isOnboardingPathRowDone(row.status)) return null;
  if (row.blocking) return 'From a prior assignment — not current required work here';
  if (row.required) return 'Was part of a prior onboarding';
  return null;
}

function workerSubtitleWithHistoricalContext(row: EmploymentOnboardingRow, pathHistorical: boolean): string {
  const base = workerOnboardingSubtitle(row);
  if (!pathHistorical || isOnboardingPathRowDone(row.status)) return base;
  if (!base) return 'Prior onboarding activity on file';
  if (base === 'Action needed') return 'Prior activity on file — no current action expected';
  return `Prior activity: ${base}`;
}

function WorkerOnboardingPathRowItem({
  row,
  debugMode,
  pathHistorical,
}: {
  row: EmploymentOnboardingRow;
  debugMode: boolean;
  /** When true, soften requirement lines and status chips so nothing reads as urgent current work. */
  pathHistorical?: boolean;
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const details = row.workerGroupDetailRows;
  const showExpand = Boolean(debugMode && details && details.length > 1);
  const pipelineLabel = row.workerGroupPipelineStepId ?? row.sourceRef?.pipelineStepId;
  const requirementLabel =
    pathHistorical && !isOnboardingPathRowDone(row.status)
      ? workerRequirementLabelHistorical(row)
      : workerOnboardingRequirementLabel(row);
  const subtitle = workerSubtitleWithHistoricalContext(row, Boolean(pathHistorical));
  const done = isOnboardingPathRowDone(row.status);

  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" gap={0.5} flexWrap="nowrap">
        {showExpand ? (
          <IconButton
            size="small"
            aria-expanded={detailOpen}
            aria-label={detailOpen ? 'Hide grouped steps' : 'Show grouped steps'}
            onClick={() => setDetailOpen((v) => !v)}
            sx={{ mt: -0.5, flexShrink: 0 }}
          >
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                transform: detailOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            />
          </IconButton>
        ) : null}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} flexWrap="wrap" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              {row.label}
            </Typography>
            {requirementLabel ? (
              <Typography
                variant="caption"
                color={pathHistorical || !row.blocking ? 'text.secondary' : 'text.primary'}
                display="block"
                sx={{ mt: 0.35, fontWeight: pathHistorical ? 500 : row.blocking ? 600 : 500 }}
              >
                {requirementLabel}
              </Typography>
            ) : null}
            {subtitle ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            ) : null}
            {row.narrative?.summary?.trim() ? (
              <Typography variant="body2" color="text.secondary" display="block" sx={{ mt: 0.75, lineHeight: 1.45 }}>
                {row.narrative.summary.trim()}
              </Typography>
            ) : null}
            {row.narrative?.events?.filter((e) => String(e.message || '').trim()).length ? (
              <>
                <Button
                  size="small"
                  onClick={() => setActivityOpen((o) => !o)}
                  endIcon={
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: activityOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                    />
                  }
                  sx={{ mt: 0.5, px: 0, minWidth: 0, textTransform: 'none', alignSelf: 'flex-start' }}
                >
                  View activity
                </Button>
                <Collapse in={activityOpen}>
                  <List dense disablePadding sx={{ mt: 0.5 }}>
                    {row.narrative!.events!
                      .filter((e) => String(e.message || '').trim())
                      .map((ev, i) => (
                        <ListItem key={i} disableGutters sx={{ py: 0.2, alignItems: 'flex-start' }}>
                          <ListItemText
                            primary={ev.message}
                            secondary={
                              ev.timestamp
                                ? `${ev.timestamp.toLocaleString()}${
                                    narrativeActorLabelForUi(ev.type, 'worker')
                                      ? ` · ${narrativeActorLabelForUi(ev.type, 'worker')}`
                                      : ''
                                  }`
                                : narrativeActorLabelForUi(ev.type, 'worker')
                            }
                            primaryTypographyProps={{
                              variant: 'caption',
                              color: 'text.primary',
                              sx: { whiteSpace: 'pre-wrap' },
                            }}
                            secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                          />
                        </ListItem>
                      ))}
                  </List>
                </Collapse>
              </>
            ) : null}
            {debugMode ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, fontFamily: 'monospace' }}>
                Group: {row.workerGroupKey ?? deriveWorkerGroupKey(row)}
                {pipelineLabel ? ` · step: ${pipelineLabel}` : ''}
              </Typography>
            ) : null}
          </Box>
          <Chip
            size="small"
            label={pathHistorical && !done ? `Record · ${workerOnboardingStatusChip(row)}` : workerOnboardingStatusChip(row)}
            variant="outlined"
            sx={{ flexShrink: 0 }}
          />
        </Stack>
      </Stack>
      {showExpand ? (
        <Collapse in={detailOpen}>
          <Box
            sx={{
              mt: 1,
              ml: showExpand ? 4.5 : 0,
              pl: 1.5,
              borderLeft: 2,
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.75 }}>
              Source rows ({details!.length})
            </Typography>
            <Stack spacing={1}>
              {details!.map((m) => {
                const memberReq = workerOnboardingRequirementLabel(m);
                return (
                  <Box key={m.rowId}>
                    <Typography variant="caption" display="block" fontWeight={600}>
                      {m.label}
                    </Typography>
                    {memberReq ? (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.15 }}>
                        {memberReq}
                      </Typography>
                    ) : null}
                    <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5} sx={{ mt: 0.25 }}>
                      <Chip size="small" label={workerOnboardingStatusChip(m)} variant="outlined" />
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {m.rowId}
                      </Typography>
                    </Stack>
                    {m.statusLabel ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {m.statusLabel}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </Collapse>
      ) : null}
    </Box>
  );
}

function WorkerBucketCard({
  title,
  rows,
  debugMode,
  pathHistorical,
}: {
  title: string;
  rows: EmploymentOnboardingRow[];
  debugMode: boolean;
  pathHistorical?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        <Stack spacing={1.25} divider={<Divider flexItem />}>
          {rows.map((row) => (
            <WorkerOnboardingPathRowItem key={row.rowId} row={row} debugMode={debugMode} pathHistorical={pathHistorical} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

const MyEmploymentDetailPage: React.FC = () => {
  const { employmentId } = useParams<{ employmentId: string }>();
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const workerDisplayName = user?.displayName?.trim() || undefined;
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [employment, setEmployment] = useState<EmploymentRecord | null>(null);
  const [payrollAccount, setPayrollAccount] = useState<{ status: string; id: string } | null>(null);
  /** Entity TempWorks first-time setup URL (`payrollSettings.onboardingUrl`). */
  const [payrollSignupUrl, setPayrollSignupUrl] = useState<string | null>(null);
  /** Entity login / pay history URL (`payrollSettings.portalUrl`). */
  const [payrollPortalLoginUrl, setPayrollPortalLoginUrl] = useState<string | null>(null);
  const [complianceItems, setComplianceItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);
  const [workerBuckets, setWorkerBuckets] = useState<Record<WorkerOnboardingBucketId, EmploymentOnboardingRow[]> | null>(
    null
  );
  const [pathLoading, setPathLoading] = useState(false);
  const [headerPathCtx, setHeaderPathCtx] = useState<{
    assignments: EmploymentAssignmentSummary[];
    pipeline: WorkerOnboardingPipeline | null;
    pathBlockingRows: EmploymentOnboardingRow[];
    entityKey: EmploymentEntityKey;
  } | null>(null);

  const pathDebugMode = useMemo(() => workerEmploymentPathDebugEnabled(), []);

  useEffect(() => {
    if (!tenantId || !employmentId || !uid) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const empRef = doc(db, p.entityEmployment(tenantId, employmentId));
        const empSnap = await getDoc(empRef);
        if (!empSnap.exists()) {
          setEmployment(null);
          setPayrollAccount(null);
          setPayrollSignupUrl(null);
          setPayrollPortalLoginUrl(null);
          setLoading(false);
          return;
        }
        const data = empSnap.data();
        if (data?.userId !== uid) {
          setEmployment(null);
          setPayrollAccount(null);
          setPayrollSignupUrl(null);
          setPayrollPortalLoginUrl(null);
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...data } as EmploymentRecord;
        setEmployment(emp);

        const entityId = emp.entityId ?? data?.entityId ?? null;
        const entityKey = emp.entityKey ?? data?.entityKey ?? '';
        if (entityId) {
          try {
            const entityRef = doc(db, p.entity(tenantId, entityId));
            const entitySnap = await getDoc(entityRef);
            const payrollSettings = entitySnap.data()?.payrollSettings as
              | { onboardingUrl?: string | null; portalUrl?: string | null }
              | undefined;
            const su = String(payrollSettings?.onboardingUrl || '').trim() || null;
            const pl = String(payrollSettings?.portalUrl || '').trim() || null;
            setPayrollSignupUrl(su);
            setPayrollPortalLoginUrl(pl);
          } catch {
            setPayrollSignupUrl(null);
            setPayrollPortalLoginUrl(null);
          }
        } else {
          setPayrollSignupUrl(null);
          setPayrollPortalLoginUrl(null);
        }
        if (entityKey) {
          try {
            const acc = await getWorkerPayrollAccount(tenantId, uid, entityKey);
            setPayrollAccount(acc ? { status: acc.payrollStatus, id: acc.id } : null);
          } catch {
            setPayrollAccount(null);
          }
        } else {
          setPayrollAccount(null);
        }

        try {
          const compRef = collection(db, p.workerComplianceItems(tenantId));
          const compQ = query(compRef, where('userId', '==', uid));
          const compSnap = await getDocs(compQ);
          const compList = compSnap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkerComplianceItem & { id: string }));
          setComplianceItems(compList);
        } catch {
          setComplianceItems([]);
        }
      } catch {
        setEmployment(null);
        setPayrollAccount(null);
        setPayrollSignupUrl(null);
        setPayrollPortalLoginUrl(null);
        setComplianceItems([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId, employmentId, uid]);

  useEffect(() => {
    if (!tenantId || !uid || !employment?.entityId) {
      setWorkerBuckets(null);
      setHeaderPathCtx(null);
      return;
    }
    const ek = normalizeEntityKey(employment.entityKey);
    if (!ek) {
      setWorkerBuckets(null);
      setHeaderPathCtx(null);
      return;
    }
    let cancelled = false;
    setPathLoading(true);
    (async () => {
      const args = await loadBuildOnboardingPathArgsForWorkerEmployment({
        tenantId,
        userId: uid,
        entityKey: ek,
        entityFirestoreId: employment.entityId!,
        onboardingPipelineId: employment.onboardingPipelineId,
        employmentWorkerType: employment.workerType,
      });
      if (cancelled) return;
      setPathLoading(false);
      if (!args) {
        setWorkerBuckets({ ...EMPTY_BUCKETS });
        setHeaderPathCtx(null);
        return;
      }

      let automationDispatchBriefs: ReturnType<typeof onboardingAutomationDispatchBriefFromRaw>[] = [];
      try {
        const ds = await getDocs(
          query(
            collection(db, p.onboardingAutomationDispatch(tenantId)),
            where('userId', '==', uid),
            limit(100)
          )
        );
        const assignmentIdsForTab = args.assignments.map((a) => a.assignmentId);
        automationDispatchBriefs = ds.docs
          .map((d) => onboardingAutomationDispatchBriefFromRaw(d.id, d.data() as Record<string, unknown>))
          .filter((b) =>
            automationDispatchBriefMatchesEntityTab({
              brief: b,
              entityFirestoreId: employment.entityId,
              assignmentIdsForTab,
            })
          );
      } catch {
        automationDispatchBriefs = [];
      }
      if (cancelled) return;

      const rawGroups = buildOnboardingPathFromSettings(args);
      const withNarrative = enrichOnboardingPathGroupsWithNarratives(
        rawGroups,
        onboardingNarrativeContextFromPathArgs(args, {
          narrativeAudience: 'worker',
          workerDisplayName,
          automationDispatchBriefs,
        })
      );
      const relationshipOnly = filterEntityRelationshipOnboardingPathGroups(withNarrative);
      const allRelRows = relationshipOnly.flatMap((g) => g.rows);
      const pathBlockingRows = allRelRows.filter(isOnboardingPathRowBlocker);
      setHeaderPathCtx({
        assignments: args.assignments,
        pipeline: args.pipeline,
        pathBlockingRows,
        entityKey: ek,
      });
      const groups = filterOnboardingPathGroupsForWorkerUi(relationshipOnly);
      const flat = dedupeWorkerOnboardingRows(flattenFilteredWorkerGroups(groups));
      setWorkerBuckets(partitionWorkerOnboardingRows(flat));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    tenantId,
    uid,
    workerDisplayName,
    employment?.id,
    employment?.entityId,
    employment?.entityKey,
    employment?.onboardingPipelineId,
    employment?.workerType,
  ]);

  const allPathRows = useMemo(() => {
    if (!workerBuckets) return [];
    return [
      ...workerBuckets.your_tasks,
      ...workerBuckets.waiting_team,
      ...workerBuckets.behind_scenes,
      ...workerBuckets.completed,
    ];
  }, [workerBuckets]);

  const employmentHeaderState = useMemo(() => {
    if (!employment) return 'not_started' as const;
    const hasOpenOnboardingDemand = computeHasOpenOnboardingDemand({
      assignments: headerPathCtx?.assignments,
      entityEmploymentStatus: employment.status,
      employmentEntryMode: employment.employmentEntryMode ?? null,
    });
    if (headerPathCtx) {
      const pipelineBl = buildBlockersFromPipeline(
        headerPathCtx.pipeline?.steps,
        headerPathCtx.pipeline?.tasks,
        headerPathCtx.entityKey
      );
      const pathBlockingRows = headerPathCtx.pathBlockingRows;
      const synthetic = pathBlockingRows.map(employmentBlockerItemFromPathRow);
      const merged = hasOpenOnboardingDemand ? [...pipelineBl, ...synthetic] : [];
      const actionable = hasOpenOnboardingDemand
        ? deriveDominantActionableForHeader(pathBlockingRows, pipelineBl)
        : 'none';
      const primary = primaryAssignmentRowForHeader(headerPathCtx.assignments);
      return deriveEmploymentHeaderState({
        onboardingPhase: employment.onboardingPhase ?? null,
        blockers: merged,
        actionableBy: actionable,
        assignmentStatus: primary?.status ?? null,
        entityEmploymentStatus: employment.status,
        hasOpenOnboardingDemand,
        employmentEntryMode: employment.employmentEntryMode ?? null,
        hasNonTerminalAssignment: primary != null,
      });
    }
    const openBuckets =
      workerBuckets &&
      workerBuckets.your_tasks.length + workerBuckets.waiting_team.length + workerBuckets.behind_scenes.length > 0;
    const primary =
      headerPathCtx?.assignments != null
        ? primaryAssignmentRowForHeader(headerPathCtx.assignments)
        : null;
    return deriveEmploymentHeaderStateWorkerListFallback({
      onboardingPhase: employment.onboardingPhase ?? null,
      entityEmploymentStatus: employment.status,
      pipelineIncomplete: Boolean(openBuckets),
      hasOpenOnboardingDemand,
      employmentEntryMode: employment.employmentEntryMode ?? null,
      hasNonTerminalAssignment: primary != null,
    });
  }, [employment, headerPathCtx, workerBuckets]);

  const pathRelationshipHistorical = useMemo(() => {
    if (!employment) return false;
    return !computeHasOpenOnboardingDemand({
      assignments: headerPathCtx?.assignments,
      entityEmploymentStatus: employment.status,
      employmentEntryMode: employment.employmentEntryMode ?? null,
    });
  }, [employment, headerPathCtx]);

  const pathCoversPayroll = workerPathCoversPayrollRow(allPathRows);
  const pathCoversWorkAuth = workerPathCoversWorkAuthRows(allPathRows);

  const payrollComplete = payrollAccount?.status === 'complete';
  const hasEntityPayrollLinks = Boolean(payrollSignupUrl?.trim() || payrollPortalLoginUrl?.trim());

  if (!uid || !tenantId) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">Sign in to view this page.</Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!employment) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">Employment record not found.</Alert>
        <Typography
          component="button"
          variant="body2"
          sx={{ mt: 1, textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => navigate('/c1/workers/my-employment')}
        >
          Back to My Employment
        </Typography>
      </Container>
    );
  }

  const headerStatusLabel = employmentHeaderStateLabel(employmentHeaderState);
  const startedAt = employment.onboardingStartedAt?.toDate?.();
  const hiredAt = employment.hiredAt?.toDate?.();
  const isOnboarding = employment.status === 'onboarding';

  const pipelineId = employment.onboardingPipelineId ?? '';
  const readiness = getWorkerReadiness({
    employments: [
      { id: employment.id, status: employment.status, entityKey: employment.entityKey, onboardingPipelineId: pipelineId || undefined },
    ],
    complianceItems,
    payrollByKey: payrollAccount
      ? { [employment.entityKey ? `${uid}__${employment.entityKey}` : employment.id]: { payrollStatus: payrollAccount.status } }
      : {},
    canonicalPathRows: workerBuckets !== null ? allPathRows : undefined,
  });

  const complianceAttentionItems = complianceItems.filter((item) => {
    if (!item.required) return false;
    if (['not_started', 'pending', 'submitted', 'in_review'].includes(item.status)) return true;
    const state = getExpirationState(item);
    return state === 'expired' || state === 'expiring_soon';
  });
  const showComplianceAlert = hasExpiredCompliance(complianceItems) || hasExpiringSoonCompliance(complianceItems);

  const readinessBannerMessage: Record<ReadinessStatus, string | null> = {
    ready: null,
    onboarding: 'Complete onboarding to start working',
    at_risk: 'Some items need attention soon',
    blocked: 'You are not eligible to work right now',
    not_ready: 'Some items need to be completed',
  };

  const showOnboardingPath = workerBuckets !== null && (isOnboarding || allPathRows.length > 0);

  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton size="small" onClick={() => navigate('/c1/workers/my-employment')} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ cursor: 'pointer' }}
            onClick={() => navigate('/c1/workers/my-employment')}
          >
            Back to My Employment
          </Typography>
        </Stack>

        {readiness.status !== 'ready' && readinessBannerMessage[readiness.status] && (
          <Alert
            severity={readiness.status === 'blocked' ? 'error' : readiness.status === 'at_risk' ? 'warning' : 'info'}
            variant="outlined"
          >
            {readinessBannerMessage[readiness.status]}
          </Alert>
        )}

        {showComplianceAlert && (
          <Alert severity={hasExpiredCompliance(complianceItems) ? 'error' : 'warning'} variant="outlined">
            {hasExpiredCompliance(complianceItems)
              ? 'Action required: some of your documents need attention.'
              : 'Some documents will expire soon.'}
          </Alert>
        )}

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600}>
              {employment.entityName || employment.entityKey || 'Entity'}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
              <Chip
                label={headerStatusLabel}
                size="small"
                color={
                  employmentHeaderState === 'terminated'
                    ? 'error'
                    : employmentHeaderState === 'inactive'
                      ? 'default'
                      : employmentHeaderState === 'ready' || employmentHeaderState === 'on_assignment'
                        ? 'success'
                        : employmentHeaderState === 'action_required'
                          ? 'warning'
                          : employmentHeaderState === 'waiting_on_company'
                            ? 'info'
                            : employmentHeaderState === 'in_progress'
                              ? 'warning'
                              : 'default'
                }
              />
              {(employment.workerType === 'w2' || employment.workerType === '1099') && (
                <Chip label={employment.workerType === '1099' ? '1099' : 'W-2'} size="small" variant="outlined" />
              )}
            </Stack>
            {(startedAt || hiredAt) && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {hiredAt ? `Hired ${hiredAt.toLocaleDateString()}` : startedAt ? `Started ${startedAt.toLocaleDateString()}` : null}
              </Typography>
            )}
          </CardContent>
        </Card>

        {pathLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={22} />
          </Box>
        )}

        {showOnboardingPath && workerBuckets && allPathRows.length === 0 && isOnboarding && (
          <Alert severity="info" variant="outlined">
            Your hiring team is still setting up your checklist. Check back soon.
          </Alert>
        )}

        {showOnboardingPath && workerBuckets && (
          <>
            {pathRelationshipHistorical ? (
              <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
                There is no active assignment onboarding for this entity right now. The steps below are a record of prior
                relationship onboarding — they are not current required work unless you start a new assignment.
              </Alert>
            ) : null}
            <WorkerBucketCard
              title={pathRelationshipHistorical ? 'Record: your past tasks' : 'Your tasks'}
              rows={workerBuckets.your_tasks}
              debugMode={pathDebugMode}
              pathHistorical={pathRelationshipHistorical}
            />
            <WorkerBucketCard
              title={pathRelationshipHistorical ? 'Record: previously with your hiring team' : 'Waiting on your hiring team'}
              rows={workerBuckets.waiting_team}
              debugMode={pathDebugMode}
              pathHistorical={pathRelationshipHistorical}
            />
            <WorkerBucketCard
              title={pathRelationshipHistorical ? 'Record: behind the scenes (past activity)' : 'In progress behind the scenes'}
              rows={workerBuckets.behind_scenes}
              debugMode={pathDebugMode}
              pathHistorical={pathRelationshipHistorical}
            />
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                  {pathRelationshipHistorical ? 'Completed & resources (record)' : 'Completed & resources'}
                </Typography>
                {workerBuckets.completed.length > 0 ? (
                  <Stack spacing={1.25} divider={<Divider flexItem />} sx={{ mb: hasEntityPayrollLinks ? 2 : 0 }}>
                    {workerBuckets.completed.map((row) => (
                      <WorkerOnboardingPathRowItem
                        key={row.rowId}
                        row={row}
                        debugMode={pathDebugMode}
                        pathHistorical={pathRelationshipHistorical}
                      />
                    ))}
                  </Stack>
                ) : null}
                {(payrollAccount || hasEntityPayrollLinks) && (
                  <Box sx={{ mt: workerBuckets.completed.length > 0 ? 0 : 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                      Payroll
                    </Typography>
                    {payrollAccount && !pathCoversPayroll && (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                        <Chip
                          label={getPayrollStatusLabel(payrollAccount.status)}
                          size="small"
                          variant="outlined"
                          color={payrollAccount.status === 'complete' ? 'success' : 'default'}
                        />
                      </Stack>
                    )}
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {payrollAccount?.status === 'complete'
                        ? 'Payroll setup is complete. Use the portal link to view pay history and tax documents when available.'
                        : payrollAccount?.status === 'invite_sent' ||
                            payrollAccount?.status === 'account_created' ||
                            payrollAccount?.status === 'in_progress'
                          ? 'Finish payroll and banking with our payroll partner.'
                          : 'Set up payroll and banking so you can get paid.'}
                    </Typography>
                    <WorkerEntityPayrollLinkButtons
                      payrollSignupUrl={payrollSignupUrl}
                      payrollPortalLoginUrl={payrollPortalLoginUrl}
                      payrollComplete={payrollComplete}
                    />
                  </Box>
                )}
                {workerBuckets.completed.length === 0 && !payrollAccount && !hasEntityPayrollLinks ? (
                  <Typography variant="body2" color="text.secondary">
                    Nothing completed yet. Finished items will show up here.
                  </Typography>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}

        {!(showOnboardingPath && workerBuckets) && (payrollAccount || hasEntityPayrollLinks) && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Payroll
              </Typography>
              {payrollAccount && !pathCoversPayroll && (
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                  <Chip
                    label={getPayrollStatusLabel(payrollAccount.status)}
                    size="small"
                    variant="outlined"
                    color={payrollAccount.status === 'complete' ? 'success' : 'default'}
                  />
                </Stack>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {payrollAccount?.status === 'complete'
                  ? 'Payroll setup is complete. Use the portal link to view pay history and tax documents when available.'
                  : payrollAccount?.status === 'invite_sent' ||
                      payrollAccount?.status === 'account_created' ||
                      payrollAccount?.status === 'in_progress'
                    ? 'Complete your payroll setup using the link below.'
                    : 'Set up payroll and banking so you can get paid.'}
              </Typography>
              <WorkerEntityPayrollLinkButtons
                payrollSignupUrl={payrollSignupUrl}
                payrollPortalLoginUrl={payrollPortalLoginUrl}
                payrollComplete={payrollComplete}
              />
            </CardContent>
          </Card>
        )}

        {complianceAttentionItems.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Compliance
              </Typography>
              <Stack spacing={0.75}>
                {complianceAttentionItems.map((item) => {
                  const label = item.title || getComplianceTypeLabel(item.type);
                  const state = getExpirationState(item);
                  const statusText =
                    state === 'expired'
                      ? 'Expired'
                      : state === 'expiring_soon'
                        ? 'Expiring soon'
                        : getComplianceStatusDisplayLabel(item.status);
                  return (
                    <Stack
                      key={item.id ?? item.type}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      flexWrap="wrap"
                      gap={0.5}
                    >
                      <Typography variant="body2">{label}</Typography>
                      <Chip
                        size="small"
                        label={statusText}
                        color={
                          state === 'expired' ? 'error' : state === 'expiring_soon' ? 'warning' : item.status === 'complete' ? 'success' : 'default'
                        }
                        variant="outlined"
                      />
                    </Stack>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Documents & instructions
            </Typography>
            <Stack spacing={0.75}>
              {!pathCoversWorkAuth && isOnboarding && employment.everifyStatus ? (
                <Typography variant="body2" color="text.secondary">
                  Employment verification: {String(employment.everifyStatus).replace(/_/g, ' ')}
                </Typography>
              ) : null}
              {(employment.backgroundRequired || employment.drugScreenRequired) && (
                <Typography variant="body2" color="text.secondary">
                  {employment.backgroundRequired && 'A background check may be required. '}
                  {employment.drugScreenRequired && 'A screening may be required. Follow any instructions sent to you by your hiring team.'}
                </Typography>
              )}
              {!pathCoversWorkAuth &&
                !employment.everifyStatus &&
                !employment.backgroundRequired &&
                !employment.drugScreenRequired && (
                  <Typography variant="body2" color="text.secondary">
                    Your hiring team will share any forms or next steps with you.
                  </Typography>
                )}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Next steps
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {isOnboarding ? (
                <>Finish the items above when asked. This page updates as things move forward.</>
              ) : (
                <>You’re set with this entity. Questions? Reach out to your hiring team.</>
              )}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
};

export default MyEmploymentDetailPage;
