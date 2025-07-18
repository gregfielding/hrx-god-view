import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '../theme/theme';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

import {
  AppBar,
  Avatar,
  Box,
  CssBaseline,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  FormControl,
  Select,
  Chip,
  Fab,
  Drawer,
} from '@mui/material';

import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import AppsIcon from '@mui/icons-material/Apps';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import SettingsIcon from '@mui/icons-material/Settings';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HelpIcon from '@mui/icons-material/Help';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import SecurityIcon from '@mui/icons-material/Security';
import ChatIcon from '@mui/icons-material/Chat';
import ChatUI from './ChatUI';
import CloseIcon from '@mui/icons-material/Close';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import GroupsIcon from '@mui/icons-material/Groups';
import WavesIcon from '@mui/icons-material/Waves';
import CampaignIcon from '@mui/icons-material/Campaign';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import DescriptionIcon from '@mui/icons-material/Description';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import ExtensionIcon from '@mui/icons-material/Extension';
import LogoutIcon from '@mui/icons-material/Logout';
import WorkIcon from '@mui/icons-material/Work';

import { useAuth } from '../contexts/AuthContext';
import { getAccessRole } from '../utils/AccessRoles'; // Import AccessRoles helpers
import { generateMenuItems, hasMenuAccess, MenuItem as MenuItemType } from '../utils/menuGenerator';
import { Role, SecurityLevel } from '../utils/AccessRoles';
import FeedbackEngine from '../pages/Admin/FeedbackEngine';
import TenantSwitcher from './TenantSwitcher';

const drawerFullWidth = 240;
const drawerCollapsedWidth = 64;
const appBarHeight = 64;

