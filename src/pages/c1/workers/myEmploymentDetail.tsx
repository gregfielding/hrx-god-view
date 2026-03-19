/**
 * Worker-facing "My Employment" entity detail.
 * Header, onboarding progress (if onboarding), documents, simple actions.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import IconButton from '@mui/material/IconButton';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import { getEmploymentStatusLabel } from '../../../utils/employmentStatusLabel';
import { getWorkerPayrollAccount } from '../../../utils/workerPayrollAccount';
import { getPayrollStatusLabel } from '../../../types/payroll';
import { getComplianceTypeLabel, getComplianceStatusDisplayLabel } from '../../../types/compliance';
import { getExpirationState, hasExpiredCompliance, hasExpiringSoonCompliance } from '../../../utils/complianceExpiration';
import { getWorkerReadiness, type ReadinessStatus } from '../../../utils/workerReadiness';
import type { WorkerComplianceItem } from '../../../types/compliance';

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
  hiredAt?: { toDate: () => Date } | null;
  everifyStatus?: string;
  backgroundRequired?: boolean;
  drugScreenRequired?: boolean;
}

interface PipelineStep {
  id: string;
  title: string;
  status: string;
  applicability?: string;
}

const PAYROLL_LEGAL_STEPS = ['i9', 'onboarding_forms', 'everee'];
const EVERIFY_STEPS = ['e_verify'];
const BACKGROUND_STEPS = ['background_check', 'drug_screen'];

function categorySummary(steps: PipelineStep[], stepIds: string[]): 'complete' | 'in_progress' | 'not_started' | 'not_required' {
  const relevant = steps.filter((s) => stepIds.includes(s.id));
  if (relevant.length === 0) return 'not_started';
  const allNotRequired = relevant.every((s) => s.applicability === 'not_required');
  if (allNotRequired) return 'not_required';
  const allComplete = relevant.filter((s) => s.applicability !== 'not_required').every((s) => s.status === 'complete');
  if (allComplete) return 'complete';
  const anyInProgress = relevant.some((s) => s.status === 'in_progress' || s.status === 'complete');
  return anyInProgress ? 'in_progress' : 'not_started';
}

const CATEGORY_LABEL: Record<string, string> = {
  complete: 'Complete',
  in_progress: 'In progress',
  not_started: 'Not started',
  not_required: 'Not required',
};

const MyEmploymentDetailPage: React.FC = () => {
  const { employmentId } = useParams<{ employmentId: string }>();
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [employment, setEmployment] = useState<EmploymentRecord | null>(null);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [payrollAccount, setPayrollAccount] = useState<{ status: string; id: string } | null>(null);
  const [payrollPortalUrl, setPayrollPortalUrl] = useState<string | null>(null);
  const [complianceItems, setComplianceItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);

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
          setPayrollPortalUrl(null);
          setLoading(false);
          return;
        }
        const data = empSnap.data();
        if (data?.userId !== uid) {
          setEmployment(null);
          setPayrollAccount(null);
          setPayrollPortalUrl(null);
          setLoading(false);
          return;
        }
        const emp = { id: empSnap.id, ...data } as EmploymentRecord;
        setEmployment(emp);

        const pipelineId = data?.onboardingPipelineId;
        if (pipelineId) {
          const pipeRef = doc(db, p.workerOnboardingPipeline(tenantId, pipelineId));
          const pipeSnap = await getDoc(pipeRef);
          const pipeData = pipeSnap.data();
          const steps = Array.isArray(pipeData?.steps) ? pipeData.steps : [];
          setPipelineSteps(steps);
        } else {
          setPipelineSteps([]);
        }

        // Phase 2B: payroll — entity URL and worker payroll account
        const entityId = emp.entityId ?? data?.entityId ?? null;
        const entityKey = emp.entityKey ?? data?.entityKey ?? '';
        if (entityId) {
          try {
            const entityRef = doc(db, p.entity(tenantId, entityId));
            const entitySnap = await getDoc(entityRef);
            const payrollSettings = entitySnap.data()?.payrollSettings;
            const url = payrollSettings?.onboardingUrl || payrollSettings?.portalUrl || null;
            setPayrollPortalUrl(url || null);
          } catch {
            setPayrollPortalUrl(null);
          }
        } else {
          setPayrollPortalUrl(null);
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

        // Compliance items for this worker (for compliance section and readiness)
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
        setPipelineSteps([]);
        setPayrollAccount(null);
        setPayrollPortalUrl(null);
        setComplianceItems([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId, employmentId, uid]);

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
        <Typography component="button" variant="body2" sx={{ mt: 1, textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('/c1/workers/my-employment')}>
          Back to My Employment
        </Typography>
      </Container>
    );
  }

  const statusLabel = getEmploymentStatusLabel(employment.status, employment.workerType);
  const startedAt = employment.onboardingStartedAt?.toDate?.();
  const hiredAt = employment.hiredAt?.toDate?.();
  const isOnboarding = employment.status === 'onboarding';

  const payrollSummary = categorySummary(pipelineSteps, PAYROLL_LEGAL_STEPS);
  const everifySummary = categorySummary(pipelineSteps, EVERIFY_STEPS);
  const backgroundSummary = categorySummary(pipelineSteps, BACKGROUND_STEPS);

  const pipelineId = employment.onboardingPipelineId ?? '';
  const completeCount = pipelineSteps.filter((s) => s.status === 'complete').length;
  const totalCount = pipelineSteps.length;
  const readiness = getWorkerReadiness({
    employments: [{ id: employment.id, status: employment.status, entityKey: employment.entityKey, onboardingPipelineId: pipelineId || undefined }],
    complianceItems,
    payrollByKey: payrollAccount
      ? { [employment.entityKey ? `${uid}__${employment.entityKey}` : employment.id]: { payrollStatus: payrollAccount.status } }
      : {},
    pipelineStepCounts: pipelineId ? { [pipelineId]: { complete: completeCount, total: totalCount } } : {},
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

  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton size="small" onClick={() => navigate('/c1/workers/my-employment')} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }} onClick={() => navigate('/c1/workers/my-employment')}>
            Back to My Employment
          </Typography>
        </Stack>

        {/* Readiness banner */}
        {readiness.status !== 'ready' && readinessBannerMessage[readiness.status] && (
          <Alert
            severity={readiness.status === 'blocked' ? 'error' : readiness.status === 'at_risk' ? 'warning' : 'info'}
            variant="outlined"
          >
            {readinessBannerMessage[readiness.status]}
          </Alert>
        )}

        {/* Compliance attention banner */}
        {showComplianceAlert && (
          <Alert severity={hasExpiredCompliance(complianceItems) ? 'error' : 'warning'} variant="outlined">
            {hasExpiredCompliance(complianceItems)
              ? 'Action required: some of your documents need attention.'
              : 'Some documents will expire soon.'}
          </Alert>
        )}

        {/* Header */}
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600}>
              {employment.entityName || employment.entityKey || 'Entity'}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
              <Chip label={statusLabel} size="small" color={employment.status === 'active' ? 'success' : employment.status === 'terminated' ? 'error' : 'default'} />
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

        {/* Onboarding Progress — only when onboarding */}
        {isOnboarding && pipelineSteps.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                Onboarding progress
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="body2">Payroll & legal</Typography>
                  <Chip label={CATEGORY_LABEL[payrollSummary]} size="small" variant="outlined" color={payrollSummary === 'complete' ? 'success' : 'default'} />
                </Stack>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="body2">E-Verify</Typography>
                  <Chip label={CATEGORY_LABEL[everifySummary]} size="small" variant="outlined" color={everifySummary === 'complete' ? 'success' : 'default'} />
                </Stack>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="body2">Background checks</Typography>
                  <Chip label={CATEGORY_LABEL[backgroundSummary]} size="small" variant="outlined" color={backgroundSummary === 'complete' ? 'success' : 'default'} />
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Payroll — status, progress text, link to TempWorks portal */}
        {(payrollAccount || payrollPortalUrl) && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Payroll
              </Typography>
              {payrollAccount && (
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                  <Chip label={getPayrollStatusLabel(payrollAccount.status)} size="small" variant="outlined" color={payrollAccount.status === 'complete' ? 'success' : 'default'} />
                </Stack>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {payrollAccount?.status === 'complete'
                  ? 'Payroll setup is complete.'
                  : payrollAccount?.status === 'invite_sent' || payrollAccount?.status === 'account_created' || payrollAccount?.status === 'in_progress'
                    ? 'Complete your payroll setup using the link below.'
                    : 'Set up payroll and banking so you can get paid.'}
              </Typography>
              {payrollPortalUrl && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  href={payrollPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  component="a"
                >
                  {payrollAccount?.status === 'complete' ? 'Open Payroll Portal' : 'Open Payroll Setup'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Compliance — required items: incomplete, expired, or expiring soon (visibility only) */}
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
                    <Stack key={item.id ?? item.type} direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={0.5}>
                      <Typography variant="body2">{label}</Typography>
                      <Chip
                        size="small"
                        label={statusText}
                        color={state === 'expired' ? 'error' : state === 'expiring_soon' ? 'warning' : item.status === 'complete' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </Stack>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Documents / Instructions — worker-safe placeholders */}
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Documents & instructions
            </Typography>
            <Stack spacing={0.75}>
              {employment.everifyStatus ? (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                  <Typography variant="body2" color="text.secondary">
                    E-Verify: {String(employment.everifyStatus).replace(/_/g, ' ')}
                  </Typography>
                </Stack>
              ) : null}
              {(employment.backgroundRequired || employment.drugScreenRequired) && (
                <Typography variant="body2" color="text.secondary">
                  {employment.backgroundRequired && 'Background check may be required. '}
                  {employment.drugScreenRequired && 'Drug screening may be required. Follow any instructions sent to you by your recruiter or HR.'}
                </Typography>
              )}
              {!employment.everifyStatus && !employment.backgroundRequired && !employment.drugScreenRequired && (
                <Typography variant="body2" color="text.secondary">
                  No documents or instructions are listed for this entity. Your recruiter or HR will share any forms or next steps with you.
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Actions — minimal, worker-relevant only */}
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Next steps
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {isOnboarding ? (
                <>Complete any tasks or forms your recruiter or HR has sent you. You’ll see updates here as steps are completed.</>
              ) : (
                <>You’re all set with this entity. If you have questions, reach out to your recruiter or HR.</>
              )}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
};

export default MyEmploymentDetailPage;
