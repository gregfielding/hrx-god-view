import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

type Tier2Intensity = 'none' | 'selective' | 'moderate' | 'aggressive';

const INTENSITY_OPTIONS: ReadonlyArray<{ value: Tier2Intensity; label: string; detail: string }> = [
  { value: 'none', label: 'Tier 1 only', detail: 'No Tier 2 applicants are hired' },
  { value: 'selective', label: 'Selectively', detail: 'Top 25% of Tier 2 applicants' },
  { value: 'moderate', label: 'Moderately', detail: 'Top 60% of Tier 2 applicants' },
  { value: 'aggressive', label: 'Aggressively', detail: 'Every Tier 2 applicant' },
];

type PlanRunStats = {
  skipReason?: string;
  applicants?: number;
  tier1?: number;
  tier2?: number;
  tier3?: number;
  promoted?: number;
  maxHires?: number;
  projectedPool?: number;
  onboardsStarted?: number;
  screeningsOrdered?: number;
  deferred?: number;
};

type AttentionRow = { userId: string; name: string; status: string; error: string; attempts: number };

type FormState = {
  enabled: boolean;
  workersNeeded: string;
  backupWorkers: string;
  poolMultiplier: string;
  tier2Intensity: Tier2Intensity;
};

type Props = {
  tenantId: string;
  jobOrderId: string;
  jobOrderRaw: Record<string, unknown> | null;
  onSaved?: () => void;
};

const toCount = (v: string): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function formFromJobOrder(raw: Record<string, unknown> | null): FormState {
  const plan = (raw?.hiringPlan ?? {}) as Record<string, unknown>;
  const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const intensity = String(plan.tier2Intensity ?? '');
  return {
    enabled: plan.enabled === true,
    workersNeeded: num(plan.workersNeeded) || num(raw?.workersNeeded),
    backupWorkers: num(plan.backupWorkers) || '0',
    poolMultiplier: num(plan.poolMultiplier) || '1',
    tier2Intensity: INTENSITY_OPTIONS.some((o) => o.value === intensity)
      ? (intensity as Tier2Intensity)
      : 'moderate',
  };
}

const formatWhen = (ts: unknown): string | null => {
  const t = ts as { toDate?: () => Date } | null;
  return t && typeof t.toDate === 'function' ? t.toDate().toLocaleString() : null;
};

const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/**
 * Job Order → Hiring: the hiring plan. Recruiters set the client's headcount,
 * backups, pool depth and Tier 2 intensity; `job_order_hiring_plan_sweep`
 * hires from the applicants hourly and reports back through
 * `hiring_plan/state` and `hiring_plan_hires`.
 */
