/**
 * ShiftsTable — reusable paginated shifts table (shared by /shifts/list and
 * account-scoped surfaces). Expects rows from `useActiveShifts`; filtering is
 * client-side unless the parent already scopes the fetch.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { SxProps, Theme } from '@mui/material/styles';

import { db } from '../../firebase';
import StandardTablePagination from '../StandardTablePagination';
import ShiftPlacementsDrawer from './ShiftPlacementsDrawer';
import FavoriteButton from '../FavoriteButton';
import { useFavorites } from '../../hooks/useFavorites';
import {
  formatWeeklyScheduleDays,
  SHIFT_STATUS_FILTER_ENTRIES,
  shiftRowOverlapsDateRange,
  statusChipColor,
  toShiftPlacementsDrawerSummary,
  todayIsoLocal,
  type ShiftRow,
  type ShiftStatus,
} from '../../utils/shifts/shiftRow';
import type { ShiftsJobTypeFilter, ShiftsStatusFilter } from '../../pages/Shifts';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Stable, cross-tenant-unique favorite key per shift row. The `shift.id` on
// its own is only unique within a job order, so we composite with the JO id.
const favoriteIdFor = (row: ShiftRow): string =>
  `${row.jobOrder.id}:${row.shift.id}`;

const fmtMoney = (n: number | undefined): string =>
  n != null && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';

// Normalize the rich-text job description (React Quill HTML) into plain
// text suitable for a tooltip. Collapses whitespace and trims so an empty
// `<p><br></p>` doesn't render as a stray space.
const stripHtmlForTooltip = (html: string | undefined): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

// Tooltip slot styling for the Job-cell description: white surface with
// dark text so a multi-paragraph description reads cleanly. The default
// MUI tooltip is dark grey with white text, which is unreadable for
// long-form job descriptions.
const jobDescriptionTooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: '#fff',
      color: 'text.primary',
      border: '1px solid rgba(0, 0, 0, 0.08)',
      boxShadow: 4,
      maxWidth: 480,
      fontSize: '0.75rem',
      lineHeight: 1.45,
      whiteSpace: 'pre-line',
      p: 1.25,
    },
  },
} as const;

// Truncate plain text for the Instructions cell. We render two
// elements (clock-in URL and shift description) inside a fixed
// table column, so we both clamp the rendered string AND apply
// CSS `text-overflow: ellipsis` to handle very long single tokens
// like opaque URLs or paragraph descriptions.
const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

// Strip the protocol so the cell shows the part of the URL workers
// actually recognize. The full URL still goes to the clipboard.
const displayUrl = (url: string): string =>
  url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

// Tiny copy-to-clipboard button for the Instructions cell. Switches
// to a check icon for ~1.2s after a successful copy so the user gets
// feedback without us having to wire up a global snackbar from this
// row. Uses `navigator.clipboard` with a graceful no-op when it's
// not available (e.g. older browsers, http://).
const CopyUrlButton: React.FC<{ url: string; ariaLabel?: string }> = ({
  url,
  ariaLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Older-browser fallback: stage in a textarea, then `execCommand`.
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy clock-in URL'} arrow>
      <IconButton
        size="small"
        onClick={handleCopy}
        aria-label={ariaLabel ?? 'Copy clock-in URL'}
        sx={{ p: 0.25 }}
      >
        {copied ? (
          <CheckIcon sx={{ fontSize: '0.95rem', color: 'success.main' }} />
        ) : (
          <ContentCopyIcon sx={{ fontSize: '0.95rem' }} />
        )}
      </IconButton>
    </Tooltip>
  );
};

// Compact percent: trim trailing zeros (3.00 → "3", 2.30 → "2.3"), so the
// caption row reads cleanly at small font sizes.
const fmtPct = (n: number | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const fixed = n.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return `${trimmed}%`;
};

// Renders a tax-rate value (FUTA / SUTA / WC) with a soft red highlight when
// the rate is missing on the JO. Recruiters use this column to spot JOs that
// were created before tax rates were captured — the tint makes the gap
// scannable without adding a separate badge column.
const RATE_MISSING_SX = {
  backgroundColor: 'rgba(231, 76, 60, 0.16)',
  color: '#B71C1C',
  borderRadius: 0.5,
  px: 0.5,
} as const;
const renderRateValue = (n: number | null | undefined): React.ReactNode => {
  const isMissing = n == null || !Number.isFinite(n);
  return (
    <Box component="span" sx={isMissing ? RATE_MISSING_SX : undefined}>
      {fmtPct(n ?? undefined)}
    </Box>
  );
};

/**
 * Inline-editable PO# cell.
 *
 * - Click anywhere on the cell to edit (does NOT open the row drawer).
 * - Enter / blur saves; Escape cancels.
 * - Persists to `tenants/{tid}/job_orders/{joId}/shifts/{shiftId}.poNumber`.
 *   We deliberately write to the shift, not the JO — `shiftRow.ts` documents
 *   that a single JO can have shifts billed against different POs.
 * - The list view doesn't use a Firestore listener (it's `getDocs`-driven via
 *   `useActiveShifts`), so we keep an optimistic local override that paints
 *   the new value immediately and survives until the next refresh.
 *
 * Empty input clears the override (writes `''` to Firestore so the JO-level
 * fallback shows again on next render).
 */
