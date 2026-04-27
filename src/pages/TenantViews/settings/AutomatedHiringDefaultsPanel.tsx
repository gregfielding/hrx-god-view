import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  DEFAULT_TENANT_AI_HIRING,
  DEFAULT_TENANT_AI_PRESCREEN,
  type TenantAiHiringConfig,
  type TenantAiPrescreenConfig,
  type TenantHiringQualityDefaults,
} from '../../../types/tenantAutomatedHiringDefaults';
import TenantAiPolicyEffectSummaryCard from '../../../components/settings/ai/TenantAiPolicyEffectSummaryCard';
import PolicyControlKindBadge from '../../../components/settings/ai/PolicyControlKindBadge';

function readBool(obj: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  if (!obj) return fallback;
  const v = obj[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Prefer `requireResumeOrSkill`; fall back to legacy `requireResumeOrWorkHistory` in Firestore. */
function readResumeOrSkillEligibility(
  elig: Record<string, unknown> | undefined,
  fallback: boolean,
): boolean {
  if (!elig) return fallback;
  if (typeof elig.requireResumeOrSkill === 'boolean') return elig.requireResumeOrSkill;
  if (typeof elig.requireResumeOrWorkHistory === 'boolean') return elig.requireResumeOrWorkHistory;
  return fallback;
}

function parseAiPrescreen(raw: unknown): TenantAiPrescreenConfig {
  const base = DEFAULT_TENANT_AI_PRESCREEN;
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: base.enabled,
      eligibility: { ...base.eligibility },
      questions: { ...base.questions },
    };
  }
  const o = raw as Record<string, unknown>;
  const elig = o.eligibility && typeof o.eligibility === 'object' ? (o.eligibility as Record<string, unknown>) : undefined;
  const q = o.questions && typeof o.questions === 'object' ? (o.questions as Record<string, unknown>) : undefined;
  return {
    enabled: readBool(o, 'enabled', base.enabled),
    eligibility: {
      requireResumeOrSkill: readResumeOrSkillEligibility(elig, base.eligibility.requireResumeOrSkill),
      requirePhone: readBool(elig, 'requirePhone', base.eligibility.requirePhone),
      requireLocation: readBool(elig, 'requireLocation', base.eligibility.requireLocation),
      requireWorkAuthorization: readBool(elig, 'requireWorkAuthorization', base.eligibility.requireWorkAuthorization),
    },
    questions: {
      askShiftConfirmation: readBool(q, 'askShiftConfirmation', base.questions.askShiftConfirmation),
      askLocationConfirmation: readBool(q, 'askLocationConfirmation', base.questions.askLocationConfirmation),
      askDrugScreenConfirmation: readBool(q, 'askDrugScreenConfirmation', base.questions.askDrugScreenConfirmation),
      askBackgroundConfirmation: readBool(q, 'askBackgroundConfirmation', base.questions.askBackgroundConfirmation),
      askCertificationConfirmation: readBool(q, 'askCertificationConfirmation', base.questions.askCertificationConfirmation),
      askUniformConfirmation: readBool(q, 'askUniformConfirmation', base.questions.askUniformConfirmation),
      allowGigFallbackQuestion: readBool(q, 'allowGigFallbackQuestion', base.questions.allowGigFallbackQuestion),
    },
  };
}

function parseNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

