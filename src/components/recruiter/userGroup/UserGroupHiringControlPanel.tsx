import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  Divider,
} from '@mui/material';
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../contexts/AuthContext';
import { db, functions } from '../../../firebase';
import { AccusourcePackageSelector } from '../AccusourcePackageSelector';
import { useAccusourceCatalog } from '../../../hooks/useAccusourceCatalog';
import { canAccusourceAdminFromUserDoc } from '../../../pages/UserProfile/components/backgroundsComplianceModel';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import { useUserGroupHiringPipeline } from '../../../hooks/useUserGroupHiringPipeline';
import {
  DEFAULT_USER_GROUP_HIRING_CONFIG,
  GROUP_HIRING_QUALITY_PRESETS,
  detectGroupHiringQualityPreset,
  parseUserGroupHiringConfig,
  toFirestoreUserGroupHiringConfig,
  validateUserGroupHiringConfig,
  type GroupHiringQualityPreset,
  type UserGroupHiringConfigV1,
} from '../../../types/userGroupHiringConfig';
import {
  buildEffectiveUserGroupHiringConfig,
  getEffectiveHiringThresholdSummaryLines,
  getTenantHiringPolicySummaryLines,
} from '../../../utils/mergeTenantAndGroupHiringConfig';
import {
  formatUserGroupHirePassedSuccess,
  runUserGroupHirePassedExecute,
  runUserGroupHirePassedPreview,
  type UserGroupHirePassedExecuteResult,
} from '../../../utils/userGroupHirePassedOneClick';
import UserGroupCandidatesPolicyImpactSection from './UserGroupCandidatesPolicyImpactSection';
import UserGroupHiringDecisionFlowPreview from './UserGroupHiringDecisionFlowPreview';
import UserGroupHiringPipelineStatus from './UserGroupHiringPipelineStatus';
import UserGroupHiringQueuePreview from './UserGroupHiringQueuePreview';
import UserGroupHiringSummaryCard from './UserGroupHiringSummaryCard';
import { TriggerGroupInterviewDialog } from './TriggerGroupInterviewDialog';
import type { Option } from '../../../fields/FieldTypes';
import { getOptionsForField } from '../../../utils/fieldOptions';

export type UserGroupMemberProfilePreview = {
  userId: string;
  aiProfileScore?: number;
  aiJobFitScore?: number;
};

export type UserGroupHiringControlPanelProps = {
  tenantId: string;
  groupId: string;
  memberCount: number;
  /** Optional member profile scores (legacy); “Preview hiring outcomes” uses the hire-passed callable when you run it. */
  memberProfiles?: UserGroupMemberProfilePreview[];
  onSaved?: () => void;
};

/**
 * Display name (from `tenants/{tenantId}/entities` → `name` / `label`) that requires E-Verify.
 * Compared to the **selected** Hiring entity dropdown option’s label — same source as the menu.
 */
const EVERIFY_REQUIRED_ENTITY_NAME = 'C1 Select LLC';

/**
 * Display name for the gig-style entity used for catchall / on-call event work. When the user picks
 * this from the Hiring entity dropdown, sections B / C / D snap to "open the gates" defaults so the
 * group behaves as a low-friction invite list — see {@link applyC1EventsCatchallDefaultsForCfg}.
 *
 * Defaults are applied **only at the moment of selection** (matching the E-Verify auto-flip
 * pattern); users can still override any field afterwards.
 */
const C1_EVENTS_CATCHALL_ENTITY_NAME = 'C1 Events LLC';

const syncAccusourcePackageCatalog = httpsCallable(functions, 'syncAccusourcePackageCatalog');

function parseOptionalInt(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function SectionCard(props: {
  title: string;
  subtitle?: string;
  /** e.g. “This group only” chip for employment/requirements */
  titleBadge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, subtitle, titleBadge, children } = props;
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent sx={{ py: 1.25, px: 1.5, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} flexWrap="wrap" sx={{ mb: 0.25 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            {title}
          </Typography>
          {titleBadge}
        </Stack>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, lineHeight: 1.35 }}>
            {subtitle}
          </Typography>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

function InheritedBadge() {
  return (
    <Chip
      label="Inherited from tenant"
      size="small"
      color="primary"
      variant="outlined"
      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700 }}
    />
  );
}

function GroupOnlyBadge() {
  return (
    <Chip
      label="This group"
      size="small"
      color="secondary"
      variant="outlined"
      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700 }}
    />
  );
}

function noShowRiskChipColor(value: number): 'success' | 'warning' | 'error' {
  if (value <= 30) return 'success';
  if (value <= 60) return 'warning';
  return 'error';
}

