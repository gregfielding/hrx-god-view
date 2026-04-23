import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Typography,
  Button,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ChatIcon from '@mui/icons-material/Chat';
import PeopleIcon from '@mui/icons-material/People';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
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
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import ComplianceLibraryPlaceholder from './settings/ComplianceLibraryPlaceholder';
import CredentialTypesPlaceholder from './settings/CredentialTypesPlaceholder';
import ScreeningTypesPlaceholder from './settings/ScreeningTypesPlaceholder';
import BenefitsProgramsPlaceholder from './settings/BenefitsProgramsPlaceholder';
import PayrollProvidersPlaceholder from './settings/PayrollProvidersPlaceholder';
import MessagingSequencesPlaceholder from './settings/MessagingSequencesPlaceholder';
import AISignalsSettings from './settings/AISignalsSettings';
import WorkersCompRatesPage from './settings/WorkersCompRatesPage';
import ApiServiceDetailContent from './settings/ApisAndServicesPage';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import ApiOutlinedIcon from '@mui/icons-material/ApiOutlined';
import {
  APIS_SERVICES_TAB_PREFIX,
  getApisServiceCatalogEntry,
  parseApisServicesTab,
} from '../../config/apisAndServicesCatalog';
import {
  SETTINGS_NAV_GROUPS,
  findGroupForTab,
  findNavItemLabel,
  SETTINGS_TAB_KEYS,
  type CoreSettingsTab,
  type SettingsTab,
} from '../../config/settingsNavigation';

const TAB_ICON_SX = { fontSize: 20 };

const CORE_TAB_ICONS: Record<CoreSettingsTab, React.ReactNode> = {
  'company-setup': <BusinessIcon sx={TAB_ICON_SX} />,
  entities: <AccountBalanceIcon sx={TAB_ICON_SX} />,
  'onboarding-library': <LibraryBooksIcon sx={TAB_ICON_SX} />,
  documents: <DescriptionIcon sx={TAB_ICON_SX} />,
  messaging: <EmailIcon sx={TAB_ICON_SX} />,
  'messaging-sequences': <AutoAwesomeMotionIcon sx={TAB_ICON_SX} />,
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
  'workers-comp': <HealthAndSafetyIcon sx={TAB_ICON_SX} />,
  'ai-signals': <PsychologyIcon sx={TAB_ICON_SX} />,
};

function settingsNavIcon(tab: SettingsTab): React.ReactNode {
  if (typeof tab === 'string' && tab.startsWith('apis-services__')) {
    return <ApiOutlinedIcon sx={TAB_ICON_SX} />;
  }
  return CORE_TAB_ICONS[tab as CoreSettingsTab];
}

function isSettingsTabKey(s: string | null): s is SettingsTab {
  return s != null && (SETTINGS_TAB_KEYS as string[]).includes(s);
}

const SettingsLanding: React.FC = () => {
  const theme = useTheme();
  const isDesktopNav = useMediaQuery(theme.breakpoints.up('md'));
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const { tenantId, activeTenant, recruiterEnabled, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;

  const canWorkersComp = useMemo(() => {
    const sec = parseInt(String(currentClaimsSecurityLevel ?? securityLevel ?? '0'), 10);
    return Boolean(recruiterEnabled && sec >= 5);
  }, [recruiterEnabled, currentClaimsSecurityLevel, securityLevel]);

  const navGroups = useMemo(() => {
    if (canWorkersComp) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.key !== 'workers-comp'),
    }));
  }, [canWorkersComp]);

  const [activeTab, setActiveTab] = useState<SettingsTab>('company-setup');

  useEffect(() => {
    if (tabFromUrl === 'workers-comp' && !canWorkersComp) {
      setSearchParams({}, { replace: true });
      setActiveTab('company-setup');
      return;
    }
    if (isSettingsTabKey(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, canWorkersComp, setSearchParams]);

  const selectTab = useCallback(
    (key: SettingsTab) => {
      setActiveTab(key);
      if (key === 'company-setup') {
        setSearchParams({}, { replace: true });
      } else {
        setSearchParams({ tab: key }, { replace: true });
      }
    },
    [setSearchParams],
  );

  const activeGroup = useMemo(() => findGroupForTab(activeTab), [activeTab]);

  const renderTabContent = () => {
    if (typeof activeTab === 'string' && activeTab.startsWith(APIS_SERVICES_TAB_PREFIX)) {
      const apiServiceId = parseApisServicesTab(activeTab);
      if (apiServiceId) {
        const entry = getApisServiceCatalogEntry(apiServiceId);
        return entry ? (
          <ApiServiceDetailContent entry={entry} />
        ) : (
          <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
            <Alert severity="warning">Unknown APIs &amp; Services entry.</Alert>
          </Box>
        );
      }
      return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
          <Alert severity="warning">Unknown or removed APIs &amp; Services entry.</Alert>
        </Box>
      );
    }

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
      case 'messaging-sequences':
        return <MessagingSequencesPlaceholder />;
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
      case 'workers-comp':
        if (!canWorkersComp) {
          return (
            <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
              <Alert severity="warning">
                You don&apos;t have permission to manage Workers Comp settings (recruiting access and security level 5+
                required).
              </Alert>
            </Box>
          );
        }
        return effectiveTenantId ? (
          <WorkersCompRatesPage tenantId={effectiveTenantId} embeddedInSettings />
        ) : null;
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
      {navGroups.map((group) => (
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
                startIcon={settingsNavIcon(item.key)}
                onClick={() => selectTab(item.key)}
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
      {navGroups.map((group) => (
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
              onClick={() => selectTab(item.key)}
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
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>{settingsNavIcon(item.key)}</ListItemIcon>
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
    <Box
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      aria-label={
        activeGroup
          ? `Settings · ${activeGroup.label} · ${findNavItemLabel(activeTab)}`
          : 'Settings'
      }
    >
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
