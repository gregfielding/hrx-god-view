/**
 * Workforce Dashboard
 * 
 * Main workforce management page with tab navigation following Inbox Standard.
 * Replaces card-based layout with filter button tabs in header.
 */

import React, { useState, useEffect } from 'react';
import { Box, Button, useTheme } from '@mui/material';
import {
  People as PeopleIcon,
  PersonAdd as PersonAddIcon,
  PendingActions as PendingIcon,
  IntegrationInstructions as IntegrationInstructionsIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import InboxSearchBar from '../../components/InboxSearchBar';
import CompanyDirectory from './CompanyDirectory';
import AddWorkers from './AddWorkers';
import PendingInvites from './PendingInvites';
import IntegrationsTab from './IntegrationsTab';
import { useAuth } from '../../contexts/AuthContext';

export type WorkforceTab = 'company-directory' | 'add-workers' | 'pending-invites' | 'integrations';

const WorkforceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTenant } = useAuth();
  const theme = useTheme();

  // Get active tab from URL or default to 'company-directory'
  const getActiveTab = (): WorkforceTab => {
    const path = location.pathname;
    if (path.includes('/company-directory')) return 'company-directory';
    if (path.includes('/add-workers')) return 'add-workers';
    if (path.includes('/pending-invites')) return 'pending-invites';
    if (path.includes('/integrations')) return 'integrations';
    return 'company-directory'; // Default active tab
  };

  const [activeTab, setActiveTab] = useState<WorkforceTab>(getActiveTab());
  const [search, setSearch] = useState('');

  // Update active tab when route changes
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [location.pathname]);

  // Reset search when switching tabs
  useEffect(() => {
    setSearch('');
  }, [activeTab]);

  const handleTabChange = (tab: WorkforceTab) => {
    setActiveTab(tab);
    // Navigate to the tab's route
    navigate(`/workforce/${tab}`);
  };

  const tabs = [
    {
      id: 'company-directory' as WorkforceTab,
      label: 'Company Directory',
      icon: <PeopleIcon fontSize="small" />,
    },
    {
      id: 'add-workers' as WorkforceTab,
      label: 'Add Workers',
      icon: <PersonAddIcon fontSize="small" />,
    },
    {
      id: 'pending-invites' as WorkforceTab,
      label: 'Pending Invites',
      icon: <PendingIcon fontSize="small" />,
    },
    {
      id: 'integrations' as WorkforceTab,
      label: 'Integrations',
      icon: <IntegrationInstructionsIcon fontSize="small" />,
    },
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
        return activeTenant?.id ? <IntegrationsTab tenantId={activeTenant.id} /> : null;
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
          activeTab === 'company-directory' ? (
            <InboxSearchBar
              value={search}
              onChange={setSearch}
              onSearch={setSearch}
              placeholder="Search workers..."
            />
          ) : undefined
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
          pb: 2, // 16px bottom padding standard
        }}
      >
        {renderContent()}
      </Box>
    </Box>
  );
};

export default WorkforceDashboard;
