import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';
import CompanyDirectory from './CompanyDirectory';
import AddWorkers from './AddWorkers';
import PendingInvites from './PendingInvites';
import IntegrationsTab from './IntegrationsTab';

const WorkforceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTenant, tenantId } = useAuth();
  const theme = useTheme();

  const effectiveTenantId = activeTenant?.id || tenantId;

  // Determine active tab based on current route
  const getActiveTab = () => {
    if (location.pathname.includes('/company-directory')) return 'company-directory';
    if (location.pathname.includes('/add-workers')) return 'add-workers';
    if (location.pathname.includes('/pending-invites')) return 'pending-invites';
    if (location.pathname.includes('/integrations')) return 'integrations';
    return 'company-directory'; // Default to Company Directory
  };

  const [activeTab, setActiveTab] = useState<string>(getActiveTab());
  const [search, setSearch] = useState('');

  // Update active tab when route changes
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  // Reset search when switching tabs
  useEffect(() => {
    setSearch('');
  }, [activeTab]);

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    navigate(`/workforce/${tab}`);
  };

  const tabs = [
    { id: 'company-directory', label: 'Company Directory' },
    { id: 'add-workers', label: 'Add Workers' },
    { id: 'pending-invites', label: 'Pending Invites' },
    { id: 'integrations', label: 'Integrations' },
  ];

  // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'company-directory':
        return <CompanyDirectory search={search} onSearchChange={setSearch} />;
      case 'add-workers':
        return <AddWorkers />;
      case 'pending-invites':
        return <PendingInvites />;
      case 'integrations':
        return effectiveTenantId ? <IntegrationsTab tenantId={effectiveTenantId} /> : null;
      default:
        return <CompanyDirectory search={search} onSearchChange={setSearch} />;
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Workforce Management"
        subtitle="Manage your workforce, employees, and organizational structure"
        filters={
          <Box
            sx={{
              display: 'flex',
              gap: 1, // match Inbox chip spacing
              flexWrap: 'nowrap',
              minWidth: 0,
            }}
          >
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                variant="contained"
                onClick={() => handleTabClick(tab.id)}
                sx={{
                  minWidth: 'auto',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  px: 2,
                  py: 0.75,
                  fontSize: '0.875rem',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  textTransform: 'none',
                  borderRadius: '999px',
                  boxShadow: 'none',
                  border: 'none',
                  ...(activeTab === tab.id
                    ? {
                        bgcolor: '#0057B8',
                        color: '#FFFFFF',
                        '&:hover': { bgcolor: '#004a9f' },
                      }
                    : {
                        bgcolor: 'rgba(0, 0, 0, 0.06)', // Inbox-style chip background
                        color: 'rgba(0, 0, 0, 0.78)',
                        '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.10)' },
                      }),
                }}
              >
                {tab.label}
              </Button>
            ))}
          </Box>
        }
        rightActions={
          activeTab === 'company-directory' ? (
            <TextField
              placeholder="Search workers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="small"
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.2rem' }} />,
              }}
              sx={{ 
                width: { xs: '100%', md: 300 },
                maxWidth: { md: 420 },
                '& .MuiOutlinedInput-root': {
                  fontSize: '14px',
                },
              }}
            />
          ) : undefined
        }
      />

      {/* Tab Content */}
      <Box sx={{ 
        px: { xs: 2, md: 3 }, 
        py: 2,
        flex: 1,
        overflowY: 'auto',
        minHeight: 0, // Allow flex child to shrink
      }}>
        {renderContent()}
      </Box>
    </Box>
  );
};

export default WorkforceDashboard;
