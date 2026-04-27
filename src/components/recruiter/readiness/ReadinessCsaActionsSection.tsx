/**
 * **R.3** — `ReadinessCsaActionsSection` — recruiter-only section that lists
 * the eligible readiness items for a single assignment and exposes the
 * three R.3 callable actions (`confirmReadinessItem`, `waiveReadinessItem`,
 * `markReadinessItemFailed`) on each row.
 *
 * Scope choices for "minimal" R.3 surface:
 *   - **Per-assignment only** — we subscribe to `assignmentReadinessItems`
 *     filtered by `assignmentId`. Employee-scoped items live behind their
 *     dedicated dedicated tabs (Employment / Compliance) for now; cross-
 *     entity surfacing is R.8 territory.
 *   - **Excluded types are filtered out client-side** so the recruiter
 *     never sees a no-op menu item. The same list (`CSA_READINESS_ACTION_EXCLUDED_TYPES`)
 *     is enforced server-side — R.5 (E-Verify) and R.6 (AccuSource) own
 *     those flows via dedicated drawers.
 *   - **Permission gate is purely a soft hide** — the callables enforce
 *     admin / level-5 server-side; we hide the section entirely for
 *     non-admins so the affordance never flashes.
 *
 * Audit trail surfaces inline as a compact secondary line ("Last action:
 * <kind> by <uid> · <relative time> · <reason>") — full history view is
 * deferred to R.8's drill-in.
 *
 * @see functions/src/readiness/csaActions/applyCsaReadinessAction.ts (server pattern)
 * @see docs/READINESS_R3_HANDOFF.md
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../../firebase';
import {
  CSA_READINESS_ACTION_EXCLUDED_TYPES,
  isCsaReadinessActionExcludedType,
  type CsaReadinessActionInput,
  type CsaReadinessActionKind,
  type CsaReadinessActionResult,
  type CsaReadinessActionsFieldShape,
  type CsaReadinessHistoryEntryShape,
} from '../../../types/csaReadinessActionTypes';
import type {
  AssignmentReadinessItem,
  AssignmentReadinessItemStatus,
  AssignmentReadinessRequirementType,
} from '../../../types/assignmentReadinessItemV1';
import { jobReadinessChipLabelFor } from '../../../shared/jobReadinessChip/labels';

export interface ReadinessCsaActionsSectionProps {
  tenantId: string;
  assignmentId: string;
  /** Soft hide for non-admins. Server enforces the same gate. */
  canManage: boolean;
}

interface AssignmentItemRow extends AssignmentReadinessItem {
  /** Firestore doc id mirrored on the doc itself (same value). */
  id: string;
  csaActions?: CsaReadinessActionsFieldShape;
}

/**
 * Action menu config — one entry per kind. Keeps the row UI declarative and
 * pins the labels / mandatory-note flag in a single place.
 */
const ACTION_MENU: ReadonlyArray<{
  kind: CsaReadinessActionKind;
  label: string;
  description: string;
  noteRequired: boolean;
  destructive?: boolean;
}> = [
  {
    kind: 'csa_confirm',
    label: 'Confirm',
    description:
      'Mark this requirement complete. Use when you have verified the worker satisfies it (e.g. spoke with worker, sighted document).',
    noteRequired: false,
  },
  {
    kind: 'csa_waive',
    label: 'Waive',
    description:
      'Bypass this requirement for this assignment. A note explaining why is required and stored in the audit trail.',
    noteRequired: true,
  },
  {
    kind: 'csa_mark_failed',
    label: 'Mark failed',
    description:
      'Record a final failed verdict. Use when the worker cannot satisfy the requirement (e.g. refused to sign, missing license). A note is required.',
    noteRequired: true,
    destructive: true,
  },
];

const ACTION_LABEL_BY_KIND: Record<CsaReadinessActionKind, string> = {
  csa_confirm: 'Confirm',
  csa_waive: 'Waive',
  csa_mark_failed: 'Mark failed',
};

const STATUS_CHIP_COLOR: Partial<Record<AssignmentReadinessItemStatus, 'success' | 'error' | 'warning' | 'default' | 'info'>> = {
  complete_pass: 'success',
  complete: 'success',
  complete_fail: 'error',
  needs_review: 'warning',
  in_progress: 'info',
  expired: 'warning',
  blocked: 'error',
  not_applicable: 'default',
  incomplete: 'default',
};

const STATUS_CHIP_LABEL: Partial<Record<AssignmentReadinessItemStatus, string>> = {
  complete_pass: 'Complete',
  complete: 'Complete',
  complete_fail: 'Failed',
  needs_review: 'Needs review',
  in_progress: 'In progress',
  expired: 'Expired',
  blocked: 'Blocked',
  not_applicable: 'N/A',
  incomplete: 'Incomplete',
};

