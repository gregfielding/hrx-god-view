/**
 * Worker AI pre-screen — saves to users/{uid}/interviews via submitWorkerAiPrescreenInterview callable.
 *
 * Intended entry paths (same route): worker dashboard CTA (`workerAiPrescreenDashboardActions`), SMS/deep link
 * (`buildWorkerAiPrescreenUrl` → `/c1/workers/prescreen?applicationId=…`), optional nav when tenant enables prescreen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  LinearProgress,
  Link,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import {
  WORKER_AI_PRESCREEN_STEPS,
  type WorkerAiPrescreenStep,
  type WorkerAiPrescreenStepId,
} from '../../../constants/workerAiPrescreenQuestions';
import {
  getWorkerAiPrescreenInterviewPlan,
  submitWorkerAiPrescreenInterview,
} from '../../../services/workerAiPrescreenCallable';
import { db } from '../../../firebase';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import type { WorkerAiPrescreenAnswers } from '../../../utils/workerAiPrescreenScore';
import { PRESCREEN_MIN_SUBSTANTIVE_WORDS } from '../../../shared/prescreenAnswerQuality';
import type {
  WorkerAiPrescreenDynamicAnswer,
  WorkerAiPrescreenDynamicStep,
} from '../../../types/workerAiPrescreenDynamic';

/** Dynamic step ids from `buildDynamicPrescreenQuestions` (must match functions). */
const DYNAMIC_WORKSITE_COMMUTE_STEP_ID = 'dyn_worksite_commute';
const DYNAMIC_JOB_DRUG_SCREEN_ID = 'dyn_job_drug_screen';
const DYNAMIC_JOB_BACKGROUND_CHECK_ID = 'dyn_job_background_check';

type WorksiteCommuteBlock = {
  worksiteName?: string;
  streetLine?: string;
  cityStateZipLine: string;
  /** Non-null only when we have enough location detail for a useful map search. */
  mapsQuery: string | null;
};

type JobHeaderInfo = {
  title: string;
  locationLine?: string;
  /** Parsed from job order `worksiteAddress` — same document the server uses to build assignment location. */
  worksiteCommute?: WorksiteCommuteBlock;
};

function emptyAnswers(): WorkerAiPrescreenAnswers {
  return {
    motivation: '',
    experience_details: '',
    work_confidence: [],
    pressure_situation: '',
    attendance_issues: '',
    attendance_explanation: '',
    transportation_plan: '',
    backup_transportation: '',
    physical_comfort: '',
    drug_screen: '',
    background_check: '',
    supervisor_feedback: '',
    additional_notes: '',
  };
}

/** Follow-ups only when the triggering Yes/No question is "Yes". */
const CONDITIONAL_CORE_STEP_IDS: Partial<Record<WorkerAiPrescreenStepId, (a: WorkerAiPrescreenAnswers) => boolean>> = {
  attendance_explanation: (a) => String(a.attendance_issues ?? '').trim().toLowerCase() === 'yes',
};

const SUBSTANTIVE_TEXT_STEP_IDS = new Set<WorkerAiPrescreenStepId>([
  'motivation',
  'experience_details',
  'pressure_situation',
  'supervisor_feedback',
]);

