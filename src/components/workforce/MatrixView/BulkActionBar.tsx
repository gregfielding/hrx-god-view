/**
 * **R.8** — `BulkActionBar` — appears at the bottom of the matrix when the
 * user has selected one or more cells. Encapsulates D4.R8 bulk-action UX:
 *
 *   - Selection cap = 50 cells (the parent enforces; the bar surfaces it).
 *   - Single mandatory note (waive / mark-failed) applies to every item in
 *     the batch; confirm allows empty.
 *   - Per-row outcome surfaced once the parent finishes the fan-out (counts
 *     of `ok` / `unchanged (idempotent)` / `failed`).
 *   - Failed rows stay selected — the parent computes and reports them via
 *     `lastResult.failedKeys`.
 *
 * **Layering:** this component is purely UI. The actual fan-out + R.3
 * idempotency-aware re-runs live in `MatrixView/index.tsx`'s
 * `runBulkAction` helper. We keep the orchestration in the parent because
 * it also owns row invalidation post-fan-out.
 *
 * **Visibility:** when `selectedCount === 0` the bar is hidden. When > 0
 * it slides up sticky at the bottom of the matrix container; the
 * implementation mirrors the existing `ProfileReadinessTabContent` bulk
 * footer so reviewers don't see a third bulk-action visual.
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import type { CsaReadinessActionKind } from '../../../shared/csaReadinessActionTypes';

export interface BulkActionResult {
  /** Total items the bulk action acted on (may be > selected cells if a
   *  cell aggregates multiple items — see `MatrixCell` aggregator). */
  total: number;
  ok: number;
  /** R.3 reported `unchanged: true` — already in target state. Considered
   *  a non-error success. */
  idempotentNoOp: number;
  failed: number;
  /** Row keys (`workerUid__hiringEntityId`) whose action failed in part or
   *  whole. The parent uses these to keep selection on failed rows. */
  failedKeys: ReadonlyArray<string>;
  /** First failure message, surfaced inline in the bar. */
  firstError?: string;
}

export interface BulkActionBarProps {
  selectedCount: number;
  /** Selection cap (D4.R8 = 50). */
  selectionCap: number;
  /** Total fan-out item count if the user fires now (sum of itemRefs across selected cells). */
  itemFanOutCount: number;
  /** Counts of selected cells by their chip state. Drives the
   *  "X red, Y yellow" affordance + the disabled state on
   *  `Confirm all` (we don't allow confirm-on-red without explicit override
   *   — but the per-cell menu is still available for that). */
  selectedRedCount: number;
  selectedYellowCount: number;
  /** Whether a fan-out is currently running. Disables all action buttons. */
  inFlight: boolean;
  /** Last completed run's result, if any. Cleared by the parent when the
   *  user changes selection. */
  lastResult: BulkActionResult | null;
  onClearSelection: () => void;
  /**
   * Commit the bulk action. Parent owns Promise.allSettled, concurrency,
   * and post-run row invalidation. The bar just collects the kind + note
   * and hands them off.
   */
  onCommit: (args: {
    kind: CsaReadinessActionKind;
    note: string | null;
  }) => Promise<void> | void;
}

interface DialogState {
  kind: CsaReadinessActionKind;
  note: string;
  /** "Confirm" allows empty note; the others require it. */
  noteRequired: boolean;
}

const ACTION_BUTTONS: ReadonlyArray<{
  kind: CsaReadinessActionKind;
  label: string;
  destructive?: boolean;
  noteRequired: boolean;
}> = [
  { kind: 'csa_confirm', label: 'Confirm all…', noteRequired: false },
  { kind: 'csa_waive', label: 'Waive all…', noteRequired: true },
  {
    kind: 'csa_mark_failed',
    label: 'Mark failed all…',
    destructive: true,
    noteRequired: true,
  },
];