interface PoNumberCellProps {
  tenantId: string | null | undefined;
  jobOrderId: string;
  shiftId: string;
  /** Current shift-level PO (after applying the optimistic override). */
  shiftPoNumber: string;
  /** JO-level fallback shown when shift-level is blank. */
  jobOrderPoNumber: string;
  /** Optimistic update so the cell reflects the save without re-fetching. */
  onSaved: (joId: string, shiftId: string, value: string) => void;
}

const PoNumberCell: React.FC<PoNumberCellProps> = ({
  tenantId,
  jobOrderId,
  shiftId,
  shiftPoNumber,
  jobOrderPoNumber,
  onSaved,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shiftPoNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the source value changes (refetch / sibling edit) and we're not
  // actively editing, sync the draft so the next click starts from the
  // latest persisted value.
  useEffect(() => {
    if (!editing) setDraft(shiftPoNumber);
  }, [shiftPoNumber, editing]);

  const beginEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tenantId) return;
    setError(null);
    setDraft(shiftPoNumber);
    setEditing(true);
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === shiftPoNumber.trim()) {
      setEditing(false);
      return;
    }
    if (!tenantId) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDoc(
        doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId),
        { poNumber: next, updatedAt: serverTimestamp() },
      );
      onSaved(jobOrderId, shiftId, next);
      setEditing(false);
    } catch (err) {
      console.warn('[ShiftsTable] Failed to save PO#:', err);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(shiftPoNumber);
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <TextField
        autoFocus
        size="small"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          // commit on blur — but ignore the blur that happens because the
          // input is being unmounted by `cancel()` (Escape). `cancel`
          // sets `editing=false` synchronously, so by the time onBlur
          // fires the input is already torn down and this callback
          // doesn't run. Safe.
          void commit();
        }}
        placeholder="PO#"
        inputProps={{ 'aria-label': 'PO number' }}
        error={Boolean(error)}
        helperText={error ?? undefined}
        sx={{ width: 100 }}
      />
    );
  }

  const isMissing = !shiftPoNumber && !jobOrderPoNumber;
  const display = shiftPoNumber || jobOrderPoNumber || '—';
  return (
    <Tooltip title="Click to edit PO#" arrow disableInteractive>
      <Box
        role="button"
        tabIndex={0}
        onClick={beginEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            beginEdit(e as unknown as React.MouseEvent);
          }
        }}
        sx={{
          display: 'inline-block',
          minWidth: 60,
          px: 0.5,
          py: 0.25,
          borderRadius: 0.5,
          cursor: tenantId ? 'text' : 'default',
          color: isMissing ? '#7A5C00' : 'text.primary',
          // Soft yellow tint when PO is missing on both the shift and the
          // parent JO — same scannable pattern we use for missing tax
          // rates in the Financials column.
          bgcolor: isMissing ? 'rgba(244, 180, 0, 0.20)' : undefined,
          '&:hover': tenantId
            ? {
                bgcolor: isMissing
                  ? 'rgba(244, 180, 0, 0.32)'
                  : 'rgba(0, 87, 184, 0.08)',
              }
            : undefined,
        }}
      >
        <Typography variant="body2" component="span">
          {display}
        </Typography>
      </Box>
    </Tooltip>
  );
};

