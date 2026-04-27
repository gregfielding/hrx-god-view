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
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import IconButton from '@mui/material/IconButton';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { computeHasOpenOnboardingDemand } from '../../../utils/deriveEmploymentHeaderState';
import { getWorkerPayrollAccount } from '../../../utils/workerPayrollAccount';
import WorkerEntityI9Section from '../../../components/worker/employment/WorkerEntityI9Section';
import {
  omitWorkerPayrollChecklistRows,
  workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments,
} from '../../../utils/workerEmploymentWorkerSurface';
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
  automationDispatchBriefMatchesEntityTab,
  onboardingAutomationDispatchBriefFromRaw,
  onboardingNarrativeContextFromPathArgs,
} from '../../../utils/employmentOnboardingNarrative';
import { filterOnboardingPathGroupsForWorkerUi } from '../../../utils/employmentOnboardingRowVisibility';
import { loadBuildOnboardingPathArgsForWorkerEmployment } from '../../../utils/workerEmploymentOnboardingLoad';
import {
  dedupeWorkerOnboardingRows,
  flattenFilteredWorkerGroups,
  partitionWorkerOnboardingRows,
  translateWorkerOnboardingBundleLabel,
  workerOnboardingStatusChip,
  workerPathCoversPayrollRow,
  type WorkerOnboardingBucketId,
} from '../../../utils/workerOnboardingPathPresentation';
import { partitionEmploymentRowsForBridge, rowToChecklistUiStatus } from '../../../utils/workerMyEmploymentDetailPresentation';
import { useEntityEmploymentOverview } from '../../../hooks/useEntityEmploymentOverview';
import EmploymentWorkerEmploymentHub from '../../UserProfile/components/employment-v2/EmploymentWorkerEmploymentHub';
import ProfileTabPointerAlert from '../../../components/profile/ProfileTabPointerAlert';
import { workerEmploymentShouldShowScreeningPointerAlert } from '../../../utils/workerEmploymentBackgroundsCrossLink';
import { C1_WORKER_SCREENING_PATH } from '../../../constants/c1WorkerRoutes';

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
  /** Denormalized from onboarding engine; aligns with Employment V2 `onboardingComplete`. */
  onboardingComplete?: boolean;
  i9SupportingDocumentsManualCompleteAt?: { toDate: () => Date } | null;
}

const EMPTY_BUCKETS: Record<WorkerOnboardingBucketId, EmploymentOnboardingRow[]> = {
  your_tasks: [],
  waiting_team: [],
  behind_scenes: [],
  completed: [],
};

