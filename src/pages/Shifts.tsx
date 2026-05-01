/**
 * Shifts — cross-job-order shift dashboard.
 *
 * Layout shell: top-of-page pill tabs (Inbox Standard, mirroring
 * `RecruiterDashboard`) and an `<Outlet />` for the active tab body.
 *
 * Two views share the same dataset:
 *   - **List**     — paginated table (default landing).
 *   - **Calendar** — month-grid visualization of the same shifts.
 *
 * Data fetching lives at this level (`useActiveShifts`) so switching tabs
 * does not refetch. Both child pages read `rows`, `loading`, `error`, and
 * `search` via `useOutletContext<ShiftsOutletContext>()`.
 *
 * Sec 5/6/7 only — the gate is enforced at the route layer (App.tsx) and
 * the sidebar entry (menuGenerator.ts).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Add as AddIcon,
  ViewList as ViewListIcon,
  CalendarMonth as CalendarMonthIcon,
} from '@mui/icons-material';

import PageHeader from '../components/PageHeader';
import ShiftPlacementsDrawer from '../components/shifts/ShiftPlacementsDrawer';
import UniversalSearchBar from '../components/UniversalSearchBar';
import { useAuth } from '../contexts/AuthContext';
import { useSetTopBarTitle } from '../contexts/TopBarTitleContext';
import useActiveShifts from '../hooks/useActiveShifts';
import type { ShiftRow, ShiftStatus } from '../utils/shifts/shiftRow';

export type ShiftsTab = 'list' | 'calendar';

/** "all" or one of the canonical ShiftStatus values. */
export type ShiftsStatusFilter = 'all' | ShiftStatus;

/** "all" or one of the canonical JobOrder.jobType values. */
export type ShiftsJobTypeFilter = 'all' | 'gig' | 'career';

export type ShiftsOutletContext = {
  activeTab: ShiftsTab;
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
  /** "all" or an exact company name match against `jobOrder.companyName`. */
  accountFilter: string;
  setAccountFilter: (value: string) => void;
  /** "all" | open | closed | filled | cancelled. */
  statusFilter: ShiftsStatusFilter;
  setStatusFilter: (value: ShiftsStatusFilter) => void;
  /** "all" | gig | career. Matches `jobOrder.jobType`. */
  jobTypeFilter: ShiftsJobTypeFilter;
  setJobTypeFilter: (value: ShiftsJobTypeFilter) => void;
  rows: ShiftRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const STATUS_OPTIONS: Array<{ value: ShiftsStatusFilter; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const JOB_TYPE_OPTIONS: Array<{ value: ShiftsJobTypeFilter; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'gig', label: 'Gig' },
  { value: 'career', label: 'Career' },
];

// Canonical sx for compact toolbar dropdowns. Mirrors the look used on
// /jobs and /contacts (white bg, 6px radius, 36px high) so every list
// page's filter row reads as the same control.
const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

const TABS: Array<{ id: ShiftsTab; label: string; icon: React.ReactNode }> = [
  { id: 'list', label: 'List', icon: <ViewListIcon fontSize="small" /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarMonthIcon fontSize="small" /> },
];

const Shifts: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantId } = useAuth();

  const getActiveTab = (): ShiftsTab => {
    if (location.pathname.includes('/shifts/calendar')) return 'calendar';
    return 'list';
  };

  const [activeTab, setActiveTab] = useState<ShiftsTab>(getActiveTab());
  const [addShiftDrawerOpen, setAddShiftDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ShiftsStatusFilter>('all');
  const [jobTypeFilter, setJobTypeFilter] = useState<ShiftsJobTypeFilter>('all');

  // Shared data fetch — lives at the parent so List ↔ Calendar tab switches
  // don't trigger a re-fetch.
  const { rows, loading, error, refetch } = useActiveShifts(tenantId);

  // Account dropdown options are derived from whatever shifts are currently
  // loaded — keeps the menu honest (no companies the user can't actually
  // select), and avoids an extra Firestore query for the company list.
  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const name = r.jobOrder.companyName?.trim();
      if (name) seen.add(name);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // True iff any of the toolbar filters is set away from its default
  // ("all"). Drives the enabled state of the Clear filters button so the
  // user can't fire a no-op state churn when nothing is filtered.
  const hasActiveFilters =
    accountFilter !== 'all' || statusFilter !== 'all' || jobTypeFilter !== 'all';

  // If the currently-selected account disappears from the result set
  // (e.g. shifts ended, JO closed), fall back to "All" so the user
  // doesn't end up staring at an empty page with a stale chip.
  useEffect(() => {
    if (accountFilter !== 'all' && !accountOptions.includes(accountFilter)) {
      setAccountFilter('all');
    }
  }, [accountFilter, accountOptions]);

  // Top bar shows the static section label "Shifts" instead of the
  // tenant name (which is the global default). Mirrors the pattern from
  // RecruiterAccountDetails / Workforce — section pages override the
  // top bar with their own title.
  const topBarTitleNode = useMemo(
    () => (
      <Typography
        sx={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'inherit',
          lineHeight: 1.2,
        }}
      >
        Shifts
      </Typography>
    ),
    [],
  );
  useSetTopBarTitle(topBarTitleNode);

  useEffect(() => {
    setActiveTab(getActiveTab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleTabChange = (tab: ShiftsTab) => {
    setActiveTab(tab);
    navigate(`/shifts/${tab}`);
  };

  const outletContext = useMemo<ShiftsOutletContext>(
    () => ({
      activeTab,
      search,
      setSearch,
      showFavoritesOnly,
      setShowFavoritesOnly,
      accountFilter,
      setAccountFilter,
      statusFilter,
      setStatusFilter,
      jobTypeFilter,
      setJobTypeFilter,
      rows,
      loading,
      error,
      refetch,
    }),
    [
      activeTab,
      search,
      showFavoritesOnly,
      accountFilter,
      statusFilter,
      jobTypeFilter,
      rows,
      loading,
      error,
      refetch,
    ],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        hideHeading
        dense
        showDivider={false}
        title=""
        filters={
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center' }}>
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <Button
                    key={tab.id}
                    startIcon={tab.icon}
                    onClick={() => handleTabChange(tab.id)}
                    variant="text"
                    sx={{
                      textTransform: 'none',
                      borderRadius: '999px',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
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
                        bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                      },
                    }}
                  >
                    {tab.label}
                  </Button>
                );
              })}
            </Box>

            <Divider
              orientation="vertical"
              flexItem
              sx={{ my: 0.5, borderColor: 'rgba(0, 0, 0, 0.08)' }}
            />

            <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Account</InputLabel>
              <Select
                value={accountFilter}
                onChange={(e) => setAccountFilter(String(e.target.value))}
                label="Account"
                sx={filterSelectSx}
              >
                <MenuItem value="all">All Accounts</MenuItem>
                {accountOptions.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

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

            <Button
              variant="text"
              size="small"
              disabled={!hasActiveFilters}
              onClick={() => {
                setAccountFilter('all');
                setStatusFilter('all');
                setJobTypeFilter('all');
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
        }
        rightActions={
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
            {/* Opens ShiftPlacementsDrawer: pick a job order, then manage
                placements / create a shift on that JO (no row shift locked). */}
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
        <Outlet context={outletContext} />
      </Box>

      <ShiftPlacementsDrawer
        open={addShiftDrawerOpen}
        onClose={() => setAddShiftDrawerOpen(false)}
        tenantId={tenantId ?? null}
        jobOrderId={null}
        shift={null}
        pickJobOrderFirst
        onShiftAdded={() => {
          void refetch();
        }}
      />
    </Box>
  );
};

export default Shifts;