/**
 * Inline-editable Status cell.
 *
 * - Click the chip to open a small menu with the four `ShiftStatus`
 *   values; selecting one persists to Firestore and stops here (does
 *   NOT open the row drawer).
 * - Persists to `tenants/{tid}/job_orders/{joId}/shifts/{shiftId}.status`.
 * - Same optimistic-override pattern as `PoNumberCell` — `useActiveShifts`
 *   doesn't subscribe, so we paint the new value locally and let the
 *   next refresh confirm.
 *
 * Status options mirror `SHIFT_STATUS_FILTER_ENTRIES` (toolbar filters).
 */
const SHIFT_STATUS_OPTIONS = SHIFT_STATUS_FILTER_ENTRIES;

interface StatusSelectCellProps {
  tenantId: string | null | undefined;
  jobOrderId: string;
  shiftId: string;
  status: ShiftStatus;
  onSaved: (joId: string, shiftId: string, value: ShiftStatus) => void;
}

const StatusSelectCell: React.FC<StatusSelectCellProps> = ({
  tenantId,
  jobOrderId,
  shiftId,
  status,
  onSaved,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const open = Boolean(anchorEl);

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!tenantId || saving) return;
    setAnchorEl(e.currentTarget);
  };
  const handleClose = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setAnchorEl(null);
  };

  const handlePick = async (e: React.MouseEvent, next: ShiftStatus) => {
    e.stopPropagation();
    setAnchorEl(null);
    if (!tenantId || next === status) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId),
        { status: next, updatedAt: serverTimestamp() },
      );
      onSaved(jobOrderId, shiftId, next);
    } catch (err) {
      console.warn('[ShiftsTable] Failed to save shift status:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Chip
        size="small"
        label={status}
        color={statusChipColor(status)}
        onClick={handleOpen}
        // Keep keyboard a11y on the chip itself; the row's onClick
        // also opens the drawer on Enter, so we explicitly stop the
        // event there too.
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
          }
        }}
        sx={{
          textTransform: 'capitalize',
          cursor: tenantId ? 'pointer' : 'default',
          opacity: saving ? 0.6 : 1,
        }}
      />
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => handleClose()}
        // Stop the row click from firing when the user clicks
        // anywhere inside the menu (including the backdrop).
        onClick={(e) => e.stopPropagation()}
        slotProps={{ paper: { sx: { minWidth: 140 } } }}
      >
        {SHIFT_STATUS_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={opt.value === status}
            onClick={(e) => void handlePick(e, opt.value)}
          >
            <Chip
              size="small"
              label={opt.label}
              color={statusChipColor(opt.value)}
              sx={{ mr: 1, pointerEvents: 'none' }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export interface ShiftsTableProps {
  tenantId: string | null | undefined;
  rows: ShiftRow[];
  loading: boolean;
  error: string | null;
  search: string;
  showFavoritesOnly: boolean;
  accountFilter: string;
  statusFilter: ShiftsStatusFilter;
  jobTypeFilter: ShiftsJobTypeFilter;
  /** When true, skips filtering by `companyName` (dataset already scoped to an account). */
  accountFilterDisabled?: boolean;
  /** Inclusive local-date range from the shifts toolbar; null = unset. */
  dateFilterStartIso?: string | null;
  dateFilterEndIso?: string | null;
  /** Copy when `rows.length === 0` after a successful load. */
  emptyStateNoDataMessage?: string;
  /** Optional outer box `sx` (e.g. account tab uses less horizontal padding). */
  containerSx?: SxProps<Theme>;
}

const ShiftsTable: React.FC<ShiftsTableProps> = ({
  tenantId,
  rows,
  loading,
  error,
  search: searchRaw,
  showFavoritesOnly,
  accountFilter,
  statusFilter,
  jobTypeFilter,
  accountFilterDisabled = false,
  dateFilterStartIso = null,
  dateFilterEndIso = null,
  emptyStateNoDataMessage,
  containerSx,
}) => {
  const search = searchRaw.trim().toLowerCase();

  const { isFavorite, toggleFavorite } = useFavorites('shifts');

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [openRow, setOpenRow] = useState<ShiftRow | null>(null);

  // Optimistic, per-row PO# overrides keyed by `${joId}:${shiftId}`. Filled
  // by `PoNumberCell` after a successful Firestore write so the new value
  // shows immediately without waiting for `useActiveShifts` to re-fetch.
  // Cleared (set back to '') makes the cell fall back to the JO-level PO.
  const [poOverrides, setPoOverrides] = useState<Record<string, string>>({});

  // 3-state PO# sort: null (default JO-order order) → 'asc' → 'desc' → null.
  // Numeric-aware so `508390` and `508405` order sensibly; empties pinned
  // to the bottom regardless of direction.
  const [poSortDir, setPoSortDir] = useState<'asc' | 'desc' | null>(null);

  const handlePoSaved = (joId: string, shiftId: string, value: string) => {
    setPoOverrides((prev) => ({ ...prev, [`${joId}:${shiftId}`]: value }));
  };

  // Same optimistic pattern for status edits — see `StatusSelectCell`.
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, ShiftStatus>
  >({});

  const handleStatusSaved = (
    joId: string,
    shiftId: string,
    value: ShiftStatus,
  ) => {
    setStatusOverrides((prev) => ({ ...prev, [`${joId}:${shiftId}`]: value }));
  };

  const filteredRows = useMemo(() => {
    const todayIso = todayIsoLocal();
    return rows.filter((r) => {
      if (showFavoritesOnly && !isFavorite(favoriteIdFor(r))) return false;
      if (
        !accountFilterDisabled &&
        accountFilter !== 'all' &&
        r.jobOrder.companyName !== accountFilter
      ) {
        return false;
      }
      if (statusFilter !== 'all' && (r.shift.status ?? 'open') !== statusFilter) {
        return false;
      }
      if (jobTypeFilter !== 'all' && r.jobOrder.jobType !== jobTypeFilter) {
        return false;
      }
      if (
        !shiftRowOverlapsDateRange(r, dateFilterStartIso, dateFilterEndIso, todayIso)
      ) {
        return false;
      }
      if (!search) return true;
      const haystack = [
        r.shift.shiftTitle,
        r.shift.defaultJobTitle,
        r.shift.poNumber,
        r.jobOrder.jobTitle,
        r.jobOrder.jobOrderNumber,
        r.jobOrder.poNumber,
        r.jobOrder.companyName,
        r.jobOrder.worksiteName,
        r.jobOrder.worksiteAddress?.street,
        r.jobOrder.worksiteAddress?.city,
        r.jobOrder.worksiteAddress?.state,
        r.jobOrder.worksiteAddress?.zipCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [
    rows,
    search,
    showFavoritesOnly,
    accountFilter,
    accountFilterDisabled,
    statusFilter,
    jobTypeFilter,
    dateFilterStartIso,
    dateFilterEndIso,
    isFavorite,
  ]);

  // Reset to page 0 when filter/search shrinks the result set past current page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1);
    if (page > maxPage) setPage(0);
  }, [filteredRows.length, rowsPerPage, page]);

  // Sort phase. Mirrors the resolution used by the cell renderer:
  // optimistic override → shift PO → JO PO → empty. Numeric compare wins
  // when both values parse as finite numbers; otherwise we fall back to
  // a numeric-aware locale compare for mixed alphanumeric POs.
  const sortedFilteredRows = useMemo(() => {
    if (poSortDir === null) return filteredRows;
    const dir = poSortDir === 'asc' ? 1 : -1;
    const resolvePo = (r: ShiftRow): string => {
      const overrideKey = `${r.jobOrder.id}:${r.shift.id}`;
      if (overrideKey in poOverrides) {
        return (poOverrides[overrideKey] ?? '').toString().trim();
      }
      return (r.shift.poNumber ?? r.jobOrder.poNumber ?? '').toString().trim();
    };
    return [...filteredRows].sort((a, b) => {
      const av = resolvePo(a);
      const bv = resolvePo(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [filteredRows, poSortDir, poOverrides]);

  const pagedRows = useMemo(
    () => sortedFilteredRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sortedFilteredRows, page, rowsPerPage],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={[
        { px: 2, pt: 1.5 },
        ...(containerSx != null ? [containerSx] : []),
      ] as SxProps<Theme>}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  padding="checkbox"
                  sx={{ width: 48 }}
                  aria-label="Favorite"
                />
                {/* Company column header intentionally blank — the cell
                    body renders the company avatar, no label needed. */}
                <TableCell
                  sx={{
                    fontWeight: 600,
                    width: 48,
                    paddingLeft: '0 !important',
                    paddingRight: '0 !important',
                  }}
                  aria-label="Company"
                />
                <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                <TableCell
                  sx={{ fontWeight: 600 }}
                  sortDirection={poSortDir ?? false}
                >
                  <TableSortLabel
                    active={poSortDir !== null}
                    direction={poSortDir ?? 'asc'}
                    onClick={() => {
                      setPoSortDir((prev) => {
                        if (prev === null) return 'asc';
                        if (prev === 'asc') return 'desc';
                        return null;
                      });
                    }}
                  >
                    PO#
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Job</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Requirements</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Financials</TableCell>
                {/* Instructions column temporarily hidden while we clean up the shifts list view.
                <TableCell sx={{ fontWeight: 600, width: 220 }}>Instructions</TableCell>
                */}
                <TableCell sx={{ fontWeight: 600 }} align="right">
                  Staff
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      {rows.length === 0
                        ? emptyStateNoDataMessage ??
                          'No shifts loaded yet. Shifts appear here from Job Orders (Shift Setup) for this tenant.'
                        : showFavoritesOnly
                          ? 'No favorited shifts match your filters.'
                          : 'No shifts match your filters.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((row) => {
                  const { shift, jobOrder } = row;
                  const street = jobOrder.worksiteAddress?.street?.trim() || '';
                  const city = jobOrder.worksiteAddress?.city?.trim() || '';
                  const state = jobOrder.worksiteAddress?.state?.trim() || '';
                  const zip = jobOrder.worksiteAddress?.zipCode?.trim() || '';
                  // US 2-line address format: street on line 1; "city,
                  // state zip" on line 2. Falls back gracefully when any
                  // segment is missing (e.g. older tenants without a
                  // street line on the JO).
                  const cityStateZip = [
                    [city, state].filter(Boolean).join(', '),
                    zip,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const favId = favoriteIdFor(row);
                  const shiftOverrideKey = `${jobOrder.id}:${shift.id}`;
                  const resolvedShiftStatus: ShiftStatus =
                    statusOverrides[shiftOverrideKey] ??
                    shift.status ??
                    'open';
                  return (
                    <TableRow
                      key={favId}
                      hover
                      onClick={() => setOpenRow(row)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell
                        padding="checkbox"
                        sx={{ width: 48 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FavoriteButton
                          itemId={favId}
                          favoriteType="shifts"
                          isFavorite={isFavorite}
                          toggleFavorite={toggleFavorite}
                          size="small"
                        />
                      </TableCell>
                      <TableCell
                        sx={{
                          width: 48,
                          paddingLeft: '0 !important',
                          paddingRight: '0 !important',
                        }}
                      >
                        {jobOrder.companyName || jobOrder.companyLogoUrl ? (
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center',
                            }}
                          >
                            <Tooltip title={jobOrder.companyName || ''} placement="top">
                              <Avatar
                                src={jobOrder.companyLogoUrl}
                                alt={jobOrder.companyName || 'Company'}
                                variant="rounded"
                                sx={{
                                  width: 36,
                                  height: 36,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  bgcolor: jobOrder.companyLogoUrl
                                    ? 'transparent'
                                    : '#E9ECEF',
                                  color: '#0B0D12',
                                }}
                              >
                                {jobOrder.companyName?.[0]?.toUpperCase() ?? '?'}
                              </Avatar>
                            </Tooltip>
                          </Box>
                        ) : (
                          <Box sx={{ textAlign: 'right' }}>—</Box>
                        )}
                      </TableCell>
                      <TableCell>
                        {jobOrder.worksiteName || street || cityStateZip ? (
                          <Stack spacing={0.25}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {jobOrder.worksiteName || '—'}
                            </Typography>
                            {street && (
                              <Typography variant="caption" color="text.secondary">
                                {street}
                              </Typography>
                            )}
                            {cityStateZip && (
                              <Typography variant="caption" color="text.secondary">
                                {cityStateZip}
                              </Typography>
                            )}
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {/* `poOverrides` lets a freshly-saved PO show
                            without waiting for the next refetch from
                            `useActiveShifts`. */}
                        {(() => {
                          const overrideKey = `${jobOrder.id}:${shift.id}`;
                          const shiftPo =
                            overrideKey in poOverrides
                              ? poOverrides[overrideKey]
                              : shift.poNumber ?? '';
                          return (
                            <PoNumberCell
                              tenantId={tenantId}
                              jobOrderId={jobOrder.id}
                              shiftId={shift.id}
                              shiftPoNumber={shiftPo}
                              jobOrderPoNumber={jobOrder.poNumber ?? ''}
                              onSaved={handlePoSaved}
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {row.dateLabel}
                          </Typography>
                          {(() => {
                            const daysLabel = formatWeeklyScheduleDays(
                              shift.weeklySchedule,
                            );
                            return daysLabel ? (
                              <Typography variant="caption" color="text.secondary">
                                {daysLabel}
                              </Typography>
                            ) : null;
                          })()}
                          {row.timeLabel && row.timeLabel !== '—' && (
                            <Typography variant="caption" color="text.secondary">
                              {row.timeLabel}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const shiftLabel = shift.shiftTitle?.trim();
                          const jobLabel =
                            shift.defaultJobTitle?.trim() ||
                            jobOrder.jobTitle?.trim();
                          const description = stripHtmlForTooltip(
                            jobOrder.jobDescription,
                          );
                          if (!shiftLabel && !jobLabel) return '—';
                          return (
                            <Stack spacing={0.25}>
                              {shiftLabel && (
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 500 }}
                                >
                                  {shiftLabel}
                                </Typography>
                              )}
                              {jobLabel &&
                                (description ? (
                                  <Tooltip
                                    title={description}
                                    placement="top-start"
                                    enterDelay={250}
                                    arrow
                                    slotProps={jobDescriptionTooltipSlotProps}
                                  >
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{
                                        cursor: 'help',
                                        // Faint underline cue that
                                        // there's hoverable content.
                                        borderBottom: '1px dotted',
                                        borderColor: 'rgba(0, 0, 0, 0.18)',
                                        display: 'inline-block',
                                        alignSelf: 'flex-start',
                                      }}
                                    >
                                      {jobLabel}
                                    </Typography>
                                  </Tooltip>
                                ) : (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {jobLabel}
                                  </Typography>
                                ))}
                            </Stack>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const entityLabel = jobOrder.hiringEntityName?.trim();
                          const screening = [
                            jobOrder.screeningPackageName?.trim(),
                            ...(jobOrder.additionalScreenings ?? []),
                          ]
                            .filter((s): s is string => !!s)
                            .join(', ');
                          const uniform = jobOrder.uniformRequirements?.trim();
                          if (!entityLabel && !screening && !uniform) {
                            return '—';
                          }
                          return (
                            <Stack spacing={0.25}>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                {entityLabel || '—'}
                              </Typography>
                              {screening && (
                                <Typography variant="caption" color="text.secondary">
                                  {screening}
                                </Typography>
                              )}
                              {uniform && (
                                <Typography variant="caption" color="text.secondary">
                                  {uniform}
                                </Typography>
                              )}
                            </Stack>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {jobOrder.payRate != null ||
                        jobOrder.billRate != null ||
                        jobOrder.wcRate != null ||
                        jobOrder.sutaRate != null ||
                        jobOrder.futaRate != null ? (
                          <Stack spacing={0.25}>
                            <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                              Pay: {fmtMoney(jobOrder.payRate)} · Bill:{' '}
                              {fmtMoney(jobOrder.billRate)}
                              {jobOrder.markupPercent != null &&
                                Number.isFinite(jobOrder.markupPercent) && (
                                  <> ({fmtPct(jobOrder.markupPercent)})</>
                                )}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ whiteSpace: 'nowrap' }}
                            >
                              FUTA: {renderRateValue(jobOrder.futaRate)} · SUTA:{' '}
                              {renderRateValue(jobOrder.sutaRate)} · WC:{' '}
                              {renderRateValue(jobOrder.wcRate)}
                            </Typography>
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      {/* Instructions column temporarily hidden while we clean up the shifts list view.
                      <TableCell sx={{ maxWidth: 240 }}>
                        {(() => {
                          const url = shift.clockInUrl?.trim() || '';
                          const desc = shift.shiftDescription?.trim() || '';
                          if (!url && !desc) return '—';
                          return (
                            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                              {url && (
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  alignItems="center"
                                  sx={{ minWidth: 0 }}
                                >
                                  <Tooltip
                                    title={url}
                                    placement="top-start"
                                    enterDelay={250}
                                    arrow
                                    slotProps={jobDescriptionTooltipSlotProps}
                                  >
                                    <Typography
                                      variant="body2"
                                      component="a"
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      sx={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: 'primary.main',
                                        textDecoration: 'none',
                                        flex: 1,
                                        minWidth: 0,
                                        '&:hover': { textDecoration: 'underline' },
                                      }}
                                    >
                                      {truncate(displayUrl(url), 32)}
                                    </Typography>
                                  </Tooltip>
                                  <CopyUrlButton url={url} />
                                </Stack>
                              )}
                              {desc && (
                                <Tooltip
                                  title={desc}
                                  placement="top-start"
                                  enterDelay={250}
                                  arrow
                                  slotProps={jobDescriptionTooltipSlotProps}
                                >
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{
                                      cursor: 'help',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {truncate(desc, 80)}
                                  </Typography>
                                </Tooltip>
                              )}
                            </Stack>
                          );
                        })()}
                      </TableCell>
                      */}
                      <TableCell align="right">
                        <Stack
                          spacing={0.25}
                          alignItems="flex-end"
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {row.confirmedCount ?? 0} / {shift.totalStaffRequested ?? '—'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Total Applicants: {row.applicantsCount ?? 0}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <StatusSelectCell
                          tenantId={tenantId}
                          jobOrderId={jobOrder.id}
                          shiftId={shift.id}
                          status={resolvedShiftStatus}
                          onSaved={handleStatusSaved}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <StandardTablePagination
          rowsPerPageOptions={PAGE_SIZE_OPTIONS}
          count={filteredRows.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Paper>

      <ShiftPlacementsDrawer
        open={openRow !== null}
        tenantId={tenantId ?? null}
        jobOrderId={openRow?.jobOrder.id ?? null}
        shift={openRow ? toShiftPlacementsDrawerSummary(openRow) : null}
        onClose={() => setOpenRow(null)}
      />
    </Box>
  );
};

export default ShiftsTable;
