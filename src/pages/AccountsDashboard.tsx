import React, { useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';
import { Add as AddIcon, AccountBalance as AccountBalanceIcon, Person as PersonIcon } from '@mui/icons-material';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
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

  const handleTabChange = (tab: AccountsTab) => {
    setActiveTab(tab);
    navigate(tab === 'my-accounts' ? '/accounts/my' : '/accounts');
  };

  const tabs = [
    { id: 'accounts' as AccountsTab, label: 'Accounts', icon: <AccountBalanceIcon fontSize="small" /> },
    { id: 'my-accounts' as AccountsTab, label: 'My Accounts', icon: <PersonIcon fontSize="small" /> },
  ];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isTopLevelTabRoute && (
        <PageHeader
          title="Accounts"
          subtitle="Manage recruiter accounts"
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <InboxSearchBar
                value={search}
                onChange={setSearch}
                onSearch={setSearch}
                placeholder="Search accounts..."
              />
              <FavoritesFilter
                favoriteType="accounts"
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
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate(`${location.pathname}?new=1`)}
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
                Add Account
              </Button>
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
          pb: 2,
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