function statusChip(status: AssignmentReadinessItemStatus | string) {
  const label = STATUS_CHIP_LABEL[status as AssignmentReadinessItemStatus] ?? String(status);
  const color = STATUS_CHIP_COLOR[status as AssignmentReadinessItemStatus] ?? 'default';
  return <Chip size="small" label={label} color={color} sx={{ fontWeight: 600 }} />;
}

function rowLabel(row: AssignmentItemRow): string {
  const customKey =
    typeof row.requirementLabel === 'string' && row.requirementLabel.trim().length > 0
      ? row.requirementLabel.trim()
      : null;
  if (customKey) return customKey;
  return jobReadinessChipLabelFor('assignment', row.requirementType, row.requirementLabel ?? null);
}

function lastHistoryEntry(row: AssignmentItemRow): CsaReadinessHistoryEntryShape | null {
  const list = row.csaActions?.history;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[list.length - 1];
}

function formatHistoryTimestamp(at: unknown): string {
  if (at instanceof Timestamp) {
    return at.toDate().toLocaleString();
  }
  if (typeof at === 'string') {
    const d = new Date(at);
    if (!Number.isNaN(d.valueOf())) return d.toLocaleString();
    return at;
  }
  return '';
}

function lastActionBlurb(row: AssignmentItemRow): string | null {
  const entry = lastHistoryEntry(row);
  if (!entry) return null;
  const kindLabel = ACTION_LABEL_BY_KIND[entry.kind] ?? entry.kind;
  const ts = formatHistoryTimestamp(entry.at);
  const reason = entry.reason ? ` · ${entry.reason}` : '';
  const when = ts ? ` · ${ts}` : '';
  return `Last action: ${kindLabel} by ${entry.by}${when}${reason}`;
}

