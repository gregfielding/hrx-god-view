/**
 * EvereeApprovalGroupControl — admin-only control for the entity-default
 * Everee approval-group routing.
 *
 * Phase C of the May 2026 approval-group rollout (HRX Everee Master Plan §5).
 * Phase A wired entity-level defaults into `createWorkerIfNeeded`; Phase B
 * shipped the runtime callables (`evereeListApprovalGroups`,
 * `evereeAssignApprovalGroup`, `evereeReassignAllWorkersToGroup`); this
 * component is the operator-facing surface that ties them together.
 *
 * Where it renders:
 *   - `EntitiesPage.tsx`, inside the Everee section of the Overview tab,
 *     immediately under "API base URL". Only when the entity has Everee
 *     enabled AND a non-empty `evereeTenantId` (otherwise there's no API
 *     to talk to and we'd just toast errors).
 *
 * What it does:
 *   1. Lazy-loads the group catalog via `evereeListApprovalGroups` on first
 *      "Load groups" click. We do NOT auto-load on mount — every load
 *      costs an Everee API call and the page mounts on every entity click.
 *   2. Renders a Select with the loaded groups; persists the selection back
 *      to the parent via `onChange(value)` so the existing "Save" button
 *      writes the entity doc.
 *   3. Optional bulk re-assignment: a "Re-assign all existing workers"
 *      button that runs `dryRun:true` first, shows a confirmation with the
 *      candidate count, then re-runs with `dryRun:false` if the operator
 *      proceeds. This is the same surface that the scratch backfill script
 *      uses, but accessible from the UI without a service-account env.
 *
 * Defensive choices:
 *   - "Save" is decoupled from "Re-assign". Operator can change the entity
 *     default without touching existing workers (and vice versa). This
 *     matches the Phase A migration where we wrote the entity field and
 *     ran the backfill as separate explicit steps.
 *   - Bulk action is double-confirmed; dry-run output is shown verbatim.
 *   - If `evereeTenantId` changes underneath us (operator switches entities,
 *     or re-points a tenant), we drop cached groups so the next "Load"
 *     re-fetches.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import RefreshIcon from '@mui/icons-material/Refresh';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import {
  evereeListApprovalGroups,
  evereeReassignAllWorkersToGroup,
  type EvereeApprovalGroupSummary,
  type EvereeReassignAllWorkersToGroupResult,
} from '../../services/everee/evereeCallables';

interface Props {
  tenantId: string;
  entityId: string;
  /** Live `evereeTenantId` from the entity doc — used as a cache key. */
  evereeTenantId: string;
  /** Current saved value; what the entity doc would echo if read right now. */
  value: string | null;
  /**
   * Pending value from the parent form. Distinct from `value` because the
   * parent edits the form locally and only writes on Save — we should
   * reflect the in-flight selection, not the persisted one.
   */
  pendingValue: string | null;
  onChange: (next: string | null) => void;
  /**
   * Disable interactive controls (e.g. while the parent's Save is in flight).
   * Does NOT affect the bulk re-assign dialog — that's an independent action.
   */
  disabled?: boolean;
}

const PLACEHOLDER_NONE = '__none__';

