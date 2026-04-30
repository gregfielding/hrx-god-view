/**
 * Vendor-style line-item table for AccuSource screenings (User → Backgrounds).
 * Reads `providerServiceOrderStatus` + catalog; extended fields come from webhooks (see
 * `functions/.../accusourceWebhookServiceLine.ts`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RestoreIcon from '@mui/icons-material/Restore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Timestamp } from 'firebase/firestore';
import type {
  AccusourceLineVerdict,
  AccusourceManualVerdict,
  BackgroundCheckRecord,
} from '../../../types/backgroundCheck';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import { accusourceScreeningLineItems } from '../../../utils/accusourceScreeningLineItems';
import {
  BAND_CHIP_COLOR,
  BAND_DEFAULT_COLLAPSED,
  BAND_LABEL,
  BAND_ORDER,
  cardHeaderSubBadge,
  groupLinesByBand,
  isAllPendingState,
  isSyntheticOrderRow,
  type AccusourceVerdictBand,
} from '../../../utils/accusourceVerdictBands';

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

/**
 * AC.0a — Icon for a band header. Returns an MUI icon element with the
 * band's color so the header reads at a glance.
 */
function bandHeaderIcon(band: AccusourceVerdictBand): React.ReactElement {
  const color =
    band === 'NEEDS_REVIEW'
      ? 'warning'
      : band === 'FAILED'
        ? 'error'
        : band === 'PASSED'
          ? 'success'
          : 'disabled';
  if (band === 'NEEDS_REVIEW')
    return <WarningAmberIcon fontSize="small" color={color} />;
  if (band === 'FAILED') return <CancelIcon fontSize="small" color={color} />;
  if (band === 'PASSED') return <CheckCircleIcon fontSize="small" color={color} />;
  return <HourglassEmptyIcon fontSize="small" color={color} />;
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
  // AC.0a — Optimistic local-overrides map keyed by line id. The parent
  // (BackgroundsComplianceTab) currently does NOT re-fetch after
  // setAccusourceLineAdjudication resolves (an aspirational comment in
  // that file says "Firestore snapshot subscriptions keep the table in
  // sync" but no such subscription is wired today). Without this map a
  // CSA who clicks "Mark as Passed" sees the row stay in the Needs review
  // band — which violates the AC.0a acceptance criterion ("row instantly
  // moves to Passed band"). The map is purely presentation: it overrides
  // `line.verdict` until the parent's `record` prop catches up. When the
  // parent's data eventually carries the same verdict, we prune the
  // override entry so we don't shadow a future legitimate revert.
  const [localOverrides, setLocalOverrides] = useState<Record<string, AccusourceLineVerdict>>({});

  const baseLines = useMemo(() => accusourceScreeningLineItems(record), [record]);

  // Apply local overrides AND prune any entries the parent has now
  // caught up to. Stable result reference unless the source data or the
  // override map actually changes; safe to depend on in downstream memos.
  const lines = useMemo<AccusourceScreeningLineItem[]>(() => {
    if (Object.keys(localOverrides).length === 0) return baseLines;
    return baseLines.map((line) => {
      const optimistic = localOverrides[line.id];
      if (optimistic == null) return line;
      // If the underlying record already reflects the override, skip the
      // local mutation — the prune effect below will clear the entry.
      if (line.verdict === optimistic) return line;
      return {
        ...line,
        verdict: optimistic,
        verdictOverridden: true,
      };
    });
  }, [baseLines, localOverrides]);

  // Prune local overrides that the parent has caught up to. Runs after
  // every render where `baseLines` changed. Out-of-band so it doesn't
  // re-trigger the `lines` memo synchronously.
  useEffect(() => {
    setLocalOverrides((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next: Record<string, AccusourceLineVerdict> = {};
      for (const key of keys) {
        const line = baseLines.find((l) => l.id === key);
        if (line && line.verdict === prev[key]) {
          changed = true; // parent caught up — drop the local override
          continue;
        }
        next[key] = prev[key];
      }
      return changed ? next : prev;
    });
  }, [baseLines]);

  const showCostColumn = useMemo(() => lines.some(lineHasPrice), [lines]);

  // AC.0a — Group lines into the four verdict bands. Synthetic `order:*`
  // rows that escaped the line builder's time-correlated dedup are
  // filtered out here (presentation guard — no data writes).
  const linesByBand = useMemo(() => groupLinesByBand(lines), [lines]);
  const visibleLineCount = useMemo(
    () => lines.filter((l) => !isSyntheticOrderRow(l)).length,
    [lines],
  );
  const subBadge = useMemo(() => cardHeaderSubBadge(linesByBand), [linesByBand]);
  const allPending = useMemo(() => isAllPendingState(linesByBand), [linesByBand]);

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

  // AC.0a — Band collapse state + per-row inline expansion state. Bands
  // start in their spec-mandated default (Pending + Passed collapsed,
  // Needs review + Failed expanded) but the user can toggle either way.
  // Row expansions are local-only — closing a band closes its rows by
  // virtue of being unmounted (Collapse `unmountOnExit`).
  const [collapsedBands, setCollapsedBands] = useState<Set<AccusourceVerdictBand>>(
    () => new Set(BAND_DEFAULT_COLLAPSED),
  );
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());

  const toggleBand = (band: AccusourceVerdictBand) => {
    setCollapsedBands((prev) => {
      const next = new Set(prev);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
  };

  const toggleRowExpansion = (lineId: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

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
      // Drop any optimistic override for this line — once revert hits,
      // the parent's autoVerdict is the source of truth and we don't
      // want a stale local override holding the row in the wrong band.
      setLocalOverrides((prev) => {
        if (!(line.id in prev)) return prev;
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
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
      // AC.0a optimistic update — without this the row stays in its old
      // band until the parent re-fetches (which it doesn't today; see the
      // localOverrides comment above for the full rationale).
      setLocalOverrides((prev) => ({ ...prev, [overrideLine.id]: overrideVerdict }));
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

  // ──────────────────────────────────────────────────────────────────
  // AC.0a — Per-row renderer + per-row inline details panel.
  // Defined in render scope so they can close over the menu / override
  // dialog state without prop-drilling. Reading them in this order
  // (header → row → details) mirrors how the chunk renders top-to-bottom.
  // ──────────────────────────────────────────────────────────────────

  /**
   * Render the per-band action button(s). Spec mapping:
   *   - NEEDS_REVIEW: primary "Review" button → opens the same override
   *     menu (Mark as Passed / Failed / Needs review). Replaces the
   *     ⋮ kebab as the discoverable entry point.
   *   - FAILED: primary "View report" + secondary ⋮ for downward override.
   *   - PENDING: no button — informational.
   *   - PASSED: text "View report" link + ⋮ surfaced on hover for power
   *     users who need to override down.
   */
  const renderRowAction = (
    line: AccusourceScreeningLineItem,
    band: AccusourceVerdictBand,
  ): React.ReactNode => {
    const reportUrl =
      line.reportUrl != null ? String(line.reportUrl).trim() : '';
    const canFinalPdf =
      onOpenFinalPdf != null &&
      !!record.finalReportReady &&
      lineStatusLooksComplete(line.status);
    const reportButton = (variant: 'contained' | 'outlined' | 'text') =>
      reportUrl !== '' ? (
        <Button
          size="small"
          variant={variant}
          component="a"
          href={reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          View report
        </Button>
      ) : canFinalPdf && onOpenFinalPdf ? (
        <Button
          size="small"
          variant={variant}
          disabled={!!pdfLoading || canAccusourceAdmin === false}
          onClick={(e) => {
            e.stopPropagation();
            onOpenFinalPdf(record.id);
          }}
        >
          Final PDF
        </Button>
      ) : null;

    if (band === 'NEEDS_REVIEW') {
      return canOverride ? (
        <Button
          size="small"
          variant="contained"
          color="warning"
          onClick={(e) => {
            e.stopPropagation();
            handleMenuOpen(e, line.id);
          }}
          disabled={adjudicationLoadingKey === `${record.id}::${line.id}`}
        >
          Review
        </Button>
      ) : null;
    }

    if (band === 'FAILED') {
      return (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {reportButton('contained')}
          {canOverride && (
            <IconButton
              size="small"
              aria-label={`Override verdict for ${line.name}`}
              onClick={(e) => {
                e.stopPropagation();
                handleMenuOpen(e, line.id);
              }}
              disabled={adjudicationLoadingKey === `${record.id}::${line.id}`}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      );
    }

    if (band === 'PENDING') {
      // Informational only — a small "Awaiting vendor" caption is
      // already implied by the band label; an action button here would
      // just attract clicks the CSA can't act on.
      return null;
    }

    // PASSED — link + kebab on hover.
    return (
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        className="ac0a-passed-actions"
        sx={{
          '& .ac0a-passed-kebab': { opacity: 0.4, transition: 'opacity 120ms' },
          '&:hover .ac0a-passed-kebab': { opacity: 1 },
        }}
      >
        {reportButton('text')}
        {canOverride && (
          <IconButton
            size="small"
            aria-label={`Override verdict for ${line.name}`}
            className="ac0a-passed-kebab"
            onClick={(e) => {
              e.stopPropagation();
              handleMenuOpen(e, line.id);
            }}
            disabled={adjudicationLoadingKey === `${record.id}::${line.id}`}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    );
  };

  /**
   * Inline details panel — replaces the pre-AC.0a right-side `Drawer`.
   * Reveals every column the flat table used to show, plus the
   * adjudication audit trail. Rendered inside a `<Collapse>` keyed off
   * the row's id so unmount-on-collapse keeps the DOM small.
   */
  const renderDetailsPanel = (line: AccusourceScreeningLineItem): React.ReactNode => {
    const orderId =
      line.providerOrderId != null && String(line.providerOrderId).trim() !== ''
        ? String(line.providerOrderId)
        : orderRef;
    const auto = line.adjudication?.autoVerdict;
    const autoReason = line.adjudication?.autoVerdictReason;
    const overrideBy = line.adjudication?.overriddenBy;
    const overrideAtRaw = line.adjudication?.overriddenAt;
    const overrideAt =
      overrideAtRaw != null ? formatTimestamp(overrideAtRaw) : null;
    return (
      <Box sx={{ px: 2, pb: 1.5, pt: 0.5, bgcolor: 'grey.50' }}>
        {showCostColumn && lineHasPrice(line) && (
          <DetailRow label="Cost" value={formatPrice(line)} />
        )}
        <DetailRow label="Order #" value={orderId} mono />
        <DetailRow label="Component ID" value={line.id} mono />
        <DetailRow
          label="Jurisdiction"
          value={
            line.jurisdiction != null && String(line.jurisdiction).trim() !== ''
              ? line.jurisdiction
              : '—'
          }
        />
        <DetailRow
          label="Scope"
          value={scopeLabelForLine(line, clientLabel)}
        />
        <DetailRow label="Subject" value={subjectLabel} />
        <DetailRow
          label="Assignment"
          value={
            line.assignmentLabel != null && String(line.assignmentLabel).trim() !== ''
              ? line.assignmentLabel
              : '—'
          }
        />
        <DetailRow label="Order placed" value={orderedAtFallback} />
        <DetailRowNode label="Lifecycle">
          <LifecycleTimestamps line={line} />
        </DetailRowNode>
        {line.decision && <DetailRow label="Vendor decision" value={String(line.decision)} />}
        {auto && (
          <DetailRow
            label="Auto verdict"
            value={
              autoReason
                ? `${verdictChipLabel(auto)} — ${autoReason}`
                : verdictChipLabel(auto)
            }
          />
        )}
        {line.verdictOverridden && (
          <DetailRow
            label="Manual override"
            value={[
              overrideBy ? `by ${overrideBy}` : null,
              overrideAt ? `at ${overrideAt}` : null,
              line.adjudication?.overrideReason
                ? `— ${line.adjudication.overrideReason}`
                : null,
            ]
              .filter(Boolean)
              .join(' ') || 'Active'}
          />
        )}
      </Box>
    );
  };

  /**
   * Per-row chunk: clickable header (toggles expansion) + chip strip +
   * action button + collapsible details panel.
   */
  const renderRow = (
    line: AccusourceScreeningLineItem,
    band: AccusourceVerdictBand,
  ): React.ReactNode => {
    const expanded = expandedRowIds.has(line.id);
    return (
      <Box key={line.id} data-testid={`accusource-row-${line.id}`}>
        <Box
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={`${line.name} ${verdictChipLabel(line.verdict)}, ${
            expanded ? 'collapse' : 'expand'
          } details`}
          data-testid={`accusource-row-header-${line.id}`}
          onClick={() => toggleRowExpansion(line.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleRowExpansion(line.id);
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.25,
            cursor: 'pointer',
            userSelect: 'none',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
              {line.name}
            </Typography>
            {line.type ? (
              <Typography variant="caption" color="text.secondary" display="block">
                {line.type}
              </Typography>
            ) : null}
          </Box>
          <Chip
            size="small"
            label={line.status}
            color={statusChipColor(line.status)}
            variant={line.status === 'Pending' ? 'outlined' : 'filled'}
            sx={{ fontWeight: 600, flexShrink: 0 }}
          />
          <Tooltip
            title={
              line.verdictOverridden
                ? `Manual override${
                    line.adjudication?.overrideReason
                      ? ` — ${line.adjudication.overrideReason}`
                      : ''
                  }. Auto verdict was ${line.adjudication?.autoVerdict ?? 'PENDING'}.`
                : line.adjudication?.autoVerdictReason ||
                  'System verdict from status + decision'
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
          <Box sx={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {renderRowAction(line, band)}
          </Box>
          <KeyboardArrowDownIcon
            fontSize="small"
            sx={{
              flexShrink: 0,
              color: 'text.disabled',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms',
            }}
          />
        </Box>
        <Collapse in={expanded} unmountOnExit>
          {renderDetailsPanel(line)}
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ py: 1, px: { xs: 0, sm: 0.5 } }}>
      {/*
        AC.0a — Card header: title with total visible count + an optional
        sub-badge highlighting actionable items ("1 needs review" /
        "1 failed"). The dev-facing copy ("same ordered components as the
        vendor order …") moved into a tooltip so the header isn't cluttered
        for CSAs.
      */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          AccuSource service lines ({visibleLineCount})
        </Typography>
        {subBadge && (
          <Chip
            size="small"
            color={subBadge.severity}
            label={subBadge.label}
            sx={{ fontWeight: 600 }}
          />
        )}
        <Tooltip title="Same ordered components as the vendor order. Extra columns populate when SourceDirect includes them on webhooks (field names are normalized server-side). Recruiters L5–L7 can override or revert system verdicts.">
          <IconButton size="small" sx={{ ml: 'auto', opacity: 0.6 }} aria-label="About this section">
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/*
        Special "all pending" state — when every line is still in PENDING
        and no actionable bands exist, render only the Pending band with
        an explanatory caption so the CSA isn't left wondering whether
        the empty Needs review / Failed / Passed bands mean the data is
        broken. (They're just genuinely not there yet.)
      */}
      {allPending && (
        <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
          All checks are still in progress with the vendor.
        </Alert>
      )}

      <Stack spacing={1}>
        {BAND_ORDER.map((band) => {
          const items = linesByBand[band];
          if (items.length === 0) return null;
          const collapsed = collapsedBands.has(band);
          return (
            <Box
              key={band}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              <Box
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                aria-controls={`accusource-band-${band.toLowerCase()}`}
                aria-label={`${BAND_LABEL[band]} band, ${items.length} ${
                  items.length === 1 ? 'item' : 'items'
                }`}
                data-testid={`accusource-band-header-${band.toLowerCase()}`}
                onClick={() => toggleBand(band)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleBand(band);
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 1,
                  bgcolor: 'background.default',
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderBottom: collapsed ? 0 : 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {bandHeaderIcon(band)}
                <Typography variant="subtitle2" fontWeight={700}>
                  {BAND_LABEL[band]}
                </Typography>
                <Chip
                  size="small"
                  label={items.length}
                  color={BAND_CHIP_COLOR[band]}
                  variant="outlined"
                  sx={{ fontWeight: 600, height: 22 }}
                />
                <KeyboardArrowDownIcon
                  fontSize="small"
                  sx={{
                    ml: 'auto',
                    color: 'text.secondary',
                    transform: collapsed ? 'rotate(-90deg)' : 'none',
                    transition: 'transform 150ms',
                  }}
                />
              </Box>
              <Collapse in={!collapsed} unmountOnExit>
                <Box id={`accusource-band-${band.toLowerCase()}`}>
                  <Stack divider={<Divider />}>
                    {items.map((line) => renderRow(line, band))}
                  </Stack>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Stack>

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

    </Box>
  );
};

/**
 * AC.0a — One row in the inline details panel. Two-column layout
 * (label | value) so multiple rows align vertically. `mono` forces
 * `ui-monospace` for values like Order # / Component ID where character
 * alignment matters more than visual flow.
 */
function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}): React.ReactElement {
  const v = value != null && String(value).trim() !== '' ? String(value).trim() : '—';
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 0.25, sm: 1.5 }}
      sx={{ py: 0.5, alignItems: { sm: 'baseline' } }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: { sm: 130 }, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          wordBreak: 'break-word',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          fontSize: mono ? '0.8125rem' : undefined,
          color: v === '—' ? 'text.disabled' : undefined,
          flexGrow: 1,
        }}
      >
        {v}
      </Typography>
    </Stack>
  );
}

/**
 * AC.0a — Same shape as `DetailRow` but renders an arbitrary node
 * (e.g. `<LifecycleTimestamps>`) on the right. Reused so the value
 * column inherits the same alignment / typography baseline.
 */
function DetailRowNode({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 0.25, sm: 1.5 }}
      sx={{ py: 0.5, alignItems: { sm: 'baseline' } }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: { sm: 130 }, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {label}
      </Typography>
      <Box sx={{ flexGrow: 1 }}>{children}</Box>
    </Stack>
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