const MyEmploymentDetailPage: React.FC = () => {
  const { employmentId } = useParams<{ employmentId: string }>();
  const location = useLocation();
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const t = useT();
  const workerDisplayName = user?.displayName?.trim() || undefined;
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const { byEntityKey, loading: overviewLoading, refetch: refetchOverview } = useEntityEmploymentOverview({
    userId: uid ?? undefined,
    tenantId,
  });

  const [loading, setLoading] = useState(true);
  const [employment, setEmployment] = useState<EmploymentRecord | null>(null);
  const [payrollAccount, setPayrollAccount] = useState<{ status: string; id: string } | null>(null);
  /** Entity payroll first-time setup URL (`payrollSettings.onboardingUrl`). */
  const [payrollSignupUrl, setPayrollSignupUrl] = useState<string | null>(null);
  /** Entity login / pay history URL (`payrollSettings.portalUrl`). */
  const [payrollPortalLoginUrl, setPayrollPortalLoginUrl] = useState<string | null>(null);
  const [complianceItems, setComplianceItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);
  const [workerBuckets, setWorkerBuckets] = useState<Record<WorkerOnboardingBucketId, EmploymentOnboardingRow[]> | null>(
    null
  );
  /** Full path rows before payroll omission — used for pathCoversPayroll / work auth. */
  const [onboardingPathFlatRaw, setOnboardingPathFlatRaw] = useState<EmploymentOnboardingRow[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [headerPathCtx, setHeaderPathCtx] = useState<{
    assignments: EmploymentAssignmentSummary[];
    pipeline: WorkerOnboardingPipeline | null;
    pathBlockingRows: EmploymentOnboardingRow[];
    entityKey: EmploymentEntityKey;
  } | null>(null);

  useEffect(() => {
    if (!tenantId || !employmentId || !uid) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const empRef = doc(db, p.entityEmployment(tenantId, employmentId));
        let empSnap = await getDoc(empRef);
        if (!empSnap.exists()) {
          const pipelineQ = query(
            collection(db, p.entityEmployments(tenantId)),
            where('userId', '==', uid),
            where('onboardingPipelineId', '==', employmentId),
            limit(1),
          );
          const pipelineSnap = await getDocs(pipelineQ);
          if (!pipelineSnap.empty) {
            empSnap = pipelineSnap.docs[0];
          }
        }
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
      setOnboardingPathFlatRaw([]);
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
        setOnboardingPathFlatRaw([]);
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
      setOnboardingPathFlatRaw(flat);
      const flatNoPayroll = omitWorkerPayrollChecklistRows(flat);
      setWorkerBuckets(partitionWorkerOnboardingRows(flatNoPayroll));
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

  const bridgeBuckets = useMemo(
    () => partitionEmploymentRowsForBridge(allPathRows),
    [allPathRows],
  );

  const pathRelationshipHistorical = useMemo(() => {
    if (!employment) return false;
    return !computeHasOpenOnboardingDemand({
      assignments: headerPathCtx?.assignments,
      entityEmploymentStatus: employment.status,
      employmentEntryMode: employment.employmentEntryMode ?? null,
    });
  }, [employment, headerPathCtx]);

  const normalizedEntityKey = useMemo(() => {
    if (!employment?.entityKey) return null;
    return normalizeEntityKey(employment.entityKey);
  }, [employment]);

  const entityOverview = useMemo(() => {
    if (!normalizedEntityKey) return null;
    return byEntityKey[normalizedEntityKey] ?? null;
  }, [byEntityKey, normalizedEntityKey]);

  const pathCoversPayroll = workerPathCoversPayrollRow(onboardingPathFlatRaw);

  const payrollComplete = payrollAccount?.status === 'complete';

  const payrollSecondaryLoginHref = useMemo(() => {
    const signup = payrollSignupUrl?.trim() || null;
    const portal = payrollPortalLoginUrl?.trim() || null;
    if (!portal && !signup) return null;
    const same = Boolean(signup && portal && signup === portal);
    if (payrollComplete) return portal || signup;
    if (!payrollComplete && portal && signup && !same) return portal;
    return null;
  }, [payrollSignupUrl, payrollPortalLoginUrl, payrollComplete]);

  if (!uid) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Alert severity="info">{t('workerEmploymentHub.detailSignInPrompt')}</Alert>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            onClick={() => navigate('/login', { state: { from: location } })}
          >
            {t('workerEmploymentHub.signInButton')}
          </Button>
        </Stack>
      </Container>
    );
  }

  if (!tenantId) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">{t('workerEmploymentHub.myEmploymentNeedEntity')}</Alert>
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
        <Alert severity="info">{t('workerEmploymentHub.detailNotFound')}</Alert>
        <Typography
          component="button"
          variant="body2"
          sx={{ mt: 1, textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => navigate('/c1/workers/profile')}
        >
          {t('workerEmploymentHub.detailBackToList')}
        </Typography>
      </Container>
    );
  }

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

  const showComplianceAlert = hasExpiredCompliance(complianceItems) || hasExpiringSoonCompliance(complianceItems);

  const readinessBannerMessage: Record<ReadinessStatus, string | null> = {
    ready: null,
    onboarding: t('workerEmploymentHub.readinessOnboardingShort'),
    at_risk: t('workerEmploymentHub.readinessAtRisk'),
    blocked: t('workerEmploymentHub.readinessBlocked'),
    not_ready: t('workerEmploymentHub.readinessNotReady'),
  };

  const showWorkerEmploymentHub =
    Boolean(normalizedEntityKey && entityOverview?.onboardingComplete) && !overviewLoading;

  const showOnboardingScreeningPointer =
    !showWorkerEmploymentHub &&
    Boolean(
      entityOverview &&
        entityOverview.hasOpenOnboardingDemand &&
        workerEmploymentShouldShowScreeningPointerAlert(entityOverview),
    );

  const renderEmploymentPathRow = (row: EmploymentOnboardingRow) => {
    const ui = rowToChecklistUiStatus(row);
    const label = translateWorkerOnboardingBundleLabel(row.label, t);
    const done = isOnboardingPathRowDone(row.status);
    const canAct = (row.actionableBy === 'worker' || row.actionableBy === 'either') && !done;
    const pid = row.sourceRef?.pipelineStepId;
    const rowCta = () => {
      if (!canAct) return;
      if (pid === 'everee' && !payrollComplete) {
        const href = (payrollSignupUrl || payrollPortalLoginUrl || '').trim();
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (pid === 'i9' || row.groupId === 'work_authorization') {
        document.getElementById('worker-employment-i9-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      document.getElementById(`employment-checklist-${row.rowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const chipColor =
      ui === 'complete'
        ? 'success'
        : ui === 'required'
          ? 'error'
          : ui === 'in_progress'
            ? 'primary'
            : 'default';
    return (
      <Stack
        key={row.rowId}
        id={`employment-checklist-${row.rowId}`}
        direction="row"
        spacing={1.5}
        alignItems="flex-start"
      >
        <Box sx={{ pt: 0.25 }}>
          {ui === 'complete' ? (
            <CheckCircleIcon color="success" fontSize="small" />
          ) : ui === 'required' ? (
            <ErrorOutlineIcon color="error" fontSize="small" />
          ) : ui === 'in_progress' ? (
            <HourglassEmptyIcon color="primary" fontSize="small" />
          ) : (
            <RadioButtonUncheckedIcon color="disabled" fontSize="small" />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>
            {label}
          </Typography>
          <Chip
            size="small"
            label={workerOnboardingStatusChip(row, t)}
            color={chipColor}
            variant="outlined"
            sx={{ mt: 0.5 }}
          />
        </Box>
        {canAct ? (
          <Button size="small" variant="outlined" onClick={rowCta}>
            {row.status === 'not_started'
              ? t('workerEmploymentDetail.checklistRowStart')
              : t('workerEmploymentDetail.checklistRowContinue')}
          </Button>
        ) : null}
      </Stack>
    );
  };

  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton size="small" onClick={() => navigate('/c1/workers/profile')} aria-label={t('common.back')}>
            <ArrowBackIcon />
          </IconButton>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ cursor: 'pointer' }}
            onClick={() => navigate('/c1/workers/profile')}
          >
            {t('workerEmploymentHub.detailBackToList')}
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
              ? t('workerEmploymentDetail.complianceDocActionRequired')
              : t('workerEmploymentDetail.complianceDocExpiringSoon')}
          </Alert>
        )}

        {showWorkerEmploymentHub && normalizedEntityKey && entityOverview ? (
          <EmploymentWorkerEmploymentHub
            entityKey={normalizedEntityKey}
            overview={entityOverview}
            tenantId={tenantId}
            profileUserId={uid}
            screeningPointerMessage={t('workerEmploymentDetail.screeningPointer')}
            onNavigateToScreening={() => navigate(C1_WORKER_SCREENING_PATH)}
            onRefresh={() => refetchOverview()}
          />
        ) : null}

        {!showWorkerEmploymentHub && pathLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!showWorkerEmploymentHub && !pathLoading && workerBuckets && (
          <>
            {pathRelationshipHistorical ? (
              <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
                {t('workerEmploymentDetail.historicalPathAlertShort')}
              </Alert>
            ) : null}

            <Stack id="worker-employment-bridge-stack" spacing={2}>
              <Card id="worker-employment-bridge-identity" variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                    {t('workerEmploymentDetail.bridgeSectionIdentity')}
                  </Typography>
                  {bridgeBuckets.identity.length > 0 ? (
                    <Stack spacing={2} divider={<Divider flexItem />} sx={{ mb: 2 }}>
                      {bridgeBuckets.identity.map((row) => renderEmploymentPathRow(row))}
                    </Stack>
                  ) : allPathRows.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t('workerEmploymentDetail.checklistEmptySettingUp')}
                    </Typography>
                  ) : null}
                  {tenantId &&
                  uid &&
                  !workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments(employment.entityKey) ? (
                    <Box id="worker-employment-i9-anchor">
                      <WorkerEntityI9Section
                        tenantId={tenantId}
                        workerUserId={uid}
                        employmentRecordId={employment.id}
                        employmentEntityKey={employment.entityKey}
                        requestedForEntityId={employment.entityId ?? null}
                        i9SupportingManualComplete={Boolean(employment.i9SupportingDocumentsManualCompleteAt)}
                      />
                    </Box>
                  ) : null}
                </CardContent>
              </Card>

              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                    {t('workerEmploymentDetail.bridgeSectionPayroll')}
                  </Typography>
                  {bridgeBuckets.payroll.length > 0 ? (
                    <Stack spacing={2} divider={<Divider flexItem />}>
                      {bridgeBuckets.payroll.map((row) => renderEmploymentPathRow(row))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('workerEmploymentDetail.bridgePayrollEmpty')}
                    </Typography>
                  )}
                  {payrollSecondaryLoginHref ? (
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<OpenInNewIcon fontSize="small" />}
                      href={payrollSecondaryLoginHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      component="a"
                      sx={{ alignSelf: 'flex-start', textTransform: 'none', mt: 1 }}
                    >
                      {t('workerEmploymentDetail.secondaryPayrollLoginExisting')}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>

              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                    {t('workerEmploymentDetail.bridgeSectionScreening')}
                  </Typography>
                  {bridgeBuckets.screening.length > 0 ? (
                    <Stack spacing={2} divider={<Divider flexItem />} sx={{ mb: 2 }}>
                      {bridgeBuckets.screening.map((row) => renderEmploymentPathRow(row))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: showOnboardingScreeningPointer ? 1.5 : 0 }}>
                      {t('workerEmploymentDetail.bridgeScreeningEmpty')}
                    </Typography>
                  )}
                  {showOnboardingScreeningPointer ? (
                    <ProfileTabPointerAlert
                      message={t('workerEmploymentDetail.screeningPointerShort')}
                      onNavigate={() => navigate(C1_WORKER_SCREENING_PATH)}
                    />
                  ) : null}
                </CardContent>
              </Card>
            </Stack>

            <Button
              variant="text"
              size="small"
              onClick={() => navigate('/c1/workers/support')}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              {t('workerEmploymentDetail.bridgeHelpLink')}
            </Button>
          </>
        )}
      </Stack>
    </Container>
  );
};

export default MyEmploymentDetailPage;