const EvereeApprovalGroupControl: React.FC<Props> = ({
  tenantId,
  entityId,
  evereeTenantId,
  value,
  pendingValue,
  onChange,
  disabled,
}) => {
  const [groups, setGroups] = useState<EvereeApprovalGroupSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState<string>('');

  // Bulk re-assign dialog state. We keep it self-contained — easier to
  // collapse the whole feature later if product decides per-location is
  // the only thing they want.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] =
    useState<EvereeReassignAllWorkersToGroupResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Drop cached groups when the underlying Everee tenant changes — the
  // catalog is per-tenant, not per-entity.
  useEffect(() => {
    setGroups(null);
    setLoadError(null);
  }, [evereeTenantId]);

  const handleLoad = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await evereeListApprovalGroups({ tenantId, entityId });
      const data = res.data;
      if (!data?.ok) {
        throw new Error('Empty response from evereeListApprovalGroups');
      }
      setGroups(data.groups);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg || 'Failed to load Everee approval groups');
    } finally {
      setLoading(false);
    }
  };

  const optionLabel = (g: EvereeApprovalGroupSummary) =>
    g.name ? `${g.name} (#${g.id})` : `#${g.id}`;

  // Selected value precedence: pendingValue (live form edits) wins. When the
  // group catalog has been loaded, we map the id → label; otherwise we just
  // show the id so the operator knows what's saved without needing to load.
  const effective = pendingValue ?? value ?? null;
  const matchedFromCatalog = useMemo(
    () => (effective && groups ? groups.find((g) => g.id === effective) : null),
    [effective, groups],
  );

  // Bulk re-assign uses the *currently saved* value (`value`), not the
  // pending edit, because the entity doc is what every newly-provisioned
  // worker reads from. If the operator wants to bulk-route to the pending
  // value, they should Save first.
  const bulkTargetGroup = value ?? null;

  const openBulk = async () => {
    setBulkOpen(true);
    setBulkResult(null);
    setBulkError(null);
    setBulkLoading(true);
    try {
      const res = await evereeReassignAllWorkersToGroup({
        tenantId,
        entityId,
        approvalGroupId: bulkTargetGroup,
        dryRun: true,
      });
      setBulkResult(res.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBulkError(msg || 'Dry-run failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const applyBulk = async () => {
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await evereeReassignAllWorkersToGroup({
        tenantId,
        entityId,
        approvalGroupId: bulkTargetGroup,
        dryRun: false,
      });
      setBulkResult(res.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBulkError(msg || 'Re-assignment failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const closeBulk = () => {
    if (bulkLoading) return;
    setBulkOpen(false);
    setBulkResult(null);
    setBulkError(null);
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <GroupsIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">Default approval group</Typography>
        {effective ? (
          <Chip
            size="small"
            label={
              matchedFromCatalog
                ? optionLabel(matchedFromCatalog)
                : `#${effective}`
            }
            color="primary"
            variant="outlined"
          />
        ) : (
          <Chip size="small" label="None" variant="outlined" />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Routes every newly-provisioned worker into this Everee approval
        group. Existing workers are unaffected — use “Re-assign all existing
        workers” below to backfill.
      </Typography>

      {groups === null ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={handleLoad}
            disabled={loading || disabled}
            startIcon={
              loading ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />
            }
          >
            {loading ? 'Loading…' : 'Load groups from Everee'}
          </Button>
          <TextField
            size="small"
            label="Or enter group id"
            value={manualEntry}
            onChange={(e) => setManualEntry(e.target.value)}
            onBlur={() => {
              const trimmed = manualEntry.trim();
              if (trimmed) onChange(trimmed);
            }}
            placeholder='e.g. "7900"'
            sx={{ minWidth: 180 }}
            disabled={disabled}
          />
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 280 }} disabled={disabled}>
            <InputLabel>Approval group</InputLabel>
            <Select
              label="Approval group"
              value={effective ?? PLACEHOLDER_NONE}
              onChange={(e) => {
                const v = e.target.value;
                onChange(v === PLACEHOLDER_NONE ? null : String(v));
              }}
            >
              <MenuItem value={PLACEHOLDER_NONE}>
                <em>None — workers stay unassigned</em>
              </MenuItem>
              {groups.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {optionLabel(g)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="text"
            size="small"
            onClick={handleLoad}
            disabled={loading || disabled}
            startIcon={
              loading ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />
            }
          >
            Refresh
          </Button>
        </Stack>
      )}

      {loadError ? (
        <Alert severity="error" variant="outlined">
          {loadError}
        </Alert>
      ) : null}

      <Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<GroupWorkIcon fontSize="small" />}
          onClick={openBulk}
          disabled={disabled}
        >
          Re-assign all existing workers to{' '}
          {bulkTargetGroup ? `#${bulkTargetGroup}` : '“None”'}
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 0.5 }}
        >
          Uses the saved value{value ? ` (#${value})` : ' (None)'} —{' '}
          {pendingValue !== undefined && pendingValue !== value
            ? 'save your changes first if you want to bulk-route to the new value.'
            : 'matches what new workers will get.'}
        </Typography>
      </Box>

      <Dialog open={bulkOpen} onClose={closeBulk} maxWidth="sm" fullWidth>
        <DialogTitle>Re-assign all existing workers</DialogTitle>
        <DialogContent>
          {bulkLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Talking to Everee…</Typography>
            </Stack>
          ) : null}
          {bulkError ? (
            <Alert severity="error" sx={{ my: 1 }}>
              {bulkError}
            </Alert>
          ) : null}
          {bulkResult ? (
            <>
              <DialogContentText component="div" sx={{ mb: 1 }}>
                <Typography variant="body2">
                  Target group:{' '}
                  <strong>{bulkResult.approvalGroupId ?? 'None (clear)'}</strong>
                </Typography>
                <Typography variant="body2">
                  Everee tenant: <strong>{bulkResult.evereeTenantId}</strong>
                </Typography>
                <Typography variant="body2">
                  Workers needing change: <strong>{bulkResult.candidates}</strong>
                </Typography>
                {!bulkResult.dryRun ? (
                  <>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Succeeded: <strong>{bulkResult.succeeded}</strong>
                    </Typography>
                    <Typography variant="body2">
                      Failed: <strong>{bulkResult.failed}</strong>
                    </Typography>
                  </>
                ) : null}
              </DialogContentText>
              {bulkResult.failures.length > 0 ? (
                <Alert severity="warning" sx={{ mt: 1 }} variant="outlined">
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    First failures (full list in function logs):
                  </Typography>
                  {bulkResult.failures.map((f) => (
                    <Typography
                      key={f.externalWorkerId}
                      variant="caption"
                      display="block"
                    >
                      • {f.externalWorkerId}
                      {f.userId ? ` (uid ${f.userId})` : ''}: {f.error}
                    </Typography>
                  ))}
                </Alert>
              ) : null}
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBulk} disabled={bulkLoading}>
            Close
          </Button>
          {bulkResult?.dryRun && bulkResult.candidates > 0 ? (
            <Button
              variant="contained"
              color="warning"
              onClick={applyBulk}
              disabled={bulkLoading}
            >
              Re-assign {bulkResult.candidates} workers
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EvereeApprovalGroupControl;