function parseAiHiring(raw: unknown): TenantAiHiringConfig {
  const base = DEFAULT_TENANT_AI_HIRING;
  if (!raw || typeof raw !== 'object') {
    return { ...base };
  }
  const o = raw as Record<string, unknown>;
  return {
    autoAdvanceEnabled: typeof o.autoAdvanceEnabled === 'boolean' ? o.autoAdvanceEnabled : base.autoAdvanceEnabled,
    minimumScoreToAdvance: parseNum(o.minimumScoreToAdvance),
    minimumJobScoreGateEnabled:
      typeof o.minimumJobScoreGateEnabled === 'boolean' ? o.minimumJobScoreGateEnabled : undefined,
    minimumJobScoreToAdvance: parseNum(o.minimumJobScoreToAdvance),
    jobFitFailAction:
      o.jobFitFailAction === 'hold' ? 'hold' : o.jobFitFailAction === 'review' ? 'review' : undefined,
    maximumAutoAdvances: parseNum(o.maximumAutoAdvances),
    targetOnboardingCount: parseNum(o.targetOnboardingCount),
    stopWhenTargetReached:
      typeof o.stopWhenTargetReached === 'boolean' ? o.stopWhenTargetReached : undefined,
    allowGigFallback: typeof o.allowGigFallback === 'boolean' ? o.allowGigFallback : undefined,
  };
}

/** Build Firestore-safe payloads (no undefined values). */
function toFirestorePrescreen(p: TenantAiPrescreenConfig): Record<string, unknown> {
  return {
    enabled: p.enabled,
    eligibility: { ...p.eligibility },
    questions: { ...p.questions },
  };
}

function toFirestoreHiring(h: TenantAiHiringConfig): Record<string, unknown> {
  const o: Record<string, unknown> = {
    autoAdvanceEnabled: h.autoAdvanceEnabled,
  };
  if (h.minimumScoreToAdvance !== undefined) o.minimumScoreToAdvance = h.minimumScoreToAdvance;
  if (h.minimumJobScoreGateEnabled !== undefined) o.minimumJobScoreGateEnabled = h.minimumJobScoreGateEnabled;
  if (h.minimumJobScoreToAdvance !== undefined) o.minimumJobScoreToAdvance = h.minimumJobScoreToAdvance;
  if (h.jobFitFailAction !== undefined) o.jobFitFailAction = h.jobFitFailAction;
  if (h.maximumAutoAdvances !== undefined) o.maximumAutoAdvances = h.maximumAutoAdvances;
  if (h.targetOnboardingCount !== undefined) o.targetOnboardingCount = h.targetOnboardingCount;
  if (h.stopWhenTargetReached !== undefined) o.stopWhenTargetReached = h.stopWhenTargetReached;
  if (h.allowGigFallback !== undefined) o.allowGigFallback = h.allowGigFallback;
  return o;
}

function parseTenantQuality(hc: Record<string, unknown> | undefined): TenantHiringQualityDefaults {
  const q = hc?.quality as Record<string, unknown> | undefined;
  const n = q?.maximumNoShowRiskToAdvance;
  return {
    maximumNoShowRiskToAdvance: typeof n === 'number' && Number.isFinite(n) ? n : undefined,
  };
}

type Props = {
  tenantId: string;
};

