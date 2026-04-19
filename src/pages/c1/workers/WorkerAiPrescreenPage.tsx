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
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { applyPrescreenDynamicDedupe } from '../../../shared/prescreenDynamicDedupe';
import type {
  WorkerAiPrescreenDynamicAnswer,
  WorkerAiPrescreenDynamicStep,
} from '../../../types/workerAiPrescreenDynamic';
import WorkerAiPrescreenStrengthenPanel from '../../../components/worker/WorkerAiPrescreenStrengthenPanel';
import { buildPrescreenSessionProfileEnhancements } from '../../../utils/workerAiPrescreenSubmitProfileSnapshot';
import { userDocNeedsLegalFirstNameConfirm } from '../../../utils/profileDisplayName';
import type { WorkerAiPrescreenUiSection } from '../../../utils/workerAiPrescreenUiFlow';
import {
  buildPrescreenNavEntries,
  ensureFastPathNarrativePadding,
  mergeClientFollowUpsIntoAnswers,
  navEntryStepId,
  PRESCREEN_FAST_PATH_V2,
  prescreenUiSectionForNavEntry,
  shouldAskExpandedQuestions,
  validatePrescreenNavEntry,
  type PrescreenNavEntry,
  type PrescreenSessionFollowupLocks,
} from '../../../utils/workerAiPrescreenV2Flow';
import {
  logPrescreenAbandoned,
  logPrescreenAdaptiveBootstrap,
  logPrescreenCompleted,
  logPrescreenInterviewEntered,
  logPrescreenStepCompleted,
  logPrescreenStepViewed,
} from '../../../utils/prescreenAnalytics';
import {
  buildAnswersPatchFromUserPreferences,
  computeAdaptiveFirstNavIndex,
} from '../../../utils/workerAiPrescreenAdaptiveEntry';

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

/** i18n key for a short line above job-specific dynamics (clarifies layering vs general reliability answers). */
function progressiveLeadI18nKeyForDynamicStepId(stepId: string): string | null {
  const direct: Record<string, string> = {
    dyn_shift_punctuality: 'workerAiPrescreen.v2.progressiveLead.dyn_shift_punctuality',
    dyn_worksite_commute: 'workerAiPrescreen.v2.progressiveLead.dyn_worksite_commute',
    dyn_physical_job_fit: 'workerAiPrescreen.v2.progressiveLead.dyn_physical_job_fit',
    dyn_job_drug_screen: 'workerAiPrescreen.v2.progressiveLead.dyn_job_compliance',
    dyn_job_background_check: 'workerAiPrescreen.v2.progressiveLead.dyn_job_compliance',
    dyn_uniform_available: 'workerAiPrescreen.v2.progressiveLead.dyn_uniform_available',
    dyn_gig_path_willing: 'workerAiPrescreen.v2.progressiveLead.dyn_gig_path_willing',
  };
  if (direct[stepId]) return direct[stepId];
  if (stepId.startsWith('dyn_cert_willing__')) return 'workerAiPrescreen.v2.progressiveLead.dyn_cert_willing';
  if (stepId.startsWith('dyn_cert__')) return 'workerAiPrescreen.v2.progressiveLead.dyn_cert_have';
  return null;
}

function emptyAnswers(): WorkerAiPrescreenAnswers {
  return {
    confirm_legal_first_name: '',
    opening_target_work_types: [],
    opening_schedule_preferences: [],
    opening_experience_industrial: [],
    opening_experience_hospitality: [],
    opening_experience_events: [],
    opening_experience_clerical: [],
    opening_experience_healthcare: [],
    opening_gig_types: [],
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
    drug_screen_detail: '',
    background_check: '',
    background_check_detail: '',
    background_offense_class: '',
    background_offense_when: '',
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
  'drug_screen_detail',
  'background_check_detail',
]);

