/**
 * **R.16.1 Phase 8** — Dialog that shows the affected-JO list and
 * triggers `pushToActiveJobOrdersCallable` after the admin selects
 * rows + types a reason.
 *
 * Wire shape:
 *   1. Parent (`PushToActiveBanner` or any custom invoker) opens
 *      this dialog with `{ tenantId, accountId, fieldKey,
 *      positionId?, newValue, fieldLabel }`.
 *   2. On open we call `previewPushToActiveCallable`. The dialog
 *      blocks render (spinner) until the preview lands.
 *   3. The preview returns one row per JO under the account
 *      (excluding `draft` / `cancelled`). Rows with
 *      `wouldChange === true` are checked by default; ineligible
 *      rows (`no_snapshot`, `no_position`) are listed but
 *      checkbox-disabled with the reason inline.
 *   4. Admin types a non-empty reason (max 2000 chars) and clicks
 *      "Push". We call `pushToActiveJobOrdersCallable`. Server-side
 *      preview re-validation gates which selected JOs actually get
 *      written.
 *   5. Result page shows per-JO outcome (pushed / skipped + reason)
 *      + summary counts. Closing snaps back to the form.
 *
 * Audit + safety:
 *   - The reason string is mandatory and trimmed; the callable
 *     enforces 1–2000 chars server-side. The dialog mirrors that.
 *   - The dialog never builds the push from cached preview state
 *     alone — the callable always re-runs preview server-side and
 *     refuses to write JOs that don't appear in its own preview
 *     (`preview_excluded`). The UI still shows the full row list so
 *     the admin sees why something was skipped.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L9, §L10, Phase 8
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

// ─────────────────────────────────────────────────────────────────────
// Types — duplicated here to keep the component decoupled from the
// functions package (CRA bundle never imports compiled functions).
// Any drift is caught by the integration tests + the strong type
// shape on `httpsCallable`.
// ─────────────────────────────────────────────────────────────────────

export type PushFieldKey =
  | 'hiringEntityId'
  | 'eVerifyRequired'
  | 'workersCompCode'
  | 'screeningPackageId'
  | 'additionalScreenings'
  | 'jobTitle'
  | 'jobDescription'
  | 'rateMode'
  | 'payRate'
  | 'billRate'
  | 'futa'
  | 'suta'
  | 'workersCompRate'
  | 'markupPercentage'
  // R.16.2c additions — top-level snapshot-policy fields. Server-side
  // gate (`PUSH_TOP_LEVEL_FIELDS` in `functions/src/jobOrders/pushToActive.ts`)
  // mirrors this list; keep them in lockstep when adding new ones.
  | 'scheduler'
  | 'pricingFlatMarkupPercent'
  | 'physicalRequirements'
  | 'customUniformRequirements'
  | 'attachments';

type IneligibilityReason =
  | 'status_excluded'
  | 'no_snapshot'
  | 'no_position'
  // R.16.1.1 — snapshot value didn't match the prior Account-level
  // value, so the JO is most likely a child-level override (or
  // already-pushed). The dialog disables the row + explains.
  | 'previous_value_mismatch';

interface AffectedJoSummary {
  jobOrderId: string;
  status: string;
  currentValue: unknown;
  wouldChange: boolean;
  ineligibleReason?: IneligibilityReason;
}

interface PreviewPushReport {
  affectedJobOrders: AffectedJoSummary[];
  totals: {
    totalScanned: number;
    eligible: number;
    wouldChange: number;
    alreadyMatching: number;
    missingSnapshot: number;
    missingPosition: number;
    /** R.16.1.1 — Optional on legacy server builds. */
    previousValueMismatch?: number;
  };
}

interface PushPageReport {
  updatedCount: number;
  skippedCount: number;
  perJobOrder: Array<{
    jobOrderId: string;
    outcome:
      | 'pushed'
      | 'skipped_not_eligible'
      | 'skipped_no_change'
      | 'skipped_status_changed';
    skipReason?: string;
  }>;
  durationMs: number;
}

const MAX_REASON_LEN = 2000;

export interface PushToActiveDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  positionId: string | null;
  newValue: unknown;
  /**
   * **R.16.1.1** — The Account-level value before the user's edit.
   * When supplied, the server only treats a JO as eligible when its
   * snapshot matches `previousValue`, so a National Account push
   * doesn't silently overwrite child-level overrides.
   */
  previousValue?: unknown;
  fieldLabel: string;
}

