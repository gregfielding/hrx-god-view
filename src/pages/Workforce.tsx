/**
 * Workforce — top-level CSA workspace (Phase D, spec §1).
 *
 * Layout shell: pill-tab navigation (Employee Readiness / Job Readiness),
 * shared search box on the right of the header, and an `<Outlet />` for the
 * active tab body. State for scope, status filters, entity filter, and
 * search lives here so toggling tabs preserves the filter context (CSAs
 * frequently bounce between the two views while triaging the same worker
 * cohort).
 *
 * Naming locked by Greg 2026-04-25: nav label is `Workforce`. Role term stays
 * **CSA** everywhere — do NOT rename to "WSA" / "Workforce Success Agent" in
 * this file or anywhere else in this PR.
 *
 * Sec L5+ only — gate enforced at the route layer (App.tsx) and the sidebar
 * entry (menuGenerator.ts).
 *
 * @see ../utils/workforceLayoutPersistence — restores per-user state across
 *   sessions so a CSA returning Monday morning lands where they left off.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import HowToRegIcon from '@mui/icons-material/HowToReg';

import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import { useAuth } from '../contexts/AuthContext';
import {
  loadWorkforceLayoutPersisted,
  persistWorkforceLayout,
  type WorkforceEntityFilter,
  type WorkforceScope,
  type WorkforceTabId,
} from '../utils/workforceLayoutPersistence';
import {
  DEFAULT_WORKFORCE_STATUS_FILTERS,
  type WorkforceStatusFilterId,
} from '../utils/readinessQueue';

/**
 * Routes for the two Workforce tabs.
 *
 * Path prefix is `/readiness/*`, NOT `/workforce/*` — the `/workforce`
 * namespace was already in use for the tenant company directory
 * (`WorkforceDashboard`) when Phase D started. The user-facing nav LABEL
 * stays "Workforce" (spec naming-lock applies to the label, not the URL);
 * the URL was renamed to `/readiness` per Greg's 2026-04-25 D.1 promote
 * answer to avoid colliding with the existing surface.
 */
const WORKFORCE_TAB_PATHS: Record<WorkforceTabId, string> = {
  'employee-readiness': '/readiness/employee-readiness',
  'job-readiness': '/readiness/job-readiness',
  'i9-signatures': '/readiness/i9-signatures',
};

const TABS: ReadonlyArray<{ id: WorkforceTabId; label: string; icon: React.ReactNode }> = [
  {
    id: 'employee-readiness',
    label: 'Employee Readiness',
    icon: <AssignmentIndIcon fontSize="small" />,
  },
  {
    id: 'job-readiness',
    label: 'Job Readiness',
    icon: <WorkOutlineIcon fontSize="small" />,
  },
  {
    id: 'i9-signatures',
    label: 'I-9 Signatures Needed',
    icon: <HowToRegIcon fontSize="small" />,
  },
];

/**
 * Outlet context shape — every Workforce tab gets the full filter state plus
 * setters so pages don't have to plumb down to root for changes. Tabs that
 * don't need a particular filter (e.g. Job Readiness ignores the status
 * chips) just don't read it.
 */
export interface WorkforceOutletContext {
  activeTab: WorkforceTabId;
  scope: WorkforceScope;
  setScope: (next: WorkforceScope) => void;
  statusFilters: WorkforceStatusFilterId[];
  setStatusFilters: (next: WorkforceStatusFilterId[]) => void;
  showComplete: boolean;
  setShowComplete: (next: boolean) => void;
  entityFilter: WorkforceEntityFilter;
  setEntityFilter: (next: WorkforceEntityFilter) => void;
  search: string;
  setSearch: (next: string) => void;
}

