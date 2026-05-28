/**
 * Recruiter Dashboard
 * 
 * Main recruiter page with tab navigation following Inbox Standard.
 * Replaces card-based layout with filter button tabs in header.
 * Job Orders is the default active tab.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, Divider, IconButton, Tooltip } from '@mui/material';
import {
  Work as WorkIcon,
  Assignment as AssignmentIcon,
  Add as AddIcon,
  Person as PersonIcon,
  GroupAdd as GroupAddIcon,
  PlaylistAddCheck as PlaylistAddCheckIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import UniversalSearchBar from '../components/UniversalSearchBar';
import { useAuth } from '../contexts/AuthContext';
import AddJobOrderModal from '../components/recruiter/AddJobOrderModal';

export type RecruiterTab =
  | 'job-orders'
  | 'my-orders'
  | 'my-queue'
  | 'jobs-board'
  | 'reports';

export type RecruiterOutletContext = {
  activeTab: RecruiterTab;
  /** Live value of the header search input — fires on every keystroke. */
  search: string;
  setSearch: (value: string) => void;
  /**
   * Committed query — only updates on Enter, Clear (X), or suggestion-pick.
   * Optional because most list surfaces don't distinguish live vs committed;
   * those callers should fall back to `search`. Currently provided by
   * `UsersLayout` so the expensive `/users/all` server scan only fires when
   * the user explicitly commits.
   */
  submittedSearch?: string;
  setSubmittedSearch?: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
  /**
   * Show/hide state for the Job Orders / My Job Orders inline filter row.
   * Lifted up here (mirrors `/shifts/list`) so the toggle button can live
   * in the global PageHeader tab strip instead of inside the page body.
   * Optional because this context type is reused by Accounts / Contacts /
   * Companies / Users surfaces that have no inline filter row.
   */
  filtersExpanded?: boolean;
  setFiltersExpanded?: (value: boolean) => void;
  /** Set by Job Orders / My Job Orders list so the header modal can refresh after creating an order. */
  jobOrdersListRefreshRef?: React.MutableRefObject<(() => Promise<void>) | null>;
};

const RecruiterDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantId, user } = useAuth();
  const jobOrdersListRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const [newJobOrderModalOpen, setNewJobOrderModalOpen] = useState(false);

  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const pathParts = normalizedPath.split('/').filter(Boolean); // e.g. ['jobs', 'job-orders', ':id?']
  const isTopLevelTabRoute = pathParts.length === 2; // '/jobs/<tab>'

  // Get active tab from URL or default to 'job-orders'
  const getActiveTab = (): RecruiterTab => {
    const path = location.pathname;
    // Check my-queue BEFORE my-orders so the substring match doesn't collide.
    if (path.includes('/my-queue')) return 'my-queue';
    if (path.includes('/my-orders')) return 'my-orders';
    if (path.includes('/job-orders')) return 'job-orders';
    if (path.includes('/jobs-board')) return 'jobs-board';
    if (path.includes('/reports')) return 'reports';
    return 'job-orders';
  };

  const [activeTab, setActiveTab] = useState<RecruiterTab>(getActiveTab());
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // Mirrors `/shifts/list`: the Job Orders filter row is collapsed by
  // default; the toggle button lives next to the tabs in the header.
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Update active tab when route changes
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  // Reset search and favorites when switching tabs. Filter visibility
  // also resets so /jobs/my-orders doesn't inherit the open state from
  // /jobs/job-orders (and vice versa).
  useEffect(() => {
    setSearch('');
    setShowFavoritesOnly(false);
    setFiltersExpanded(false);
  }, [activeTab]);

  const handleTabChange = (tab: RecruiterTab) => {
    setActiveTab(tab);
    navigate(tab === 'job-orders' ? '/jobs/job-orders' : `/jobs/${tab}`);
  };

  const tabs = [
    { id: 'job-orders' as RecruiterTab, label: 'Job Orders', icon: <WorkIcon fontSize="small" /> },
    { id: 'my-orders' as RecruiterTab, label: 'My Job Orders', icon: <PersonIcon fontSize="small" /> },
    // Phase 1 readiness action queue — readiness items owned by the current recruiter.
    // { id: 'my-queue' as RecruiterTab, label: 'My Queue', icon: <PlaylistAddCheckIcon fontSize="small" /> },
    { id: 'jobs-board' as RecruiterTab, label: 'Jobs Board', icon: <AssignmentIcon fontSize="small" /> },
  ];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isTopLevelTabRoute && (
        <PageHeader
          hideHeading
          dense
          showDivider={false}
          title=""
          filters={
            <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'wrap' }}>
              {tabs.map((tab) => {
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

              {/* Show/Hide filters — design copied from `/shifts/list`. The
                  matching collapsible filter row lives in <RecruiterJobOrders>
                  and reads `filtersExpanded` from outlet context. The toggle
                  is only meaningful on the Job Orders / My Job Orders tabs;
                  Jobs Board has no inline filters. */}
              {(activeTab === 'job-orders' || activeTab === 'my-orders') && (
                <>
                  <Divider
                    orientation="vertical"
                    flexItem
                    sx={{ mx: 0.5, my: 0.5, borderColor: 'rgba(0, 0, 0, 0.08)' }}
                  />
                  <Button
                    variant="text"
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
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
                </>
              )}
            </Box>
          }
          rightActions={
            activeTab === 'job-orders' || activeTab === 'my-orders' || activeTab === 'jobs-board'
                ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <UniversalSearchBar
                  value={search}
                  onChange={setSearch}
                  onSearch={setSearch}
                  placeholder={
                    activeTab === 'job-orders' || activeTab === 'my-orders'
                      ? 'Search job orders...'
                      : 'Search job posts...'
                  }
                  favoriteType={
                    activeTab === 'job-orders' || activeTab === 'my-orders'
                      ? 'jobOrders'
                      : 'jobPosts'
                  }
                  showFavoritesOnly={showFavoritesOnly}
                  onToggleFavorites={setShowFavoritesOnly}
                />
                {(activeTab === 'job-orders' || activeTab === 'my-orders') && (
                  <Tooltip title="Add job order">
                    <IconButton
                      onClick={() => setNewJobOrderModalOpen(true)}
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
                )}
                {activeTab === 'jobs-board' && (
                  <Tooltip title="Add job post">
                    <IconButton
                      onClick={() => navigate('/jobs/jobs-board?new=1')}
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
                )}
              </Box>
                )
                : undefined
          }
        />
      )}

      <AddJobOrderModal
        open={newJobOrderModalOpen}
        onClose={() => setNewJobOrderModalOpen(false)}
        onSaved={async () => {
          await jobOrdersListRefreshRef.current?.();
        }}
        tenantId={tenantId ?? null}
        userId={user?.uid ?? ''}
        requireAccountSelection
      />

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Outlet
          context={{
            activeTab,
            search,
            setSearch,
            showFavoritesOnly,
            setShowFavoritesOnly,
            filtersExpanded,
            setFiltersExpanded,
            jobOrdersListRefreshRef,
          } satisfies RecruiterOutletContext}
        />
      </Box>
    </Box>
  );
};

export default RecruiterDashboard;
