/**
 * Vendor-style line-item table for AccuSource screenings (User → Backgrounds).
 * Reads `providerServiceOrderStatus` + catalog; extended fields come from webhooks (see
 * `functions/.../accusourceWebhookServiceLine.ts`).
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { SystemStyleObject } from '@mui/system';
import type { Theme } from '@mui/material/styles';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RestoreIcon from '@mui/icons-material/Restore';
import { Timestamp } from 'firebase/firestore';
import type {
  AccusourceLineVerdict,
  AccusourceManualVerdict,
  BackgroundCheckRecord,
} from '../../../types/backgroundCheck';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import { accusourceScreeningLineItems } from '../../../utils/accusourceScreeningLineItems';
import { decisionChipColor } from '../../../utils/accusourceDecisionChip';

function formatTs(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

function formatPrice(line: AccusourceScreeningLineItem): string {
  if (line.providerPriceFormatted != null && String(line.providerPriceFormatted).trim() !== '') {
    return String(line.providerPriceFormatted).trim();
  }
  if (line.providerPrice != null && Number.isFinite(line.providerPrice)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(line.providerPrice);
  }
  return '—';
}

type LineTimestampKey =
  | 'orderedAt'
  | 'submittedAt'
  | 'startedAt'
  | 'completedAt'
  | 'receivedAt'
  | 'reviewedAt'
  | 'providerReportedAt'
  | 'updatedAt';

const STAGE_LABELS: Array<{ key: LineTimestampKey; label: string }> = [
  { key: 'orderedAt', label: 'Ordered' },
  { key: 'submittedAt', label: 'Submitted' },
  { key: 'startedAt', label: 'Started' },
  { key: 'completedAt', label: 'Completed' },
  { key: 'receivedAt', label: 'Received' },
  { key: 'reviewedAt', label: 'Review' },
  { key: 'providerReportedAt', label: 'Vendor updated' },
  { key: 'updatedAt', label: 'Line updated' },
];

function LifecycleTimestamps({ line }: { line: AccusourceScreeningLineItem }) {
  // When `completedAt` is derived from `updatedAt` (vendor didn't send `completion_date`), hide the
  // generic "Line updated" row so we don't double-print the same timestamp.
  const suppressUpdated = line.completedAtDerived === true;
  const rows = STAGE_LABELS.map(({ key, label }) => {
    if (suppressUpdated && key === 'updatedAt') return null;
    const raw = line[key];
    const text = formatTs(raw);
    if (text === '—') return null;
    const derivedSuffix =
      (key === 'orderedAt' && line.orderedAtDerived) ||
      (key === 'completedAt' && line.completedAtDerived)
        ? ' *'
        : '';
    return (
      <Typography key={String(key)} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
        <strong>{label}:</strong> {text}
        {derivedSuffix}
      </Typography>
    );
  }).filter(Boolean);

  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Box sx={{ maxWidth: 280 }}>
      {rows}
      {(line.orderedAtDerived || line.completedAtDerived) && (
        <Typography variant="caption" color="text.disabled" display="block" sx={{ fontStyle: 'italic', mt: 0.25 }}>
          * inferred — vendor didn’t send this stage
        </Typography>
      )}
    </Box>
  );
}

/** Approximate AccuSource dashboard badge colors (Completed / In Progress / In Review). */
function statusChipColor(status: string): 'success' | 'primary' | 'warning' | 'default' {
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('closed') || s === 'pass' || s.includes('clear')) return 'success';
  if (s.includes('review') || s.includes('pending review') || s.includes('adjudicat')) return 'warning';
  if (s.includes('progress') || s.includes('pending') || s.includes('submitted') || s.includes('ordered')) return 'primary';
  return 'default';
}

const ASSIGN_HINT =
  'When AccuSource sends assignment / researcher name on the webhook, it appears here; otherwise manage in the vendor dashboard.';