function formatValue(v: unknown): string {
  if (v === null) return '—';
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length === 0 ? '(empty)' : v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ineligibilityCopy(reason: IneligibilityReason): string {
  switch (reason) {
    case 'no_snapshot':
      return 'No snapshot — run backfill first';
    case 'no_position':
      return 'Position not on this JO';
    case 'previous_value_mismatch':
      return 'Child override or already changed — push manually if intended';
    case 'status_excluded':
    default:
      return 'Status not eligible';
  }
}

export const PushToActiveDialog: React.FC<PushToActiveDialogProps> = ({
  open,
  onClose,
  tenantId,
  accountId,
  fieldKey,
  positionId,
  newValue,
  previousValue,
  fieldLabel,
}) => {
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPushReport | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<PushPageReport | null>(null);

  // Reset every time the dialog opens so a stale preview from a
  // prior open doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    setSelected({});
    setReason('');
    setResult(null);

    const run = async () => {
      try {
        const fn = httpsCallable<
          {
            tenantId: string;
            accountId: string;
            fieldKey: PushFieldKey;
            positionId: string | null;
            newValue: unknown;
            previousValue?: unknown;
          },
          PreviewPushReport
        >(functions, 'previewPushToActiveCallable');
        const res = await fn({
          tenantId,
          accountId,
          fieldKey,
          positionId,
          newValue,
          // R.16.1.1 — only forward when the parent supplied it,
          // so we don't change the wire shape for legacy callers.
          ...(previousValue !== undefined ? { previousValue } : {}),
        });
        setPreview(res.data);
        const initialSelection: Record<string, boolean> = {};
        for (const row of res.data.affectedJobOrders) {
          if (row.wouldChange) initialSelection[row.jobOrderId] = true;
        }
        setSelected(initialSelection);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [open, tenantId, accountId, fieldKey, positionId, newValue, previousValue]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  const trimmedReason = reason.trim();
  const reasonValid =
    trimmedReason.length > 0 && trimmedReason.length <= MAX_REASON_LEN;
  const canPush =
    !loading && !pushing && !result && selectedIds.length > 0 && reasonValid;

  const handlePush = async () => {
    if (!canPush) return;
    setPushing(true);
    setError(null);
    try {
      const fn = httpsCallable<
        {
          tenantId: string;
          accountId: string;
          fieldKey: PushFieldKey;
          positionId: string | null;
          newValue: unknown;
          previousValue?: unknown;
          selectedJoIds: string[];
          reason: string;
        },
        PushPageReport
      >(functions, 'pushToActiveJobOrdersCallable');
      const res = await fn({
        tenantId,
        accountId,
        fieldKey,
        positionId,
        newValue,
        ...(previousValue !== undefined ? { previousValue } : {}),
        selectedJoIds: selectedIds,
        reason: trimmedReason,
      });
      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const renderPreviewBody = () => {
    if (loading) {
      return (
        <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      );
    }
    if (!preview) return null;

    const rows = preview.affectedJobOrders;
    if (rows.length === 0) {
      return (
        <Alert severity="info">
          No active job orders are affected by this change.
        </Alert>
      );
    }

    return (
      <>
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Chip
            color="primary"
            label={`${preview.totals.wouldChange} would change`}
            size="small"
          />
          <Chip
            label={`${preview.totals.alreadyMatching} already match`}
            size="small"
          />
          {preview.totals.missingSnapshot > 0 && (
            <Chip
              color="warning"
              label={`${preview.totals.missingSnapshot} missing snapshot`}
              size="small"
            />
          )}
          {preview.totals.missingPosition > 0 && (
            <Chip
              color="warning"
              label={`${preview.totals.missingPosition} missing position`}
              size="small"
            />
          )}
          {(preview.totals.previousValueMismatch ?? 0) > 0 && (
            <Chip
              color="warning"
              label={`${preview.totals.previousValueMismatch} child override / already changed`}
              size="small"
            />
          )}
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Job Order</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Current</TableCell>
              <TableCell>New</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const disabled = !row.wouldChange;
              return (
                <TableRow key={row.jobOrderId} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      disabled={disabled || pushing || !!result}
                      checked={selected[row.jobOrderId] === true}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [row.jobOrderId]: e.target.checked,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {row.jobOrderId}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{formatValue(row.currentValue)}</TableCell>
                  <TableCell>{formatValue(newValue)}</TableCell>
                  <TableCell>
                    {row.ineligibleReason ? (
                      <Typography variant="caption" color="warning.main">
                        {ineligibilityCopy(row.ineligibleReason)}
                      </Typography>
                    ) : row.wouldChange ? (
                      <Typography variant="caption" color="primary">
                        Will update on push
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Already matches
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Select-all controls — handy when an Account has many JOs. */}
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                disabled={pushing || !!result}
                checked={
                  rows.filter((r) => r.wouldChange).every((r) => selected[r.jobOrderId])
                }
                onChange={(e) => {
                  const next = { ...selected };
                  for (const r of rows) {
                    if (r.wouldChange) next[r.jobOrderId] = e.target.checked;
                  }
                  setSelected(next);
                }}
              />
            }
            label="Select all eligible"
          />
        </Stack>
      </>
    );
  };

  const renderResultBody = () => {
    if (!result) return null;
    return (
      <>
        <Alert severity="success" sx={{ mb: 2 }}>
          Pushed {result.updatedCount} job order
          {result.updatedCount === 1 ? '' : 's'}; skipped {result.skippedCount}.
        </Alert>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Job Order</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.perJobOrder.map((row) => (
              <TableRow key={row.jobOrderId}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {row.jobOrderId}
                  </Typography>
                </TableCell>
                <TableCell>{row.outcome}</TableCell>
                <TableCell>{row.skipReason ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Push {fieldLabel} to active job orders</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          New value: <strong>{formatValue(newValue)}</strong>
          {positionId ? (
            <>
              {' '}
              for position <strong>{positionId}</strong>
            </>
          ) : null}
          .
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {result ? renderResultBody() : renderPreviewBody()}

        {!result && !loading && preview && (
          <TextField
            fullWidth
            multiline
            minRows={2}
            sx={{ mt: 2 }}
            label="Reason (required)"
            placeholder="Why are you pushing this update to active job orders?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            inputProps={{ maxLength: MAX_REASON_LEN }}
            helperText={`${trimmedReason.length}/${MAX_REASON_LEN} — 1 to ${MAX_REASON_LEN} characters; appears in the audit log.`}
            disabled={pushing}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pushing}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button
            onClick={handlePush}
            disabled={!canPush}
            variant="contained"
            startIcon={pushing ? <CircularProgress size={16} /> : undefined}
          >
            {pushing
              ? 'Pushing…'
              : `Push to ${selectedIds.length} job order${
                  selectedIds.length === 1 ? '' : 's'
                }`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PushToActiveDialog;
