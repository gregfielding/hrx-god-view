import React, { useEffect, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import UniversalSearchBar from '../components/UniversalSearchBar';
import type { RecruiterOutletContext } from './RecruiterDashboard';

type AccountsTab = 'accounts' | 'my-accounts';

const AccountsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const isTopLevelTabRoute = normalizedPath === '/accounts' || normalizedPath === '/accounts/my';

  const getActiveTab = (): AccountsTab => {
    if (normalizedPath === '/accounts/my') return 'my-accounts';
    return 'accounts';
  };

  const [activeTab, setActiveTab] = useState<AccountsTab>(getActiveTab());
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  useEffect(() => {
    setSearch('');
    setShowFavoritesOnly(false);
  }, [activeTab]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isTopLevelTabRoute && (
        <PageHeader
          hideHeading
          dense
          title=""
          rightActions={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <UniversalSearchBar
                value={search}
                onChange={setSearch}
                onSearch={setSearch}
                placeholder="Search accounts..."
                favoriteType="accounts"
                showFavoritesOnly={showFavoritesOnly}
                onToggleFavorites={setShowFavoritesOnly}
              />
              {/* Universal icon-only Add button. Mirrors the "Create new group"
                  button on /users/user-groups so all top-of-page Add actions
                  share one consistent look. */}
              <Tooltip title="Add account">
                <IconButton
                  onClick={() => navigate(`${location.pathname}?new=1`)}
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
      )}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          paddingTop: '8px',
          // Bottom spacing comes from LayoutOutlet (16px). Don't double-pad
          // here or the table won't fill the viewport.
          pb: 0,
          '&::-webkit-scrollbar': { width: '8px', height: '8px' },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Outlet
          context={{
            activeTab: activeTab as RecruiterOutletContext['activeTab'],
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

export default AccountsDashboard;