const UserGroupHiringControlPanel: React.FC<UserGroupHiringControlPanelProps> = ({
  tenantId,
  groupId,
  memberCount,
  memberProfiles = [],
  onSaved,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cfg, setCfg] = useState<UserGroupHiringConfigV1>(DEFAULT_USER_GROUP_HIRING_CONFIG);
  const [tenantData, setTenantData] = useState<Record<string, unknown> | undefined>();
  const [hirePassedPreviewLoading, setHirePassedPreviewLoading] = useState(false);
  const [hirePassedPreviewError, setHirePassedPreviewError] = useState<string | null>(null);
  const [hirePassedPreviewResult, setHirePassedPreviewResult] = useState<UserGroupHirePassedExecuteResult | null>(
    null,
  );

  // Backfill ("Apply hiring rules to existing members") modal — runs the
  // `userGroupHirePassedCandidates` callable in `preview` mode on open, then
  // `execute` on confirm. The callable scans both `applications.groupId === gid`
  // and applications for any uid in `memberIds`, re-evaluates eligibility against
  // the group's current saved hiring rules + tenant baseline, and calls
  // `runStartOnCallEmploymentFlow` for each eligible distinct user. Idempotent:
  // already-onboarded users are skipped server-side.
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillPreview, setBackfillPreview] =
    useState<UserGroupHirePassedExecuteResult | null>(null);
  const [backfillResult, setBackfillResult] =
    useState<UserGroupHirePassedExecuteResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  // "Send AI prescreen invites" — delegates to the existing
  // `triggerUserGroupInterviewInvites` callable via `TriggerGroupInterviewDialog`.
  // We surface it in two places: as a sibling button next to the backfill
  // ("send invites for everyone in this group who hasn't done their interview"),
  // and contextually inside the backfill preview when the breakdown reveals
  // that prescreen-not-completed is the dominant blocker (most groups will
  // hit this path more often than the other excluded categories).
  const [interviewInvitesOpen, setInterviewInvitesOpen] = useState(false);
  const prescreenBlockedCount = useMemo(() => {
    const breakdown = backfillPreview?.exclusionBreakdown ?? backfillResult?.exclusionBreakdown ?? [];
    const row = breakdown.find((b) => b.category === 'prescreen_not_completed');
    return row?.count ?? 0;
  }, [backfillPreview, backfillResult]);
  const [entityOptions, setEntityOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const { user } = useAuth();
  const [viewerUserDoc, setViewerUserDoc] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogSyncMessage, setCatalogSyncMessage] = useState<string | null>(null);
  const { catalog: accusourceCatalog, loading: catalogLoading, refetch: refetchAccusourceCatalog } =
    useAccusourceCatalog();

  const useTenantMode = cfg.useTenantDefaults === true;
  const effectiveCfg = useMemo(
    () => buildEffectiveUserGroupHiringConfig(tenantData, cfg),
    [tenantData, cfg],
  );
  const tenantPolicyLines = useMemo(() => {
    const raw = getTenantHiringPolicySummaryLines(tenantData);
    return raw.filter((l) => !l.startsWith('Worker AI prescreen:'));
  }, [tenantData]);
  const thresholdSummaryLines = useMemo(
    () => getEffectiveHiringThresholdSummaryLines(effectiveCfg),
    [effectiveCfg],
  );

  const canAccusourceAdmin = useMemo(() => {
    if (viewerUserDoc === undefined) return false;
    return canAccusourceAdminFromUserDoc(viewerUserDoc, tenantId);
  }, [viewerUserDoc, tenantId]);

  const handleRefreshAccusourceCatalog = useCallback(async () => {
    if (!canAccusourceAdmin) return;
    setCatalogSyncing(true);
    setCatalogSyncMessage(null);
    try {
      await syncAccusourcePackageCatalog({ tenantId: tenantId || undefined });
      const read = await refetchAccusourceCatalog();
      if (read.ok === false) {
        setCatalogSyncMessage(`Synced on the server but could not re-read catalog: ${read.error}`);
      }
    } catch (e: unknown) {
      setCatalogSyncMessage(formatFirebaseHttpsError(e));
    } finally {
      setCatalogSyncing(false);
    }
  }, [canAccusourceAdmin, refetchAccusourceCatalog, tenantId]);

  const {
    loading: pipelineLoading,
    error: pipelineError,
    metrics,
    metricsBeta,
    queuedPreview,
    policyImpactRows,
    rawApplicationDocCount,
    memberCentricOnCall,
  } = useUserGroupHiringPipeline(tenantId, groupId, effectiveCfg);

  const runHirePassedPreview = useCallback(async () => {
    setHirePassedPreviewLoading(true);
    setHirePassedPreviewError(null);
    try {
      const r = await runUserGroupHirePassedPreview({ tenantId, groupId });
      setHirePassedPreviewResult(r);
    } catch (e) {
      setHirePassedPreviewResult(null);
      setHirePassedPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setHirePassedPreviewLoading(false);
    }
  }, [tenantId, groupId]);

  const openBackfillDialog = useCallback(async () => {
    setBackfillOpen(true);
    setBackfillError(null);
    setBackfillResult(null);
    setBackfillPreview(null);
    setBackfillBusy(true);
    try {
      const r = await runUserGroupHirePassedPreview({ tenantId, groupId });
      setBackfillPreview(r);
    } catch (e) {
      setBackfillError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfillBusy(false);
    }
  }, [tenantId, groupId]);

  const runBackfillExecute = useCallback(async () => {
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const r = await runUserGroupHirePassedExecute({ tenantId, groupId });
      setBackfillResult(r);
    } catch (e) {
      setBackfillError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfillBusy(false);
    }
  }, [tenantId, groupId]);

  const closeBackfillDialog = useCallback(() => {
    if (backfillBusy) return;
    setBackfillOpen(false);
  }, [backfillBusy]);

  useEffect(() => {
    if (!tenantId || !groupId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, 'tenants', tenantId, 'userGroups', groupId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        if (!cancelled) {
          setCfg(parseUserGroupHiringConfig(data.hiringConfig));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load hiring config');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, groupId]);

  useEffect(() => {
    const vid = user?.uid;
    if (!vid || !tenantId) {
      if (!vid) setViewerUserDoc(undefined);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', vid))
      .then((s) => {
        if (cancelled) return;
        setViewerUserDoc(s.exists() ? (s.data() as Record<string, unknown>) : null);
      })
      .catch(() => {
        if (!cancelled) setViewerUserDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (cancelled) return;
        setTenantData(snap.exists() ? (snap.data() as Record<string, unknown>) : {});
      } catch {
        if (!cancelled) setTenantData(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      setEntitiesLoading(true);
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'entities'));
        if (cancelled) return;
        const list = snap.docs
          .map((d) => {
            const data = d.data() as { name?: string; label?: string; isActive?: boolean };
            if (data.isActive === false) return null;
            return { id: d.id, name: String(data.name ?? data.label ?? d.id) };
          })
          .filter((x): x is { id: string; name: string } => x != null)
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntityOptions(list);
      } catch {
        if (!cancelled) setEntityOptions([]);
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const setInterview = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['interview']>>) => {
    setCfg((p) => ({ ...p, interview: { ...p.interview, ...patch } }));
  }, []);
  const setAutomation = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['automation']>>) => {
    setCfg((p) => ({ ...p, automation: { ...p.automation, ...patch } }));
  }, []);
  const setEmployment = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['employment']>>) => {
    setCfg((p) => ({ ...p, employment: { ...p.employment, ...patch } }));
  }, []);
  const setRequirements = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['requirements']>>) => {
    setCfg((p) => ({ ...p, requirements: { ...p.requirements, ...patch } }));
  }, []);
  const setQuality = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['quality']>>) => {
    setCfg((p) => ({ ...p, quality: { ...p.quality, ...patch } }));
  }, []);
  const setTargets = useCallback((patch: Partial<NonNullable<UserGroupHiringConfigV1['targets']>>) => {
    setCfg((p) => ({ ...p, targets: { ...p.targets, ...patch } }));
  }, []);

  const applyPreset = useCallback(
    (preset: GroupHiringQualityPreset) => {
      if (preset === 'custom') {
        // Keep current threshold values; just relabel the dropdown.
        setQuality({ preset });
        return;
      }
      const b = GROUP_HIRING_QUALITY_PRESETS[preset];
      setQuality({
        preset,
        interviewMinimumScoreToAdvance: b.interviewMinimumScoreToAdvance,
        jobFitMinimumScoreToAdvance: b.jobFitMinimumScoreToAdvance,
      });
    },
    [setQuality],
  );

  const handleSave = async () => {
    if (!tenantId || !groupId) return;
    const validation = validateUserGroupHiringConfig(effectiveCfg);
    if (validation.ok === false) {
      setError(validation.errors.join(' '));
      setDone(null);
      return;
    }
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const ref = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(ref, {
        hiringConfig: toFirestoreUserGroupHiringConfig(cfg),
        updatedAt: serverTimestamp(),
      });
      setDone('Hiring configuration saved.');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const iv = effectiveCfg.interview ?? {};
  const auto = cfg.automation ?? {};
  const autoEff = effectiveCfg.automation ?? {};
  const emp = cfg.employment ?? {};
  const req = cfg.requirements ?? {};
  const qual = effectiveCfg.quality ?? {};
  const tgt = effectiveCfg.targets ?? {};
  const qualForm = cfg.quality ?? {};
  const tgtForm = cfg.targets ?? {};

  /** Same rows as the Hiring entity `<Select>` (tenant `entities` + optional orphan id). */
  const entitySelectOptions = useMemo(() => {
    const hid = String(emp.hiringEntityId ?? '').trim();
    if (!hid || entityOptions.some((e) => e.id === hid)) return entityOptions;
    return [...entityOptions, { id: hid, name: `${hid} (saved — review in Entities)` }];
  }, [entityOptions, emp.hiringEntityId]);

  /** Selected option in that dropdown — E-Verify follows this row’s `name`. */
  const selectedHiringEntityOption = useMemo(() => {
    const hid = String(emp.hiringEntityId ?? '').trim();
    if (!hid) return null;
    return entitySelectOptions.find((o) => o.id === hid) ?? null;
  }, [emp.hiringEntityId, entitySelectOptions]);

  const derivedEverifyRequired = useMemo(() => {
    const label = selectedHiringEntityOption?.name?.trim() ?? '';
    if (!label) return false;
    return label.toLowerCase() === EVERIFY_REQUIRED_ENTITY_NAME.toLowerCase();
  }, [selectedHiringEntityOption]);

  useEffect(() => {
    if (derivedEverifyRequired === !!emp.eVerifyRequired) return;
    setEmployment({ eVerifyRequired: derivedEverifyRequired });
  }, [derivedEverifyRequired, emp.eVerifyRequired, setEmployment]);

  // On-call employment is always on for this group type — never expose the toggle.
  useEffect(() => {
    if (emp.employmentType !== 'on_call') {
      setEmployment({ employmentType: 'on_call' });
    }
  }, [emp.employmentType, setEmployment]);

  const certificationFieldOptions = useMemo(() => getOptionsForField('licensesCerts', undefined), []);

  const selectedCertificationOptions = useMemo((): Option[] => {
    const ids = req.requiredCertificationIds ?? [];
    const byValue = new Map(certificationFieldOptions.map((o) => [o.value, o]));
    return ids.map((id) => {
      const found = byValue.get(id);
      if (found) return found;
      return { value: id, label: id };
    });
  }, [certificationFieldOptions, req.requiredCertificationIds]);

  const targetN = tgt.targetOnboardingCount;
  const showQueuePreview =
    typeof targetN === 'number' &&
    Number.isFinite(targetN) &&
    targetN >= 1 &&
    autoEff.queueAfterTargetReached === true;

  const maxNs = qualForm.maximumNoShowRiskToAdvance;

  const failSafeWarnings = useMemo(() => {
    const w: string[] = [];
    if (
      autoEff.autoAdvanceEnabled === true &&
      auto.autoOnboardEnabled === true &&
      (targetN === undefined || targetN === null || !Number.isFinite(targetN))
    ) {
      w.push('You have unlimited auto-hiring enabled with no onboarding cap.');
    }
    const preset = qual.preset ?? 'balanced';
    const fb =
      preset === 'custom'
        ? GROUP_HIRING_QUALITY_PRESETS.balanced
        : GROUP_HIRING_QUALITY_PRESETS[preset];
    const interviewMin = qual.interviewMinimumScoreToAdvance ?? fb.interviewMinimumScoreToAdvance;
    if (
      preset !== 'hire_everyone' &&
      qual.minimumJobScoreGateEnabled !== true &&
      interviewMin > 0 &&
      interviewMin < 60
    ) {
      w.push('Quality floor is below D (60). Almost everyone with a usable signal will advance.');
    }
    return w;
  }, [
    autoEff.autoAdvanceEnabled,
    auto.autoOnboardEnabled,
    targetN,
    qual.minimumJobScoreGateEnabled,
    qual.interviewMinimumScoreToAdvance,
    qual.preset,
  ]);

  const groupSpecificSummaryLines = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Hiring active: ${auto.hiringActive === true ? 'Yes' : 'No'}`);
    lines.push(`Auto-onboarding: ${auto.autoOnboardEnabled === true ? 'Yes' : 'No'}`);
    lines.push(`Queue after target reached: ${auto.queueAfterTargetReached === true ? 'Yes' : 'No'}`);
    const he = String(emp.hiringEntityId ?? '').trim();
    lines.push(he ? `Hiring entity: ${he}` : 'Hiring entity: not set');
    lines.push(
      `Employment: ${emp.employmentType === 'on_call' ? 'On-call' : 'Standard'} · Worker type follows hiring entity`,
    );
    if (req.accusourceScreeningRequired) {
      const pkg = String(req.accusourcePackageId ?? '').trim();
      const pn = String(req.accusourcePackageName ?? '').trim();
      if (pkg) {
        lines.push(pn ? `AccuSource screening: ${pn} (${pkg})` : `AccuSource screening: ${pkg}`);
        const svcs = (req.accusourceRequestedServiceIds ?? []).filter(Boolean);
        if (svcs.length) lines.push(`AccuSource add-on services: ${svcs.join(', ')}`);
      } else {
        lines.push('AccuSource screening: required (no package selected)');
      }
    }
    const certs = (req.requiredCertificationIds ?? []).filter(Boolean);
    if (certs.length) lines.push(`Required certifications: ${certs.join(', ')}`);
    return lines;
  }, [auto, emp, req]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Pre-cards section (policy source + tenant inheritance + hire-passed preview) hidden per UX simplification — leave commented in case we restore. */}
      {/*
      <Box>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
          <Typography variant="h5" component="h2" fontWeight={700}>
            {useTenantMode ? 'Using tenant defaults' : 'Custom group hiring policy'}
          </Typography>
          <Chip
            label={useTenantMode ? 'Tenant baseline' : 'Group override'}
            size="small"
            color={useTenantMode ? 'primary' : 'secondary'}
            variant="filled"
            sx={{ fontWeight: 700 }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {useTenantMode
            ? 'Interview rules and score thresholds come from Settings → AI interview & hiring. Employment, requirements, and activation switches below are saved on this group.'
            : 'All editable fields below are stored on this user group. Update tenant Settings if you want a new organization-wide baseline for other groups.'}
        </Typography>
      </Box>

      {!useTenantMode ? (
        <Alert severity="info" variant="outlined" sx={{ borderRadius: 1 }}>
          <strong>Tenant defaults are not controlling this group.</strong> Thresholds and targets you set in sections D
          and E apply only here unless a job order adds further hiringConfig overrides.
        </Alert>
      ) : null}

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ py: 1.5, px: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FormControl component="fieldset" variant="standard" sx={{ width: '100%' }}>
            <FormLabel component="legend" sx={{ fontWeight: 800, fontSize: '0.95rem', mb: 1 }}>
              Policy source
            </FormLabel>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
              Choose whether this group follows the tenant baseline or stores its own interview and threshold overrides.
            </Typography>
            <RadioGroup
              row
              value={useTenantMode ? 'tenant' : 'custom'}
              onChange={(_, v) => {
                if (v === 'tenant') {
                  setCfg((prev) => ({
                    useTenantDefaults: true,
                    employment: prev.employment,
                    requirements: prev.requirements,
                    automation: {
                      hiringActive: prev.automation?.hiringActive ?? false,
                      autoOnboardEnabled: prev.automation?.autoOnboardEnabled ?? false,
                      queueAfterTargetReached: prev.automation?.queueAfterTargetReached ?? true,
                    },
                  }));
                } else {
                  const eff = buildEffectiveUserGroupHiringConfig(tenantData, cfg);
                  setCfg({ ...eff, useTenantDefaults: false });
                }
              }}
            >
              <FormControlLabel value="tenant" control={<Radio size="small" />} label="Use tenant defaults" />
              <FormControlLabel value="custom" control={<Radio size="small" />} label="Customize for this group" />
            </RadioGroup>
          </FormControl>
        </CardContent>
      </Card>

      {useTenantMode ? (
        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            borderColor: 'primary.light',
            bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.08)' : 'rgba(25, 118, 210, 0.04)'),
          }}
        >
          <CardContent sx={{ py: 1.5, px: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle1" fontWeight={800} gutterBottom>
              Inherited policy summary
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
              What applies to this group right now. Tenant-controlled items are read-only below; group rows are
              editable.
            </Typography>

            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
              Inherited interview rules
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 1.5, mt: 0.5 }}>
              <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                Require AI prescreen: {iv.workerAiPrescreenRequired === true ? 'Yes' : 'No'}{' '}
                <Chip component="span" label="Tenant" size="small" variant="outlined" sx={{ ml: 0.5, height: 20 }} />
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                Auto-advance qualified candidates: {autoEff.autoAdvanceEnabled === true ? 'Yes' : 'No'}{' '}
                <Chip component="span" label="Tenant" size="small" variant="outlined" sx={{ ml: 0.5, height: 20 }} />
              </Typography>
              {tenantPolicyLines.map((line, i) => (
                <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>

            <Divider sx={{ my: 1.5 }} />

            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
              Inherited thresholds
            </Typography>
            {thresholdSummaryLines.length > 0 ? (
              <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 0, mt: 0.5 }}>
                {thresholdSummaryLines.map((line, i) => (
                  <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5 }}>
                    {line}
                  </Typography>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                No numeric thresholds loaded from tenant yet (check tenant AI interview & hiring settings).
              </Typography>
            )}

            <Divider sx={{ my: 1.5 }} />

            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                Group-specific (saved on this group)
              </Typography>
              <GroupOnlyBadge />
            </Stack>
            <Box component="ul" sx={{ m: 0, pl: 2.25, mt: 0.5 }}>
              {groupSpecificSummaryLines.map((line, i) => (
                <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {pipelineError ? (
        <Alert severity="warning">
          Pipeline data: {pipelineError} (summary counts may be incomplete until the query succeeds.)
        </Alert>
      ) : null}

      {failSafeWarnings.map((t) => (
        <Alert key={t} severity="warning">
          {t}
        </Alert>
      ))}

      <UserGroupHiringPipelineStatus
        cfg={effectiveCfg}
        metrics={metrics}
        loading={pipelineLoading}
        applicationCount={metrics.totalApplications}
        memberCentricOnCall={memberCentricOnCall}
        rawApplicationRecordCount={rawApplicationDocCount}
      />

      <UserGroupCandidatesPolicyImpactSection
        rows={policyImpactRows}
        loading={pipelineLoading}
        applicationCount={metrics.totalApplications}
        memberCount={memberCount}
        memberCentricOnCall={memberCentricOnCall}
        rawApplicationRecordCount={rawApplicationDocCount}
        groupId={groupId}
      />

      <UserGroupHiringDecisionFlowPreview cfg={effectiveCfg} />

      <UserGroupHiringSummaryCard
        memberCount={memberCount}
        metrics={metrics}
        metricsLoading={pipelineLoading}
        metricsBeta={metricsBeta}
      />

      {showQueuePreview ? (
        <UserGroupHiringQueuePreview
          queuedCount={metrics.queued}
          candidates={queuedPreview}
          loading={pipelineLoading}
        />
      ) : null}

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ py: 1.25, px: 1.5, '&:last-child': { pb: 1.25 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }} justifyContent="space-between">
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" fontWeight={800}>
                Preview hiring outcomes
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                Uses the same scan as <strong>Hire Passed Candidates</strong> (live applications): prescreen completed,
                orchestrator <code>advance</code>, no blocking C1 employment.
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => void runHirePassedPreview()}
              disabled={hirePassedPreviewLoading}
            >
              {hirePassedPreviewLoading ? 'Running…' : 'Run preview'}
            </Button>
          </Stack>
          <Box
            sx={{
              mt: 1.5,
              p: 1.25,
              borderRadius: 1,
              bgcolor: hirePassedPreviewResult ? 'action.hover' : 'grey.50',
              border: '1px dashed',
              borderColor: 'divider',
              minHeight: 88,
            }}
          >
            {hirePassedPreviewLoading ? (
              <Stack direction="row" alignItems="center" gap={1}>
                <CircularProgress size={22} />
                <Typography variant="body2" color="text.secondary">
                  Scanning applications…
                </Typography>
              </Stack>
            ) : hirePassedPreviewError ? (
              <Alert severity="error" sx={{ py: 0 }}>
                {hirePassedPreviewError}
              </Alert>
            ) : !hirePassedPreviewResult ? (
              <Typography variant="body2" color="text.secondary">
                Run preview to load eligible counts from the server (matches the hire button).
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Group members: {hirePassedPreviewResult.groupMemberCount} · Applications scanned:{' '}
                  {hirePassedPreviewResult.applicationsScanned}
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={2}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Eligible (hire-passed)
                    </Typography>
                    <Typography variant="h6" fontWeight={800}>
                      {hirePassedPreviewResult.eligibleCount}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Excluded
                    </Typography>
                    <Typography variant="h6" fontWeight={800}>
                      {hirePassedPreviewResult.excludedCount}
                    </Typography>
                  </Box>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Eligibility uses <strong>current</strong> tenant + group hiring policy, re-running the orchestrator with
                  each application’s saved prescreen score and interview flags (same as Hire Passed). Changing D/E and
                  saving updates who counts as advance without rewriting old Firestore decision fields.
                </Typography>
              </Stack>
            )}
          </Box>
        </CardContent>
      </Card>
      */}

      <Grid container spacing={1.5}>
        {/* Card A merged into Card A (Employment setup) — only the "Hiring active" toggle was kept; rest deprecated. */}
        {/*
        <Grid item xs={12} md={6}>
          <SectionCard
            title="A. Interview & automation"
            subtitle={
              useTenantMode
                ? 'Prescreen and auto-advance are inherited from the tenant (disabled here). Activation and queue behavior are saved on this group.'
                : 'AI pre-screen and hiring automation flags (stored under hiringConfig).'
            }
          >
            <Stack spacing={1}>
              {useTenantMode ? (
                <>
                  <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                      From tenant (read-only)
                    </Typography>
                    <InheritedBadge />
                  </Stack>
                  <FormControlLabel
                    control={<Switch checked={!!iv.workerAiPrescreenRequired} disabled />}
                    label="Require AI prescreen"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75, pl: 4.5 }}>
                    Disabled while using tenant defaults — edit under Settings → AI interview & hiring.
                  </Typography>
                  <FormControlLabel
                    control={<Switch checked={!!autoEff.autoAdvanceEnabled} disabled />}
                    label="Automatically hire qualified candidates"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75, pl: 4.5 }}>
                    Mirrors tenant <code>aiHiring.autoAdvanceEnabled</code>.
                  </Typography>
                  <Divider sx={{ my: 0.5 }} />
                  <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }}>
                      Saved on this group
                    </Typography>
                    <GroupOnlyBadge />
                  </Stack>
                </>
              ) : null}
              {!useTenantMode ? (
                <>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!iv.workerAiPrescreenRequired}
                        onChange={(_, v) => setInterview({ workerAiPrescreenRequired: v })}
                      />
                    }
                    label="Require AI prescreen"
                  />
                  <FormControlLabel
                    control={
                      <Switch checked={!!auto.hiringActive} onChange={(_, v) => setAutomation({ hiringActive: v })} />
                    }
                    label="Hiring active"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!auto.autoAdvanceEnabled}
                        onChange={(_, v) => setAutomation({ autoAdvanceEnabled: v })}
                      />
                    }
                    label="Automatically hire qualified candidates"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!auto.autoOnboardEnabled}
                        onChange={(_, v) => setAutomation({ autoOnboardEnabled: v })}
                      />
                    }
                    label="Automatically start onboarding"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!auto.queueAfterTargetReached}
                        onChange={(_, v) => setAutomation({ queueAfterTargetReached: v })}
                      />
                    }
                    label="Queue candidates after target is reached"
                  />
                </>
              ) : (
                <>
                  <FormControlLabel
                    control={
                      <Switch checked={!!auto.hiringActive} onChange={(_, v) => setAutomation({ hiringActive: v })} />
                    }
                    label="Hiring active"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!auto.autoOnboardEnabled}
                        onChange={(_, v) => setAutomation({ autoOnboardEnabled: v })}
                      />
                    }
                    label="Automatically start onboarding"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!auto.queueAfterTargetReached}
                        onChange={(_, v) => setAutomation({ queueAfterTargetReached: v })}
                      />
                    }
                    label="Queue candidates after target is reached"
                  />
                </>
              )}
            </Stack>
          </SectionCard>
        </Grid>
        */}

        <Grid item xs={12} md={6}>
          <SectionCard
            title="A. Employment setup"
            subtitle="Defaults for workers hired through this group."
            titleBadge={useTenantMode ? <GroupOnlyBadge /> : undefined}
          >
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Switch checked={!!auto.hiringActive} onChange={(_, v) => setAutomation({ hiringActive: v })} />
                }
                label="Hiring active"
              />
              <FormControl
                size="small"
                fullWidth
                required={auto.hiringActive === true || auto.autoOnboardEnabled === true}
                disabled={entitiesLoading}
              >
                <InputLabel id="user-group-hiring-entity-label">Hiring entity</InputLabel>
                <Select
                  labelId="user-group-hiring-entity-label"
                  label="Hiring entity"
                  value={emp.hiringEntityId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as string;
                    const hiringEntityId = v === '' ? null : v;
                    const opt = hiringEntityId
                      ? entitySelectOptions.find((o) => o.id === hiringEntityId)
                      : null;
                    const label = opt?.name?.trim() ?? '';
                    const ev =
                      !!hiringEntityId &&
                      label.toLowerCase() === EVERIFY_REQUIRED_ENTITY_NAME.toLowerCase();
                    setEmployment({ hiringEntityId, eVerifyRequired: ev });
                    // C1 Events catchall: open all gates so the group behaves as an invite list.
                    // Applied at the moment of selection only; users can still customize after.
                    if (
                      label.toLowerCase() === C1_EVENTS_CATCHALL_ENTITY_NAME.toLowerCase()
                    ) {
                      setRequirements({
                        accusourceScreeningRequired: false,
                        accusourcePackageId: '',
                        accusourcePackageName: '',
                        accusourceRequestedServiceIds: [],
                        requiredCertificationIds: [],
                      });
                      setQuality({
                        preset: 'hire_everyone',
                        interviewMinimumScoreToAdvance:
                          GROUP_HIRING_QUALITY_PRESETS.hire_everyone.interviewMinimumScoreToAdvance,
                        jobFitMinimumScoreToAdvance:
                          GROUP_HIRING_QUALITY_PRESETS.hire_everyone.jobFitMinimumScoreToAdvance,
                        minimumJobScoreGateEnabled: false,
                        jobFitFailAction: 'review',
                        // Cleared so the resolver's preset default (100 — never block on no-show)
                        // is what reaches the orchestrator.
                        maximumNoShowRiskToAdvance: undefined,
                      });
                      setTargets({
                        // Catchall has no specific onboarding cap; leave blank.
                        targetOnboardingCount: undefined,
                        maximumAutoAdvances: undefined,
                        stopWhenTargetReached: false,
                      });
                    }
                  }}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {entitySelectOptions.map((e) => (
                    <MenuItem key={e.id} value={e.id}>
                      {e.name}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>Employer of record — choose from tenant Entities</FormHelperText>
                {auto.hiringActive === true && !emp.hiringEntityId ? (
                  <FormHelperText error>
                    Required while Hiring active is on.
                  </FormHelperText>
                ) : null}
                {selectedHiringEntityOption?.name?.trim().toLowerCase() ===
                C1_EVENTS_CATCHALL_ENTITY_NAME.toLowerCase() ? (
                  <FormHelperText>
                    Catchall mode: this entity opens up B / C / D by default (no screening,{' '}
                    <strong>Hire everyone · no floor</strong>, no caps). Override any field below if
                    you need a stricter rule for this group.
                  </FormHelperText>
                ) : null}
              </FormControl>
              {/* Worker type (W-2 vs 1099) is intentionally not editable on the group:
                  it is owned by the tenant Entity (e.g. C1 Events = 1099, C1 Select = W-2)
                  and resolved server-side via `resolveEvereeWorkerTypeForOnCall`. The
                  group-level `Hire passed candidates` callable now passes `entity_default`,
                  matching the auto-onboarding trigger in `onApplicationCreatedPush.ts`. */}
              <FormControlLabel
                control={<Switch checked={derivedEverifyRequired} disabled />}
                label="Require E-Verify"
                sx={{ alignItems: 'flex-start', m: 0 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5, pl: 4.5 }}>
                Follows the Hiring entity option you chose above (same tenant Entities as the dropdown). On only when
                that option’s name is {EVERIFY_REQUIRED_ENTITY_NAME}; otherwise off.
              </Typography>
            </Stack>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            title="B. Requirements"
            subtitle="Screening and certification expectations."
            titleBadge={useTenantMode ? <GroupOnlyBadge /> : undefined}
          >
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!req.accusourceScreeningRequired}
                    onChange={(_, v) => {
                      if (!v) {
                        setRequirements({
                          accusourceScreeningRequired: false,
                          accusourcePackageId: '',
                          accusourcePackageName: '',
                          accusourceRequestedServiceIds: [],
                        });
                      } else {
                        setRequirements({ accusourceScreeningRequired: true });
                      }
                    }}
                  />
                }
                label="Require AccuSource screening package"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0 }}>
                For on-call pool hires, <strong>Hire passed candidates</strong> uses the same screening package as{' '}
                <strong>Start on-call employment</strong> on a user profile.
              </Typography>
              {catalogSyncMessage ? (
                <Alert severity="warning" onClose={() => setCatalogSyncMessage(null)}>
                  {catalogSyncMessage}
                </Alert>
              ) : null}
              <AccusourcePackageSelector
                catalog={accusourceCatalog}
                catalogLoading={catalogLoading || catalogSyncing}
                packageId={req.accusourcePackageId ?? ''}
                packageName={req.accusourcePackageName ?? ''}
                onChange={(next) =>
                  setRequirements({
                    accusourcePackageId: next.packageId.trim(),
                    accusourcePackageName: next.packageName.trim(),
                  })
                }
                selectedServiceIds={req.accusourceRequestedServiceIds ?? []}
                onServicesChange={(ids) => setRequirements({ accusourceRequestedServiceIds: ids })}
                disabled={!req.accusourceScreeningRequired}
                showCatalogMeta
                showRefresh
                onRefreshCatalog={() => void handleRefreshAccusourceCatalog()}
                catalogRefreshing={catalogSyncing}
                canRefreshCatalog={canAccusourceAdmin}
                emptyCatalogSeverity="info"
                selectLabel="AccuSource screening package"
                emptyMenuLabel="None"
                packageNameFieldLabel="Package name (from catalog)"
                description="Synced catalog from User → Backgrounds → Order screening (AccuSource). Package plus optional add-on services are sent in one SourceDirect order. Required when the toggle above is on."
              />
              <Autocomplete
                multiple
                disableCloseOnSelect
                options={certificationFieldOptions}
                value={selectedCertificationOptions}
                onChange={(_, newValue) => {
                  setRequirements({
                    requiredCertificationIds: newValue.map((o) => o.value),
                  });
                }}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(a, b) => a.value === b.value}
                filterSelectedOptions
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        variant="outlined"
                        size="small"
                        label={option.label}
                        {...chipProps}
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Required certifications"
                    placeholder="Search credentials…"
                    helperText="Same standard list as deal scoping and job compliance (credentials catalog). Stored as credential names."
                  />
                )}
              />
            </Stack>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <Collapse in={!useTenantMode} timeout="auto" unmountOnExit>
            <SectionCard
              title="C. Quality thresholds"
              subtitle="Floors for advancing candidates. For this group, the score floor is compared to the candidate's Master Recruiter Score (50% category profile + 35% interview + 15% resume) — not the raw interview score."
            >
              <Stack spacing={1}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Preset</InputLabel>
                  <Select
                    label="Preset"
                    value={qualForm.preset ?? 'balanced'}
                    onChange={(e) => applyPreset(e.target.value as GroupHiringQualityPreset)}
                  >
                    <MenuItem value="conservative">Conservative · Master ≥ 80 (B)</MenuItem>
                    <MenuItem value="balanced">Balanced · Master ≥ 70 (C)</MenuItem>
                    <MenuItem value="aggressive">Aggressive · Master ≥ 60 (D)</MenuItem>
                    <MenuItem value="hire_everyone">Hire everyone · no floor</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                </FormControl>
                {(() => {
                  // Mirrors `readGroupHiringConfigAsAiPartial` in
                  // `functions/src/workerAiPrescreen/aiHiringPolicyResolution.ts`.
                  const presetForCopy = qualForm.preset ?? 'custom';
                  const liftedNoShow =
                    presetForCopy === 'aggressive' || presetForCopy === 'hire_everyone';
                  return (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', lineHeight: 1.4, pt: 0.25 }}
                    >
                      For this user group, an AI prescreen &quot;review&quot; recommendation never blocks
                      on its own — candidates are still gated by the Master score floor, flags,
                      dynamic answers, job-fit rules (when enabled), and hard &quot;decline&quot;
                      recommendations. Presets only change how strict those numeric floors are.
                      {liftedNoShow ? (
                        <>
                          {' '}
                          The <strong>{presetForCopy === 'hire_everyone' ? 'Hire everyone' : 'Aggressive'}</strong>{' '}
                          preset also lifts the no-show overlay (defaults the maximum allowed
                          no-show risk to&nbsp;100); set the field below if you want to enforce a
                          stricter ceiling.
                        </>
                      ) : (
                        <>
                          {' '}
                          The no-show overlay defaults to blocking candidates whose risk score is
                          above 49 (high or critical band); set the field below to a different
                          ceiling, or pick the <strong>Aggressive</strong> preset to lift it.
                        </>
                      )}
                    </Typography>
                  );
                })()}
                <TextField
                  size="small"
                  label="Minimum Master Recruiter Score to advance"
                  type="number"
                  value={qualForm.interviewMinimumScoreToAdvance ?? ''}
                  onChange={(e) => {
                    const next = parseOptionalInt(e.target.value);
                    setQuality({
                      interviewMinimumScoreToAdvance: next,
                      preset: detectGroupHiringQualityPreset(
                        next,
                        qualForm.jobFitMinimumScoreToAdvance,
                      ),
                    });
                  }}
                  inputProps={{ min: 0, max: 100 }}
                  fullWidth
                  helperText="0–100, same scale as the grade you see on a candidate (B=80, C=70, D=60). Falls back to the prescreen overall when a Master score can't be computed."
                />
                <TextField
                  size="small"
                  label="Job-fit minimum score to advance"
                  type="number"
                  value={qualForm.jobFitMinimumScoreToAdvance ?? ''}
                  onChange={(e) => {
                    const next = parseOptionalInt(e.target.value);
                    setQuality({
                      jobFitMinimumScoreToAdvance: next,
                      preset: detectGroupHiringQualityPreset(
                        qualForm.interviewMinimumScoreToAdvance,
                        next,
                      ),
                    });
                  }}
                  inputProps={{ min: 0, max: 100 }}
                  fullWidth
                  required={qualForm.minimumJobScoreGateEnabled === true}
                  helperText="0–100. Only enforced when “Require minimum job-fit score” is on AND the application has a job posting attached."
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!qualForm.minimumJobScoreGateEnabled}
                      onChange={(_, v) => setQuality({ minimumJobScoreGateEnabled: v })}
                    />
                  }
                  label="Require minimum job-fit score"
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>Job-fit fail action</InputLabel>
                  <Select
                    label="Job-fit fail action"
                    value={qualForm.jobFitFailAction ?? 'review'}
                    onChange={(e) => setQuality({ jobFitFailAction: e.target.value as 'review' | 'hold' })}
                  >
                    <MenuItem value="review">Review</MenuItem>
                    <MenuItem value="hold">Hold</MenuItem>
                  </Select>
                </FormControl>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                  <TextField
                    size="small"
                    label="Maximum allowed no-show risk (0–100)"
                    type="number"
                    value={qualForm.maximumNoShowRiskToAdvance ?? ''}
                    onChange={(e) =>
                      setQuality({ maximumNoShowRiskToAdvance: parseOptionalInt(e.target.value) })
                    }
                    inputProps={{ min: 0, max: 100 }}
                    fullWidth
                    helperText="Candidates with a no-show risk score strictly above this value are downgraded to “review” by the orchestrator’s no-show overlay. Leave blank to use the preset default (Conservative/Balanced: 49 — block high/critical; Aggressive/Hire-everyone: 100 — never block on no-show alone). Set 100 to disable, 0 to block all but the lowest risk."
                  />
                  {typeof maxNs === 'number' && Number.isFinite(maxNs) ? (
                    <Chip
                      sx={{ mt: { xs: 0, sm: 1 } }}
                      label={`Threshold ${maxNs}`}
                      color={noShowRiskChipColor(maxNs)}
                      size="small"
                    />
                  ) : null}
                </Stack>
              </Stack>
            </SectionCard>
          </Collapse>
        </Grid>

        <Grid item xs={12} md={6}>
          <Collapse in={!useTenantMode} timeout="auto" unmountOnExit>
            <SectionCard
              title="D. Targets"
              subtitle="Onboarding caps and stop rules (stored under hiringConfig.targets)."
              titleBadge={<GroupOnlyBadge />}
            >
              <Stack spacing={1}>
                <TextField
                  size="small"
                  label="Target onboarding count"
                  type="number"
                  value={tgtForm.targetOnboardingCount ?? ''}
                  onChange={(e) => setTargets({ targetOnboardingCount: parseOptionalInt(e.target.value) })}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Maximum auto-advances"
                  type="number"
                  value={tgtForm.maximumAutoAdvances ?? ''}
                  onChange={(e) => setTargets({ maximumAutoAdvances: parseOptionalInt(e.target.value) })}
                  fullWidth
                  helperText="Cap on automated advances per policy window (when execution exists)"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!tgtForm.stopWhenTargetReached}
                      onChange={(_, v) => setTargets({ stopWhenTargetReached: v })}
                    />
                  }
                  label="Stop hiring when target is reached"
                />
              </Stack>
            </SectionCard>
          </Collapse>
        </Grid>
      </Grid>

      {useTenantMode ? (
        <Alert severity="info" variant="outlined" sx={{ borderRadius: 1 }}>
          <Typography variant="body2">
            Sections <strong>C</strong> and <strong>D</strong> are hidden while you use tenant defaults — scoring and
            capacity rules come from the tenant (see <strong>Inherited policy summary</strong> above). Choose{' '}
            <strong>Customize for this group</strong> to edit thresholds on this group only.
          </Typography>
        </Alert>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {done ? <Alert severity="success">{done}</Alert> : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} flexWrap="wrap">
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save hiring configuration'}
        </Button>
        <Button
          variant="outlined"
          color="primary"
          onClick={() => void openBackfillDialog()}
          disabled={saving || !emp.hiringEntityId || emp.employmentType !== 'on_call'}
        >
          Apply rules to existing members
        </Button>
        <Button
          variant="outlined"
          color="secondary"
          onClick={() => setInterviewInvitesOpen(true)}
          disabled={saving}
        >
          Send AI prescreen invites
        </Button>
        {!emp.hiringEntityId ? (
          <Typography variant="caption" color="text.secondary">
            Set a hiring entity above to enable the backfill.
          </Typography>
        ) : null}
      </Stack>

      <TriggerGroupInterviewDialog
        open={interviewInvitesOpen}
        onClose={() => setInterviewInvitesOpen(false)}
        tenantId={tenantId || undefined}
        groupId={groupId}
      />

      <Dialog
        open={backfillOpen}
        onClose={closeBackfillDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Apply hiring rules to existing members</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1.5 }}>
            This re-evaluates every member of the group (and their applications) against the{' '}
            <strong>currently saved</strong> hiring rules, then starts on-call onboarding for each
            user who currently passes. Members who are already onboarding or employed at the
            hiring entity are skipped — this action is idempotent and safe to re-run.
          </DialogContentText>
          <DialogContentText variant="caption" color="text.secondary" sx={{ mb: 1 }}>
            Catchall groups: with the quality preset set to <strong>"Hire everyone · no floor"</strong>,
            members who never created an application are also onboarded — useful when the group is
            being used as an invite list. Active C1 Select employment still blocks hiring at C1 Events.
          </DialogContentText>
          <DialogContentText variant="caption" color="text.secondary" sx={{ mb: 2 }}>
            Tip: save any pending changes above first — the scan uses what's stored on the
            group document, not your in-flight edits.
          </DialogContentText>

          {backfillBusy && !backfillResult ? (
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {backfillPreview ? 'Onboarding eligible members…' : 'Scanning members and applications…'}
              </Typography>
            </Stack>
          ) : null}

          {backfillPreview && !backfillResult ? (
            <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
              <Typography variant="body2">
                <strong>{backfillPreview.eligibleCount}</strong> eligible ·{' '}
                <strong>{backfillPreview.excludedCount}</strong> excluded ·{' '}
                {backfillPreview.applicationsScanned} application(s) scanned across{' '}
                {backfillPreview.groupMemberCount} member(s)
                {(backfillPreview.membersWithoutApplicationCount ?? 0) > 0 ? (
                  <>
                    {' '}·{' '}
                    <strong>{backfillPreview.membersWithoutApplicationCount}</strong> without an
                    application
                  </>
                ) : null}
                .
              </Typography>

              {(backfillPreview.exclusionBreakdown?.length ?? 0) > 0 ? (
                <Box sx={{ mt: 1.25 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Why excluded:
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.25, mt: 0.25 }}>
                    {backfillPreview.exclusionBreakdown!.map((b) => (
                      <Typography
                        key={b.category}
                        component="li"
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'list-item' }}
                      >
                        <strong>{b.count}</strong> · {b.label}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ) : null}

              {prescreenBlockedCount > 0 ? (
                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    Most blockers are prescreen completion. Sending invites will move them
                    through the funnel — once they finish, the auto-onboarding trigger picks
                    them up.
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={() => {
                      setBackfillOpen(false);
                      setInterviewInvitesOpen(true);
                    }}
                  >
                    Send AI prescreen invites
                  </Button>
                </Box>
              ) : null}

              {backfillPreview.eligibleCount === 0 && prescreenBlockedCount === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  No one currently passes. The breakdown above shows the dominant blocker.
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          {backfillResult ? (
            <Alert severity="success" sx={{ whiteSpace: 'pre-line' }}>
              {formatUserGroupHirePassedSuccess(backfillResult)}
            </Alert>
          ) : null}

          {backfillError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {backfillError}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBackfillDialog} disabled={backfillBusy}>
            {backfillResult ? 'Close' : 'Cancel'}
          </Button>
          {!backfillResult ? (
            <Button
              variant="contained"
              onClick={() => void runBackfillExecute()}
              disabled={
                backfillBusy ||
                !backfillPreview ||
                backfillPreview.eligibleCount === 0
              }
            >
              {backfillBusy
                ? 'Running…'
                : backfillPreview
                  ? `Apply to ${backfillPreview.eligibleCount} member${backfillPreview.eligibleCount === 1 ? '' : 's'}`
                  : 'Apply'}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default UserGroupHiringControlPanel;