const Layout: React.FC = () => {
  console.log('Layout rendered');
  const { toggleMode, mode } = useThemeMode();
  const { user, role, securityLevel, logout, avatarUrl, orgType, tenantId, tenantIds, activeTenant, setActiveTenant, loading: authLoading } = useAuth();
  const isMobile = useMediaQuery('(max-width:768px)');
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(true);
  const setOpenWithLog = (value) => { console.log('setOpen', value); setOpen(value); };
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const setMenuAnchorElWithLog = (value) => { console.log('setMenuAnchorEl', value); setMenuAnchorEl(value); };
  const [firstName, setFirstName] = useState<string | null>(null);
  const setFirstNameWithLog = (value) => { console.log('setFirstName', value); setFirstName(value); };
  const [lastName, setLastName] = useState<string | null>(null);
  const setLastNameWithLog = (value) => { console.log('setLastName', value); setLastName(value); };
  
  // Development role switcher state
  const [devRole, setDevRole] = useState<Role>(role);
  const setDevRoleWithLog = (value) => { console.log('setDevRole', value); setDevRole(value); };
  const [devSecurityLevel, setDevSecurityLevel] = useState<SecurityLevel>(securityLevel);
  const setDevSecurityLevelWithLog = (value) => { console.log('setDevSecurityLevel', value); setDevSecurityLevel(value); };
  const [devOrgType, setDevOrgType] = useState<'Agency' | 'Customer' | 'HRX' | 'Tenant' | null>(orgType);
  const setDevOrgTypeWithLog = (value) => { console.log('setDevOrgType', value); setDevOrgType(value); };

  // Tenant state
  const [tenants, setTenants] = useState<any[]>([]); // TODO: type Tenant
  const [tenantsLoading, setTenantsLoading] = useState(false);

  // Add a ref to track if we've already set the initial tenant
  const hasSetInitialTenant = useRef(false);

  const drawerWidth = open ? drawerFullWidth : drawerCollapsedWidth;
  const isMenuOpen = Boolean(menuAnchorEl);

  // Use development values for testing, fallback to real values
  const effectiveRole = devRole || role;
  const effectiveSecurityLevel = devSecurityLevel || securityLevel;
  const effectiveOrgType = devOrgType || orgType;
  const userAccessRole = getAccessRole(effectiveRole, effectiveSecurityLevel);

  const [showChat, setShowChat] = useState(false);
  // For now, default to showing the chat button unless user?.hideChatbot is true
  const showChatbotButton = !(user && (user as any).hideChatbot);
  const setShowChatWithLog = (value) => { console.log('setShowChat', value); setShowChat(value); };

  const [agencyLogoUrl, setAgencyLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    setOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user?.uid) {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFirstName(data.firstName || null);
          setLastName(data.lastName || null);
        }
      }
    };
    fetchUserData();
  }, [user]);

  useEffect(() => {
    const fetchTenantLogo = async () => {
      if (orgType === 'Tenant' && tenantId) {
        try {
          const tenantRef = doc(db, 'tenants', tenantId);
          const tenantSnap = await getDoc(tenantRef);
          if (tenantSnap.exists()) {
            const data = tenantSnap.data();
            setAgencyLogoUrl(data.avatar || null);
          } else {
            setAgencyLogoUrl(null);
          }
        } catch {
          setAgencyLogoUrl(null);
        }
      } else {
        setAgencyLogoUrl(null);
      }
    };
    fetchTenantLogo();
  }, [orgType, tenantId]);

  // Remove the fetchTenants useCallback entirely and keep the inline function
  // const fetchTenants = useCallback(async () => { ... }, [tenantIds, tenantId]);

  useEffect(() => {
    console.log('useEffect triggered:', { authLoading, tenantIds, user });
    if (!authLoading && user && tenantIds && tenantIds.length > 0 && !tenantsLoading) {
      console.log('Auth loaded and tenantIds available, fetching tenants');
      // Call fetchTenants directly without including it in dependencies
      const fetchTenantsDirectly = async () => {
        // Convert tenantIds to array if it's a map/object
        const tenantIdList = Array.isArray(tenantIds)
          ? tenantIds
          : (tenantIds ? Object.keys(tenantIds) : []);
        console.log('DEBUG: tenantIdList', tenantIdList);
        if (!tenantIdList || tenantIdList.length === 0) {
          return;
        }
        setTenantsLoading(true);
        try {
          const tenantPromises = tenantIdList.map(async (tid) => {
            const tenantRef = doc(db, 'tenants', tid);
            const tenantSnap = await getDoc(tenantRef);
            if (tenantSnap.exists()) {
              const data = tenantSnap.data();
              console.log('DEBUG: tenant data for', tid, data);
              return {
                id: tid,
                name: data.name || 'Unknown Tenant',
                type: data.type || 'Tenant',
                avatar: data.avatar || '',
                slug: data.slug || ''
              };
            } else {
              console.warn('DEBUG: tenant not found for', tid);
            }
            return null;
          });
          const tenantResults = await Promise.all(tenantPromises);
          const validTenants = tenantResults.filter((t): t is NonNullable<typeof t> => t !== null);
          console.log('DEBUG: validTenants', validTenants);
          setTenants(validTenants);
          // Only set initial tenant if we haven't already and activeTenant is not set
          if (!hasSetInitialTenant.current && !activeTenant) {
            let initialTenant = null;
            if (tenantId && validTenants.some(t => t.id === tenantId)) {
              initialTenant = validTenants.find(t => t.id === tenantId);
            }
            if (!initialTenant) {
              initialTenant = validTenants[0] || null;
            }
            setActiveTenant(initialTenant);
            hasSetInitialTenant.current = true;
          }
        } catch (err) {
          setTenants([]);
          setActiveTenant(null);
          console.error('DEBUG: fetchTenants error', err);
        } finally {
          setTenantsLoading(false);
        }
      };
      fetchTenantsDirectly();
    } else {
      console.log('Waiting for auth to load or tenantIds to be available');
    }
  }, [authLoading, user, tenantIds, tenantId]); // Removed tenantsLoading from dependencies to prevent infinite loop

  // Simplify handleSetActiveTenant to only call setActiveTenant
  const handleSetActiveTenant = (tenant) => {
    setActiveTenant(tenant);
  };

  const toggleDrawer = () => setOpen((prev) => !prev);
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) =>
    setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleLogout = async () => {
    await logout();
    handleMenuClose();
    navigate('/login');
  };
  const handleSettings = () => {
    if (user) navigate(`/users/${user.uid}`);
    handleMenuClose();
  };

  // Generate menu items based on user role and org type
  const [menuItems, setMenuItems] = useState<MenuItemType[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [flexModuleEnabled, setFlexModuleEnabled] = useState(false);
  const [recruiterModuleEnabled, setRecruiterModuleEnabled] = useState(false);
  const [customersModuleEnabled, setCustomersModuleEnabled] = useState(false);
  const [jobsBoardModuleEnabled, setJobsBoardModuleEnabled] = useState(false);

  // Real-time listener for flex module status
  useEffect(() => {
    if (!activeTenant?.id || activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // Not a tenant or is HRX, no need to listen for flex module
      setFlexModuleEnabled(false);
      return;
    }

    const flexModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Flex module status changed:', isEnabled);
        setFlexModuleEnabled(isEnabled);
      } else {
        console.log('Flex module document does not exist, defaulting to disabled');
        setFlexModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to flex module status:', error);
      setFlexModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id]);

  // Real-time listener for recruiter module status
  useEffect(() => {
    if (!activeTenant?.id || activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // Not a tenant or is HRX, no need to listen for recruiter module
      setRecruiterModuleEnabled(false);
      return;
    }

    const recruiterModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-recruiter');
    const unsubscribe = onSnapshot(recruiterModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Recruiter module status changed:', isEnabled);
        setRecruiterModuleEnabled(isEnabled);
      } else {
        console.log('Recruiter module document does not exist, defaulting to disabled');
        setRecruiterModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to recruiter module status:', error);
      setRecruiterModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id]);

  // Real-time listener for customers module status
  useEffect(() => {
    if (!activeTenant?.id || activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // Not a tenant or is HRX, no need to listen for customers module
      setCustomersModuleEnabled(false);
      return;
    }

    const customersModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-customers');
    const unsubscribe = onSnapshot(customersModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Customers module status changed:', isEnabled);
        setCustomersModuleEnabled(isEnabled);
      } else {
        console.log('Customers module document does not exist, defaulting to disabled');
        setCustomersModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to customers module status:', error);
      setCustomersModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id]);

  // Real-time listener for jobs board module status
  useEffect(() => {
    if (!activeTenant?.id || activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // Not a tenant or is HRX, no need to listen for jobs board module
      setJobsBoardModuleEnabled(false);
      return;
    }

    const jobsBoardModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-jobs-board');
    const unsubscribe = onSnapshot(jobsBoardModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Jobs Board module status changed:', isEnabled);
        setJobsBoardModuleEnabled(isEnabled);
      } else {
        console.log('Jobs Board module document does not exist, defaulting to disabled');
        setJobsBoardModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to jobs board module status:', error);
      setJobsBoardModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id]);

  useEffect(() => {
    const generateMenu = async () => {
      setMenuLoading(true);
      try {
        console.log('Generating menu with:', { userAccessRole, activeTenant, flexModuleEnabled, recruiterModuleEnabled, customersModuleEnabled, jobsBoardModuleEnabled });
        const items = await generateMenuItems(userAccessRole, (activeTenant?.type === 'HRX' ? 'HRX' : 'Tenant'), activeTenant?.id, flexModuleEnabled, recruiterModuleEnabled, customersModuleEnabled, jobsBoardModuleEnabled);
        console.log('Generated menu items:', items);
        setMenuItems(items);
      } catch (error) {
        console.error('Error generating menu:', error);
        setMenuItems([]);
      } finally {
        setMenuLoading(false);
      }
    };
    generateMenu();
  }, [userAccessRole, activeTenant, flexModuleEnabled, recruiterModuleEnabled, customersModuleEnabled, jobsBoardModuleEnabled]);

  const menuItemsWithIcons = menuItems.map(item => {
    const iconMap: Record<string, React.ReactNode> = {
      'Dashboard': <DashboardIcon />, 
      'Customers': <BusinessIcon />, 
      'Agencies': <GroupWorkIcon />,
      'Tenants': <BusinessIcon />,
      'Team Access': <RecordVoiceOverIcon />,
      'Recruiter': <RecordVoiceOverIcon />,
      'Workforce': <PeopleIcon />,
      'Job Orders': <AssignmentIcon />,
      'Flex Jobs': <AssignmentIcon />,
      'Jobs Board': <WorkIcon />,
      'My Assignments': <AssignmentTurnedInIcon />,
      'Locations': <LocationOnIcon />,
      'Schedules': <GroupWorkIcon />,
      'My Schedule': <GroupWorkIcon />,
      'AI Settings': <AutoFixHighIcon />, 
      'User Groups': <GroupsIcon />,
      'Departments': <BusinessIcon />,
      'Reports': <SettingsIcon />,
      'Scheduling': <GroupWorkIcon />,
      'Performance': <SettingsIcon />,
      'Reviews': <SettingsIcon />,
      'Check-ins': <NotificationsIcon />,
      'Messages': <NotificationsIcon />,
      'Notifications': <NotificationsIcon />,
      'Privacy & Notifications': <NotificationsIcon />,
      'Modules': <AppsIcon />,
      'AI Launchpad': <RocketLaunchIcon />,
      'Help': <HelpIcon />,
      'Campaigns': <WavesIcon />,
      'Broadcasts': <CampaignIcon />,
      'Resume Management': <DescriptionIcon />,
      'Mobile App Errors': <PhoneIphoneIcon />,
      'Mobile App': <PhoneIphoneIcon />,
      'My Tenant': <BusinessIcon />,
      'Log out': <LogoutIcon />,
    };
    return {
      ...item,
      icon: iconMap[item.text] || <SettingsIcon />,
    };
  });

  // Menu items are now properly generated in menuGenerator.ts

  // Use activeTenant for logo and menu logic
  const initials = activeTenant?.name
    ? activeTenant.name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2)
    : `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();

  console.log('Layout: Rendering with:', { 
    tenants: tenants.length, 
    activeTenant, 
    tenantsLoading, 
    tenantIds, 
    tenantId,
    authLoading,
    user: !!user
  });

  // Ensure only allowed values for devOrgType, devRole, devSecurityLevel
  const allowedOrgTypes = ['Agency', 'Customer', 'HRX', 'Tenant'];
  const allowedRoles = ['Worker', 'Agency', 'Customer', 'HRX'];
  const allowedSecurityLevels = ['0', '1', '2', '3', '4', '5', '6', '7'];

  const safeDevOrgType = allowedOrgTypes.includes(devOrgType) ? devOrgType : '';
  const safeDevRole = allowedRoles.includes(devRole) ? devRole : '';
  const safeDevSecurityLevel = allowedSecurityLevels.includes(devSecurityLevel) ? devSecurityLevel : '';

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />

      {/* Navigation Drawer (sidebar menu) */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: 'border-box',
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100vh',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            transition: (theme) =>
              theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
          },
        }}
      >
        {/* TenantSwitcher at the very top of the Drawer */}
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <TenantSwitcher
            tenants={tenants}
            activeTenant={activeTenant}
            setActiveTenant={handleSetActiveTenant}
            loading={tenantsLoading}
            open={open}
          />
        </Box>
        {/* Removed avatar/welcome and divider here */}
        <List sx={{ flexGrow: 1, pb: '72px' }}>
          {/* My Profile menu item at the top */}
          {user && (
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                component={Link}
                to={`/users/${user.uid}`}
                selected={location.pathname === `/users/${user.uid}`}
                sx={{
                  backgroundColor: location.pathname === `/users/${user.uid}`
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'inherit',
                  '&.Mui-selected': {
                    borderLeft: '4px solid #FFD700',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  },
                  px: open ? 2.5 : 0,
                  py: 1,
                  justifyContent: open ? 'initial' : 'center',
                }}
              >
                <ListItemIcon
                  sx={open ? {
                    minWidth: 0,
                    mr: 3,
                    color: 'inherit',
                  } : {
                    minWidth: 0,
                    width: '100%',
                    mr: 0,
                    justifyContent: 'center',
                    display: 'flex',
                    color: 'inherit',
                  }}
                >
                  <Avatar alt={`${firstName} ${lastName}`} src={avatarUrl || undefined} sx={{ width: open ? 28 : 24, height: open ? 28 : 24 }}>
                    {!avatarUrl && initials}
                  </Avatar>
                </ListItemIcon>
                {open && <ListItemText primary="My Profile" />}
              </ListItemButton>
            </ListItem>
          )}
          {/* All other menu items */}
          {menuLoading ? (
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton disabled>
                <ListItemIcon sx={{ minWidth: 0, mr: 3, color: 'inherit' }}>
                  <SettingsIcon />
                </ListItemIcon>
                {open && <ListItemText primary="Loading menu..." />}
              </ListItemButton>
            </ListItem>
          ) : (
            menuItemsWithIcons.map(({ text, to, icon }) => (
            <ListItem key={text} disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                component={text === 'Log out' ? 'button' : Link}
                {...(text !== 'Log out' ? { to } : {})}
                {...(text !== 'Log out' ? { selected: location.pathname == to } : {})}
                onClick={text === 'Log out' ? async () => { await logout(); } : undefined}
                sx={{
                  backgroundColor: location.pathname.startsWith(to)
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'inherit',
                  '&.Mui-selected': {
                    borderLeft: '4px solid #FFD700',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  },
                  px: open ? 2.5 : 0,
                  py: 0.75,
                  justifyContent: open ? 'initial' : 'center',
                }}
              >
                <ListItemIcon
                  sx={
                    open
                      ? { minWidth: 0, mr: 3, color: 'inherit' }
                      : { minWidth: 0, width: '100%', mr: 0, justifyContent: 'center', display: 'flex', color: 'inherit' }
                  }
                >
                  {icon}
                </ListItemIcon>
                {open && <ListItemText primary={text} />}
              </ListItemButton>
            </ListItem>
          ))
          )}
        </List>
        {/* Fixed Collapse button at the bottom */}
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            bottom: 0,
            width: drawerWidth,
            bgcolor: 'background.paper',
            zIndex: 1201,
            borderTop: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <ListItem disablePadding sx={{ display: 'block' }}>
            <ListItemButton
              onClick={toggleDrawer}
              sx={{
                justifyContent: open ? 'initial' : 'center',
                px: 2.5,
                py: 1.25,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  mr: open ? 3 : 'auto',
                  justifyContent: 'center',
                }}
              >
                <MenuIcon />
              </ListItemIcon>
              {open && <ListItemText primary="Collapse" />}
            </ListItemButton>
          </ListItem>
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          mt: 0, // No AppBar, so no margin top
          height: '100vh',
          overflowY: 'auto',
          transition: (theme) =>
            theme.transitions.create(['margin', 'width'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
        }}
      >
        <Outlet />
        {/* Floating Chatbot Button and Widget */}
        {/* {showChatbotButton && (
          <>
            <Fab
              color="primary"
              aria-label="chat"
              onClick={() => setShowChat(true)}
              sx={{
                position: 'fixed',
                bottom: 32,
                right: 32,
                zIndex: 1300,
                boxShadow: 4,
              }}
            >
              <ChatIcon />
            </Fab>
            {showChat && (
              <Box
                sx={{
                  position: 'fixed',
                  right: 0,
                  bottom: 0,
                  width: 400,
                  maxWidth: '100vw',
                  height: 600,
                  zIndex: 1400,
                  boxShadow: 6,
                  borderTopLeftRadius: 12,
                  borderBottomLeftRadius: 12,
                  bgcolor: 'background.paper',
                  display: 'flex',
                  flexDirection: 'column',
                  p: 0,
                }}
              >
                <ChatUI />
                <IconButton
                  onClick={() => setShowChat(false)}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 1500,
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            )}
          </>
        )} */}
      </Box>
    </Box>
  );
};

export default Layout;
