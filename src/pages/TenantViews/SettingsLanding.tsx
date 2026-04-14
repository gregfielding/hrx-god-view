import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ChatIcon from '@mui/icons-material/Chat';
import PeopleIcon from '@mui/icons-material/People';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PageHeader from '../../components/PageHeader';
import CompanySetup from './CompanySetup';
import EntitiesPage from './settings/EntitiesPage';
import OnboardingLibraryPage from './settings/OnboardingLibraryPage';
import SignaturesDocumentsPage from './settings/SignaturesDocumentsPage';
import MessagingTab from './MessagingTab';
import SenderManagementPage from './SenderManagementPage';
import SlackAdminPage from '../Admin/SlackAdminPage';
import WorkforceManagement from './WorkforceManagement';
import EverifyAdminOpsPage from './EverifyAdminOpsPage';
import SmartGroupsSettings from './SmartGroupsSettings';
import { useAuth } from '../../contexts/AuthContext';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import DescriptionIcon from '@mui/icons-material/Description';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BadgeIcon from '@mui/icons-material/Badge';
import SecurityIcon from '@mui/icons-material/Security';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ComplianceLibraryPlaceholder from './settings/ComplianceLibraryPlaceholder';
import CredentialTypesPlaceholder from './settings/CredentialTypesPlaceholder';
import ScreeningTypesPlaceholder from './settings/ScreeningTypesPlaceholder';
import BenefitsProgramsPlaceholder from './settings/BenefitsProgramsPlaceholder';
import PayrollProvidersPlaceholder from './settings/PayrollProvidersPlaceholder';
import AISignalsSettings from './settings/AISignalsSettings';
import {
  SETTINGS_NAV_GROUPS,
  findGroupForTab,
  type SettingsTab,
} from '../../config/settingsNavigation';

const TAB_ICON_SX = { fontSize: 20 };

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  'company-setup': <BusinessIcon sx={TAB_ICON_SX} />,
  entities: <AccountBalanceIcon sx={TAB_ICON_SX} />,
  'onboarding-library': <LibraryBooksIcon sx={TAB_ICON_SX} />,
  documents: <DescriptionIcon sx={TAB_ICON_SX} />,
  messaging: <EmailIcon sx={TAB_ICON_SX} />,
  senders: <PhoneAndroidIcon sx={TAB_ICON_SX} />,
  slack: <ChatIcon sx={TAB_ICON_SX} />,
  workforce: <PeopleIcon sx={TAB_ICON_SX} />,
  'smart-groups': <GroupWorkIcon sx={TAB_ICON_SX} />,
  'everify-ops': <AdminPanelSettingsIcon sx={TAB_ICON_SX} />,
  'compliance-library': <VerifiedUserIcon sx={TAB_ICON_SX} />,
  'credential-types': <BadgeIcon sx={TAB_ICON_SX} />,
  'screening-types': <SecurityIcon sx={TAB_ICON_SX} />,
  'benefits-programs': <LocalHospitalIcon sx={TAB_ICON_SX} />,
  'payroll-providers': <AccountBalanceWalletIcon sx={TAB_ICON_SX} />,
  'ai-signals': <PsychologyIcon sx={TAB_ICON_SX} />,
};

