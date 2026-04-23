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
          hideHeading
          dense
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
            </Box>
          }
          rightActions={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <FavoritesFilter
                favoriteType="accounts"
                showFavoritesOnly={showFavoritesOnly}
                onToggle={setShowFavoritesOnly}
                showText={false}
                size="small"
                sx={{
                  minWidth: '32px',
                  width: '32px',
                  height: '32px',
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
                placeholder="Search accounts..."
              />
              <Button
                variant="contained"
                startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                onClick={() => navigate(`${location.pathname}?new=1`)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  px: 1.5,
                  py: 0.5,
                  minHeight: 30,
                  height: 30,
                  fontWeight: 600,
                  fontSize: '13px',
                  bgcolor: '#0057B8',
                  boxShadow: 'none',
                  '& .MuiButton-startIcon': { mr: 0.35 },
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
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
          minWidth: 0,
          paddingTop: '8px',
          pb: 2,
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
