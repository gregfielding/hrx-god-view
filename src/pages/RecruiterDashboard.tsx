/**
 * Recruiter Dashboard
 * 
 * Main recruiter page with tab navigation following Inbox Standard.
 * Replaces card-based layout with filter button tabs in header.
 * Job Orders is the default active tab.
 */

import React, { useState, useEffect } from 'react';
import { Box, Button, useTheme } from '@mui/material';
import {
  Work as WorkIcon,
  Assignment as AssignmentIcon,
  Add as AddIcon,
  Person as PersonIcon,
  GroupAdd as GroupAddIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { useAuth } from '../contexts/AuthContext';

export type RecruiterTab =
  | 'job-orders'
  | 'my-orders'
  | 'jobs-board'
  | 'reports';

export type RecruiterOutletContext = {
  activeTab: RecruiterTab;
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
};

const RecruiterDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTenant } = useAuth();
  const theme = useTheme();

  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const pathParts = normalizedPath.split('/').filter(Boolean); // e.g. ['jobs', 'job-orders', ':id?']
  const isTopLevelTabRoute = pathParts.length === 2; // '/jobs/<tab>'

  // Get active tab from URL or default to 'job-orders'
  const getActiveTab = (): RecruiterTab => {
    const path = location.pathname;
    if (path.includes('/my-orders')) return 'my-orders';
    if (path.includes('/job-orders')) return 'job-orders';
    if (path.includes('/jobs-board')) return 'jobs-board';
    if (path.includes('/reports')) return 'reports';
    return 'job-orders';
  };

  const [activeTab, setActiveTab] = useState<RecruiterTab>(getActiveTab());
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Update active tab when route changes
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  // Reset search and favorites when switching tabs
  useEffect(() => {
    setSearch('');
    setShowFavoritesOnly(false);
  }, [activeTab]);

  const handleTabChange = (tab: RecruiterTab) => {
    setActiveTab(tab);
    navigate(tab === 'job-orders' ? '/jobs/job-orders' : `/jobs/${tab}`);
  };

  const tabs = [
    { id: 'job-orders' as RecruiterTab, label: 'Job Orders', icon: <WorkIcon fontSize="small" /> },
    { id: 'my-orders' as RecruiterTab, label: 'My Job Orders', icon: <PersonIcon fontSize="small" /> },
    { id: 'jobs-board' as RecruiterTab, label: 'Jobs Board', icon: <AssignmentIcon fontSize="small" /> },
  ];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isTopLevelTabRoute && (
        <PageHeader
          title="Jobs"
          subtitle="Manage job orders and job posts"
          filters={
            <Box display="flex" gap={0.5}>
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
                      fontSize: '14px',
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                      px: 1.5,
                      py: 0.75,
                      minWidth: 'auto',
                      whiteSpace: 'nowrap',
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
            activeTab === 'job-orders' || activeTab === 'my-orders' || activeTab === 'jobs-board'
                ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <FavoritesFilter
                  favoriteType={
                    activeTab === 'job-orders' || activeTab === 'my-orders'
                      ? 'jobOrders'
                      : 'jobPosts'
                  }
                  showFavoritesOnly={showFavoritesOnly}
                  onToggle={setShowFavoritesOnly}
                  showText={false}
                  size="small"
                  sx={{
                    minWidth: '36px',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    '&:hover': {
                      backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                    },
                  }}
                />
                <InboxSearchBar
                  value={search}
                  onChange={setSearch}
                  onSearch={setSearch}
                  placeholder={
                    activeTab === 'job-orders' || activeTab === 'my-orders'
                      ? 'Search job orders...'
                      : 'Search job posts...'
                  }
                />
                {(activeTab === 'job-orders' || activeTab === 'my-orders') && (
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => navigate('/jobs/job-orders/new')}
                    sx={{
                      textTransform: 'none',
                      borderRadius: '24px',
                      px: 2.5,
                      py: 1,
                      height: '40px',
                      fontWeight: 500,
                      fontSize: '14px',
                      bgcolor: '#0057B8',
                      boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                      '&:hover': {
                        bgcolor: '#004a9f',
                        boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                      },
                      whiteSpace: 'nowrap',
                    }}
                  >
                    New Order
                  </Button>
                )}
                {activeTab === 'jobs-board' && (
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => navigate('/jobs/jobs-board?new=1')}
                    sx={{
                      textTransform: 'none',
                      borderRadius: '24px',
                      px: 2.5,
                      py: 1,
                      height: '40px',
                      fontWeight: 500,
                      fontSize: '14px',
                      bgcolor: '#0057B8',
                      boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                      '&:hover': {
                        bgcolor: '#004a9f',
                        boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                      },
                      whiteSpace: 'nowrap',
                    }}
                  >
                    New Post
                  </Button>
                )}
              </Box>
                )
                : undefined
          }
        />
      )}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          pb: 2, // 16px bottom padding standard
        }}
      >
        <Outlet
          context={{
            activeTab,
            search,
            setSearch,
            showFavoritesOnly,
            setShowFavoritesOnly,
          } satisfies RecruiterOutletContext}
        />
      </Box>
    </Box>
  );
};

export default RecruiterDashboard;
