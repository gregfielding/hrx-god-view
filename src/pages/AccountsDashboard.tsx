import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  Add as AddIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import UniversalSearchBar from '../components/UniversalSearchBar';
import type { RecruiterOutletContext } from './RecruiterDashboard';

type AccountsTab = 'accounts' | 'my-accounts';
type AccountsStatusFilter = 'all' | 'active' | 'inactive';
type AccountsSortField = 'name' | 'createdAt';

/**
 * Outlet context the Accounts pages receive. Extends the shared
 * `RecruiterOutletContext` with Accounts-specific filter state so the pill
 * tabs / Status / Sort By controls can live in the global PageHeader row
 * (alongside search + Add) instead of in a second filter bar inside the
 * <RecruiterAccounts /> outlet — keeping the table flush against the page top.
 */
export type AccountsOutletContext = RecruiterOutletContext & {
  statusFilter: AccountsStatusFilter;
  setStatusFilter: (value: AccountsStatusFilter) => void;
  sortField: AccountsSortField;
  setSortField: (value: AccountsSortField) => void;
};

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
  const [statusFilter, setStatusFilter] = useState<AccountsStatusFilter>('all');
  const [sortField, setSortField] = useState<AccountsSortField>('name');

  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  // Reset surface filters when the tab switches so /accounts/my doesn't
  // inherit a stale state filter from /accounts (and vice versa).
  useEffect(() => {
    setSearch('');
    setShowFavoritesOnly(false);
    setStatusFilter('all');
    setSortField('name');
  }, [activeTab]);

  // Pill tabs + Status + Sort By, lifted from the inner page so they live on
  // the same toolbar row as the universal search + Add button.
  const filterBar = (
    <>
      {[
        { id: 'accounts' as const, label: 'Accounts', icon: <AccountBalanceIcon fontSize="small" />, to: '/accounts' },
        { id: 'my-accounts' as const, label: 'My Accounts', icon: <PersonIcon fontSize="small" />, to: '/accounts/my' },
      ].map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <Button
            key={tab.id}
            startIcon={tab.icon}
            onClick={() => navigate(tab.to)}
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
              height: 30,
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

      <FormControl size="small" sx={{ minWidth: 140, height: 36 }}>
        <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AccountsStatusFilter)}
          label="Status"
          sx={{
            height: 36,
            borderRadius: '6px',
            backgroundColor: 'white',
            fontSize: '0.875rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
          }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="inactive">Inactive</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: 140, height: 36 }}>
        <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
        <Select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as AccountsSortField)}
          label="Sort By"
          sx={{
            height: 36,
            borderRadius: '6px',
            backgroundColor: 'white',
            fontSize: '0.875rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
          }}
        >
          <MenuItem value="name">Name</MenuItem>
          <MenuItem value="createdAt">Date Created</MenuItem>
        </Select>
      </FormControl>
    </>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isTopLevelTabRoute && (
        <PageHeader
          hideHeading
          dense
          showDivider={false}
          title=""
          filters={filterBar}
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
            statusFilter,
            setStatusFilter,
            sortField,
            setSortField,
          } satisfies AccountsOutletContext}
        />
      </Box>
    </Box>
  );
};

export default AccountsDashboard;