const JobOrderHiringPlanCard: React.FC<Props> = ({ tenantId, jobOrderId, jobOrderRaw, onSaved }) => {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(() => formFromJobOrder(jobOrderRaw));
  const [savedForm, setSavedForm] = useState<FormState>(() => formFromJobOrder(jobOrderRaw));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [promotionMode, setPromotionMode] = useState<string | null>(null);
  const [runState, setRunState] = useState<{ lastRunAt: unknown; stats: PlanRunStats } | null>(null);
  const [attention, setAttention] = useState<AttentionRow[]>([]);

  useEffect(() => {
    const next = formFromJobOrder(jobOrderRaw);
    setForm(next);
    setSavedForm(next);
  }, [jobOrderRaw]);

  const hiringEntityId = typeof jobOrderRaw?.hiringEntityId === 'string' ? jobOrderRaw.hiringEntityId.trim() : '';
  const packageName =
    typeof jobOrderRaw?.screeningPackageName === 'string' && jobOrderRaw.screeningPackageName.trim()
      ? jobOrderRaw.screeningPackageName.trim()
      : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [entitySnap, tierSnap, stateSnap, attentionSnap] = await Promise.all([
        hiringEntityId ? safe(getDoc(doc(db, 'tenants', tenantId, 'entities', hiringEntityId))) : Promise.resolve(null),
        safe(getDoc(doc(db, 'tenants', tenantId, 'settings', 'tierAutomation'))),
        safe(getDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'hiring_plan', 'state'))),
        safe(
          getDocs(
            query(
              collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'hiring_plan_hires'),
              where('status', 'in', ['failed', 'screening_paused']),
            ),
          ),
        ),
      ]);
      if (cancelled) return;
      if (entitySnap?.exists()) {
        const e = entitySnap.data() as Record<string, unknown>;
        setEntityName(String(e.name || e.legalName || hiringEntityId));
      }
      if (tierSnap?.exists()) {
        const t = tierSnap.data() as Record<string, unknown>;
        setThreshold(typeof t.threshold === 'number' ? t.threshold : null);
        setPromotionMode(typeof t.mode === 'string' ? t.mode : null);
      }
      if (stateSnap?.exists()) {
        const s = stateSnap.data() as Record<string, unknown>;
        setRunState({ lastRunAt: s.lastRunAt, stats: (s.stats ?? {}) as PlanRunStats });
      }
      if (attentionSnap) {
        setAttention(
          attentionSnap.docs.map((d) => {
            const r = d.data() as Record<string, unknown>;
            return {
              userId: d.id,
              name: String(r.name || d.id),
              status: String(r.status || ''),
              error: String(r.error || ''),
              attempts: Number(r.attempts) || 0,
            };
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrderId, hiringEntityId]);

  const workersNeeded = toCount(form.workersNeeded);
  const backupWorkers = toCount(form.backupWorkers);
  const multiplier = Number(form.poolMultiplier);
  const multiplierValid = Number.isFinite(multiplier) && multiplier >= 1 && multiplier <= 10;
  const poolTarget = workersNeeded + backupWorkers;
  const maxHires = multiplierValid ? Math.ceil(poolTarget * multiplier - 1e-9) : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const needsHeadcount = form.enabled && poolTarget === 0;
  const canSave = dirty && !saving && multiplierValid && !needsHeadcount;
  const selectedIntensity = INTENSITY_OPTIONS.find((o) => o.value === form.tier2Intensity);
  const stats = runState?.stats;
  const lastRun = formatWhen(runState?.lastRunAt);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setJustSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId), {
        'hiringPlan.enabled': form.enabled,
        'hiringPlan.workersNeeded': workersNeeded,
        'hiringPlan.backupWorkers': backupWorkers,
        'hiringPlan.poolMultiplier': multiplier,
        'hiringPlan.tier2Intensity': form.tier2Intensity,
        'hiringPlan.updatedAt': serverTimestamp(),
        'hiringPlan.updatedBy': user?.uid ?? null,
      });
      const normalized: FormState = {
        ...form,
        workersNeeded: String(workersNeeded),
        backupWorkers: String(backupWorkers),
        poolMultiplier: String(multiplier),
      };
      setForm(normalized);
      setSavedForm(normalized);
      setJustSaved(true);
      onSaved?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The hiring plan could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Hiring plan
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Builds an onboarded, screened pool from this job&apos;s applicants. Checks every hour.
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={form.enabled}
                disabled={saving}
                onChange={(e) => setField('enabled', e.target.checked)}
                inputProps={{ 'aria-label': 'Run hiring plan' }}
              />
            }
            label={form.enabled ? 'On' : 'Off'}
            labelPlacement="start"
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="Workers needed"
            type="number"
            size="small"
            value={form.workersNeeded}
            onChange={(e) => setField('workersNeeded', e.target.value)}
            inputProps={{ min: 0 }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Backup workers"
            type="number"
            size="small"
            value={form.backupWorkers}
            onChange={(e) => setField('backupWorkers', e.target.value)}
            inputProps={{ min: 0 }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Pool multiplier"
            type="number"
            size="small"
            value={form.poolMultiplier}
            onChange={(e) => setField('poolMultiplier', e.target.value)}
            inputProps={{ min: 1, max: 10, step: 0.5 }}
            InputProps={{ endAdornment: <InputAdornment position="end">×</InputAdornment> }}
            error={!multiplierValid}
            helperText={multiplierValid ? undefined : 'Between 1 and 10'}
            sx={{ flex: 1 }}
          />
        </Stack>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          Pool target <strong>{poolTarget}</strong> ({workersNeeded} needed + {backupWorkers} backups) · hire up to{' '}
          <strong>{maxHires ?? '—'}</strong> applicants
        </Typography>

        <TextField
          select
          label="Tier 2 hiring"
          size="small"
          value={form.tier2Intensity}
          onChange={(e) => setField('tier2Intensity', e.target.value as Tier2Intensity)}
          helperText={selectedIntensity?.detail}
          sx={{ mt: 2, minWidth: 260 }}
        >
          {INTENSITY_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>

        <Box
          component="ul"
          sx={{ pl: 2.5, mt: 2, mb: 0, color: 'text.secondary', typography: 'body2', '& li': { mb: 0.5 } }}
        >
          <li>Tier 1 applicants are always hired and screened. They count toward the max.</li>
          <li>
            Tier 2 applicants fill the remaining spots. Applicants already hired count first, then the highest tier
            scores.
          </li>
          <li>
            Tier 3 applicants aren&apos;t hired.{' '}
            {promotionMode === 'automatic'
              ? `They move to Tier 2 automatically once their scorecard reaches ${threshold ?? 70}.`
              : 'Their promotions to Tier 2 wait for approval in tier settings.'}
          </li>
          <li>
            Hiring means on-call onboarding with {entityName ?? 'the job order’s hiring entity'}
            {packageName ? ` and the ${packageName} screening` : ' and its screening package'}. No shifts are assigned.
          </li>
        </Box>

        {needsHeadcount ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            Enter how many workers the job needs before turning the plan on.
          </Alert>
        ) : null}
        {saveError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {saveError}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save plan'}
          </Button>
          {justSaved && !dirty ? (
            <Typography variant="caption" color="text.secondary">
              Saved. The next hourly check uses it.
            </Typography>
          ) : null}
        </Stack>

        {runState ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2">Last check{lastRun ? ` · ${lastRun}` : ''}</Typography>
            {stats?.skipReason ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Nothing was hired because {stats.skipReason}.
              </Alert>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip size="small" label={`${stats?.applicants ?? 0} applicants`} />
                <Chip
                  size="small"
                  label={`Tier 1: ${stats?.tier1 ?? 0} · Tier 2: ${stats?.tier2 ?? 0} · Tier 3: ${stats?.tier3 ?? 0}`}
                />
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`In pool: ${stats?.projectedPool ?? 0} of ${stats?.maxHires ?? 0}`}
                />
                {stats?.promoted ? <Chip size="small" label={`Promoted to Tier 2: ${stats.promoted}`} /> : null}
                {stats?.onboardsStarted ? (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={`Onboarding started: ${stats.onboardsStarted}`}
                  />
                ) : null}
                {stats?.screeningsOrdered ? (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={`Screenings ordered: ${stats.screeningsOrdered}`}
                  />
                ) : null}
                {stats?.deferred ? <Chip size="small" label={`Waiting for next check: ${stats.deferred}`} /> : null}
              </Stack>
            )}
            {attention.length > 0 ? (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  Couldn&apos;t hire ({attention.length})
                </Typography>
                {attention.slice(0, 10).map((r) => (
                  <Typography key={r.userId} variant="body2" color="text.secondary">
                    {r.name} —{' '}
                    {r.status === 'screening_paused'
                      ? 'screening paused'
                      : r.attempts >= 3
                        ? 'failed 3 times, needs a recruiter'
                        : 'failed, retrying in a few hours'}
                    {r.error ? `: ${r.error}` : ''}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </>
        ) : savedForm.enabled ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Waiting for the first hourly check.
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default JobOrderHiringPlanCard;