const SettingsLanding: React.FC = () => {
  const theme = useTheme();
  const isDesktopNav = useMediaQuery(theme.breakpoints.up('md'));
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;
  const [activeTab, setActiveTab] = useState<SettingsTab>('company-setup');

  const activeGroup = useMemo(() => findGroupForTab(activeTab), [activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'company-setup':
        return <CompanySetup />;
      case 'entities':
        return <EntitiesPage />;
      case 'onboarding-library':
        return <OnboardingLibraryPage />;
      case 'documents':
        return effectiveTenantId ? <SignaturesDocumentsPage /> : null;
      case 'messaging':
        return effectiveTenantId ? <MessagingTab tenantId={effectiveTenantId} /> : null;
      case 'senders':
        return <SenderManagementPage />;
      case 'slack':
        return <SlackAdminPage />;
      case 'workforce':
        return <WorkforceManagement />;
      case 'smart-groups':
        return effectiveTenantId ? <SmartGroupsSettings tenantId={effectiveTenantId} /> : null;
      case 'everify-ops':
        return effectiveTenantId ? <EverifyAdminOpsPage tenantId={effectiveTenantId} /> : null;
      case 'compliance-library':
        return <ComplianceLibraryPlaceholder />;
      case 'credential-types':
        return <CredentialTypesPlaceholder />;
      case 'screening-types':
        return <ScreeningTypesPlaceholder />;
      case 'benefits-programs':
        return <BenefitsProgramsPlaceholder />;
      case 'payroll-providers':
        return <PayrollProvidersPlaceholder />;
      case 'ai-signals':
        return <AISignalsSettings />;
      default:
        return <CompanySetup />;
    }
  };

  const navPillSx = (selected: boolean) => ({
    textTransform: 'none' as const,
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: selected ? 600 : 400,
    color: selected ? theme.palette.primary.contrastText : theme.palette.text.primary,
    bgcolor: selected ? theme.palette.primary.main : theme.palette.action.hover,
    px: 1.5,
    py: 0.75,
    minWidth: 'auto',
    whiteSpace: 'nowrap' as const,
    border: '1px solid',
    borderColor: selected ? theme.palette.primary.main : 'transparent',
    '&:hover': {
      bgcolor: selected ? theme.palette.primary.dark : theme.palette.action.selected,
    },
  });

  const renderMobileGroupedPills = () => (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, borderBottom: 1, borderColor: 'divider' }}>
      {SETTINGS_NAV_GROUPS.map((group) => (
        <Box key={group.id} sx={{ mb: 2 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{
              display: 'block',
              letterSpacing: 0.8,
              fontWeight: 700,
              fontSize: '0.7rem',
              mb: 1,
            }}
          >
            {group.label}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {group.items.map((item) => (
              <Button
                key={item.key}
                variant="text"
                startIcon={TAB_ICONS[item.key]}
                onClick={() => setActiveTab(item.key)}
                sx={navPillSx(activeTab === item.key)}
              >
                {item.label}
              </Button>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );

  const renderDesktopSideNav = () => (
    <Box
      component="nav"
      aria-label="Settings sections"
      sx={{
        width: 280,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        overflowY: 'auto',
        px: 1.5,
        py: 2,
        bgcolor: 'background.default',
      }}
    >
      {SETTINGS_NAV_GROUPS.map((group) => (
        <Box key={group.id} sx={{ mb: 2.5 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{
              display: 'block',
              letterSpacing: 0.8,
              fontWeight: 700,
              fontSize: '0.7rem',
              px: 1,
              mb: 0.75,
            }}
          >
            {group.label}
          </Typography>
          {group.items.map((item) => (
            <ListItemButton
              key={item.key}
              selected={activeTab === item.key}
              onClick={() => setActiveTab(item.key)}
              sx={{
                borderRadius: 1,
                py: 0.75,
                mb: 0.25,
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '& .MuiListItemIcon-root': { color: 'inherit' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>{TAB_ICONS[item.key]}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ variant: 'body2', fontWeight: activeTab === item.key ? 600 : 400 }}
              />
            </ListItemButton>
          ))}
        </Box>
      ))}
    </Box>
  );

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
        subtitle={
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Manage your organization&apos;s configuration and preferences
            </Typography>
            {activeGroup ? (
              <Typography variant="body2" color="text.secondary" component="p" sx={{ m: 0 }}>
                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  Settings
                </Box>
                {' / '}
                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  {activeGroup.label}
                </Box>
              </Typography>
            ) : null}
          </Box>
        }
      />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          overflow: 'hidden',
        }}
      >
        {!isDesktopNav ? renderMobileGroupedPills() : null}
        {isDesktopNav ? renderDesktopSideNav() : null}

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
          <Box sx={{ flex: 1, minHeight: 0 }}>{renderTabContent()}</Box>
        </Box>
      </Box>
    </Box>
  );
};

export default SettingsLanding;
