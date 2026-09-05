/**
 * Settings → Tier Automation (Greg 2026-09-04): the points scorecard that
 * governs automatic Tier 3 → Tier 2 promotion, plus the review queue the
 * nightly engine fills in propose mode. Config lives at
 * `tenants/{tid}/settings/tierAutomation`; the engine rides
 * scheduledScoringDistribution (3 AM ET) and uses the SAME shared scorer
 * (shared/workerTierScoring.ts), so what this page shows is exactly what the
 * engine computes. Tier 1 promotion stays manual-only; demotion/earn-back
 * are hardcoded policy (displayed read-only) wired up with Claim Shift.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  DEFAULT_TIER_AUTOMATION_CONFIG,
  TIER_FACTOR_LABELS,
  TierAutomationConfig,
  TierAutomationMode,
  TierAutomationPoints,
  normalizeTierAutomationConfig,
} from '../../../shared/workerTierScoring';
import { setWorkerTierGlobal } from '../../../utils/workerTier';

interface ProposalRow {
  id: string;
  uid: string;
  name: string;
  total: number;
  maxPossible: number;
  threshold: number;
  factors: Array<{ key: string; label: string; earned: number; max: number; detail: string }>;
  lastEvaluatedAt: Date | null;
}

const FACTOR_ORDER: Array<keyof TierAutomationPoints> = [
  'profileCompletion',
  'interviewScore',
  'resume',
  'skills',
  'profilePhoto',
  'appInstalled',
  'backgroundCheck',
  'drugScreen',
];

const FACTOR_HINTS: Partial<Record<keyof TierAutomationPoints, string>> = {
  profileCompletion: 'Scaled by the 0–100 completeness score',
  interviewScore: 'Scaled by the 0–100 AI interview score; no interview = 0',
  skills: 'Full points at 3+ skills, half at 1–2',
  appInstalled: 'iOS/Android app install; inactive until Oct 1, 2026',
  backgroundCheck: 'Completed and clear — strong "shows up" signal',
  drugScreen: 'Completed and negative',
};

function toDateMaybe(v: unknown): Date | null {
  const maybe = v as { toDate?: () => Date } | null;
  if (maybe && typeof maybe.toDate === 'function') {
    try {
      return maybe.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

const TierAutomationSettings: React.FC = () => {
  const { tenantId, activeTenant, currentUser } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId || '';
  const navigate = useNavigate();

  const [config, setConfig] = useState<TierAutomationConfig>(DEFAULT_TIER_AUTOMATION_CONFIG);
  const [savedConfig, setSavedConfig] = useState<TierAutomationConfig | null>(null);
  const [docExists, setDocExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [actingOn, setActingOn] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveTenantId) return;
    const ref = doc(db, 'tenants', effectiveTenantId, 'settings', 'tierAutomation');
    const unsub = onSnapshot(ref, (snap) => {
      const normalized = normalizeTierAutomationConfig(snap.data());
      setDocExists(snap.exists());
      setSavedConfig(normalized);
      setConfig(normalized);
    });
    return () => unsub();
  }, [effectiveTenantId]);

  useEffect(() => {
    if (!effectiveTenantId) return;
    const q = query(
      collection(db, 'tenants', effectiveTenantId, 'tier_promotion_proposals'),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: ProposalRow[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const card = (data.scorecard ?? {}) as Record<string, unknown>;
        return {
          id: d.id,
          uid: String(data.uid ?? d.id),
          name: String(data.name ?? d.id),
          total: Number(card.total ?? 0),
          maxPossible: Number(card.maxPossible ?? 100),
          threshold: Number(card.threshold ?? 0),
          factors: Array.isArray(card.factors) ? (card.factors as ProposalRow['factors']) : [],
          lastEvaluatedAt: toDateMaybe(data.lastEvaluatedAt),
        };
      });
      rows.sort((a, b) => b.total - a.total);
      setProposals(rows);
    });
    return () => unsub();
  }, [effectiveTenantId]);

  const dirty = useMemo(
    () => savedConfig != null && JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );
  const maxPossible = useMemo(
    () => FACTOR_ORDER.reduce((s, k) => s + config.points[k], 0),
    [config],
  );

  const handleSave = async () => {
    if (!effectiveTenantId) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'tenants', effectiveTenantId, 'settings', 'tierAutomation'),
        {
          ...config,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid ?? null,
        },
        { merge: true },
      );
      setSnack('Tier automation settings saved. The nightly run (3 AM ET) uses them next.');
    } catch (e) {
      setSnack(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const decideProposal = async (row: ProposalRow, decision: 'approved' | 'dismissed') => {
    if (!effectiveTenantId || !currentUser?.uid) return;
    setActingOn(row.id);
    const byName = currentUser.displayName || currentUser.email || 'HRX staff';
    try {
      if (decision === 'approved') {
        await setWorkerTierGlobal({
          userId: row.uid,
          tier: 2,
          previousTier: 3,
          changedById: currentUser.uid,
          changedByName: byName,
          source: 'auto_threshold',
          reason: `Scorecard ${row.total}/${row.maxPossible} (threshold ${row.threshold}) — approved from the review queue`,
        });
      }
      await updateDoc(doc(db, 'tenants', effectiveTenantId, 'tier_promotion_proposals', row.id), {
        status: decision,
        decidedById: currentUser.uid,
        decidedByName: byName,
        decidedAt: serverTimestamp(),
      });
      setSnack(
        decision === 'approved'
          ? `${row.name} promoted to Tier 2 (logged under your name).`
          : `Proposal for ${row.name} dismissed — the engine won't re-propose them.`,
      );
    } catch (e) {
      setSnack(`Could not ${decision === 'approved' ? 'approve' : 'dismiss'}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActingOn(null);
    }
  };

  if (!effectiveTenantId) return null;

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 1.5, maxWidth: 960 }}>
      <Typography variant="h6" component="h2" fontWeight={600} sx={{ mb: 0.5 }}>
        Tier Automation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        The points scorecard for automatic Tier 3 → Tier 2 promotion. The nightly engine (3 AM ET)
        scores every Tier 3 worker; in Propose mode it fills the review queue below, in Automatic
        mode it promotes directly (audit-logged as &quot;HRX Tier Engine&quot;). Tier 1 stays
        manual-only.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={config.mode}
            onChange={(_e, v: TierAutomationMode | null) => {
              if (v) setConfig((c) => ({ ...c, mode: v }));
            }}
          >
            <ToggleButton value="off">Off</ToggleButton>
            <ToggleButton value="propose">Propose (review queue)</ToggleButton>
            <ToggleButton value="automatic">Automatic</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            label="Promotion threshold"
            size="small"
            type="number"
            value={config.threshold}
            onChange={(e) =>
              setConfig((c) => ({ ...c, threshold: Math.max(0, Math.round(Number(e.target.value) || 0)) }))
            }
            sx={{ width: 170 }}
            helperText={`of ${maxPossible} possible points`}
          />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" size="small" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : docExists ? 'Save changes' : 'Save & activate'}
          </Button>
        </Stack>
        {!docExists ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Not active yet — save to turn the nightly engine on for this tenant (defaults shown, Propose mode).
          </Alert>
        ) : null}
        <Divider sx={{ mb: 1.5 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1fr' },
            gap: 1.5,
          }}
        >
          {FACTOR_ORDER.map((key) => (
            <Tooltip key={key} title={FACTOR_HINTS[key] ?? ''} placement="top">
              <TextField
                label={TIER_FACTOR_LABELS[key]}
                size="small"
                type="number"
                value={config.points[key]}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    points: {
                      ...c.points,
                      [key]: Math.max(0, Math.round(Number(e.target.value) || 0)),
                    },
                  }))
                }
              />
            </Tooltip>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Hardcoded policy (not adjustable): a penalized no-show drops a worker one tier; 40 clean
          hours restore it, and the counter resets on demotion. That wiring ships with Claim Shift.
          Worker-facing names — Tier 1 &quot;Top Pro&quot;, Tier 2 &quot;Pro&quot;, Tier 3
          &quot;Member&quot; — go live in the app at Claim Shift launch; nothing is shown to workers
          before then.
        </Typography>
      </Paper>

      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
        Review queue{proposals.length > 0 ? ` (${proposals.length})` : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Workers the engine would promote to Tier 2. Approving promotes immediately and logs it under
        your name; dismissing is remembered — the engine never re-proposes a dismissed worker.
      </Typography>
      {proposals.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            No pending proposals. The queue fills after the next nightly run (3 AM ET) once the
            engine is active.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {proposals.map((row) => (
            <Paper key={row.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => navigate(`/users/${row.uid}`)}
                >
                  {row.name}
                </Typography>
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`${row.total}/${row.maxPossible} · threshold ${row.threshold}`}
                  sx={{ fontWeight: 600 }}
                />
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<CheckIcon />}
                  disabled={actingOn === row.id}
                  onClick={() => void decideProposal(row, 'approved')}
                >
                  Promote to Tier 2
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  startIcon={<CloseIcon />}
                  disabled={actingOn === row.id}
                  onClick={() => void decideProposal(row, 'dismissed')}
                >
                  Dismiss
                </Button>
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.75 }}>
                {row.factors.map((f) => (
                  <Tooltip key={f.key} title={f.detail} placement="top">
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${f.label} ${f.earned}/${f.max}`}
                      sx={{
                        height: 20,
                        fontSize: 11,
                        color: f.earned === 0 ? 'text.disabled' : 'text.primary',
                      }}
                    />
                  </Tooltip>
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Snackbar
        open={snack != null}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
      />
    </Box>
  );
};

export default TierAutomationSettings;