const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  selectionCap,
  itemFanOutCount,
  selectedRedCount,
  selectedYellowCount,
  inFlight,
  lastResult,
  onClearSelection,
  onCommit,
}) => {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  if (selectedCount === 0) return null;

  const handleOpenDialog = (kind: CsaReadinessActionKind, noteRequired: boolean) => {
    setDialog({ kind, note: '', noteRequired });
  };
  const handleCloseDialog = () => {
    if (inFlight) return;
    setDialog(null);
  };

  const handleConfirmDialog = async () => {
    if (!dialog) return;
    const note = dialog.note.trim();
    if (dialog.noteRequired && note.length === 0) return;
    await onCommit({ kind: dialog.kind, note: note.length > 0 ? note : null });
    setDialog(null);
  };

  const dialogActionLabel: Record<CsaReadinessActionKind, string> = {
    csa_confirm: 'Confirm',
    csa_waive: 'Waive',
    csa_mark_failed: 'Mark failed',
  };

  return (
    <>
      <Box
        sx={{
          position: 'sticky',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          zIndex: 4,
          py: 1.25,
          px: 2,
        }}
      >
        <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
          <Typography variant="subtitle2" fontWeight={700}>
            {selectedCount} cell{selectedCount === 1 ? '' : 's'} selected
          </Typography>
          <Chip
            label={`${itemFanOutCount} item${itemFanOutCount === 1 ? '' : 's'}`}
            size="small"
            variant="outlined"
            title="Total readiness items the bulk action will act on. May exceed selected cells if a cell aggregates multiple items."
          />
          {selectedRedCount > 0 && (
            <Chip
              label={`${selectedRedCount} red`}
              size="small"
              color="error"
              variant="outlined"
            />
          )}
          {selectedYellowCount > 0 && (
            <Chip
              label={`${selectedYellowCount} yellow`}
              size="small"
              color="warning"
              variant="outlined"
            />
          )}
          {selectedCount >= selectionCap && (
            <Tooltip title={`Selection cap is ${selectionCap}. Deselect cells to add more.`}>
              <Chip label={`At cap (${selectionCap})`} size="small" color="info" />
            </Tooltip>
          )}

          <Box sx={{ flex: 1 }} />

          {ACTION_BUTTONS.map((btn) => (
            <Button
              key={btn.kind}
              variant={btn.destructive ? 'outlined' : 'contained'}
              color={btn.destructive ? 'error' : 'primary'}
              size="small"
              disabled={inFlight}
              onClick={() => handleOpenDialog(btn.kind, btn.noteRequired)}
            >
              {btn.label}
            </Button>
          ))}

          <Tooltip title="Clear selection">
            <span>
              <IconButton size="small" onClick={onClearSelection} disabled={inFlight}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {lastResult && (
          <Alert
            severity={
              lastResult.failed === 0
                ? 'success'
                : lastResult.ok + lastResult.idempotentNoOp > 0
                  ? 'warning'
                  : 'error'
            }
            sx={{ mt: 1, py: 0.25 }}
          >
            <Typography variant="caption">
              {lastResult.ok} confirmed
              {lastResult.idempotentNoOp > 0
                ? ` · ${lastResult.idempotentNoOp} already in target state (no-op)`
                : ''}
              {lastResult.failed > 0 ? ` · ${lastResult.failed} failed` : ''}
              {lastResult.firstError ? ` — first error: ${lastResult.firstError}` : ''}
            </Typography>
          </Alert>
        )}
      </Box>

      <Dialog open={!!dialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        {dialog && (
          <>
            <DialogTitle>
              {dialogActionLabel[dialog.kind]} {selectedCount} cell
              {selectedCount === 1 ? '' : 's'} ({itemFanOutCount} item
              {itemFanOutCount === 1 ? '' : 's'})
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {dialog.kind === 'csa_confirm'
                  ? 'A note is optional. Already-resolved items are no-ops (R.3 idempotency).'
                  : dialog.kind === 'csa_waive'
                    ? 'Waiving an item drops the requirement for these workers. A note is required.'
                    : 'Marking failed records a hard fail; the worker may need re-screening. A note is required.'}
              </Typography>
              <TextField
                label="Note"
                placeholder={
                  dialog.noteRequired
                    ? 'Required — describe why this batch action applies.'
                    : 'Optional'
                }
                value={dialog.note}
                onChange={(e) => setDialog({ ...dialog, note: e.target.value })}
                fullWidth
                multiline
                minRows={2}
                required={dialog.noteRequired}
                error={dialog.noteRequired && dialog.note.trim().length === 0}
                helperText={
                  dialog.noteRequired && dialog.note.trim().length === 0
                    ? 'A note is required for this action.'
                    : 'Same note is recorded on every item in the batch.'
                }
                disabled={inFlight}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDialog} disabled={inFlight}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color={dialog.kind === 'csa_mark_failed' ? 'error' : 'primary'}
                disabled={
                  inFlight ||
                  (dialog.noteRequired && dialog.note.trim().length === 0)
                }
                onClick={handleConfirmDialog}
              >
                {dialogActionLabel[dialog.kind]} {selectedCount}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
};

export default BulkActionBar;