/** Keeps verdict + actions visible when the table is wider than the viewport (horizontal scroll). */
function verdictColumnStickySx(theme: Theme): SystemStyleObject<Theme> {
  return {
    position: 'sticky',
    right: 0,
    zIndex: 3,
    minWidth: 132,
    bgcolor: theme.palette.background.paper,
    boxShadow: '-8px 0 12px -8px rgba(0, 0, 0, 0.15)',
  };
}

function verdictHeaderStickySx(theme: Theme): SystemStyleObject<Theme> {
  return {
    ...verdictColumnStickySx(theme),
    zIndex: 4,
  };
}

export interface AccusourceOrderServiceLinesTableProps {
  record: BackgroundCheckRecord;
  /**
   * Fires the parent's existing `getAccusourceBackgroundCheckPdf` callable for this record's final
   * report. When provided, completed lines without their own `reportUrl` fall back to this action
   * so the line-level Report cell isn't stuck on "—" while the parent row shows "Final PDF".
   */
  onOpenFinalPdf?: (backgroundCheckId: string) => void;
  /** Passed through from parent so the line-level button disables during an in-flight PDF open. */
  pdfLoading?: string | null;
  /** Whether the viewer can invoke the PDF callable (server-side also enforces). */
  canAccusourceAdmin?: boolean;
  /**
   * Fires the `setAccusourceLineAdjudication` callable. Parent owns the loading + snackbar state
   * so multiple tables / pages can share one callable instance. When omitted, the Verdict column
   * renders read-only chips.
   */
  onSetAdjudication?: (
    backgroundCheckId: string,
    serviceKey: string,
    verdict: AccusourceManualVerdict,
    reason: string | null,
  ) => Promise<void> | void;
  /** Keyed by `${backgroundCheckId}::${serviceKey}` — disables the verdict menu during an in-flight call. */
  adjudicationLoadingKey?: string | null;
}

/** Chip color for the verdict pill. Keeps PASSED/FAILED loud and NEEDS_REVIEW amber. */
function verdictChipColor(v: AccusourceLineVerdict): 'success' | 'error' | 'warning' | 'default' {
  if (v === 'PASSED') return 'success';
  if (v === 'FAILED') return 'error';
  if (v === 'NEEDS_REVIEW') return 'warning';
  return 'default';
}

function verdictChipLabel(v: AccusourceLineVerdict): string {
  if (v === 'PASSED') return 'Passed';
  if (v === 'FAILED') return 'Failed';
  if (v === 'NEEDS_REVIEW') return 'Needs review';
  return 'Waiting';
}

function lineStatusLooksComplete(status: string | null | undefined): boolean {
  if (status == null) return false;
  const s = String(status).toLowerCase();
  return s.includes('complete') || s.includes('closed') || s === 'pass' || s.includes('clear');
}

/**
 * Pick the most specific label for the "Scope" column. Per-county criminal
 * rows get a jurisdiction string; drug-screen rows get their lab info; the
 * generic fallback is the hiring entity name. Having every row just repeat
 * "C1 Select LLC" was useless for adjudication — the scope is the thing the
 * recruiter needs to see.
 */
function scopeLabelForLine(
  line: AccusourceScreeningLineItem,
  clientLabelFallback: string,
): string {
  const juris = line.jurisdiction != null ? String(line.jurisdiction).trim() : '';
  if (juris) return juris;

  const labName = line.labName != null ? String(line.labName).trim() : '';
  const labCode = line.labCode != null ? String(line.labCode).trim() : '';
  if (labName && labCode) return `${labName} · ${labCode}`;
  if (labName) return labName;
  if (labCode) return `Lab ${labCode}`;

  return clientLabelFallback;
}

function lineHasPrice(line: AccusourceScreeningLineItem): boolean {
  if (line.providerPrice != null && Number.isFinite(line.providerPrice)) return true;
  if (line.providerPriceFormatted != null && String(line.providerPriceFormatted).trim() !== '') return true;
  return false;
}