function wordCountAnswer(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function openingTargetsSelected(a: WorkerAiPrescreenAnswers): Set<string> {
  return new Set((a.opening_target_work_types || []).map((x) => String(x).trim()).filter(Boolean));
}

function openingSchedulesSelected(a: WorkerAiPrescreenAnswers): Set<string> {
  return new Set((a.opening_schedule_preferences || []).map((x) => String(x).trim()).filter(Boolean));
}

function isCoreStepIncluded(
  step: WorkerAiPrescreenStep,
  a: WorkerAiPrescreenAnswers,
  dynamicSteps: WorkerAiPrescreenDynamicStep[],
  needsLegalNameConfirm: boolean,
): boolean {
  if (step.id === 'confirm_legal_first_name') return needsLegalNameConfirm;
  const tw = openingTargetsSelected(a);
  const sp = openingSchedulesSelected(a);
  if (step.id === 'opening_experience_industrial' && !tw.has('industrial')) return false;
  if (step.id === 'opening_experience_hospitality' && !tw.has('hospitality')) return false;
  if (step.id === 'opening_experience_events' && !tw.has('events')) return false;
  if (step.id === 'opening_experience_clerical' && !tw.has('clerical_admin')) return false;
  if (step.id === 'opening_experience_healthcare' && !tw.has('healthcare')) return false;
  if (step.id === 'opening_gig_types' && !sp.has('gig_work')) return false;

  const dynIds = new Set(dynamicSteps.map((s) => s.id));
  if (step.id === 'drug_screen' && dynIds.has(DYNAMIC_JOB_DRUG_SCREEN_ID)) return false;
  if (step.id === 'background_check' && dynIds.has(DYNAMIC_JOB_BACKGROUND_CHECK_ID)) return false;
  if (step.id === 'drug_screen_detail') {
    if (dynIds.has(DYNAMIC_JOB_DRUG_SCREEN_ID)) return false;
    return String(a.drug_screen ?? '').trim().toLowerCase() === 'yes';
  }
  if (step.id === 'background_check_detail') {
    if (dynIds.has(DYNAMIC_JOB_BACKGROUND_CHECK_ID)) return false;
    return String(a.background_check ?? '').trim().toLowerCase() === 'yes';
  }
  if (step.id === 'background_offense_class' || step.id === 'background_offense_when') {
    if (dynIds.has(DYNAMIC_JOB_BACKGROUND_CHECK_ID)) return false;
    return String(a.background_check ?? '').trim().toLowerCase() === 'yes';
  }
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
    ...(String(answers.background_check ?? '').trim().toLowerCase() !== 'yes'
      ? { background_offense_class: '', background_offense_when: '' }
      : {}),
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
      if (step.id === 'confirm_legal_first_name') {
        return v.length >= 2 && v.length <= 80 && /[a-zA-Z\u00C0-\u024F]/.test(v);
      }
      if (step.id === 'additional_notes') return true;
      if (SUBSTANTIVE_TEXT_STEP_IDS.has(step.id)) {
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
      }
      if (step.id === 'attendance_explanation') {
        const attYes = String(a.attendance_issues ?? '').trim().toLowerCase() === 'yes';
        if (!attYes) return true;
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS || /^(n\/a|na)$/i.test(v.trim());
      }
      if (step.id === 'background_offense_class' || step.id === 'background_offense_when') {
        return true;
      }
      return v.length >= 2;
    }
    case 'single_select': {
      const v = String((a as Record<string, unknown>)[step.id] ?? '').trim();
      return v.length > 0;
    }
    case 'multi_select': {
      const arr =
        step.id === 'work_confidence'
          ? a.work_confidence || []
          : Array.isArray((a as Record<string, unknown>)[step.id])
            ? ((a as Record<string, unknown>)[step.id] as string[])
            : [];
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

function localizedDynamicPrompt(
  step: WorkerAiPrescreenDynamicStep | null | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!step) return '';
  if (step.promptKey) {
    const s = tr(step.promptKey, step.promptParams);
    if (s !== step.promptKey) return s;
  }
  return step.prompt;
}

function localizedDynamicOptionLabel(
  value: string,
  fallbackLabel: string,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const k = `workerAiPrescreen.dynamicOpts.${value}`;
  const s = tr(k);
  return s !== k ? s : fallbackLabel;
}

const WorkerAiPrescreenPage: React.FC = () => {
  const theme = useTheme();
  const t = useT();
  const { user, activeTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const applicationId = searchParams.get('applicationId');
  const entryQuery = searchParams.get('entry');
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
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  /** Client-only follow-up merged into `experience_details` on submit (not a server key). */
  const [experienceFollowupOptional, setExperienceFollowupOptional] = useState('');
  const [pressureFollowupOptional, setPressureFollowupOptional] = useState('');
  const [supervisorFollowupOptional, setSupervisorFollowupOptional] = useState('');
  /** Sticky session: once a follow-up is in the path, keep it so step count does not churn while editing. */
  const [sessionFollowupLocks, setSessionFollowupLocks] = useState<PrescreenSessionFollowupLocks>({
    experienceFollowup: false,
    pressureFollowup: false,
    supervisorFollowup: false,
  });
  const interviewStartedAtMs = useRef<number | null>(null);
  const lastStepIdLogged = useRef<string>('');
  const stepIndexRef = useRef(0);
  const doneRef = useRef(false);
  /** Latches true if `experience_details` was ever “weak” this session; keeps expanded narrative in nav. */
  const expandedNarrativeEverWeakRef = useRef(false);
  const adaptiveBootstrapDoneRef = useRef(false);
  const [userProfileSnapshotReady, setUserProfileSnapshotReady] = useState(false);

  const prevVisibleCoreRef = useRef<WorkerAiPrescreenStep[]>([]);
  const prevCoreLenRef = useRef(0);
  const prevNavLenRef = useRef(0);

  // `t` is a stable function ref; depend on a resolved string so this memo recomputes after locale JSON loads (otherwise step prompts stay as raw keys).
  const i18nWorkerPrescreenReady = t('workerAiPrescreen.title');

  const needsLegalNameConfirm = useMemo(() => userDocNeedsLegalFirstNameConfirm(userDoc), [userDoc]);

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
    () =>
      localizedCoreSteps.filter((step) =>
        isCoreStepIncluded(step, answers, dynamicSteps, needsLegalNameConfirm),
      ),
    [
      localizedCoreSteps,
      answers,
      answers.attendance_issues,
      answers.opening_target_work_types,
      answers.opening_schedule_preferences,
      dynamicSteps,
      needsLegalNameConfirm,
    ],
  );

  if (PRESCREEN_FAST_PATH_V2 && shouldAskExpandedQuestions(answers)) {
    expandedNarrativeEverWeakRef.current = true;
  }

  const visibleDynamicSteps = useMemo(() => {
    if (dynamicSteps.length === 0) return [];
    return applyPrescreenDynamicDedupe(dynamicSteps, answers, dynamicAnswers).visibleSteps;
  }, [
    dynamicSteps,
    answers,
    answers.attendance_issues,
    answers.transportation_plan,
    answers.backup_transportation,
    answers.physical_comfort,
    dynamicAnswers,
  ]);

  const navEntries = useMemo(
    () =>
      buildPrescreenNavEntries({
        isFastPath: PRESCREEN_FAST_PATH_V2,
        visibleCoreSteps,
        dynamicStepsPlan: dynamicSteps,
        visibleDynamicSteps,
        answers,
        experienceFollowupText: experienceFollowupOptional,
        sessionFollowupLocks,
        expandedNarrativeSticky: expandedNarrativeEverWeakRef.current,
      }),
    [
      visibleCoreSteps,
      dynamicSteps,
      visibleDynamicSteps,
      answers,
      answers.experience_details,
      answers.opening_target_work_types,
      answers.opening_schedule_preferences,
      answers.attendance_issues,
      answers.transportation_plan,
      answers.backup_transportation,
      answers.physical_comfort,
      answers.pressure_situation,
      answers.supervisor_feedback,
      experienceFollowupOptional,
      sessionFollowupLocks,
      dynamicAnswers,
    ],
  );

  const totalSteps = navEntries.length;
  const currentEntry: PrescreenNavEntry | null = totalSteps > 0 ? navEntries[stepIndex] ?? null : null;
  const isDynamicPhase = currentEntry?.kind === 'dynamic';
  const coreStep = currentEntry?.kind === 'core' ? currentEntry.step : null;
  const dynamicStep = currentEntry?.kind === 'dynamic' ? currentEntry.step : null;
  const clientFollowupKind =
    currentEntry?.kind === 'client_followup' ? currentEntry.followup : null;

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

    prevVisibleCoreRef.current = visibleCoreSteps;
    prevCoreLenRef.current = newLen;
  }, [visibleCoreSteps, answers.attendance_issues, dynamicSteps.length]);

  useEffect(() => {
    const n = navEntries.length;
    setStepIndex((i) => {
      if (n <= 0) return 0;
      return i >= n ? n - 1 : i;
    });
    prevNavLenRef.current = n;
  }, [navEntries.length]);

  useEffect(() => {
    if (String(answers.attendance_issues ?? '').trim().toLowerCase() === 'yes') return;
    setAnswers((prev) => (prev.attendance_explanation ? { ...prev, attendance_explanation: '' } : prev));
  }, [answers.attendance_issues]);

  useEffect(() => {
    setStepIndex(0);
    setDone(false);
    setSubmittedInterviewId(null);
    setExperienceFollowupOptional('');
    setPressureFollowupOptional('');
    setSupervisorFollowupOptional('');
    setSessionFollowupLocks({ experienceFollowup: false, pressureFollowup: false, supervisorFollowup: false });
    expandedNarrativeEverWeakRef.current = false;
    adaptiveBootstrapDoneRef.current = false;
    prevVisibleCoreRef.current = [];
    prevCoreLenRef.current = 0;
  }, [applicationId]);

  useEffect(() => {
    setSessionFollowupLocks((prev) => {
      const expWc = wordCountAnswer(String(answers.experience_details ?? ''));
      const pWc = wordCountAnswer(String(answers.pressure_situation ?? ''));
      const sWc = wordCountAnswer(String(answers.supervisor_feedback ?? ''));
      const expanded = PRESCREEN_FAST_PATH_V2 && shouldAskExpandedQuestions(answers);
      const next: PrescreenSessionFollowupLocks = {
        experienceFollowup:
          prev.experienceFollowup || (PRESCREEN_FAST_PATH_V2 && expWc >= 3 && expWc < 9),
        pressureFollowup:
          prev.pressureFollowup ||
          (expanded && PRESCREEN_FAST_PATH_V2 && pWc >= 3 && pWc < 9),
        supervisorFollowup:
          prev.supervisorFollowup || (PRESCREEN_FAST_PATH_V2 && sWc >= 3 && sWc < 9),
      };
      if (
        next.experienceFollowup === prev.experienceFollowup &&
        next.pressureFollowup === prev.pressureFollowup &&
        next.supervisorFollowup === prev.supervisorFollowup
      ) {
        return prev;
      }
      return next;
    });
  }, [answers.experience_details, answers.pressure_situation, answers.supervisor_feedback]);

  useEffect(() => {
    interviewStartedAtMs.current = Date.now();
  }, [applicationId, user?.uid]);

  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);

  useEffect(() => {
    doneRef.current = done;
  }, [done]);

  const prescreenViewKeyRef = useRef<string>('');
  useEffect(() => {
    if (done || totalSteps <= 0) return;
    const entry = navEntries[stepIndex];
    if (!entry) return;
    const id = navEntryStepId(entry);
    const key = `${stepIndex}:${id}`;
    if (prescreenViewKeyRef.current === key) return;
    prescreenViewKeyRef.current = key;
    logPrescreenStepViewed({
      stepId: id,
      stepIndex,
      totalSteps,
      entry: entryQuery,
      hasApplication: Boolean(applicationId),
      isOptionalFollowup: id.endsWith('_followup_optional'),
    });
    lastStepIdLogged.current = id;
  }, [stepIndex, totalSteps, done, navEntries, entryQuery, applicationId]);

  useEffect(
    () => () => {
      if (doneRef.current) return;
      logPrescreenAbandoned({
        lastStepId: lastStepIdLogged.current || 'unknown',
        stepIndex: stepIndexRef.current,
      });
    },
    [],
  );

  useEffect(() => {
    if (!user?.uid) {
      setUserDoc(null);
      setUserProfileSnapshotReady(true);
      return;
    }
    setUserProfileSnapshotReady(false);
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
      setUserProfileSnapshotReady(true);
    });
    return () => {
      unsub();
      setUserProfileSnapshotReady(false);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    logPrescreenInterviewEntered({
      entry: entryQuery,
      hasApplication: Boolean(applicationId),
      applicationId,
    });
  }, [user?.uid, entryQuery, applicationId]);

  useEffect(() => {
    if (!user?.uid || !userProfileSnapshotReady || done || planLoading || navEntries.length === 0 || adaptiveBootstrapDoneRef.current) {
      return;
    }
    const patch = buildAnswersPatchFromUserPreferences(userDoc);
    const synthetic: WorkerAiPrescreenAnswers = { ...answers, ...patch };
    const { index, reason, firstStepId } = computeAdaptiveFirstNavIndex({
      navEntries,
      baseAnswers: synthetic,
      patchFromProfile: {},
      dynamicAnswers,
      experienceFollowupOptional,
      pressureFollowupOptional,
      supervisorFollowupOptional,
      dynamicStepValid,
      hasApplicationId: Boolean(applicationId),
    });
    adaptiveBootstrapDoneRef.current = true;
    if (Object.keys(patch).length > 0) {
      setAnswers((prev) => ({ ...prev, ...patch }));
    }
    logPrescreenAdaptiveBootstrap({
      reason,
      firstStepId,
      firstStepIndex: index,
      hadProfilePrefsPatch: Object.keys(patch).length > 0,
      entry: entryQuery,
      hasApplication: Boolean(applicationId),
    });
    if (index > 0) {
      setStepIndex(index);
    }
  }, [
    user?.uid,
    userProfileSnapshotReady,
    done,
    planLoading,
    navEntries,
    userDoc,
    applicationId,
    answers,
    dynamicAnswers,
    experienceFollowupOptional,
    pressureFollowupOptional,
    supervisorFollowupOptional,
  ]);

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
    if (!user?.uid) {
      setDynamicSteps([]);
      setDynamicAnswers({});
      setPlanError(null);
      setPlanLoading(false);
      setWorkerAiPrescreenRequired(true);
      return;
    }
    const canFetchPlan = Boolean(applicationId) || Boolean(tenantId);
    if (!canFetchPlan) {
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
          applicationId: applicationId || null,
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

  const currentUiSection = useMemo((): WorkerAiPrescreenUiSection | null => {
    if (!currentEntry) return null;
    return prescreenUiSectionForNavEntry(currentEntry);
  }, [currentEntry]);

  const showSectionHeader = useMemo(() => {
    if (totalSteps <= 0 || !currentEntry) return false;
    const curr = prescreenUiSectionForNavEntry(currentEntry);
    if (stepIndex === 0) return curr !== null;
    const prevE = navEntries[stepIndex - 1];
    if (!prevE) return true;
    return curr !== prescreenUiSectionForNavEntry(prevE);
  }, [stepIndex, totalSteps, currentEntry, navEntries]);

  const microConfirmKey = useMemo((): 'experienceDetails' | 'workConfidence' | null => {
    if (stepIndex <= 0) return null;
    const prevE = navEntries[stepIndex - 1];
    if (!prevE || prevE.kind !== 'core') return null;
    if (prevE.step.id === 'experience_details') return 'experienceDetails';
    if (prevE.step.id === 'work_confidence') return 'workConfidence';
    return null;
  }, [stepIndex, navEntries]);

  const openingCompleteBanner = useMemo(() => {
    if (coreStep?.id !== 'work_confidence' || stepIndex < 1) return false;
    const prev = navEntries[stepIndex - 1];
    if (!prev || prev.kind !== 'core') return false;
    return String(prev.step.id).startsWith('opening_');
  }, [coreStep?.id, stepIndex, navEntries]);

  const firstDynamicNavIndex = useMemo(
    () => navEntries.findIndex((e) => e.kind === 'dynamic'),
    [navEntries],
  );

  const showJobFitTransition = useMemo(() => {
    if (!isDynamicPhase || !dynamicStep || firstDynamicNavIndex < 0) return false;
    return stepIndex === firstDynamicNavIndex;
  }, [isDynamicPhase, dynamicStep, stepIndex, firstDynamicNavIndex]);

  const progressiveDynamicLeadKey = useMemo(() => {
    if (!isDynamicPhase || !dynamicStep) return null;
    return progressiveLeadI18nKeyForDynamicStepId(dynamicStep.id);
  }, [isDynamicPhase, dynamicStep]);

  /** Only in the last two steps so “almost done” does not appear when wrap-up still has several screens left. */
  const showWrapUpAlmostDoneTransition = useMemo(() => {
    if (totalSteps <= 1) return false;
    if (!showSectionHeader || currentUiSection !== 'wrapUp') return false;
    return stepIndex >= totalSteps - 2;
  }, [showSectionHeader, currentUiSection, stepIndex, totalSteps]);

  /** Single-step flows: reassuring line without implying “almost” when there is only one screen. */
  const showWrapUpSingleStepTransition = useMemo(() => {
    if (totalSteps !== 1) return false;
    if (!showSectionHeader || currentUiSection !== 'wrapUp') return false;
    return true;
  }, [showSectionHeader, currentUiSection, totalSteps]);

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

  const toggleMultiField = useCallback((stepId: WorkerAiPrescreenStepId, value: string) => {
    setAnswers((prev) => {
      const prevArr =
        stepId === 'work_confidence'
          ? prev.work_confidence || []
          : Array.isArray((prev as Record<string, unknown>)[stepId])
            ? ((prev as Record<string, unknown>)[stepId] as string[])
            : [];
      const cur = new Set(prevArr);
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      const nextArr = Array.from(cur);
      if (stepId === 'work_confidence') return { ...prev, work_confidence: nextArr };
      return { ...prev, [stepId]: nextArr };
    });
  }, []);

  const getMultiFieldValues = useCallback((stepId: WorkerAiPrescreenStepId, a: WorkerAiPrescreenAnswers): string[] => {
    if (stepId === 'work_confidence') return a.work_confidence || [];
    const v = (a as Record<string, unknown>)[stepId];
    return Array.isArray(v) ? (v as string[]) : [];
  }, []);

  const canNext = useMemo(() => {
    if (!currentEntry) return false;
    return validatePrescreenNavEntry(
      currentEntry,
      answers,
      dynamicAnswers,
      experienceFollowupOptional,
      PRESCREEN_FAST_PATH_V2,
      dynamicStepValid,
      pressureFollowupOptional,
      supervisorFollowupOptional,
    );
  }, [currentEntry, answers, dynamicAnswers, experienceFollowupOptional, pressureFollowupOptional, supervisorFollowupOptional]);

  const goNext = () => {
    if (!canNext) return;
    if (currentEntry) {
      logPrescreenStepCompleted({
        stepId: navEntryStepId(currentEntry),
        entry: entryQuery,
        hasApplication: Boolean(applicationId),
      });
    }
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
      if (currentEntry) {
        logPrescreenStepCompleted({
          stepId: navEntryStepId(currentEntry),
          entry: entryQuery,
          hasApplication: Boolean(applicationId),
        });
      }
      const merged = mergeClientFollowUpsIntoAnswers(
        answers,
        experienceFollowupOptional,
        pressureFollowupOptional,
        supervisorFollowupOptional,
      );
      const expandedNarrativeShown = navEntries.some(
        (e) => e.kind === 'core' && (e.step.id === 'motivation' || e.step.id === 'pressure_situation'),
      );
      const padded = ensureFastPathNarrativePadding(merged, expandedNarrativeShown);
      const mergedDynamic = applyPrescreenDynamicDedupe(dynamicSteps, padded, dynamicAnswers).mergedDynamicAnswers;
      const result = await submitWorkerAiPrescreenInterview({
        answers: buildAnswersForSubmit(padded, dynamicSteps, mergedDynamic),
        applicationId: applicationId || null,
        tenantId,
        entry: entryQuery?.trim() || null,
        dynamicAnswers: (() => {
          const payloadDyn: Record<string, WorkerAiPrescreenDynamicAnswer> = {};
          for (const s of dynamicSteps) {
            const v = String(mergedDynamic[s.id] ?? '')
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_');
            if (v === 'yes' || v === 'no' || v === 'not_sure') {
              payloadDyn[s.id] = v;
            }
          }
          return Object.keys(payloadDyn).length > 0 ? payloadDyn : undefined;
        })(),
        sessionProfileEnhancements: buildPrescreenSessionProfileEnhancements(userDoc ?? undefined),
      });
      const started = interviewStartedAtMs.current ?? Date.now();
      logPrescreenCompleted({ totalSteps, durationMs: Math.max(0, Date.now() - started) });
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

  const durationHintText = (opts?: { loading?: boolean }) => {
    if (!workerAiPrescreenRequired) {
      if (totalSteps > 0) {
        return totalSteps < 12
          ? t('workerAiPrescreen.durationHintOptionalShort')
          : t('workerAiPrescreen.durationHintOptionalLong');
      }
      return t('workerAiPrescreen.durationHintOptional');
    }
    if (opts?.loading || totalSteps <= 0) {
      return t('workerAiPrescreen.durationHintEstimate');
    }
    return totalSteps < 12 ? t('workerAiPrescreen.durationHintShort') : t('workerAiPrescreen.durationHintLong');
  };

  /** SMS / group invite entry — reinforces why the worker opened this link. */
  const entryContextBanner = useMemo(() => {
    const e = entryQuery?.trim() || '';
    if (!e) return null;
    if (
      e === 'user_group_backfill' ||
      e === 'user_group_ready_interview_invite' ||
      e === 'user_group_profile_gap_interview_invite' ||
      e === 'user_group_invite'
    ) {
      return applicationId ? t('workerAiPrescreen.entryBanner.groupWithJob') : t('workerAiPrescreen.entryBanner.group');
    }
    if (e === 'sms_profile_first_interview' || e === 'profile_first_chase_1' || e === 'profile_first_chase_2') {
      return t('workerAiPrescreen.entryBanner.profileFirstSms');
    }
    if (e.startsWith('sms_')) {
      return applicationId ? t('workerAiPrescreen.entryBanner.smsWithJob') : t('workerAiPrescreen.entryBanner.sms');
    }
    return null;
  }, [entryQuery, applicationId, t]);

  /** Light nudge in the first third of steps (conversion — not shown on step 0). */
  const showFirstThirdEncouragement = useMemo(() => {
    if (totalSteps < 3 || stepIndex === 0) return false;
    const n = Math.max(1, Math.ceil(totalSteps / 3));
    return stepIndex < n;
  }, [totalSteps, stepIndex]);

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
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            {t('workerAiPrescreen.subtitleNoJob')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35, pt: 0.35 }}>
            {t('workerAiPrescreen.subtitleNoJobSecondary')}
          </Typography>
        </>
      )}
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
        {durationHintText(opts)}
      </Typography>
    </Stack>
  );

  if (!user) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
        <Typography variant="body1">{t('workerAiPrescreen.signInPrompt')}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => navigate('/login', { state: { from: location } })}>
            {t('common.signIn')}
          </Button>
          <Button variant="outlined" onClick={() => navigate('/c1/workers/dashboard')}>
            {t('workerAiPrescreen.backToDashboard')}
          </Button>
        </Stack>
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
              {applicationId ? t('workerAiPrescreen.successBody1') : t('workerAiPrescreen.successBodyNoJob1')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, lineHeight: 1.45 }}>
              {applicationId ? t('workerAiPrescreen.successBody2') : t('workerAiPrescreen.successBodyNoJob2')}
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
              onClick={() => navigate(applicationId ? '/c1/workers/dashboard' : '/c1/jobs-board')}
            >
              {applicationId ? t('workerAiPrescreen.backToDashboard') : t('workerAiPrescreen.browseJobsBoard')}
            </Button>
            {!applicationId ? (
              <Button fullWidth variant="outlined" sx={{ py: 1.1, fontWeight: 600 }} onClick={() => navigate('/c1/workers/dashboard')}>
                {t('workerAiPrescreen.backToDashboard')}
              </Button>
            ) : null}
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (planLoading && (applicationId || tenantId)) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
        {renderFramingHeader({ loading: true })}
        <LinearProgress sx={{ borderRadius: 1, mb: 1 }} />
        <Stack alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
          <CircularProgress size={36} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {applicationId ? t('workerAiPrescreen.loadingJobQuestions') : t('workerAiPrescreen.loadingProfileQuestions')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  const isLast = stepIndex === totalSteps - 1;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, pb: { xs: 3, sm: 4 }, maxWidth: 560, mx: 'auto' }}>
      {renderFramingHeader()}

      {entryContextBanner ? (
        <Alert
          severity="info"
          variant="outlined"
          sx={{
            mb: 1.25,
            py: 0.75,
            borderColor: 'info.light',
            bgcolor: (mui) => alpha(mui.palette.info.main, 0.06),
            '& .MuiAlert-message': { width: '100%' },
          }}
        >
          <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
            {entryContextBanner}
          </Typography>
        </Alert>
      ) : null}

      {applicationId && !tenantId ? (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.75 }}>
          {t('workerAiPrescreen.alertChooseTenant')}
        </Alert>
      ) : null}
      {!applicationId && !tenantId ? (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.75 }}>
          {t('workerAiPrescreen.alertChooseTenantProfileFirst')}
        </Alert>
      ) : null}

      <LinearProgress variant="determinate" value={progress} sx={{ mb: 0.75, borderRadius: 1, height: 6 }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: showFirstThirdEncouragement ? 0.5 : 1.25 }}>
        {t('workerAiPrescreen.progressOf', { current: stepIndex + 1, total: totalSteps })}
        {currentUiSection ? (
          <>
            {' '}
            · {t(`workerAiPrescreen.progressPhase.${currentUiSection}`)}
          </>
        ) : null}
      </Typography>
      {showFirstThirdEncouragement ? (
        <Typography
          variant="caption"
          color="primary"
          display="block"
          sx={{ mb: 1.25, fontWeight: 600, letterSpacing: 0.02 }}
        >
          {t(
            applicationId
              ? 'workerAiPrescreen.earlyEncouragement'
              : 'workerAiPrescreen.earlyEncouragementNoJob',
          )}
        </Typography>
      ) : null}

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
        {showSectionHeader && currentUiSection ? (
          <Typography
            variant="overline"
            color="primary"
            sx={{ fontWeight: 800, letterSpacing: 0.6, mb: 1, display: 'block', lineHeight: 1.3 }}
          >
            {t(`workerAiPrescreen.section.${currentUiSection}`)}
          </Typography>
        ) : null}
        {openingCompleteBanner ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
            {t(
              applicationId
                ? 'workerAiPrescreen.v2.transitionAfterOpening'
                : 'workerAiPrescreen.v2.transitionAfterOpeningNoJob',
            )}
          </Typography>
        ) : null}
        {showJobFitTransition ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
            {t('workerAiPrescreen.v2.transitionJobFit')}
          </Typography>
        ) : null}
        {progressiveDynamicLeadKey ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
            {t(progressiveDynamicLeadKey)}
          </Typography>
        ) : null}
        {showWrapUpAlmostDoneTransition ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
            {t('workerAiPrescreen.v2.transitionAlmostDone')}
          </Typography>
        ) : null}
        {showWrapUpSingleStepTransition ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
            {t('workerAiPrescreen.v2.transitionWrapUpSingleStep')}
          </Typography>
        ) : null}
        {microConfirmKey ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 1.25,
              px: 1.25,
              py: 1,
              borderRadius: 1,
              bgcolor: (mui) => alpha(mui.palette.success.main, 0.08),
              border: (mui) => `1px solid ${alpha(mui.palette.success.main, 0.25)}`,
            }}
          >
            {microConfirmKey === 'experienceDetails'
              ? t('workerAiPrescreen.microConfirm.experienceDetails')
              : t('workerAiPrescreen.microConfirm.workConfidence')}
          </Typography>
        ) : null}
        {clientFollowupKind ? (
          <Stack direction="row" alignItems="flex-start" gap={1} sx={{ mb: 0.75 }}>
            <Chip
              size="small"
              label={t('workerAiPrescreen.optionalFollowupChip')}
              variant="outlined"
              sx={{ mt: 0.15, flexShrink: 0, fontWeight: 600 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45, flex: 1 }}>
              {t('workerAiPrescreen.v2.followupTransitionLine')}
            </Typography>
          </Stack>
        ) : null}
        <Typography
          variant="subtitle1"
          fontWeight={600}
          sx={{ mb: 1, lineHeight: 1.35, whiteSpace: 'pre-line' }}
        >
          {clientFollowupKind
            ? clientFollowupKind === 'experience'
              ? t('workerAiPrescreen.v2.followupExperiencePrompt')
              : clientFollowupKind === 'pressure'
                ? t('workerAiPrescreen.v2.followupPressurePrompt')
                : t('workerAiPrescreen.v2.followupSupervisorPrompt')
            : isDynamicPhase
              ? localizedDynamicPrompt(dynamicStep, t)
              : coreStep?.prompt}
        </Typography>
        {!isDynamicPhase &&
        !clientFollowupKind &&
        coreStep?.type === 'multi_select' &&
        String(coreStep.id).startsWith('opening_') ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.4 }}>
            {t('workerAiPrescreen.openingMultiSelectHint')}
          </Typography>
        ) : null}

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

        {clientFollowupKind ? (
          <TextField
            fullWidth
            multiline
            minRows={2}
            value={
              clientFollowupKind === 'experience'
                ? experienceFollowupOptional
                : clientFollowupKind === 'pressure'
                  ? pressureFollowupOptional
                  : supervisorFollowupOptional
            }
            onChange={(e) => {
              const v = e.target.value;
              if (clientFollowupKind === 'experience') setExperienceFollowupOptional(v);
              else if (clientFollowupKind === 'pressure') setPressureFollowupOptional(v);
              else setSupervisorFollowupOptional(v);
            }}
            placeholder={
              clientFollowupKind === 'experience'
                ? t('workerAiPrescreen.v2.followupExperiencePlaceholder')
                : clientFollowupKind === 'pressure'
                  ? t('workerAiPrescreen.v2.followupPressurePlaceholder')
                  : t('workerAiPrescreen.v2.followupSupervisorPlaceholder')
            }
            sx={{ '& .MuiInputBase-root': { pt: 0.5 } }}
          />
        ) : null}

        {!clientFollowupKind && !isDynamicPhase && coreStep?.type === 'text' && (
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

        {!clientFollowupKind && !isDynamicPhase && coreStep?.type === 'single_select' && coreStep.options && (
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

        {!clientFollowupKind && !isDynamicPhase && coreStep?.type === 'multi_select' && coreStep.options && (
          <Stack spacing={0.75}>
            {coreStep.options.map((o) => (
              <FormControlLabel
                key={o.value}
                control={
                  <Checkbox
                    size="small"
                    checked={getMultiFieldValues(coreStep.id, answers).includes(o.value)}
                    onChange={() =>
                      coreStep.id === 'work_confidence'
                        ? toggleMulti(o.value)
                        : toggleMultiField(coreStep.id, o.value)
                    }
                  />
                }
                label={o.label}
              />
            ))}
            {getMultiFieldValues(coreStep.id, answers).length > 0 && (
              <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {getMultiFieldValues(coreStep.id, answers).map((v) => (
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
                <FormControlLabel
                  key={o.value}
                  value={o.value}
                  control={<Radio size="small" />}
                  label={localizedDynamicOptionLabel(o.value, o.label, t)}
                />
              ))}
            </RadioGroup>
          </FormControl>
        )}
      </Box>

      {user?.uid ? (
        <WorkerAiPrescreenStrengthenPanel
          userId={user.uid}
          tenantId={tenantId}
          userDoc={userDoc}
          answers={answers}
          isLastStep={isLast}
        />
      ) : null}

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