const Workforce: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const persisted = useMemo(() => loadWorkforceLayoutPersisted(uid), [uid]);

  const getActiveTab = useCallback((): WorkforceTabId => {
    if (location.pathname.includes('/readiness/job-readiness')) return 'job-readiness';
    if (location.pathname.includes('/readiness/i9-signatures')) return 'i9-signatures';
    return 'employee-readiness';
  }, [location.pathname]);

  const [activeTab, setActiveTab] = useState<WorkforceTabId>(getActiveTab);
  const [scope, setScopeRaw] = useState<WorkforceScope>(persisted.scope);
  const [statusFilters, setStatusFiltersRaw] = useState<WorkforceStatusFilterId[]>(
    persisted.statusFilters.length > 0
      ? persisted.statusFilters
      : [...DEFAULT_WORKFORCE_STATUS_FILTERS],
  );
  const [showComplete, setShowCompleteRaw] = useState<boolean>(persisted.showComplete);
  const [entityFilter, setEntityFilterRaw] = useState<WorkforceEntityFilter>(
    persisted.entityFilter,
  );
  const [search, setSearchRaw] = useState<string>(persisted.searchText);

  // Sync activeTab from URL changes — covers back/forward and external nav.
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [getActiveTab]);

  // -------- Persistence wrappers --------
  // Each setter mirrors its state through to localStorage so the CSA's view
  // restores on next visit. Persistence calls are best-effort (private mode /
  // quota errors are swallowed inside `persistWorkforceLayout`).
  const setScope = useCallback(
    (next: WorkforceScope) => {
      setScopeRaw(next);
      persistWorkforceLayout(uid, { scope: next });
    },
    [uid],
  );
  const setStatusFilters = useCallback(
    (next: WorkforceStatusFilterId[]) => {
      setStatusFiltersRaw(next);
      persistWorkforceLayout(uid, { statusFilters: next });
    },
    [uid],
  );
  const setShowComplete = useCallback(
    (next: boolean) => {
      setShowCompleteRaw(next);
      persistWorkforceLayout(uid, { showComplete: next });
    },
    [uid],
  );
  const setEntityFilter = useCallback(
    (next: WorkforceEntityFilter) => {
      setEntityFilterRaw(next);
      persistWorkforceLayout(uid, { entityFilter: next });
    },
    [uid],
  );
  const setSearch = useCallback(
    (next: string) => {
      setSearchRaw(next);
      // Don't persist on every keystroke — that's a localStorage write
      // per character. Persist on a timer instead.
      schedulePersistSearch(uid, next);
    },
    [uid],
  );

  const handleTabChange = useCallback(
    (tab: WorkforceTabId) => {
      setActiveTab(tab);
      navigate(WORKFORCE_TAB_PATHS[tab]);
      persistWorkforceLayout(uid, { lastTab: tab });
    },
    [navigate, uid],
  );

  const outletContext = useMemo<WorkforceOutletContext>(
    () => ({
      activeTab,
      scope,
      setScope,
      statusFilters,
      setStatusFilters,
      showComplete,
      setShowComplete,
      entityFilter,
      setEntityFilter,
      search,
      setSearch,
    }),
    [
      activeTab,
      scope,
      setScope,
      statusFilters,
      setStatusFilters,
      showComplete,
      setShowComplete,
      entityFilter,
      setEntityFilter,
      search,
      setSearch,
    ],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        hideHeading
        dense
        title=""
        filters={
          <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'wrap' }}>
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
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <InboxSearchBar
              value={search}
              onChange={setSearch}
              onSearch={setSearch}
              placeholder={
                activeTab === 'job-readiness'
                  ? 'Search JO# or title...'
                  : 'Search worker name or id...'
              }
            />
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
    </Box>
  );
};

// -------- Search persistence debouncing --------
// localStorage writes on every keystroke add up — debounce ~300ms.
let searchPersistTimer: number | null = null;
function schedulePersistSearch(uid: string | null, value: string): void {
  if (searchPersistTimer != null) {
    window.clearTimeout(searchPersistTimer);
  }
  searchPersistTimer = window.setTimeout(() => {
    persistWorkforceLayout(uid, { searchText: value });
    searchPersistTimer = null;
  }, 300);
}

export default Workforce;
