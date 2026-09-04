/**
 * Worker tier chip — the one component for every surface (profile header,
 * placement tiles, applicants/users/group tables). Partial activation
 * (Greg 2026-09-04): label + audit only, no job gating yet.
 *
 * Drop-in: needs only `userId` plus whatever user projection the surface has
 * (absent workerTiers = Tier 3). Staff viewers (securityLevel 5+) get a
 * click-to-change menu; the write batches the tier + activityLogs audit
 * entry together (src/utils/workerTier.ts). Workers never see this — every
 * call site is a recruiter-only surface.
 */
import React, { useMemo, useState } from 'react';
import { Box, Chip, Divider, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

import { useAuth } from '../contexts/AuthContext';
import {
  WORKER_TIER_DESCRIPTIONS,
  WORKER_TIER_LABELS,
  WorkerTier,
  resolveWorkerTier,
  resolveWorkerTierLastChange,
  setWorkerTierGlobal,
} from '../utils/workerTier';

const TIER_STYLES: Record<WorkerTier, { bgcolor: string; color: string; borderColor: string }> = {
  1: { bgcolor: '#FBF3D9', color: '#8A6D1A', borderColor: '#E2CD8A' },
  2: { bgcolor: '#E3F0FB', color: '#1565C0', borderColor: '#A8CBEE' },
  3: { bgcolor: '#F3F3F3', color: '#6B6B6B', borderColor: '#DDDDDD' },
};

type Props = {
  userId: string;
  /** Full user doc or any projection carrying `workerTiers` (absent = Tier 3). */
  user?: Record<string, unknown> | null;
  /** Worker name for the audit line; falls back to the uid. */
  userName?: string;
  /** Dense-table variant: "T2", height 18. */
  compact?: boolean;
  /** Force the menu off (viewer staff-ness is auto-detected otherwise). */
  editable?: boolean;
  onChanged?: (tier: WorkerTier) => void;
  sx?: Record<string, unknown>;
};

function toDateMaybe(v: unknown): Date | null {
  if (!v) return null;
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    try {
      return maybe.toDate();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v;
  return null;
}

const WorkerTierBadge: React.FC<Props> = ({
  userId,
  user = null,
  userName,
  compact = false,
  editable,
  onChanged,
  sx,
}) => {
  const { currentUser, securityLevel, isHRX } = useAuth();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [override, setOverride] = useState<WorkerTier | null>(null);
  const [saving, setSaving] = useState(false);

  const viewerLevel = Number.parseInt(String(securityLevel ?? ''), 10);
  const viewerIsStaff = isHRX || (!Number.isNaN(viewerLevel) && viewerLevel >= 5);
  const canEdit = (editable ?? true) && viewerIsStaff && Boolean(currentUser?.uid);

  const tier = override ?? resolveWorkerTier(user);
  const lastChange = resolveWorkerTierLastChange(user);

  const tooltip = useMemo(() => {
    if (override) return WORKER_TIER_LABELS[override];
    if (!lastChange) return `${WORKER_TIER_LABELS[tier]} — ${WORKER_TIER_DESCRIPTIONS[tier]}`;
    const at = toDateMaybe(lastChange.at);
    const when = at
      ? ` on ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';
    const by = lastChange.byName ? ` by ${lastChange.byName}` : '';
    return `Changed to ${WORKER_TIER_LABELS[lastChange.to]}${when}${by}`;
  }, [override, lastChange, tier]);

  const handleSelect = async (next: WorkerTier) => {
    setAnchorEl(null);
    if (next === tier || !currentUser?.uid) return;
    const previous = tier;
    setOverride(next); // optimistic — tables don't refetch on our account
    setSaving(true);
    try {
      await setWorkerTierGlobal({
        userId,
        tier: next,
        previousTier: previous,
        changedById: currentUser.uid,
        changedByName: currentUser.displayName || currentUser.email || 'HRX staff',
        source: 'manual',
      });
      onChanged?.(next);
    } catch (e) {
      setOverride(null);
      window.alert(
        `Could not change ${userName || 'this worker'}'s tier: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const style = TIER_STYLES[tier];
  const chip = (
    <Chip
      label={compact ? `T${tier}` : WORKER_TIER_LABELS[tier]}
      size="small"
      variant="outlined"
      onClick={canEdit ? (e) => setAnchorEl(e.currentTarget) : undefined}
      disabled={saving}
      sx={{
        height: compact ? 18 : 22,
        fontSize: compact ? 10 : 12,
        fontWeight: 700,
        letterSpacing: 0.2,
        bgcolor: style.bgcolor,
        color: style.color,
        borderColor: style.borderColor,
        '& .MuiChip-label': { px: compact ? 0.75 : 1 },
        '&:hover': canEdit ? { bgcolor: style.bgcolor, filter: 'brightness(0.96)' } : undefined,
        ...sx,
      }}
    />
  );

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
      <Tooltip title={tooltip}>{chip}</Tooltip>
      {canEdit ? (
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={() => setAnchorEl(null)}
          slotProps={{ paper: { sx: { minWidth: 260 } } }}
        >
          {( [1, 2, 3] as WorkerTier[]).map((t) => (
            <MenuItem key={t} onClick={() => void handleSelect(t)} dense>
              <ListItemText
                primary={WORKER_TIER_LABELS[t]}
                secondary={WORKER_TIER_DESCRIPTIONS[t]}
                primaryTypographyProps={{ fontWeight: t === tier ? 700 : 500, fontSize: 13 }}
                secondaryTypographyProps={{ fontSize: 11 }}
              />
              {t === tier ? <CheckIcon sx={{ fontSize: 16, ml: 1, color: 'success.main' }} /> : null}
            </MenuItem>
          ))}
          {lastChange ? (
            <Box>
              <Divider sx={{ my: 0.5 }} />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ px: 2, py: 0.5, display: 'block', maxWidth: 280 }}
              >
                {tooltip}
                {lastChange.reason ? ` — ${lastChange.reason}` : ''}
              </Typography>
            </Box>
          ) : null}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 2, pb: 0.5, display: 'block', maxWidth: 280 }}
          >
            Changes are logged to the worker&apos;s Activity tab under your name.
          </Typography>
        </Menu>
      ) : null}
    </Box>
  );
};

export default WorkerTierBadge;
