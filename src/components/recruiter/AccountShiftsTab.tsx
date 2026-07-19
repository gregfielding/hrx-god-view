/**
 * Account Shifts — mirrors `/shifts` (List + Calendar, filters, table, drawer)
 * scoped to the open recruiter account (no Account selector).
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ViewList as ViewListIcon,
  CalendarMonth as CalendarMonthIcon,
} from '@mui/icons-material';

import PageHeader from '../PageHeader';
import ShiftPlacementsDrawer from '../shifts/ShiftPlacementsDrawer';
import ShiftsTable from '../shifts/ShiftsTable';
import ShiftsCalendarView from '../shifts/ShiftsCalendarView';
import UniversalSearchBar from '../UniversalSearchBar';
import useActiveShifts from '../../hooks/useActiveShifts';
import { useFavorites } from '../../hooks/useFavorites';
import {
  dateToLocalYyyyMmDd,
  shiftRowOverlapsDateRange,
  SHIFT_STATUS_FILTER_ENTRIES,
  startOfTodayLocal,
  todayIsoLocal,
  type ShiftRow,
} from '../../utils/shifts/shiftRow';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { RecruiterAccount } from '../../types/recruiter/account';
import type { ShiftsJobTypeFilter, ShiftsStatusFilter, ShiftsTab } from '../../pages/Shifts';

const STATUS_OPTIONS: Array<{ value: ShiftsStatusFilter; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  ...SHIFT_STATUS_FILTER_ENTRIES,
];

const JOB_TYPE_OPTIONS: Array<{ value: ShiftsJobTypeFilter; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'gig', label: 'Gig' },
  { value: 'career', label: 'Career' },
];

const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

const accountShiftsDatePickerSlotProps = {
  textField: {
    size: 'small' as const,
    sx: {
      width: 156,
      '& .MuiOutlinedInput-root': {
        height: 36,
        borderRadius: '6px',
        fontSize: '0.875rem',
        backgroundColor: 'white',
      },
      '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
    },
  },
};

export interface AccountShiftsTabProps {
  tenantId: string | null | undefined;
  account: RecruiterAccount | null;
  /** True while the parent page is still resolving the account doc (optional). */
  accountLoading?: boolean;
  /**
   * Controlled search/favorites/add-drawer state — when provided, the corresponding
   * controls are rendered by the parent (in the account page header next to the tabs)
   * instead of inside this tab's own toolbar. This keeps the search bar + add button
   * on the same row as the account-level tab strip, matching `/jobs/job-orders` and
   * the rest of the page set.
   *
   * Pass nothing and the tab still works standalone with internal state + an internal
   * search/add toolbar.
   */
  search?: string;
  onSearchChange?: (next: string) => void;
  showFavoritesOnly?: boolean;
  onToggleFavorites?: (next: boolean) => void;
  addShiftDrawerOpen?: boolean;
  onAddShiftDrawerOpenChange?: (next: boolean) => void;
}

