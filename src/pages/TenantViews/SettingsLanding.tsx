import React, { useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ChatIcon from '@mui/icons-material/Chat';
import PeopleIcon from '@mui/icons-material/People';
import PageHeader from '../../components/PageHeader';
import CompanySetup from './CompanySetup';
import MessagingTab from './MessagingTab';
import SenderManagementPage from './SenderManagementPage';
import SlackAdminPage from '../Admin/SlackAdminPage';
import WorkforceManagement from './WorkforceManagement';
import { useAuth } from '../../contexts/AuthContext';

type SettingsTab = 'company-setup' | 'messaging' | 'senders' | 'slack' | 'workforce';

const SettingsLanding: React.FC = () => {
  const { tenantId } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('company-setup');

  const settingsTabs = [
    {
      id: 'company-setup' as SettingsTab,
      title: 'Company Setup',
      icon: <BusinessIcon sx={{ fontSize: 20 }} />,
    },
    {
      id: 'messaging' as SettingsTab,
      title: 'Messaging',
      icon: <EmailIcon sx={{ fontSize: 20 }} />,
    },
    {
      id: 'senders' as SettingsTab,
      title: 'Sender Management',
      icon: <PhoneAndroidIcon sx={{ fontSize: 20 }} />,
    },
    {
      id: 'slack' as SettingsTab,
      title: 'Slack Integration',
      icon: <ChatIcon sx={{ fontSize: 20 }} />,
    },
    {
      id: 'workforce' as SettingsTab,
      title: 'Workforce Management',
      icon: <PeopleIcon sx={{ fontSize: 20 }} />,
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'company-setup':
        return <CompanySetup />;
      case 'messaging':
        return tenantId ? <MessagingTab tenantId={tenantId} /> : null;
      case 'senders':
        return <SenderManagementPage />;
      case 'slack':
        return <SlackAdminPage />;
      case 'workforce':
        return <WorkforceManagement />;
      default:
        return <CompanySetup />;
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <SettingsIcon sx={{ fontSize: 24, color: 'primary.main' }} />
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: '20px', md: '24px' },
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Settings
            </Typography>
          </Box>
        }
        subtitle="Manage your organization's configuration and preferences"
        filters={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {settingsTabs.map((tab) => (
              <Button
                key={tab.id}
                variant="text"
                startIcon={tab.icon}
                onClick={() => setActiveTab(tab.id)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontSize: '14px',
                  fontWeight: activeTab === tab.id ? 500 : 400,
                  color: activeTab === tab.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  bgcolor: activeTab === tab.id ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                  px: 1.5,
                  py: 0.75,
                  minWidth: 'auto',
                  whiteSpace: 'nowrap',
                  '&:hover': {
                    bgcolor: activeTab === tab.id ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                  },
                }}
              >
                {tab.title}
              </Button>
            ))}
          </Box>
        }
      />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {renderTabContent()}
        </Box>
      </Box>
    </Box>
  );
};

export default SettingsLanding;