const AutomatedHiringDefaultsPanel: React.FC<Props> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prescreen, setPrescreen] = useState<TenantAiPrescreenConfig>(() => ({
    ...DEFAULT_TENANT_AI_PRESCREEN,
    eligibility: { ...DEFAULT_TENANT_AI_PRESCREEN.eligibility },
    questions: { ...DEFAULT_TENANT_AI_PRESCREEN.questions },
  }));
  const [hiring, setHiring] = useState<TenantAiHiringConfig>({ ...DEFAULT_TENANT_AI_HIRING });
  /** Tenant default for `hiringConfig.interview.workerAiPrescreenRequired` (merged with job order / group). */
  const [workerAiPrescreenRequired, setWorkerAiPrescreenRequired] = useState(true);
  const [tenantQuality, setTenantQuality] = useState<TenantHiringQualityDefaults>({});
  const [dirty, setDirty] = useState(false);
  const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    const ref = doc(db, 'tenants', tenantId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setPrescreen(parseAiPrescreen(data.aiPrescreen));
        setHiring(parseAiHiring(data.aiHiring));
        const hc = data.hiringConfig as Record<string, unknown> | undefined;
        const req =
          typeof (hc?.interview as Record<string, unknown> | undefined)?.workerAiPrescreenRequired === 'boolean'
            ? (hc!.interview as { workerAiPrescreenRequired: boolean }).workerAiPrescreenRequired
            : true;
        setWorkerAiPrescreenRequired(req);
        setTenantQuality(parseTenantQuality(hc));
        setDirty(false);
        setLoading(false);
      },
      (err) => {
        console.error('[AutomatedHiringDefaults]', err);
        setSnack({ message: err.message || 'Failed to load tenant settings', severity: 'error' });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId]);

  const handleSave = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const ref = doc(db, 'tenants', tenantId);
      const snap = await getDoc(ref);
      const prev = snap.exists() ? snap.data() : {};
      const prevHc = (prev.hiringConfig as Record<string, unknown> | undefined) || {};
      const prevQ = (prevHc.quality as Record<string, unknown> | undefined) || {};
      const nextQuality: Record<string, unknown> = {
        ...prevQ,
        ...(tenantQuality.maximumNoShowRiskToAdvance !== undefined && tenantQuality.maximumNoShowRiskToAdvance !== null
          ? { maximumNoShowRiskToAdvance: tenantQuality.maximumNoShowRiskToAdvance }
          : {}),
      };
      await updateDoc(ref, {
        aiPrescreen: toFirestorePrescreen(prescreen),
        aiHiring: toFirestoreHiring(hiring),
        hiringConfig: {
          ...prevHc,
          interview: {
            interviewType: 'worker_ai_prescreen',
            workerAiPrescreenRequired,
          },
          quality: nextQuality,
        },
      });
      setSnack({ message: 'Saved tenant automated hiring defaults.', severity: 'success' });
      setDirty(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSnack({ message: msg || 'Save failed', severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [tenantId, prescreen, hiring, workerAiPrescreenRequired, tenantQuality.maximumNoShowRiskToAdvance]);

  const numberField = (
    label: string,
    value: number | undefined,
    onChange: (n: number | undefined) => void,
    helper?: string,
  ) => (
    <TextField
      size="small"
      label={label}
      type="number"
      value={value === undefined ? '' : value}
      onChange={(e) => {
        const t = e.target.value.trim();
        if (t === '') {
          onChange(undefined);
          setDirty(true);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) {
          onChange(n);
          setDirty(true);
        }
      }}
      helperText={helper}
      fullWidth
      inputProps={{ step: 1 }}
    />
  );

  if (!tenantId) {
    return <Alert severity="warning">Select a tenant to edit automated hiring defaults.</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Stack spacing={2.25}>
      <TenantAiPolicyEffectSummaryCard
        workerAiPrescreenRequired={workerAiPrescreenRequired}
        prescreen={prescreen}
        hiring={hiring}
        tenantQuality={tenantQuality}
      />

      <Alert severity="info" sx={{ borderRadius: 1 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Overrides
        </Typography>
        <Typography variant="body2" component="div">
          Values here are <strong>tenant defaults</strong>. User groups and job orders can override hiring and
          prescreen settings for their candidates where the product supports it. More specific scopes win over these
          defaults.
        </Typography>
      </Alert>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Worker AI prescreen
          </Typography>
          <PolicyControlKindBadge kind="requirement" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Controls whether workers must complete the AI prescreen interview and which profile gates and question packs
          apply before and during prescreen.
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={workerAiPrescreenRequired}
              onChange={(_, v) => {
                setWorkerAiPrescreenRequired(v);
                setDirty(true);
              }}
            />
          }
          label="Require worker AI prescreen by default"
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4.5, mt: -0.5, mb: 1 }}>
          Requirement — when on, new applications expect a completed prescreen on the hire path unless a job or group
          turns this off.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Prescreen feature
          </Typography>
          <PolicyControlKindBadge kind="feature" />
        </Stack>
        <FormControlLabel
          control={
            <Switch
              checked={prescreen.enabled}
              onChange={(_, v) => {
                setPrescreen((p) => ({ ...p, enabled: v }));
                setDirty(true);
              }}
            />
          }
          label="Enable prescreen feature for this tenant"
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4.5, mt: -0.5, mb: 1 }}>
          Feature toggle — controls whether prescreen experiences tied to tenant defaults are active; combine with job
          and group settings for full behavior.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Profile gates (invite / prescreen eligibility)
          </Typography>
          <PolicyControlKindBadge kind="qualification" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Qualification rules — workers must meet these profile signals to be treated as eligible for prescreen
          invitation and lifecycle progression.
        </Typography>
        <Stack spacing={0.5}>
          {(
            [
              ['requireResumeOrSkill', 'Require resume or at least one skill'],
              ['requirePhone', 'Require phone'],
              ['requireLocation', 'Require location'],
              ['requireWorkAuthorization', 'Require work authorization'],
            ] as const
          ).map(([key, label]) => (
            <FormControlLabel
              key={key}
              control={
                <Switch
                  size="small"
                  checked={prescreen.eligibility[key]}
                  onChange={(_, v) => {
                    setPrescreen((p) => ({
                      ...p,
                      eligibility: { ...p.eligibility, [key]: v },
                    }));
                    setDirty(true);
                  }}
                />
              }
              label={label}
            />
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Prescreen question defaults
          </Typography>
          <PolicyControlKindBadge kind="requirement" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Requirement — which topics the AI may ask about during prescreen when the job uses tenant defaults.
        </Typography>
        <Stack spacing={0.5}>
          {(
            [
              ['askShiftConfirmation', 'Shift confirmation'],
              ['askLocationConfirmation', 'Location confirmation'],
              ['askDrugScreenConfirmation', 'Drug confirmation'],
              ['askBackgroundConfirmation', 'Background confirmation'],
              ['askCertificationConfirmation', 'Certification confirmation'],
              ['askUniformConfirmation', 'Uniform confirmation'],
              ['allowGigFallbackQuestion', 'Gig-path fallback question'],
            ] as const
          ).map(([key, label]) => (
            <FormControlLabel
              key={key}
              control={
                <Switch
                  size="small"
                  checked={prescreen.questions[key]}
                  onChange={(_, v) => {
                    setPrescreen((p) => ({
                      ...p,
                      questions: { ...p.questions, [key]: v },
                    }));
                    setDirty(true);
                  }}
                />
              }
              label={label}
            />
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Thresholds, automation, and capacity
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Interview and job-fit scores, no-show risk, auto-advance, and capacity limits. Together these decide who may
          move toward qualified, who needs review or waitlist, and when automation stops.
        </Typography>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={hiring.autoAdvanceEnabled}
                  onChange={(_, v) => {
                    setHiring((h) => ({ ...h, autoAdvanceEnabled: v }));
                    setDirty(true);
                  }}
                />
              }
              label="Auto-advance (tenant default)"
            />
            <PolicyControlKindBadge kind="automation" />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4.5, mt: -1 }}>
            Automation rule — when on, eligible candidates can advance automatically subject to the score and capacity
            rules below.
          </Typography>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 240 }}>
              {numberField(
                'Interview score threshold (0–100)',
                hiring.minimumScoreToAdvance,
                (n) => setHiring((h) => ({ ...h, minimumScoreToAdvance: n })),
                'Qualification rule — minimum AI interview score before a candidate is treated as qualified for automated advance.',
              )}
            </Box>
            <PolicyControlKindBadge kind="qualification" />
          </Stack>
          <Stack direction="row" alignItems="center" flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(hiring.minimumJobScoreGateEnabled)}
                  onChange={(_, v) => {
                    setHiring((h) => ({ ...h, minimumJobScoreGateEnabled: v }));
                    setDirty(true);
                  }}
                />
              }
              label="Require minimum job-fit score"
            />
            <PolicyControlKindBadge kind="qualification" />
          </Stack>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 240 }}>
              {numberField(
                'Job-fit threshold (0–100)',
                hiring.minimumJobScoreToAdvance,
                (n) => setHiring((h) => ({ ...h, minimumJobScoreToAdvance: n })),
                'Qualification rule — used together with the job-fit gate when a fit score exists on the application.',
              )}
            </Box>
          </Stack>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap" spacing={1}>
            <FormControl size="small" fullWidth sx={{ flex: 1, minWidth: 200 }}>
              <InputLabel id="tenant-jobfit-fail">Job-fit fail action</InputLabel>
              <Select
                labelId="tenant-jobfit-fail"
                label="Job-fit fail action"
                value={hiring.jobFitFailAction ?? 'review'}
                onChange={(e) => {
                  setHiring((h) => ({
                    ...h,
                    jobFitFailAction: e.target.value as 'review' | 'hold',
                  }));
                  setDirty(true);
                }}
              >
                <MenuItem value="review">Review</MenuItem>
                <MenuItem value="hold">Hold</MenuItem>
              </Select>
              <FormHelperText>
                Automation rule — when job-fit fails the gate, send candidates to recruiter review or hold for a manual
                decision.
              </FormHelperText>
            </FormControl>
            <Box sx={{ pt: 0.5 }}>
              <PolicyControlKindBadge kind="automation" />
            </Box>
          </Stack>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 240 }}>
              {numberField(
                'Max no-show risk to auto-advance (0–100)',
                tenantQuality.maximumNoShowRiskToAdvance,
                (n) => {
                  setTenantQuality((q) => ({ ...q, maximumNoShowRiskToAdvance: n }));
                  setDirty(true);
                },
                'Qualification rule — optional ceiling on predicted no-show risk before automation may advance.',
              )}
            </Box>
            <PolicyControlKindBadge kind="qualification" />
          </Stack>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 240 }}>
              {numberField(
                'Max auto-advances',
                hiring.maximumAutoAdvances,
                (n) => setHiring((h) => ({ ...h, maximumAutoAdvances: n })),
                'Capacity rule — cap on how many candidates automation may advance in this context.',
              )}
            </Box>
            <PolicyControlKindBadge kind="capacity" />
          </Stack>
          <Stack direction="row" alignItems="flex-start" flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 240 }}>
              {numberField(
                'Target onboarding count',
                hiring.targetOnboardingCount,
                (n) => setHiring((h) => ({ ...h, targetOnboardingCount: n })),
                'Capacity rule — target number of workers in onboarding; used with stop-when-target and queue behavior.',
              )}
            </Box>
            <PolicyControlKindBadge kind="capacity" />
          </Stack>
          <Stack direction="row" alignItems="center" flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(hiring.stopWhenTargetReached)}
                  onChange={(_, v) => {
                    setHiring((h) => ({ ...h, stopWhenTargetReached: v }));
                    setDirty(true);
                  }}
                />
              }
              label="Stop automation when onboarding target is reached"
            />
            <PolicyControlKindBadge kind="capacity" />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4.5, mt: -0.5, mb: 0.5 }}>
            Capacity rule — when on, further auto-advances pause when the onboarding target is met, often leaving new
            candidates in waitlist or review.
          </Typography>
          <Stack direction="row" alignItems="center" flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(hiring.allowGigFallback)}
                  onChange={(_, v) => {
                    setHiring((h) => ({ ...h, allowGigFallback: v }));
                    setDirty(true);
                  }}
                />
              }
              label="Allow gig-path fallback"
            />
            <PolicyControlKindBadge kind="automation" />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4.5, mt: -0.5 }}>
            Automation rule — allows gig-specific fallback behavior when job type and routing support it.
          </Typography>
        </Stack>
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button variant="contained" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save defaults'}
        </Button>
        {!dirty && (
          <Typography variant="caption" color="text.secondary">
            No unsaved changes
          </Typography>
        )}
      </Box>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Stack>
  );
};

export default AutomatedHiringDefaultsPanel;