const AccountShiftsTab: React.FC<AccountShiftsTabProps> = ({
  tenantId,
  account,
  accountLoading = false,
  search: searchProp,
  onSearchChange,
  showFavoritesOnly: showFavoritesOnlyProp,
  onToggleFavorites,
  addShiftDrawerOpen: addShiftDrawerOpenProp,
  onAddShiftDrawerOpenChange,
}) => {
  const [activeView, setActiveView] = useState<ShiftsTab>('list');
  const [internalAddShiftDrawerOpen, setInternalAddShiftDrawerOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState('');
  const [internalShowFavoritesOnly, setInternalShowFavoritesOnly] = useState(false);
  // Toolbar (search + add) is rendered by the parent page header when *all* the
  // controlled props are supplied — otherwise the tab falls back to its own toolbar
  // for any standalone callers we add in the future.
  const toolbarHoistedToParent =
    searchProp !== undefined &&
    onSearchChange !== undefined &&
    showFavoritesOnlyProp !== undefined &&
    onToggleFavorites !== undefined &&
    addShiftDrawerOpenProp !== undefined &&
    onAddShiftDrawerOpenChange !== undefined;
  const search = searchProp ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const showFavoritesOnly = showFavoritesOnlyProp ?? internalShowFavoritesOnly;
  const setShowFavoritesOnly = onToggleFavorites ?? setInternalShowFavoritesOnly;
  const addShiftDrawerOpen = addShiftDrawerOpenProp ?? internalAddShiftDrawerOpen;
  const setAddShiftDrawerOpen = onAddShiftDrawerOpenChange ?? setInternalAddShiftDrawerOpen;
  const [statusFilter, setStatusFilter] = useState<ShiftsStatusFilter>('all');
  const [jobTypeFilter, setJobTypeFilter] = useState<ShiftsJobTypeFilter>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [dateFilterStart, setDateFilterStart] = useState<Date | null>(() => startOfTodayLocal());
  const [dateFilterEnd, setDateFilterEnd] = useState<Date | null>(null);

  const dateFilterStartIso = useMemo(() => dateToLocalYyyyMmDd(dateFilterStart), [dateFilterStart]);
  const dateFilterEndIso = useMemo(() => dateToLocalYyyyMmDd(dateFilterEnd), [dateFilterEnd]);

  const scopeOpts = useMemo(() => {
    if (!account?.id) {
      return { recruiterAccountIds: [] as string[] };
    }
    const ids = new Set<string>([account.id.trim()]);
    (account.childAccountIds ?? []).forEach((id) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    });
    return { recruiterAccountIds: Array.from(ids) };
  }, [account?.id, account?.childAccountIds]);

  const { rows, loading, error, refetch } = useActiveShifts(tenantId, scopeOpts);

  /** Any constrained filter — including default "today" start date — enables Clear (clears dates to show all time; full reload restores defaults). */
  const hasActiveFilters =
    statusFilter !== 'all' ||
    jobTypeFilter !== 'all' ||
    dateFilterStart != null ||
    dateFilterEnd != null;

  if (!account) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 240,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          py: 6,
          color: 'text.secondary',
        }}
      >
        {accountLoading ? <CircularProgress size={32} /> : null}
        <Typography variant="body2" color="text.secondary">
          {accountLoading ? 'Loading account…' : 'Account unavailable.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <PageHeader
        hideHeading
        dense
        showDivider={false}
        title=""
        filters={
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 0,
              width: '100%',
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                gap: 1.25,
                alignItems: 'center',
                flexWrap: 'wrap',
                rowGap: 1,
              }}
            >
              <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center' }}>
                <Button
                  startIcon={<ViewListIcon fontSize="small" />}
                  onClick={() => setActiveView('list')}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: activeView === 'list' ? 600 : 400,
                    color: activeView === 'list' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: activeView === 'list' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': {
                      mr: 0.35,
                      '& svg': { fontSize: 16 },
                    },
                    '&:hover': {
                      bgcolor: activeView === 'list' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  List
                </Button>
                <Button
                  startIcon={<CalendarMonthIcon fontSize="small" />}
                  onClick={() => setActiveView('calendar')}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: activeView === 'calendar' ? 600 : 400,
                    color: activeView === 'calendar' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: activeView === 'calendar' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': {
                      mr: 0.35,
                      '& svg': { fontSize: 16 },
                    },
                    '&:hover': {
                      bgcolor: activeView === 'calendar' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  Calendar
                </Button>
              </Box>

              <Divider
                orientation="vertical"
                flexItem
                sx={{ my: 0.5, borderColor: 'rgba(0, 0, 0, 0.08)' }}
              />

              <Button
                variant="text"
                onClick={() => setFiltersExpanded((o) => !o)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#0057B8',
                  bgcolor: 'rgba(0, 87, 184, 0.06)',
                  px: 1.25,
                  py: 0.5,
                  minHeight: 30,
                  minWidth: 'auto',
                  lineHeight: 1.2,
                  '&:hover': {
                    bgcolor: 'rgba(0, 87, 184, 0.1)',
                  },
                }}
              >
                {filtersExpanded ? 'Hide Filters' : 'Show Filters'}
              </Button>
            </Box>

            <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1.25,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    rowGap: 1,
                    pt: 1.25,
                  }}
                >
                  <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                    <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
                    <Select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as ShiftsStatusFilter)}
                      label="Status"
                      sx={filterSelectSx}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" sx={{ minWidth: 140, height: 36 }}>
                    <InputLabel sx={{ fontSize: '0.875rem' }}>Job Type</InputLabel>
                    <Select
                      value={jobTypeFilter}
                      onChange={(e) => setJobTypeFilter(e.target.value as ShiftsJobTypeFilter)}
                      label="Job Type"
                      sx={filterSelectSx}
                    >
                      {JOB_TYPE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <DatePicker
                    label="Start Date"
                    value={dateFilterStart}
                    onChange={(v) => setDateFilterStart(v)}
                    slotProps={accountShiftsDatePickerSlotProps}
                  />
                  <DatePicker
                    label="End Date"
                    value={dateFilterEnd}
                    onChange={(v) => setDateFilterEnd(v)}
                    slotProps={accountShiftsDatePickerSlotProps}
                  />

                  <Button
                    variant="text"
                    size="small"
                    disabled={!hasActiveFilters}
                    onClick={() => {
                      setStatusFilter('all');
                      setJobTypeFilter('all');
                      setDateFilterStart(null);
                      setDateFilterEnd(null);
                    }}
                    sx={{
                      textTransform: 'none',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: hasActiveFilters ? '#0057B8' : 'rgba(0, 0, 0, 0.35)',
                      minHeight: 30,
                      minWidth: 'auto',
                      px: 1,
                      '&:hover': {
                        bgcolor: hasActiveFilters ? 'rgba(0, 87, 184, 0.06)' : 'transparent',
                      },
                    }}
                  >
                    Clear filters
                  </Button>
                </Box>
              </LocalizationProvider>
            </Collapse>
          </Box>
        }
        rightActions={
          toolbarHoistedToParent ? undefined : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <UniversalSearchBar
                value={search}
                onChange={setSearch}
                onSearch={setSearch}
                placeholder="Search shifts..."
                favoriteType="shifts"
                showFavoritesOnly={showFavoritesOnly}
                onToggleFavorites={setShowFavoritesOnly}
              />
              <Tooltip title="Add shift">
                <IconButton
                  onClick={() => setAddShiftDrawerOpen(true)}
                  sx={{
                    width: 32,
                    height: 32,
                    bgcolor: '#0057B8',
                    color: '#fff',
                    '&:hover': { bgcolor: '#004a9f' },
                  }}
                >
                  <AddIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )
        }
      />

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          pb: 2,
        }}
      >
        {activeView === 'list' ? (
          <ShiftsTable
            tenantId={tenantId}
            rows={rows}
            loading={loading}
            error={error}
            search={search}
            showFavoritesOnly={showFavoritesOnly}
            accountFilter="all"
            statusFilter={statusFilter}
            jobTypeFilter={jobTypeFilter}
            accountFilterDisabled
            dateFilterStartIso={dateFilterStartIso}
            dateFilterEndIso={dateFilterEndIso}
            emptyStateNoDataMessage="No shifts for job orders linked to this account."
          />
        ) : (
          <ShiftsCalendarFiltered
            tenantId={tenantId}
            rows={rows}
            loading={loading}
            error={error}
            search={search}
            showFavoritesOnly={showFavoritesOnly}
            statusFilter={statusFilter}
            jobTypeFilter={jobTypeFilter}
            /* The month grid shows its whole month — past/completed shifts
               included — so the List view's default "from today" start
               filter is dropped here unless the user explicitly set a
               range (start moved off today, or any end date). */
            dateFilterStartIso={
              dateFilterStartIso === todayIsoLocal() && !dateFilterEndIso
                ? null
                : dateFilterStartIso
            }
            dateFilterEndIso={dateFilterEndIso}
          />
        )}
      </Box>

      <ShiftPlacementsDrawer
        open={addShiftDrawerOpen}
        onClose={() => setAddShiftDrawerOpen(false)}
        tenantId={tenantId ?? null}
        jobOrderId={null}
        shift={null}
        pickJobOrderFirst
        // Pre-select the current account so the recruiter doesn't have
        // to re-pick the account they're already viewing. The Job
        // order dropdown immediately scopes to this account's JOs;
        // they can still pivot to another account inside the drawer
        // if they need to. Name is passed as a hydration fallback
        // for the case where the account has no JOs yet (the
        // Autocomplete option list derives from the JO query).
        initialAccountId={account?.id ?? null}
        initialAccountName={account?.name ?? null}
        onShiftAdded={() => {
          void refetch();
        }}
      />
    </Box>
  );
};