const AccusourceOrderServiceLinesTable: React.FC<AccusourceOrderServiceLinesTableProps> = ({
  record,
  onOpenFinalPdf,
  pdfLoading,
  canAccusourceAdmin,
  onSetAdjudication,
  adjudicationLoadingKey,
}) => {
  const lines = useMemo(() => accusourceScreeningLineItems(record), [record]);
  const showCostColumn = useMemo(() => lines.some(lineHasPrice), [lines]);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuLineId, setMenuLineId] = useState<string | null>(null);
  const [overrideLine, setOverrideLine] = useState<AccusourceScreeningLineItem | null>(null);
  const [overrideVerdict, setOverrideVerdict] = useState<AccusourceManualVerdict>(null);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [submittingOverride, setSubmittingOverride] = useState(false);
  // Local error so the recruiter sees *something* if the callable fails. The parent
  // also surfaces an error snackbar, but it lives inside another (often closed)
  // modal — so without this the dialog just sits there with no feedback.
  const [overrideError, setOverrideError] = useState<string | null>(null);
  // Per-line detail drawer — opens when a line needs review but has no
  // clickable report URL and the parent final PDF isn't ready yet. Shows
  // every field AccuSource sent us so the recruiter has something to
  // adjudicate against.
  const [detailLine, setDetailLine] = useState<AccusourceScreeningLineItem | null>(null);

  const canOverride = !!onSetAdjudication && canAccusourceAdmin !== false;

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, lineId: string) => {
    setMenuAnchor(event.currentTarget);
    setMenuLineId(lineId);
  };
  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuLineId(null);
  };

  const beginOverride = (line: AccusourceScreeningLineItem, verdict: NonNullable<AccusourceManualVerdict>) => {
    handleMenuClose();
    setOverrideLine(line);
    setOverrideVerdict(verdict);
    setOverrideReason(line.adjudication?.overrideReason ?? '');
    setOverrideError(null);
  };

  const beginClearOverride = async (line: AccusourceScreeningLineItem) => {
    handleMenuClose();
    if (!onSetAdjudication) return;
    try {
      await onSetAdjudication(record.id, line.id, null, null);
    } catch {
      // Parent surfaces the error; we keep the menu closed.
    }
  };

  const closeOverrideDialog = () => {
    if (submittingOverride) return;
    setOverrideLine(null);
    setOverrideVerdict(null);
    setOverrideReason('');
    setOverrideError(null);
  };

  const submitOverride = async () => {
    if (!overrideLine || !overrideVerdict || !onSetAdjudication) return;
    setSubmittingOverride(true);
    setOverrideError(null);
    try {
      await onSetAdjudication(
        record.id,
        overrideLine.id,
        overrideVerdict,
        overrideReason.trim() !== '' ? overrideReason.trim() : null,
      );
      setOverrideLine(null);
      setOverrideVerdict(null);
      setOverrideReason('');
    } catch (err) {
      // Show the failure right inside the dialog. The parent's snackbar lives
      // inside another (usually closed) modal so without this the user sees
      // "nothing happens".
      const message =
        err instanceof Error && err.message ? err.message : 'Failed to save override.';
      setOverrideError(message);
    } finally {
      setSubmittingOverride(false);
    }
  };

  const menuLine = menuLineId ? lines.find((l) => l.id === menuLineId) ?? null : null;

  const orderRef =
    record.providerProfileNumber?.trim() ||
    (record.providerProfileId != null && String(record.providerProfileId).trim() !== ''
      ? String(record.providerProfileId)
      : '—');

  const clientLabel = record.accountName?.trim() || '—';
  const subjectLabel = record.candidateName?.trim() || '—';
  const orderedAtFallback = formatTs(record.createdAt);

  if (lines.length === 0) {
    return (
      <Box sx={{ py: 1.25, px: 0.5 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          AccuSource service lines
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No ordered screens yet (package services will appear after the order is created and catalog ids are stored).
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 1, px: { xs: 0, sm: 0.5 } }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, lineHeight: 1.45 }}>
        AccuSource service lines — same ordered components as the vendor order. Extra columns populate when SourceDirect
        includes them on webhooks (field names are normalized server-side).
      </Typography>
      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 960 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Order #</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Service</TableCell>
              {showCostColumn && (
                <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Cost</TableCell>
              )}
              {/* Scope + Subject columns hidden per product feedback — they were
                  mostly redundant (Scope repeated the hiring entity for most rows,
                  Subject repeated the worker name shown in the page header). Both
                  are still visible inside the per-line Details drawer when a
                  recruiter needs them. Left the <TableCell> stubs removed so
                  downstream row widths auto-collapse. */}
              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Order placed (HRX)</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Lifecycle timestamps</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Jurisdiction</TableCell>
              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Component ID</TableCell>
              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                <Tooltip title={ASSIGN_HINT}>
                  <span>Assignment</span>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Report</TableCell>
              {/* Decision column hidden — it's the vendor's raw disposition string and is empty
                  on the majority of screenings (SSN Locator, most county criminals, in-progress
                  rows). The Verdict column already incorporates it as an input. Still visible
                  in the per-line Details drawer for audit. */}
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={(theme) => ({ fontWeight: 700, whiteSpace: 'nowrap', ...verdictHeaderStickySx(theme) })}>
                <Tooltip title="System verdict (auto). Recruiters L5–L7 can override and revert.">
                  <span>Verdict</span>
                </Tooltip>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                  {/* Prefer the per-line vendor order id (e.g. AU-xxxx / DR-xxxx / CR-xxxx) so
                      each row matches what AccuSource's portal shows; fall back to the parent
                      profile number when the webhook didn't include a per-line id. */}
                  <Typography variant="body2" component="span">
                    {line.providerOrderId != null &&
                    String(line.providerOrderId).trim() !== ''
                      ? String(line.providerOrderId)
                      : orderRef}
                  </Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', maxWidth: 220 }}>
                  <Typography variant="body2" fontWeight={500}>
                    {line.name}
                  </Typography>
                  {line.type ? (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {line.type}
                    </Typography>
                  ) : null}
                </TableCell>
                {showCostColumn && (
                  <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <Typography variant="body2">{formatPrice(line)}</Typography>
                  </TableCell>
                )}
                {/* Scope + Subject cells removed to match the header — available in the Details drawer. */}
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    {orderedAtFallback}
                  </Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <LifecycleTimestamps line={line} />
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', maxWidth: 200 }}>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {line.jurisdiction != null && String(line.jurisdiction).trim() !== '' ? line.jurisdiction : '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}>
                  {line.id}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', maxWidth: 140 }}>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {line.assignmentLabel != null && String(line.assignmentLabel).trim() !== ''
                      ? line.assignmentLabel
                      : '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {(() => {
                    const lineReportUrl =
                      line.reportUrl != null ? String(line.reportUrl).trim() : '';
                    if (lineReportUrl !== '') {
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          component="a"
                          href={lineReportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open report
                        </Button>
                      );
                    }
                    // Fallback: when this line is completed and the parent has a final report ready,
                    // reuse the parent-level PDF callable so the column isn't stuck on "—".
                    const fire = onOpenFinalPdf;
                    const canFallback =
                      fire != null &&
                      !!record.finalReportReady &&
                      lineStatusLooksComplete(line.status);
                    if (canFallback && fire != null) {
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!!pdfLoading || canAccusourceAdmin === false}
                          onClick={() => fire(record.id)}
                        >
                          Final PDF
                        </Button>
                      );
                    }
                    // No per-line reportUrl AND no final PDF — still give recruiters
                    // SOMETHING to look at when a verdict of "Needs review" lands. The
                    // drawer surfaces every field we persisted from the vendor so they
                    // can adjudicate without blind-guessing Pass / Fail.
                    const needsReview = line.verdict === 'NEEDS_REVIEW' || lineStatusLooksComplete(line.status);
                    if (needsReview) {
                      return (
                        <Button size="small" variant="text" onClick={() => setDetailLine(line)}>
                          Details
                        </Button>
                      );
                    }
                    return (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    );
                  })()}
                </TableCell>
                {/* Decision cell removed to match header — value still shown in Details drawer. */}
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <Chip
                    size="small"
                    label={line.status}
                    color={statusChipColor(line.status)}
                    variant={line.status === 'Pending' ? 'outlined' : 'filled'}
                    sx={{ fontWeight: 600 }}
                  />
                </TableCell>
                <TableCell sx={(theme) => ({ verticalAlign: 'top', whiteSpace: 'nowrap', ...verdictColumnStickySx(theme) })}>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
                    <Tooltip
                      title={
                        line.verdictOverridden
                          ? `Manual override${
                              line.adjudication?.overrideReason
                                ? ` — ${line.adjudication.overrideReason}`
                                : ''
                            }. Auto verdict was ${line.adjudication?.autoVerdict ?? 'PENDING'}.`
                          : line.adjudication?.autoVerdictReason || 'System verdict from status + decision'
                      }
                    >
                      <Chip
                        size="small"
                        label={verdictChipLabel(line.verdict)}
                        color={verdictChipColor(line.verdict)}
                        variant={line.verdictOverridden ? 'filled' : 'outlined'}
                        sx={{ fontWeight: 600, flexShrink: 0 }}
                      />
                    </Tooltip>
                    {canOverride && (
                      <IconButton
                        size="small"
                        aria-label={`Override verdict for ${line.name}`}
                        onClick={(e) => handleMenuOpen(e, line.id)}
                        disabled={adjudicationLoadingKey === `${record.id}::${line.id}`}
                        sx={{ flexShrink: 0 }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != null && menuLine != null}
        onClose={handleMenuClose}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {menuLine && (
          <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Override verdict for
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
              {menuLine.name}
            </Typography>
          </Box>
        )}
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'PASSED'}
          onClick={() => menuLine && beginOverride(menuLine, 'PASSED')}
        >
          Mark as Passed
        </MenuItem>
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'FAILED'}
          onClick={() => menuLine && beginOverride(menuLine, 'FAILED')}
        >
          Mark as Failed
        </MenuItem>
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'NEEDS_REVIEW'}
          onClick={() => menuLine && beginOverride(menuLine, 'NEEDS_REVIEW')}
        >
          Flag as Needs review
        </MenuItem>
        {menuLine?.verdictOverridden && (
          <MenuItem onClick={() => menuLine && beginClearOverride(menuLine)}>
            <RestoreIcon fontSize="small" sx={{ mr: 1 }} />
            Revert to system verdict
            {menuLine.adjudication?.autoVerdict
              ? ` (${verdictChipLabel(menuLine.adjudication.autoVerdict)})`
              : ''}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={overrideLine != null} onClose={closeOverrideDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {overrideVerdict === 'PASSED' && 'Mark as Passed'}
          {overrideVerdict === 'FAILED' && 'Mark as Failed'}
          {overrideVerdict === 'NEEDS_REVIEW' && 'Flag as Needs review'}
        </DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1.5 }}>
            {overrideLine?.name}
            {overrideLine?.adjudication?.autoVerdict &&
              ` — system verdict is ${verdictChipLabel(overrideLine.adjudication.autoVerdict)}.`}
          </DialogContentText>
          <TextField
            label="Reason (optional)"
            placeholder="Why are you overriding this verdict?"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            autoFocus
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            This override is reversible — any recruiter with the same access can later revert to the
            system verdict.
          </Typography>
          {overrideError && (
            <Alert
              severity="error"
              onClose={() => setOverrideError(null)}
              sx={{ mt: 2 }}
            >
              {overrideError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeOverrideDialog} disabled={submittingOverride}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitOverride}
            disabled={submittingOverride || overrideVerdict == null}
          >
            {submittingOverride ? 'Saving…' : 'Save override'}
          </Button>
        </DialogActions>
      </Dialog>

      {/*
        Per-line detail drawer. Dumb, thorough view of every field we persisted
        from the vendor webhook so a recruiter with "Needs review" has something
        to adjudicate against. Not an attempt to replace the final report PDF —
        just an always-available fallback.
      */}
      <Drawer
        anchor="right"
        open={!!detailLine}
        onClose={() => setDetailLine(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 520 } } }}
      >
        {detailLine && (
          <Box sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight={700}>
                Line detail
              </Typography>
              <IconButton size="small" onClick={() => setDetailLine(null)} aria-label="Close">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="subtitle1" fontWeight={600}>
              {detailLine.name}
            </Typography>
            {detailLine.type && (
              <Typography variant="caption" color="text.secondary" display="block">
                {detailLine.type}
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />
            <Stack spacing={1.25}>
              {renderDetailField('Order line id', detailLine.id)}
              {renderDetailField('Provider order id', detailLine.providerOrderId)}
              {renderDetailField('Status', detailLine.status)}
              {renderDetailField('Verdict', verdictChipLabel(detailLine.verdict))}
              {renderDetailField('Decision', detailLine.decision)}
              {renderDetailField('Scope', scopeLabelForLine(detailLine, clientLabel))}
              {renderDetailField('Jurisdiction', detailLine.jurisdiction)}
              {renderDetailField('Lab name', detailLine.labName)}
              {renderDetailField(
                'Lab code',
                detailLine.labCode != null ? String(detailLine.labCode) : null,
              )}
              {renderDetailField('Subject', subjectLabel)}
              {renderDetailField('Assignment label', detailLine.assignmentLabel)}
              {renderDetailField(
                'Ordered at',
                detailLine.orderedAt ? formatTimestamp(detailLine.orderedAt) : null,
              )}
              {renderDetailField(
                'Updated at',
                detailLine.updatedAt ? formatTimestamp(detailLine.updatedAt) : null,
              )}
              {renderDetailField(
                'Completed at',
                detailLine.completedAt ? formatTimestamp(detailLine.completedAt) : null,
              )}
              {renderDetailField(
                'Provider reported at',
                detailLine.providerReportedAt ? formatTimestamp(detailLine.providerReportedAt) : null,
              )}
              {renderDetailField(
                'Report URL',
                detailLine.reportUrl ? String(detailLine.reportUrl) : null,
                { isLink: true },
              )}
              {detailLine.adjudication?.autoVerdictReason && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  {renderDetailField(
                    'Auto verdict reason',
                    detailLine.adjudication.autoVerdictReason,
                  )}
                </>
              )}
              {detailLine.adjudication?.overrideReason && (
                renderDetailField(
                  'Override reason',
                  detailLine.adjudication.overrideReason,
                )
              )}
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              If the vendor's final report PDF is required to adjudicate, it becomes available once
              every line on this order is complete. Until then, adjudicate from the fields above or
              request the vendor push the per-line report URL.
            </Typography>
          </Box>
        )}
      </Drawer>
    </Box>
  );
};

/** Small key-value renderer for the detail drawer. Optionally renders value as a link. */
function renderDetailField(
  label: string,
  value: string | number | null | undefined,
  opts?: { isLink?: boolean },
): React.ReactNode {
  const v = value != null && String(value).trim() !== '' ? String(value).trim() : null;
  return (
    <Box key={label}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      {v == null ? (
        <Typography variant="body2" color="text.disabled">
          —
        </Typography>
      ) : opts?.isLink ? (
        <Button
          size="small"
          variant="text"
          component="a"
          href={v}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ textTransform: 'none', p: 0, minWidth: 'auto', justifyContent: 'flex-start' }}
        >
          {v.length > 64 ? `${v.slice(0, 64)}…` : v}
        </Button>
      ) : (
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
          {v}
        </Typography>
      )}
    </Box>
  );
}

function formatTimestamp(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  try {
    if (typeof (ts as Timestamp).toDate === 'function') {
      return (ts as Timestamp).toDate().toLocaleString();
    }
    if (ts instanceof Date) return ts.toLocaleString();
  } catch {
    /* fall through */
  }
  return '';
}

export default AccusourceOrderServiceLinesTable;