const ReadinessCsaActionsSection: React.FC<ReadinessCsaActionsSectionProps> = ({
  tenantId,
  assignmentId,
  canManage,
}) => {
  const [items, setItems] = useState<AssignmentItemRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; itemId: string } | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    item: AssignmentItemRow;
    kind: CsaReadinessActionKind;
    note: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Subscribe to `assignmentReadinessItems` for this assignment. We
   * filter excluded types client-side rather than via a Firestore
   * `not-in` query because `not-in` accepts at most 10 values and forces
   * a separate index — for an assignment-scoped read with single-digit
   * cardinality the in-memory filter is the better trade.
   */
  useEffect(() => {
    if (!tenantId || !assignmentId) {
      setItems([]);
      setLoaded(true);
      return undefined;
    }
    const q = query(
      collection(db, 'tenants', tenantId, 'assignmentReadinessItems'),
      where('assignmentId', '==', assignmentId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AssignmentItemRow[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as DocumentData;
          const requirementType = String(data.requirementType || '');
          if (isCsaReadinessActionExcludedType(requirementType)) return;
          rows.push({
            id: d.id,
            ...(data as AssignmentReadinessItem),
            csaActions: data.csaActions as CsaReadinessActionsFieldShape | undefined,
          });
        });
        rows.sort((a, b) => rowLabel(a).localeCompare(rowLabel(b)));
        setItems(rows);
        setLoaded(true);
      },
      (err) => {
        console.warn('ReadinessCsaActionsSection: listener failed', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      },
    );
    return unsub;
  }, [tenantId, assignmentId]);

  const handleOpenMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>, itemId: string) => {
      setMenuAnchor({ el: e.currentTarget, itemId });
    },
    [],
  );

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const handleSelectAction = useCallback(
    (kind: CsaReadinessActionKind) => {
      if (!menuAnchor) return;
      const item = items.find((it) => it.id === menuAnchor.itemId);
      setMenuAnchor(null);
      if (!item) return;
      setActionError(null);
      setActionDialog({ item, kind, note: '' });
    },
    [items, menuAnchor],
  );

  const handleCancelDialog = useCallback(() => {
    setActionDialog(null);
    setActionError(null);
  }, []);

  const handleSubmitDialog = useCallback(async () => {
    if (!actionDialog) return;
    const cfg = ACTION_MENU.find((m) => m.kind === actionDialog.kind);
    const note = actionDialog.note.trim();
    if (cfg?.noteRequired && note.length === 0) {
      setActionError('A note is required for this action.');
      return;
    }
    setActionError(null);
    setPendingItemId(actionDialog.item.id);
    try {
      const callableName: Record<CsaReadinessActionKind, string> = {
        csa_confirm: 'confirmReadinessItem',
        csa_waive: 'waiveReadinessItem',
        csa_mark_failed: 'markReadinessItemFailed',
      };
      const callable = httpsCallable<CsaReadinessActionInput, CsaReadinessActionResult>(
        functions,
        callableName[actionDialog.kind],
      );
      await callable({
        tenantId,
        itemId: actionDialog.item.id,
        collection: 'assignment',
        note: note.length > 0 ? note : null,
      });
      setActionDialog(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setActionError(message);
    } finally {
      setPendingItemId(null);
    }
  }, [actionDialog, tenantId]);

  const dialogConfig = useMemo(() => {
    if (!actionDialog) return null;
    return ACTION_MENU.find((m) => m.kind === actionDialog.kind) ?? null;
  }, [actionDialog]);

  if (!canManage) return null;
  if (!loaded) return null;
  if (items.length === 0) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>
            Recruiter actions
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Manually confirm, waive, or fail readiness items for this assignment. E-Verify and
            background-check items are managed via their dedicated drawers above.
          </Typography>
        </Box>
      </Stack>

      {error && (
        <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={0.5}>
        {items.map((row) => {
          const blurb = lastActionBlurb(row);
          const busy = pendingItemId === row.id;
          return (
            <Stack
              key={row.id}
              direction="row"
              alignItems="center"
              gap={1}
              sx={{
                py: 0.75,
                px: 1,
                borderRadius: 1,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={rowLabel(row)}>
                    {rowLabel(row)}
                  </Typography>
                  {statusChip(row.status)}
                  {row.severity ? (
                    <Tooltip title={row.severity === 'hard' ? 'Hard requirement — blocks job readiness when failing' : 'Soft requirement — informational, can be waived'}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={row.severity === 'hard' ? 'Hard' : 'Soft'}
                        sx={{ fontWeight: 500 }}
                      />
                    </Tooltip>
                  ) : null}
                  {row.resolutionMethod ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={row.resolutionMethod}
                      sx={{ fontWeight: 400, color: 'text.secondary' }}
                    />
                  ) : null}
                </Stack>
                {blurb ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    {blurb}
                  </Typography>
                ) : null}
              </Box>
              <IconButton
                size="small"
                onClick={(e) => handleOpenMenu(e, row.id)}
                aria-label={`Open recruiter actions for ${rowLabel(row)}`}
                disabled={busy}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        })}
      </Stack>

      <Menu
        anchorEl={menuAnchor?.el ?? null}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        {ACTION_MENU.map((cfg) => (
          <MenuItem
            key={cfg.kind}
            onClick={() => handleSelectAction(cfg.kind)}
            sx={{ color: cfg.destructive ? 'error.main' : undefined }}
          >
            {cfg.label}
          </MenuItem>
        ))}
      </Menu>

      <Dialog
        open={Boolean(actionDialog)}
        onClose={handleCancelDialog}
        fullWidth
        maxWidth="sm"
      >
        {actionDialog && dialogConfig ? (
          <>
            <DialogTitle sx={{ pb: 0 }}>
              {dialogConfig.label}: {rowLabel(actionDialog.item)}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {dialogConfig.description}
              </Typography>
              <TextField
                label={dialogConfig.noteRequired ? 'Note (required)' : 'Note (optional)'}
                fullWidth
                multiline
                minRows={3}
                value={actionDialog.note}
                onChange={(e) =>
                  setActionDialog((prev) => (prev ? { ...prev, note: e.target.value } : prev))
                }
                helperText={
                  dialogConfig.noteRequired
                    ? 'Stored in the audit trail. Be specific — future you will thank you.'
                    : 'Optional. Stored in the audit trail when supplied.'
                }
                error={Boolean(
                  actionError && dialogConfig.noteRequired && actionDialog.note.trim().length === 0,
                )}
                autoFocus
              />
              {actionError ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {actionError}
                </Alert>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCancelDialog}>Cancel</Button>
              <Button
                variant="contained"
                color={dialogConfig.destructive ? 'error' : 'primary'}
                onClick={handleSubmitDialog}
                disabled={pendingItemId === actionDialog.item.id}
              >
                {dialogConfig.label}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Box>
  );
};

/**
 * Re-exported for documentation / tests so consumers can verify which
 * requirement types this section refuses to render. Server-side gate is
 * the same constant: see `functions/src/readiness/csaActions/csaActionTypes.ts`.
 */
export const READINESS_CSA_SECTION_EXCLUDED_TYPES = CSA_READINESS_ACTION_EXCLUDED_TYPES;

export default ReadinessCsaActionsSection;

// Marker to keep the assignment requirement type symbols imported (used
// indirectly via casts) — tree-shake friendly.
export type _RowType = AssignmentReadinessRequirementType;