/** Applies the same client filters as `ShiftsCalendar.tsx` (no account dropdown). */
const ShiftsCalendarFiltered: React.FC<{
  tenantId: string | null | undefined;
  rows: ShiftRow[];
  loading: boolean;
  error: string | null;
  search: string;
  showFavoritesOnly: boolean;
  statusFilter: ShiftsStatusFilter;
  jobTypeFilter: ShiftsJobTypeFilter;
  dateFilterStartIso: string | null;
  dateFilterEndIso: string | null;
}> = ({
  tenantId,
  rows,
  loading,
  error,
  search,
  showFavoritesOnly,
  statusFilter,
  jobTypeFilter,
  dateFilterStartIso,
  dateFilterEndIso,
}) => {
  const { isFavorite } = useFavorites('shifts');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayIso = todayIsoLocal();
    return rows.filter((r) => {
      if (showFavoritesOnly && !isFavorite(`${r.jobOrder.id}:${r.shift.id}`)) {
        return false;
      }
      if (statusFilter !== 'all' && (r.shift.status ?? 'open') !== statusFilter) {
        return false;
      }
      if (jobTypeFilter !== 'all' && r.jobOrder.jobType !== jobTypeFilter) {
        return false;
      }
      if (!shiftRowOverlapsDateRange(r, dateFilterStartIso, dateFilterEndIso, todayIso)) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        r.shift.shiftTitle,
        r.shift.defaultJobTitle,
        r.jobOrder.jobTitle,
        r.jobOrder.jobOrderNumber,
        r.jobOrder.companyName,
        r.jobOrder.worksiteName,
        r.jobOrder.worksiteAddress?.city,
        r.jobOrder.worksiteAddress?.state,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    rows,
    search,
    showFavoritesOnly,
    statusFilter,
    jobTypeFilter,
    dateFilterStartIso,
    dateFilterEndIso,
    isFavorite,
  ]);

  return (
    <ShiftsCalendarView
      tenantId={tenantId}
      rows={filtered}
      loading={loading}
      error={error}
    />
  );
};

export default AccountShiftsTab;
