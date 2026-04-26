/**
 * ShiftsList — list-view tab body for /shifts.
 *
 * Pure presentation: pulls the active shift dataset from the outlet
 * context (provided by `Shifts.tsx`, fetched via `useActiveShifts`) and
 * renders a paginated table. Switching to/from the Calendar tab does NOT
 * re-fetch, because the data lives at the parent.
 *
 * Filtering: client-side substring search across job title, company,
 * worksite, etc. Search input lives in the page header (Shifts.tsx) and
 * is propagated down through the same outlet context.
 *
 * History: this file replaces the original `ShiftsActive.tsx`. The
 * previous URL `/shifts/active` redirects here.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import StandardTablePagination from '../components/StandardTablePagination';
import ShiftPlacementsDrawer from '../components/shifts/ShiftPlacementsDrawer';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';
import {
  formatWeeklyScheduleDays,
  statusChipColor,
  type ShiftRow,
} from '../utils/shifts/shiftRow';
import type { ShiftsOutletContext } from './Shifts';

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

const ShiftsList: React.FC = () => {
  const { tenantId } = useAuth();
  const ctx = useOutletContext<ShiftsOutletContext | null>();
  const search = (ctx?.search ?? '').trim().toLowerCase();
  const showFavoritesOnly = ctx?.showFavoritesOnly ?? false;
  const accountFilter = ctx?.accountFilter ?? 'all';
  const statusFilter = ctx?.statusFilter ?? 'all';
  const jobTypeFilter = ctx?.jobTypeFilter ?? 'all';
  const rows = ctx?.rows ?? [];
  const loading = ctx?.loading ?? false;
  const error = ctx?.error ?? null;

  const { isFavorite, toggleFavorite } = useFavorites('shifts');

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [openRow, setOpenRow] = useState<ShiftRow | null>(null);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (showFavoritesOnly && !isFavorite(favoriteIdFor(r))) return false;
      if (accountFilter !== 'all' && r.jobOrder.companyName !== accountFilter) {
        return false;
      }
      if (statusFilter !== 'all' && (r.shift.status ?? 'open') !== statusFilter) {
        return false;
      }
      if (jobTypeFilter !== 'all' && r.jobOrder.jobType !== jobTypeFilter) {
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
    statusFilter,
    jobTypeFilter,
    isFavorite,
  ]);

  // Reset to page 0 when filter/search shrinks the result set past current page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1);
    if (page > maxPage) setPage(0);
  }, [filteredRows.length, rowsPerPage, page]);

  const pagedRows = useMemo(
    () => filteredRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredRows, page, rowsPerPage],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
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
                <TableCell sx={{ fontWeight: 600 }}>Worksite</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO#</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Job</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Requirements</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Financials</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 220 }}>Instructions</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">
                  Staff
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      {rows.length === 0
                        ? 'No active shifts. New or upcoming shifts will appear here.'
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
                            <Typography variant="body2">
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
                      <TableCell>
                        <Typography variant="body2">
                          {shift.poNumber || jobOrder.poNumber || '—'}
                        </Typography>
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
                              FUTA: {fmtPct(jobOrder.futaRate)} · SUTA:{' '}
                              {fmtPct(jobOrder.sutaRate)} · WC:{' '}
                              {fmtPct(jobOrder.wcRate)}
                            </Typography>
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </TableCell>
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
                      <TableCell>
                        <Chip
                          size="small"
                          label={shift.status ?? 'open'}
                          color={statusChipColor(shift.status)}
                          sx={{ textTransform: 'capitalize' }}
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
        shift={
          openRow
            ? {
                id: openRow.shift.id,
                shiftTitle: openRow.shift.shiftTitle,
                dateLabel: openRow.dateLabel,
                timeLabel: openRow.timeLabel,
              }
            : null
        }
        onClose={() => setOpenRow(null)}
      />
    </Box>
  );
};

export default ShiftsList;
