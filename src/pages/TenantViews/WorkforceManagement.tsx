/**
 * Workforce Management Component
 * 
 * Wrapper for WorkforceDashboard that removes the PageHeader
 * since it's now rendered within the Settings page.
 */

import React, { useState, useEffect } from 'react';
import { Box, Button } from '@mui/material';
import {
  People as PeopleIcon,
  PersonAdd as PersonAddIcon,
  PendingActions as PendingIcon,
  IntegrationInstructions as IntegrationInstructionsIcon,
} from '@mui/icons-material';
import InboxSearchBar from '../../components/InboxSearchBar';
import CompanyDirectory from './CompanyDirectory';
import AddWorkers from './AddWorkers';
import PendingInvites from './PendingInvites';
import IntegrationsTab from './IntegrationsTab';
import { useAuth } from '../../contexts/AuthContext';

export type WorkforceTab = 'company-directory' | 'add-workers' | 'pending-invites' | 'integrations';

const WorkforceManagement: React.FC = () => {
  const { activeTenant } = useAuth();
  const [activeTab, setActiveTab] = useState<WorkforceTab>('company-directory');
  const [search, setSearch] = useState('');

  // Reset search when switching tabs
  useEffect(() => {
    setSearch('');
  }, [activeTab]);

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
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-tabs for Workforce Management */}
      <Box sx={{ mb: 3 }}>
        <Box display="flex" gap={1} alignItems="center" flexWrap="wrap" mb={2}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                startIcon={tab.icon}
                onClick={() => setActiveTab(tab.id)}
                variant={isActive ? 'contained' : 'outlined'}
                sx={{
                  borderRadius: '24px',
                  textTransform: 'none',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 500,
                  px: 2,
                  py: 0.75,
                  minHeight: '36px',
                  ...(isActive && {
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }),
                }}
              >
                {tab.label}
              </Button>
            );
          })}
        </Box>
        
        {/* Search bar for Company Directory */}
        {activeTab === 'company-directory' && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <InboxSearchBar
              value={search}
              onChange={setSearch}
              onSearch={setSearch}
              placeholder="Search workers..."
            />
          </Box>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {renderContent()}
      </Box>
    </Box>
  );
};

export default WorkforceManagement;