function wordCountAnswer(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isCoreStepIncluded(
  step: WorkerAiPrescreenStep,
  a: WorkerAiPrescreenAnswers,
  dynamicSteps: WorkerAiPrescreenDynamicStep[],
): boolean {
  const dynIds = new Set(dynamicSteps.map((s) => s.id));
  if (step.id === 'drug_screen' && dynIds.has(DYNAMIC_JOB_DRUG_SCREEN_ID)) return false;
  if (step.id === 'background_check' && dynIds.has(DYNAMIC_JOB_BACKGROUND_CHECK_ID)) return false;
  const rule = CONDITIONAL_CORE_STEP_IDS[step.id];
  return rule ? rule(a) : true;
}

/** Dynamic Y/N answers use the same tokens the core single_select expects (`no` | `yes` | `not_sure`). */
function mapDynamicAnswerToCoreDrugBg(raw: string): string {
  const x = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (x === 'yes' || x === 'no' || x === 'not_sure') return x;
  return 'not_sure';
}

function buildAnswersForSubmit(
  answers: WorkerAiPrescreenAnswers,
  dynamicSteps: WorkerAiPrescreenDynamicStep[],
  dynamicAnswers: Record<string, string>,
): WorkerAiPrescreenAnswers {
  const dynIds = new Set(dynamicSteps.map((s) => s.id));
  const attendanceYes = String(answers.attendance_issues ?? '').trim().toLowerCase() === 'yes';

  return {
    ...answers,
    ...(!attendanceYes ? { attendance_explanation: '' } : {}),
    ...(dynIds.has(DYNAMIC_JOB_DRUG_SCREEN_ID)
      ? { drug_screen: mapDynamicAnswerToCoreDrugBg(dynamicAnswers[DYNAMIC_JOB_DRUG_SCREEN_ID] ?? '') }
      : {}),
    ...(dynIds.has(DYNAMIC_JOB_BACKGROUND_CHECK_ID)
      ? {
          background_check: mapDynamicAnswerToCoreDrugBg(dynamicAnswers[DYNAMIC_JOB_BACKGROUND_CHECK_ID] ?? ''),
        }
      : {}),
  };
}

function stepValid(step: WorkerAiPrescreenStep, a: WorkerAiPrescreenAnswers): boolean {
  switch (step.type) {
    case 'text': {
      const v = String((a as Record<string, unknown>)[step.id] ?? '').trim();
      if (step.id === 'additional_notes') return true;
      if (SUBSTANTIVE_TEXT_STEP_IDS.has(step.id)) {
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
      }
      if (step.id === 'attendance_explanation') {
        const attYes = String(a.attendance_issues ?? '').trim().toLowerCase() === 'yes';
        if (!attYes) return true;
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS || /^(n\/a|na)$/i.test(v.trim());
      }
      return v.length >= 2;
    }
    case 'single_select': {
      const v = String((a as Record<string, unknown>)[step.id] ?? '').trim();
      return v.length > 0;
    }
    case 'multi_select': {
      const arr = a.work_confidence || [];
      return arr.length > 0;
    }
    default:
      return true;
  }
}

function dynamicStepValid(step: WorkerAiPrescreenDynamicStep, da: Record<string, string>): boolean {
  const v = String(da[step.id] ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'no' || v === 'not_sure';
}

/** Callable failures — i18n via `tr` (keys under workerAiPrescreen.errors). */
function friendlyPrescreenCallableError(
  e: unknown,
  kind: 'plan' | 'submit',
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const raw = formatFirebaseHttpsError(e);
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code || '') : '';
  const lower = raw.toLowerCase();
  const permission =
    code.includes('permission') ||
    lower.includes('permission denied') ||
    lower.includes('permission-denied');
  if (permission) {
    return tr(
      kind === 'plan'
        ? 'workerAiPrescreen.errors.planPermission'
        : 'workerAiPrescreen.errors.submitPermission',
    );
  }
  const internal =
    code.includes('internal') ||
    lower.includes('server error (internal)') ||
    lower.includes('cloud functions logs') ||
    lower === 'internal';
  if (internal) {
    return tr(
      kind === 'plan'
        ? 'workerAiPrescreen.errors.planInternal'
        : 'workerAiPrescreen.errors.submitInternal',
    );
  }
  const transient =
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('resource-exhausted') ||
    code.includes('aborted') ||
    code.includes('cancelled') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed');
  if (transient) {
    return tr(
      kind === 'plan'
        ? 'workerAiPrescreen.errors.planTransient'
        : 'workerAiPrescreen.errors.submitTransient',
    );
  }
  if (raw && raw !== 'Request failed') {
    return tr('workerAiPrescreen.errors.serverDetail', { detail: raw });
  }
  return tr(
    kind === 'plan' ? 'workerAiPrescreen.errors.planGeneric' : 'workerAiPrescreen.errors.submitGeneric',
  );
}

function formatWorksiteLine(job: Record<string, unknown>): string | undefined {
  const addr = (job.worksiteAddress || {}) as Record<string, unknown>;
  const street = String(addr.street ?? addr.streetAddress ?? '').trim();
  const city = String(addr.city ?? '').trim();
  const state = String(addr.state ?? '').trim();
  const zip = String(addr.zipCode ?? addr.zip ?? '').trim();
  const cityState = [city, state].filter(Boolean).join(', ');
  const parts = [street, cityState, zip].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  const name = String(job.worksiteName ?? job.locationName ?? '').trim();
  return name || undefined;
}

function buildCityStateZipLine(city: string, state: string, zip: string): string {
  const cs = [city, state].filter(Boolean).join(', ');
  if (cs && zip) return `${cs} ${zip}`.trim();
  return cs || zip || '';
}

/** Enough detail that a Maps search is likely useful (street + locality, or city + state). */
function mapsQueryEligible(street: string, city: string, state: string, zip: string): boolean {
  if (street && (city || state || zip)) return true;
  if (city && state) return true;
  return false;
}

function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Worksite lines for the commute dynamic question — from job order worksite fields
 * (aligned with how `formatWorksiteLine` / server assignment location are sourced).
 */
function buildWorksiteCommuteBlock(job: Record<string, unknown>): WorksiteCommuteBlock | undefined {
  const addr = (job.worksiteAddress || {}) as Record<string, unknown>;
  const street = String(addr.street ?? addr.streetAddress ?? '').trim();
  const city = String(addr.city ?? '').trim();
  const state = String(addr.state ?? '').trim();
  const zip = String(addr.zipCode ?? addr.zip ?? '').trim();
  const worksiteName = String(job.worksiteName ?? job.locationName ?? '').trim() || undefined;
  const cityStateZipLine = buildCityStateZipLine(city, state, zip);

  const mapsQuery = mapsQueryEligible(street, city, state, zip)
    ? [street, buildCityStateZipLine(city, state, zip)].filter(Boolean).join(', ').trim()
    : null;

  if (!worksiteName && !street && !cityStateZipLine) return undefined;

  return {
    worksiteName,
    streetLine: street || undefined,
    cityStateZipLine,
    mapsQuery,
  };
}

const WorkerAiPrescreenPage: React.FC = () => {
  const theme = useTheme();
  const t = useT();
  const { user, activeTenant } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const applicationId = searchParams.get('applicationId');
  const tenantId = activeTenant?.id ?? null;

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<WorkerAiPrescreenAnswers>(() => emptyAnswers());
  const [dynamicSteps, setDynamicSteps] = useState<WorkerAiPrescreenDynamicStep[]>([]);
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>({});
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [workerAiPrescreenRequired, setWorkerAiPrescreenRequired] = useState(true);
  const [jobHeaderInfo, setJobHeaderInfo] = useState<JobHeaderInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submittedInterviewId, setSubmittedInterviewId] = useState<string | null>(null);

  const prevVisibleCoreRef = useRef<WorkerAiPrescreenStep[]>([]);
  const prevCoreLenRef = useRef(0);

  // `t` is a stable function ref; depend on a resolved string so this memo recomputes after locale JSON loads (otherwise step prompts stay as raw keys).
  const i18nWorkerPrescreenReady = t('workerAiPrescreen.title');
  const localizedCoreSteps = useMemo(() => {
    return WORKER_AI_PRESCREEN_STEPS.map((step) => {
      const prompt = t(`workerAiPrescreen.steps.${step.id}.prompt`);
      const options = step.options?.map((o) => {
        const suffix = String(o.value).replace(/[^a-zA-Z0-9_]/g, '_');
        const lk = `workerAiPrescreen.steps.${step.id}.opt_${suffix}`;
        const lab = t(lk);
        return { ...o, label: lab === lk ? o.label : lab };
      });
      return { ...step, prompt, options: options ?? step.options };
    });
  }, [t, i18nWorkerPrescreenReady]);

  const visibleCoreSteps = useMemo(
    () => localizedCoreSteps.filter((step) => isCoreStepIncluded(step, answers, dynamicSteps)),
    [localizedCoreSteps, answers.attendance_issues, dynamicSteps],
  );

  const coreLen = visibleCoreSteps.length;
  const totalSteps = coreLen + dynamicSteps.length;
  const isDynamicPhase = stepIndex >= coreLen;
  const coreStep = !isDynamicPhase ? visibleCoreSteps[stepIndex] ?? null : null;
  const dynamicStep = isDynamicPhase ? dynamicSteps[stepIndex - coreLen] : null;

  useEffect(() => {
    const prev = prevVisibleCoreRef.current;
    const prevLen = prevCoreLenRef.current;
    const newLen = visibleCoreSteps.length;
    const delta = prevLen - newLen;

    if (prevLen > 0 && delta !== 0) {
      setStepIndex((si) => {
        if (si >= prevLen) {
          if (delta > 0) return Math.max(newLen, si - delta);
          return si;
        }
        const idAt = prev[Math.min(si, prev.length - 1)]?.id;
        if (idAt) {
          const j = visibleCoreSteps.findIndex((s) => s.id === idAt);
          if (j >= 0) return j;
        }
        return Math.min(si, Math.max(0, newLen - 1));
      });
    }

    if (totalSteps > 0) {
      setStepIndex((i) => (i >= totalSteps ? totalSteps - 1 : i));
    }

    prevVisibleCoreRef.current = visibleCoreSteps;
    prevCoreLenRef.current = newLen;
  }, [visibleCoreSteps, totalSteps, answers.attendance_issues, dynamicSteps.length]);

  useEffect(() => {
    if (String(answers.attendance_issues ?? '').trim().toLowerCase() === 'yes') return;
    setAnswers((prev) => (prev.attendance_explanation ? { ...prev, attendance_explanation: '' } : prev));
  }, [answers.attendance_issues]);

  useEffect(() => {
    setStepIndex(0);
    setDone(false);
    setSubmittedInterviewId(null);
    prevVisibleCoreRef.current = [];
    prevCoreLenRef.current = 0;
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId || !tenantId || !user?.uid) {
      setJobHeaderInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const appRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists() || cancelled) return;
        const app = appSnap.data() as Record<string, unknown>;
        const owner = String(app.userId || app.candidateId || '').trim();
        if (owner !== user.uid) {
          if (!cancelled) setJobHeaderInfo(null);
          return;
        }
        const jobOrderId = String(app.jobOrderId || '').trim();
        if (!jobOrderId) {
          const titleOnly = String(app.jobTitle || app.positionTitle || '').trim();
          if (!cancelled) setJobHeaderInfo(titleOnly ? { title: titleOnly } : null);
          return;
        }
        const jobRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists() || cancelled) return;
        const j = jobSnap.data() as Record<string, unknown>;
        const title = String(j.jobTitle || j.jobOrderName || '').trim();
        const locationLine = formatWorksiteLine(j);
        const worksiteCommute = buildWorksiteCommuteBlock(j);
        if (!cancelled) setJobHeaderInfo({ title, locationLine, worksiteCommute });
      } catch {
        if (!cancelled) setJobHeaderInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, tenantId, user?.uid]);

  useEffect(() => {
    if (!applicationId || !user?.uid) {
      setDynamicSteps([]);
      setDynamicAnswers({});
      setPlanError(null);
      setPlanLoading(false);
      setWorkerAiPrescreenRequired(true);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    setPlanError(null);
    void (async () => {
      try {
        const plan = await getWorkerAiPrescreenInterviewPlan({
          applicationId,
          tenantId,
        });
        if (cancelled) return;
        setWorkerAiPrescreenRequired(plan.workerAiPrescreenRequired !== false);
        const steps = plan.dynamicSteps;
        setDynamicSteps(Array.isArray(steps) ? steps : []);
        const init: Record<string, string> = {};
        for (const s of steps || []) {
          init[s.id] = '';
        }
        setDynamicAnswers(init);
      } catch (e) {
        if (!cancelled) {
          setDynamicSteps([]);
          setDynamicAnswers({});
          setWorkerAiPrescreenRequired(true);
          setPlanError(friendlyPrescreenCallableError(e, 'plan', t));
        }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, user?.uid, tenantId, t]);

  const progress = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  const setText = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const setDynamicAnswer = useCallback((id: string, value: WorkerAiPrescreenDynamicAnswer) => {
    setDynamicAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleMulti = useCallback((value: string) => {
    setAnswers((prev) => {
      const cur = new Set(prev.work_confidence || []);
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      return { ...prev, work_confidence: Array.from(cur) };
    });
  }, []);

  const canNext = useMemo(() => {
    if (isDynamicPhase) {
      return dynamicStep ? dynamicStepValid(dynamicStep, dynamicAnswers) : false;
    }
    return coreStep ? stepValid(coreStep, answers) : false;
  }, [isDynamicPhase, dynamicStep, dynamicAnswers, coreStep, answers]);

  const goNext = () => {
    if (!canNext) return;
    if (stepIndex < totalSteps - 1) setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setError(null);
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const handleSubmit = async () => {
    if (!user?.uid) return;
    if (!canNext) return;
    setSubmitting(true);
    setError(null);
    try {
      const payloadDyn: Record<string, WorkerAiPrescreenDynamicAnswer> = {};
      for (const s of dynamicSteps) {
        const v = String(dynamicAnswers[s.id] ?? '').trim().toLowerCase();
        if (v === 'yes' || v === 'no' || v === 'not_sure') {
          payloadDyn[s.id] = v;
        }
      }
      const result = await submitWorkerAiPrescreenInterview({
        answers: buildAnswersForSubmit(answers, dynamicSteps, dynamicAnswers),
        applicationId: applicationId || null,
        tenantId,
        dynamicAnswers: Object.keys(payloadDyn).length > 0 ? payloadDyn : undefined,
      });
      setSubmittedInterviewId(
        typeof result?.interviewId === 'string' && result.interviewId.trim() ? result.interviewId.trim() : null,
      );
      setDone(true);
    } catch (e) {
      setError(friendlyPrescreenCallableError(e, 'submit', t));
    } finally {
      setSubmitting(false);
    }
  };

  const displayJobTitle = jobHeaderInfo?.title?.trim()
    ? jobHeaderInfo.title
    : t('workerAiPrescreen.fallbackRoleTitle');

  const renderFramingHeader = (opts?: { loading?: boolean }) => (
    <Stack spacing={0.5} sx={{ mt: 0, mb: 1.25 }}>
      <Typography variant="h6" fontWeight={700} component="h1" sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
        {workerAiPrescreenRequired ? t('workerAiPrescreen.title') : t('workerAiPrescreen.titleOptional')}
      </Typography>
      {applicationId ? (
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          {workerAiPrescreenRequired
            ? t('workerAiPrescreen.subtitleWithJob')
            : t('workerAiPrescreen.subtitleOptional')}
        </Typography>
      ) : null}
      {applicationId && jobHeaderInfo && !opts?.loading ? (
        <Stack spacing={0.25} sx={{ pt: 0.25 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
            {displayJobTitle}
          </Typography>
          {jobHeaderInfo.locationLine ? (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
              {jobHeaderInfo.locationLine}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35, pt: 0.25 }}>
        {workerAiPrescreenRequired ? t('workerAiPrescreen.durationHint') : t('workerAiPrescreen.durationHintOptional')}
      </Typography>
    </Stack>
  );

  if (!user) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="body1">{t('workerAiPrescreen.signInPrompt')}</Typography>
        <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/c1/workers/dashboard')}>
          {t('workerAiPrescreen.backToDashboard')}
        </Button>
      </Box>
    );
  }

  if (done) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
        <Paper
          elevation={0}
          variant="outlined"
          sx={{
            p: { xs: 2, sm: 3 },
            borderColor: 'success.light',
            bgcolor: alpha(theme.palette.success.main, 0.06),
          }}
        >
          <Stack spacing={1.5} alignItems="center" textAlign="center">
            <CheckCircleOutlineIcon sx={{ fontSize: 48, color: 'success.main' }} aria-hidden />
            <Typography variant="h6" fontWeight={700} component="h2">
              {t('workerAiPrescreen.successTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, lineHeight: 1.45 }}>
              {t('workerAiPrescreen.successBody1')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, lineHeight: 1.45 }}>
              {t('workerAiPrescreen.successBody2')}
            </Typography>
            {submittedInterviewId ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontFamily: 'monospace' }}>
                {t('workerAiPrescreen.referenceLabel', { id: submittedInterviewId })}
              </Typography>
            ) : null}
            <Button
              fullWidth
              variant="contained"
              color="success"
              sx={{ mt: 0.5, py: 1.25, fontWeight: 600 }}
              onClick={() => navigate('/c1/workers/dashboard')}
            >
              {t('workerAiPrescreen.backToDashboard')}
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (applicationId && planLoading) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
        {renderFramingHeader({ loading: true })}
        <LinearProgress sx={{ borderRadius: 1, mb: 1 }} />
        <Stack alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
          <CircularProgress size={36} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t('workerAiPrescreen.loadingJobQuestions')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  const isLast = stepIndex === totalSteps - 1;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, pb: { xs: 3, sm: 4 }, maxWidth: 560, mx: 'auto' }}>
      {renderFramingHeader()}

      {applicationId && !tenantId ? (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.75 }}>
          {t('workerAiPrescreen.alertChooseTenant')}
        </Alert>
      ) : null}

      <LinearProgress variant="determinate" value={progress} sx={{ mb: 0.75, borderRadius: 1, height: 6 }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
        {t('workerAiPrescreen.progressOf', { current: stepIndex + 1, total: totalSteps })}
      </Typography>

      {planError ? (
        <Alert severity="warning" sx={{ mb: 1.5, py: 0.75 }}>
          {planError}
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mb: 1.5, py: 0.75 }}>
          {error}
        </Alert>
      ) : null}

      <Box sx={{ minHeight: { xs: 160, sm: 180 } }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1, lineHeight: 1.35 }}>
          {isDynamicPhase ? dynamicStep?.prompt : coreStep?.prompt}
        </Typography>

        {isDynamicPhase &&
        dynamicStep?.id === DYNAMIC_WORKSITE_COMMUTE_STEP_ID &&
        (jobHeaderInfo?.worksiteCommute || jobHeaderInfo?.locationLine) ? (
          <Paper
            variant="outlined"
            sx={{
              p: 1.25,
              mb: 1.25,
              bgcolor: (muiTheme) => alpha(muiTheme.palette.text.primary, 0.04),
              borderColor: 'divider',
            }}
          >
            {jobHeaderInfo.worksiteCommute ? (
              <Stack spacing={0.35}>
                {jobHeaderInfo.worksiteCommute.worksiteName ? (
                  <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.35 }}>
                    {jobHeaderInfo.worksiteCommute.worksiteName}
                  </Typography>
                ) : null}
                {jobHeaderInfo.worksiteCommute.streetLine ? (
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {jobHeaderInfo.worksiteCommute.streetLine}
                  </Typography>
                ) : null}
                {jobHeaderInfo.worksiteCommute.cityStateZipLine ? (
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {jobHeaderInfo.worksiteCommute.cityStateZipLine}
                  </Typography>
                ) : null}
                {jobHeaderInfo.worksiteCommute.mapsQuery ? (
                  <Link
                    component="a"
                    href={buildGoogleMapsSearchUrl(jobHeaderInfo.worksiteCommute.mapsQuery)}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                    sx={{ alignSelf: 'flex-start', mt: 0.25, fontWeight: 500 }}
                  >
                    {t('workerAiPrescreen.openInMaps')}
                  </Link>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                {jobHeaderInfo.locationLine}
              </Typography>
            )}
          </Paper>
        ) : null}

        {!isDynamicPhase && coreStep?.type === 'text' && (
          <TextField
            fullWidth
            multiline
            minRows={coreStep.id === 'motivation' || coreStep.id === 'additional_notes' ? 3 : 3}
            value={String((answers as Record<string, string>)[coreStep.id] ?? '')}
            onChange={(e) => setText(coreStep.id, e.target.value)}
            placeholder={t('workerAiPrescreen.placeholderShortAnswer')}
            sx={{ '& .MuiInputBase-root': { pt: 0.5 } }}
          />
        )}

        {!isDynamicPhase && coreStep?.type === 'single_select' && coreStep.options && (
          <FormControl component="fieldset" fullWidth sx={{ mt: 0.5 }}>
            <RadioGroup
              value={String((answers as Record<string, string>)[coreStep.id] ?? '')}
              onChange={(_, v) => setText(coreStep.id, v)}
            >
              {coreStep.options.map((o) => (
                <FormControlLabel key={o.value} value={o.value} control={<Radio size="small" />} label={o.label} />
              ))}
            </RadioGroup>
          </FormControl>
        )}

        {!isDynamicPhase && coreStep?.type === 'multi_select' && coreStep.options && (
          <Stack spacing={0.75}>
            {coreStep.options.map((o) => (
              <FormControlLabel
                key={o.value}
                control={
                  <Checkbox
                    size="small"
                    checked={(answers.work_confidence || []).includes(o.value)}
                    onChange={() => toggleMulti(o.value)}
                  />
                }
                label={o.label}
              />
            ))}
            {(answers.work_confidence || []).length > 0 && (
              <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {(answers.work_confidence || []).map((v) => (
                  <Chip key={v} size="small" label={coreStep.options!.find((x) => x.value === v)?.label || v} />
                ))}
              </Stack>
            )}
          </Stack>
        )}

        {isDynamicPhase && dynamicStep?.options && (
          <FormControl component="fieldset" fullWidth sx={{ mt: 0.5 }}>
            <RadioGroup
              value={String(dynamicAnswers[dynamicStep.id] ?? '')}
              onChange={(_, v) =>
                setDynamicAnswer(dynamicStep.id, v as WorkerAiPrescreenDynamicAnswer)
              }
            >
              {dynamicStep.options.map((o) => (
                <FormControlLabel key={o.value} value={o.value} control={<Radio size="small" />} label={o.label} />
              ))}
            </RadioGroup>
          </FormControl>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          onClick={goBack}
          disabled={stepIndex === 0 || submitting}
          fullWidth
          sx={{ py: 1.15, fontWeight: 600 }}
        >
          {t('common.back')}
        </Button>
        {!isLast ? (
          <Button
            variant="contained"
            onClick={goNext}
            disabled={!canNext || submitting}
            fullWidth
            sx={{ py: 1.15, fontWeight: 700 }}
          >
            {t('common.next')}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void handleSubmit()}
            disabled={!canNext || submitting}
            fullWidth
            sx={{ py: 1.15, fontWeight: 700 }}
          >
            {submitting ? <CircularProgress size={22} color="inherit" /> : t('workerAiPrescreen.submit')}
          </Button>
        )}
      </Stack>
    </Box>
  );
};

export default WorkerAiPrescreenPage;
