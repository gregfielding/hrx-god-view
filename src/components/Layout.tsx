import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { doc, getDoc, getDocs, onSnapshot, collection, query, where, orderBy, limit, updateDoc } from 'firebase/firestore';
import {
  Avatar,
  Box,
  CssBaseline,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  useMediaQuery,
  Drawer,
  Typography,
  IconButton,
  Badge,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import AppsIcon from '@mui/icons-material/Apps';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import SettingsIcon from '@mui/icons-material/Settings';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HelpIcon from '@mui/icons-material/Help';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import GroupsIcon from '@mui/icons-material/Groups';
import Diversity3Icon from '@mui/icons-material/Diversity3';
import WavesIcon from '@mui/icons-material/Waves';
import CampaignIcon from '@mui/icons-material/Campaign';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import DescriptionIcon from '@mui/icons-material/Description';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import LogoutIcon from '@mui/icons-material/Logout';
import WorkIcon from '@mui/icons-material/Work';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import InboxIcon from '@mui/icons-material/Inbox';
import ChatIcon from '@mui/icons-material/Chat';
import SmsIcon from '@mui/icons-material/Sms';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import SellIcon from '@mui/icons-material/Sell';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import PersonIcon from '@mui/icons-material/Person';
import LanguageIcon from '@mui/icons-material/Language';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { SlackHashIcon } from './icons/SlackHashIcon';

import { db } from '../firebase';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { useThemeMode } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { useHeartbeatPresence } from '../hooks/useHeartbeatPresence';
import { getAccessRole } from '../utils/AccessRoles'; // Import AccessRoles helpers
import { generateMenuItems, MenuItem as MenuItemType, filterMenuItemsByClaims } from '../utils/menuGenerator';
import { Role, SecurityLevel } from '../utils/AccessRoles';

import TenantSwitcher from './TenantSwitcher';
import GoogleConnectionChip from './GoogleConnectionChip';
import { GoogleStatusProvider } from '../contexts/GoogleStatusContext';
import MessengerIconButton from './messenger/MessengerIconButton';
import MessengerDrawer from './messenger/MessengerDrawer';
import { useUnreadMentionsCount } from '../hooks/useUnreadMentionsCount';
import { useChatGPT } from '../contexts/ChatGPTContext';
import ChatGPTDrawer from './chatgpt/ChatGPTDrawer';

const drawerFullWidth = 240;
const drawerCollapsedWidth = 64;
const appBarHeight = 64;
/** Charcoal for staff (0-4) shell icons and text */
const STAFF_SHELL_CHARCOAL = '#36454F';

const Layout: React.FC = React.memo(function Layout() {
  // REMOVED: Excessive logging causing re-renders
  const { toggleMode, mode } = useThemeMode();
  const { 
    user, 
    role, 
    securityLevel, 
    logout, 
    avatarUrl, 
    orgType, 
    tenantId, 
    tenantIds, 
    activeTenant, 
    setActiveTenant, 
    loading: authLoading,
    // New claims-based properties
    isHRX,
    claimsRoles,
    currentClaimsRole,
    currentClaimsSecurityLevel,
    crmSalesEnabled,
    recruiterEnabled,
    jobsBoardEnabled,
  } = useAuth();
  const { openChatGPT } = useChatGPT();
  useHeartbeatPresence(); // Write user presence to Firestore
  const isMobile = useMediaQuery('(max-width:768px)');
  const location = useLocation();
  const navigate = useNavigate();
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);
  const [alertsUnreadCount, setAlertsUnreadCount] = useState(0);
  const [alertsCriticalCount, setAlertsCriticalCount] = useState(0);
  const [avatarMenuAnchorEl, setAvatarMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [alertsDrawerOpen, setAlertsDrawerOpen] = useState(false);
  const { count: mentionsUnreadCount } = useUnreadMentionsCount(user?.uid || null);
  
  // Mentions tracking (debug logging removed)

  // Function to get page title based on current route
  const getPageTitle = () => {
    const pathname = location.pathname;
    
    // ChatGPT route
    if (pathname.includes('/chatgpt')) {
      return 'ChatGPT';
    }
    
    // Slack Channels route
    if (pathname.includes('/slack')) {
      return 'Slack Channels';
    }
    
    // SMS Messaging route
    if (pathname.includes('/text-messages')) {
      return 'SMS Messaging';
    }
    
    // Inbox route
    if (pathname.includes('/inbox')) {
      return 'Inbox';
    }
    
    // Contacts routes (check before CRM to avoid conflicts)
    if (pathname.startsWith('/contacts')) {
      return 'Contacts';
    }
    
    // Companies routes (check before CRM to avoid conflicts)
    if (pathname.startsWith('/companies')) {
      return 'Companies';
    }
    
    // Jobs Board routes
    if (pathname.includes('/recruiter/jobs-board')) {
      return 'Recruiter';
    }
    if (pathname.includes('/jobs-board') || pathname.includes('/jobs-dashboard')) {
      return 'Jobs Board';
    }
    
    // Company Setup routes
    if (pathname.includes('/company-setup')) {
      return 'Company Setup';
    }
    
    // User record routes - check if path includes /users/ anywhere (excluding /recruiter/users/)
    if (pathname.includes('/users/') && !pathname.includes('/recruiter/users/') && pathname.split('/users/').length > 1) {
      return 'User Details';
    }
    
    // Legacy recruiter user record routes - redirect handled in App.tsx
    if (pathname.includes('/recruiter/users/') && pathname.split('/recruiter/users/').length > 1) {
      return 'User Details';
    }
    
    // Workforce user record routes - check if path includes /workforce/users/ anywhere
    if (pathname.includes('/workforce/users/') && pathname.split('/workforce/users/').length > 1) {
      return 'User Details';
    }
    
    // User Profile routes - check if viewing someone else's profile
    if (pathname.includes('/users/') && !pathname.includes('/recruiter/') && !pathname.includes('/workforce/')) {
      const pathParts = pathname.split('/users/');
      if (pathParts.length > 1 && pathParts[1]) {
        const uidPart = pathParts[1].split('/')[0];
        // If viewing someone else's profile (not your own), show "User Details"
        if (uidPart && user?.uid && uidPart !== user.uid) {
          return 'User Details';
        }
        // If viewing your own profile, show "My Profile"
        if (uidPart === user?.uid) {
          return 'My Profile';
        }
        // Default to "User Details" if we can't determine (likely viewing someone else)
        return 'User Details';
      }
      return 'My Profile';
    }
    
    // CRM routes
    if (pathname.includes('/crm')) {
      return 'CRM';
    }
    
    // Recruiter routes
    if (pathname.includes('/recruiter')) {
      return 'Recruiter';
    }
    
    // Dashboard routes
    if (pathname.includes('/dashboard') || pathname === '/') {
      return 'Dashboard';
    }
    
    // Slack Integration route
    if (pathname.includes('/admin/slack')) {
      return 'Slack Integration';
    }
    
    // Settings routes
    if (pathname.includes('/settings') || pathname.includes('/privacy-settings')) {
      return 'Settings';
    }
    
    // Applications routes
    if (pathname.includes('/applications')) {
      return 'My Applications';
    }
    
    // Assignments routes
    if (pathname.includes('/assignments')) {
      return 'My Assignments';
    }
    
    // Apply wizard route
    if (pathname.includes('/apply')) {
      return 'Submit Application';
    }
    
    // Default fallback - show active tenant name
    return activeTenant?.name || 'HRX Platform';
  };

  const [open, setOpen] = useState(true);
  const setOpenWithLog = (value) => { console.log('setOpen', value); setOpen(value); };
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const setMenuAnchorElWithLog = (value) => { console.log('setMenuAnchorEl', value); setMenuAnchorEl(value); };
  const [firstName, setFirstName] = useState<string | null>(null);
  const setFirstNameWithLog = (value) => { console.log('setFirstName', value); setFirstName(value); };
  const [lastName, setLastName] = useState<string | null>(null);
  const setLastNameWithLog = (value) => { console.log('setLastName', value); setLastName(value); };
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>('en');
  
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

  // Always use collapsed width for dark shell (64-72px)
  const drawerWidth = 76; // Fixed width for always-collapsed sidebar (per logo spec)
  const isMenuOpen = Boolean(menuAnchorEl);

  // Use development values for testing, fallback to real values
  const effectiveRole = devRole || role;
  const effectiveSecurityLevel = devSecurityLevel || securityLevel;
  const effectiveOrgType = devOrgType || orgType;
  const userAccessRole = getAccessRole(effectiveRole, effectiveSecurityLevel);
  const isApplicant = currentClaimsSecurityLevel === '2' || effectiveSecurityLevel === '2';
  const isLowSecurityLevel = (currentClaimsSecurityLevel && parseInt(currentClaimsSecurityLevel) < 5) || (effectiveSecurityLevel && parseInt(effectiveSecurityLevel) < 5);

  // Determine if user should listen to module status for current tenant
  const shouldListenToModules = useMemo(() => {
    // Security level 5+ required for module management
    const hasAdminLevel = parseInt(effectiveSecurityLevel || '0') >= 5;
    if (!hasAdminLevel) return false;
    
    // Always listen for HRX tenant
    if (activeTenant?.id === 'TgDJ4sIaC7x2n5cPs3rW') return true;
    
    // For other tenants, check if user has admin rights in that tenant
    if (activeTenant?.id && tenantIds && typeof tenantIds === 'object' && !Array.isArray(tenantIds)) {
      const tenantRole = tenantIds[activeTenant.id] as any;
      if (tenantRole && typeof tenantRole === 'object') {
        const tenantSecurityLevel = parseInt(tenantRole.securityLevel || '0');
        return tenantSecurityLevel >= 5;
      }
    }
    
    return false;
  }, [effectiveSecurityLevel, activeTenant?.id, tenantIds]);

  const [showChat, setShowChat] = useState(false);
  // For now, default to showing the chat button unless user?.hideChatbot is true
  const showChatbotButton = !(user && (user as any).hideChatbot);
  const setShowChatWithLog = (value) => { console.log('setShowChat', value); setShowChat(value); };

  const [agencyLogoUrl, setAgencyLogoUrl] = useState<string | null>(null);

  // Real-time inbox unread count for nav badge (updates as messages are read)
  // Uses Gmail API counts to match category tab counts
  useEffect(() => {
    if (!user?.uid) {
      setInboxUnreadCount(0);
      return;
    }

    const loadTotalUnread = async () => {
      try {
        const getCounts = httpsCallable(functions, 'getGmailMailboxCounts');
        const result = await getCounts({ userId: user.uid });
        const data = result.data as any;
        const counts = data?.counts;
        if (data?.success && counts) {
          const total =
            (counts.primary?.threadsUnread || 0) +
            (counts.social?.threadsUnread || 0) +
            (counts.promotions?.threadsUnread || 0) +
            (counts.updates?.threadsUnread || 0) +
            (counts.forums?.threadsUnread || 0) +
            (counts.spam?.threadsUnread || 0);
          setInboxUnreadCount(total > 99 ? 99 : total);
        } else {
          // Fallback: use Firestore listener if Gmail API unavailable
          if (activeTenant?.id) {
            try {
              const threadsRef = collection(db, 'tenants', activeTenant.id, 'emailThreads');
              const threadsQuery = query(
                threadsRef,
                where('participantUserIds', 'array-contains', user.uid),
                where('status', '==', 'active'),
                orderBy('lastMessageAt', 'desc'),
                limit(500)
              );
              const snapshot = await getDocs(threadsQuery);
              const total = snapshot.docs.reduce(
                (sum, d) => sum + (Number((d.data() as any)?.unreadCount) || 0),
                0
              );
              setInboxUnreadCount(total > 99 ? 99 : total);
            } catch (err) {
              console.warn('Inbox unread count fallback failed:', err);
              setInboxUnreadCount(0);
            }
          }
        }
      } catch (err) {
        // Fallback: use Firestore listener if Gmail API fails
        if (activeTenant?.id) {
          try {
            const threadsRef = collection(db, 'tenants', activeTenant.id, 'emailThreads');
            const threadsQuery = query(
              threadsRef,
              where('participantUserIds', 'array-contains', user.uid),
              where('status', '==', 'active'),
              orderBy('lastMessageAt', 'desc'),
              limit(500)
            );
            const snapshot = await getDocs(threadsQuery);
            const total = snapshot.docs.reduce(
              (sum, d) => sum + (Number((d.data() as any)?.unreadCount) || 0),
              0
            );
            setInboxUnreadCount(total > 99 ? 99 : total);
          } catch (fallbackErr) {
            console.warn('Inbox unread count setup failed:', fallbackErr);
            setInboxUnreadCount(0);
          }
        }
      }
    };

    loadTotalUnread();
    const interval = setInterval(loadTotalUnread, 30000);
    return () => clearInterval(interval);
  }, [user?.uid, activeTenant?.id]);

  // Real-time listener for unread internal message count
  useEffect(() => {
    if (!user?.uid || !activeTenant?.id) {
      setMessagesUnreadCount(0);
      return;
    }

    let dmsUnread = 0;
    let channelsUnread = 0;

    const updateTotal = () => {
      setMessagesUnreadCount(dmsUnread + channelsUnread);
    };

    // Listen to DMs
    const dmsRef = collection(db, 'tenants', activeTenant.id, 'internalDMs');
    const dmsQuery = query(dmsRef, where('participants', 'array-contains', user.uid));
    
    const unsubscribeDMs = onSnapshot(
      dmsQuery,
      (snapshot) => {
        dmsUnread = 0;
        snapshot.forEach((doc) => {
          const data = doc.data();
          dmsUnread += data.unreadCounts?.[user.uid] || 0;
        });
        updateTotal();
      },
      (err) => {
        console.warn('Error listening to DMs for unread count:', err);
      }
    );

    // Listen to Channels
    const channelsRef = collection(db, 'tenants', activeTenant.id, 'internalChannels');
    const channelsQuery = query(channelsRef, where('memberIds', 'array-contains', user.uid));
    
    const unsubscribeChannels = onSnapshot(
      channelsQuery,
      (snapshot) => {
        channelsUnread = 0;
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Don't count if user muted this channel
          if (!data.mutedBy?.includes(user.uid)) {
            channelsUnread += data.unreadCounts?.[user.uid] || 0;
          }
        });
        updateTotal();
      },
      (err) => {
        console.warn('Error listening to channels for unread count:', err);
      }
    );

    return () => {
      unsubscribeDMs();
      unsubscribeChannels();
    };
  }, [user?.uid, activeTenant?.id]);

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
          const lang = data.preferredLanguage === 'es' ? 'es' : 'en';
          setPreferredLanguage(lang);
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
    if (!authLoading && user && tenantIds && tenantIds.length > 0 && !tenantsLoading) {
      // REMOVED: Excessive logging causing re-renders
      // Call fetchTenants directly without including it in dependencies
      const fetchTenantsDirectly = async () => {
        // Convert tenantIds to array if it's a map/object
        const tenantIdList = Array.isArray(tenantIds)
          ? tenantIds
          : (tenantIds ? Object.keys(tenantIds) : []);
        // REMOVED: Excessive logging causing re-renders
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
              // REMOVED: Excessive logging causing re-renders
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
          // REMOVED: Excessive logging causing re-renders
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
  const [crmModuleEnabled, setCrmModuleEnabled] = useState(false);
  const [staffingModuleEnabled, setStaffingModuleEnabled] = useState(false);

  // Real-time listener for flex module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setFlexModuleEnabled(false);
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setFlexModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setFlexModuleEnabled(true);
      return;
    }

    const flexModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
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
  }, [activeTenant?.id, shouldListenToModules]);

  // Real-time listener for recruiter module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setRecruiterModuleEnabled(false);
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setRecruiterModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setRecruiterModuleEnabled(true);
      return;
    }

    const recruiterModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-recruiter');
    const unsubscribe = onSnapshot(recruiterModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
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
  }, [activeTenant?.id, shouldListenToModules]);

  // Real-time listener for customers module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setCustomersModuleEnabled(false);
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setCustomersModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setCustomersModuleEnabled(true);
      return;
    }

    const customersModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-customers');
    const unsubscribe = onSnapshot(customersModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
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
  }, [activeTenant?.id, shouldListenToModules]);

  // Real-time listener for jobs board module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setJobsBoardModuleEnabled(isApplicant); // true for applicants, false otherwise
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setJobsBoardModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setJobsBoardModuleEnabled(true);
      return;
    }

    const jobsBoardModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-jobs-board');
    const unsubscribe = onSnapshot(jobsBoardModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
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
  }, [activeTenant?.id, shouldListenToModules, isApplicant]);

  // Real-time listener for CRM module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setCrmModuleEnabled(false);
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setCrmModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setCrmModuleEnabled(true);
      return;
    }

    const crmModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-crm');
    const unsubscribe = onSnapshot(crmModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
        setCrmModuleEnabled(isEnabled);
      } else {
        console.log('CRM module document does not exist, defaulting to disabled');
        setCrmModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to CRM module status:', error);
      setCrmModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id, shouldListenToModules]);

  // Real-time listener for Staffing module status
  useEffect(() => {
    if (!shouldListenToModules) {
      setStaffingModuleEnabled(false);
      return;
    }
    if (!activeTenant?.id) {
      // No active tenant
      setStaffingModuleEnabled(false);
      return;
    }
    
    if (activeTenant.id === 'TgDJ4sIaC7x2n5cPs3rW') {
      // HRX user - enable all modules by default
      setStaffingModuleEnabled(true);
      return;
    }

    const staffingModuleRef = doc(db, 'tenants', activeTenant.id, 'modules', 'hrx-staffing');
    const unsubscribe = onSnapshot(staffingModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        // REMOVED: Excessive logging causing re-renders
        setStaffingModuleEnabled(isEnabled);
      } else {
        console.log('Staffing module document does not exist, defaulting to disabled');
        setStaffingModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to Staffing module status:', error);
      setStaffingModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [activeTenant?.id, shouldListenToModules]);

  // Generate base menu items only when structural changes occur
  useEffect(() => {
    const generateBaseMenu = async () => {
      setMenuLoading(true);
      try {
        
        const items = await generateMenuItems(
          userAccessRole, 
          (activeTenant?.type === 'HRX' ? 'HRX' : 'Tenant'), 
          activeTenant?.id, 
          flexModuleEnabled, 
          recruiterModuleEnabled, 
          customersModuleEnabled, 
          jobsBoardModuleEnabled, 
          crmModuleEnabled,
          staffingModuleEnabled,
          // New claims-based parameters
          isHRX,
          currentClaimsRole,
          claimsRoles,
          // User profile flags
          jobsBoardEnabled,
          currentClaimsSecurityLevel
        );

        // Store base menu items
        setMenuItems(items);
      } catch (error) {
        console.error('Error generating base menu:', error);
        setMenuItems([]);
      } finally {
        setMenuLoading(false);
      }
    };
    generateBaseMenu();
  }, [userAccessRole, activeTenant, flexModuleEnabled, recruiterModuleEnabled, customersModuleEnabled, jobsBoardModuleEnabled, crmModuleEnabled, staffingModuleEnabled, isHRX, currentClaimsRole, claimsRoles, jobsBoardEnabled, currentClaimsSecurityLevel]);

  // Get effective security level - prioritize tenant-specific over global
  const getEffectiveSecurityLevel = useMemo(() => {
    // First check claims (most authoritative)
    if (currentClaimsSecurityLevel && ['5', '6', '7'].includes(currentClaimsSecurityLevel)) {
      return currentClaimsSecurityLevel;
    }
    // Then check tenant-specific security level
    if (activeTenant?.id && tenantIds && typeof tenantIds === 'object' && !Array.isArray(tenantIds)) {
      const tenantRole = tenantIds[activeTenant.id] as any;
      if (tenantRole && typeof tenantRole === 'object' && tenantRole.securityLevel) {
        const tenantSecLevel = String(tenantRole.securityLevel);
        if (['5', '6', '7'].includes(tenantSecLevel)) {
          return tenantSecLevel;
        }
      }
    }
    // Fallback to global security level
    return securityLevel;
  }, [currentClaimsSecurityLevel, activeTenant?.id, tenantIds, securityLevel]);

  // Filter menu items based on user flags without regenerating the entire menu
  const filteredMenuItems = useMemo(() => {
    // Get effective security level for filtering
    const secLevel = getEffectiveSecurityLevel;
    const isLowLevel = secLevel && ['0', '1', '2', '3', '4'].includes(String(secLevel));
    
    return menuItems.filter((mi) => {
      if (mi.text === 'Sales CRM' && !crmSalesEnabled) return false;
      if (mi.text === 'Recruiter' && !recruiterEnabled) return false;
      if (mi.text === 'Jobs Board' && !jobsBoardEnabled) return false;
      // Hide "Jobs Board" from menu items if user is low level (0-4) - it's shown as a shortcut instead
      if (mi.text === 'Jobs Board' && isLowLevel) return false;
      return true;
    });
  }, [menuItems, crmSalesEnabled, recruiterEnabled, jobsBoardEnabled, getEffectiveSecurityLevel]);

  const menuItemsWithIcons = filteredMenuItems.map(item => {
    const iconMap: Record<string, React.ReactNode> = {
      'Dashboard': <RocketLaunchIcon />, 
      'ChatGPT': <RocketLaunchIcon />,
      'Chat GPT': <RocketLaunchIcon />, 
      'Customers': <BusinessIcon />, 
      'Agencies': <GroupWorkIcon />,
      'Tenants': <BusinessIcon />,
      'Team Access': <RecordVoiceOverIcon />,
      'Recruiter': <RecordVoiceOverIcon />,
      'Workforce': <PeopleIcon />,
      'Users': <GroupsIcon />,
      'Contacts': <PersonIcon />,
      'Companies': <BusinessIcon />,
      'Job Orders': <AssignmentIcon />,
      'Flex Jobs': <AssignmentIcon />,
      'Jobs Board': <WorkIcon />,
      'Sales CRM': <SellIcon />,
      'My Applications': <FactCheckIcon />,
      'My Assignments': <AssignmentTurnedInIcon />,
      'Locations': <LocationOnIcon />,
      'Schedules': <GroupWorkIcon />,
      'My Schedule': <GroupWorkIcon />,
      'AI Settings': <AutoFixHighIcon />, 
      'User Groups': <Diversity3Icon />,
      'Departments': <BusinessIcon />,
      'Reports': <SettingsIcon />,
      'Scheduling': <GroupWorkIcon />,
      'Performance': <SettingsIcon />,
      'Reviews': <SettingsIcon />,
      'Check-ins': <NotificationsIcon />,
      'Messages': <NotificationsIcon />,
      'Inbox': <InboxIcon />,
      'Text Messages': <SmsIcon />,
      'Tasks': <DoneAllIcon />,
      'Calendar': <CalendarMonthIcon />,
      // Slack Channels removed - now combined with Mentions in top bar
      'Notifications': <NotificationsIcon />,
      'Privacy & Notifications': <NotificationsIcon />,
      'Modules': <AppsIcon />,
      'Settings': <SettingsIcon />,
      'Company Setup': <ArchitectureIcon />,
      'Company Defaults': <BusinessIcon />,
      'AI Launchpad': <RocketLaunchIcon />,
      'Help': <HelpIcon />,
      'Campaigns': <WavesIcon />,
      'Broadcasts': <CampaignIcon />,
      'Resume Management': <DescriptionIcon />,
      'Mobile App Errors': <PhoneIphoneIcon />,
      'Mobile App': <PhoneIphoneIcon />,
      'My Tenant': <BusinessIcon />,
      'Data Operations': <SettingsIcon />,
      'Log out': <LogoutIcon />,
    };
    
    return {
      ...item,
      icon: iconMap[item.text] || <SettingsIcon />,
    };
  });

  // Menu items are now properly generated in menuGenerator.ts

  // Use activeTenant for logo and menu logic
  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || 
    (activeTenant?.name
      ? activeTenant.name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2)
      : '');

  // REMOVED: Excessive logging causing re-renders

  // Ensure only allowed values for devOrgType, devRole, devSecurityLevel
  const allowedOrgTypes = ['Agency', 'Customer', 'HRX', 'Tenant'];
  const allowedRoles = ['Worker', 'Agency', 'Customer', 'HRX'];
  const allowedSecurityLevels = ['0', '1', '2', '3', '4', '5', '6', '7'];

  const safeDevOrgType = allowedOrgTypes.includes(devOrgType) ? devOrgType : '';
  const safeDevRole = allowedRoles.includes(devRole) ? devRole : '';
  const safeDevSecurityLevel = allowedSecurityLevels.includes(devSecurityLevel) ? devSecurityLevel : '';

  // Check if user has admin level (5, 6, or 7) for top bar items
  const hasAdminLevel = useMemo(() => {
    const secLevel = getEffectiveSecurityLevel;
    return !!(secLevel && ['5', '6', '7'].includes(String(secLevel)));
  }, [getEffectiveSecurityLevel]);
  // Staff (0-4) see white shell + charcoal icons; admins (5-7) see dark shell + white icons
  const isStaffShell = !hasAdminLevel;

  // Google status context should wrap any component that calls useGoogleStatus (Dashboard, GoogleConnectionChip, CRM, etc.)
  const effectiveGoogleTenantId = activeTenant?.id || tenantId || '';
  const secLevelForGoogle = getEffectiveSecurityLevel;
  const hasAdminLevelForGoogle = !!(secLevelForGoogle && ['5', '6', '7'].includes(String(secLevelForGoogle)));
  const shouldProvideGoogleStatus =
    hasAdminLevelForGoogle &&
    !!effectiveGoogleTenantId &&
    effectiveGoogleTenantId !== 'TgDJ4sIaC7x2n5cPs3rW';

  const layout = (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />

      {/* Navigation Drawer (sidebar menu) - Always collapsed dark shell */}
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? open : true} // Use open state on mobile, always open on desktop
        onClose={toggleDrawer}
        hideBackdrop={isMobile && !open}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            minWidth: drawerWidth,
            maxWidth: drawerWidth,
            boxSizing: 'border-box',
            position: 'fixed',
            top: 64, // Start below top bar
            left: 0,
            height: 'calc(100vh - 64px)', // Full height minus top bar
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            backgroundColor: isStaffShell ? '#FFFFFF' : '#2E2E2E', // Staff: white; admins: dark shell
            borderRight: isStaffShell ? '1px solid rgba(0,0,0,0.08)' : 'none',
            boxShadow: 'none',
            transition: 'none', // Disable any transitions that might cause expansion
          },
          '&:hover': {
            width: drawerWidth, // Ensure width stays fixed on hover
            [`& .MuiDrawer-paper`]: {
              width: drawerWidth, // Ensure paper width stays fixed on hover
            },
          },
          // Hide backdrop when drawer is closed on mobile to prevent blocking interactions
          '& .MuiBackdrop-root': {
            ...(isMobile && !open && {
              display: 'none',
              pointerEvents: 'none',
            }),
          },
        }}
      >
        {/* Logo removed - now in top bar */}
        <List sx={{ flexGrow: 1, pb: '80px' }}>
          {/* Dashboard shortcut for security levels 5-7 (at the top) */}
          {(() => {
            const secLevel = currentClaimsSecurityLevel || securityLevel;
            const isHighLevel = secLevel && ['5','6','7'].includes(secLevel);
            if (!isHighLevel) return null;
            const dashboardPath = '/dashboard';
            const isSelected = location.pathname === dashboardPath || location.pathname.startsWith(dashboardPath + '/');
            
            // Clone icon to add color prop directly - same as other menu items
            const dashboardIcon = <DashboardIcon />;
            const defaultIconColor = isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)';
            const iconWithColor = React.isValidElement(dashboardIcon) 
              ? React.cloneElement(dashboardIcon as React.ReactElement<any>, { 
                  color: 'inherit',
                  sx: { 
                    ...(dashboardIcon as any).props?.sx,
                    color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                    fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                    '& path': {
                      fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                    },
                    '& .MuiSvgIcon-root': {
                      color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                    },
                  }
                })
              : dashboardIcon;
            
            return (
              <ListItem disablePadding sx={{ display: 'block' }}>
                <Tooltip title="Dashboard" arrow placement="right" enterDelay={150}>
                  <ListItemButton
                    component={Link}
                    to={dashboardPath}
                    onClick={() => {
                      if (isMobile) setOpen(false);
                    }}
                    sx={{
                      minHeight: 48,
                      px: 1.5,
                      py: 1,
                      justifyContent: 'center',
                      borderRadius: '9999px',
                      backgroundColor: isSelected ? '#0057B8' : 'transparent !important', // Active: brandPrimary background (per style guide)
                      color: isSelected ? '#FFFFFF' : defaultIconColor,
                      '& svg': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& .MuiSvgIcon-root': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& path': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        stroke: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& g': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '&:hover': {
                        backgroundColor: isSelected ? '#0057B8' : (isStaffShell ? 'rgba(0,0,0,0.06) !important' : 'rgba(255,255,255,.10) !important'),
                        color: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': {
                          fill: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        },
                      },
                      transition: 'background-color 150ms ease, color 150ms ease', // 150ms transition (per style guide)
                      '&.Mui-focusVisible': {
                        backgroundColor: 'transparent !important',
                      },
                      '&.Mui-selected': {
                        backgroundColor: isSelected ? '#0057B8 !important' : 'transparent !important',
                        color: isSelected ? '#FFFFFF !important' : '#FFD700',
                        '& svg': {
                          fill: isSelected ? '#FFFFFF !important' : '#FFD700 !important',
                        },
                        '&:hover': {
                          backgroundColor: isSelected ? '#0057B8 !important' : 'transparent !important',
                          color: isSelected ? '#FFFFFF !important' : '#FFD700',
                          '& svg': {
                            fill: isSelected ? '#FFFFFF !important' : '#FFD700 !important',
                          },
                        },
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        justifyContent: 'center',
                        display: 'flex',
                        color: isSelected ? '#FFFFFF !important' : 'inherit',
                        '& svg': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& .MuiSvgIcon-root': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& path': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          stroke: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& g': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& *': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                      }}
                    >
                      {iconWithColor}
                    </ListItemIcon>
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })()}
          {/* Jobs Board shortcut for security levels 0-4 (above My Profile) */}
          {(() => {
            const secLevel = currentClaimsSecurityLevel || securityLevel;
            const isLowLevel = secLevel && ['0','1','2','3','4'].includes(secLevel);
            if (!isLowLevel) return null;
            const tenantSlug = activeTenant?.slug || 'c1';
            const jobsPath = `/${tenantSlug}/jobs-board`;
            const isSelected = location.pathname.startsWith(jobsPath);
            return (
              <ListItem disablePadding sx={{ display: 'block' }}>
                <Tooltip title="Jobs Board" arrow placement="right" enterDelay={150}>
                  <ListItemButton
                    component={Link}
                    to={jobsPath}
                    onClick={() => {
                      if (isMobile) setOpen(false);
                    }}
                    sx={{
                      minHeight: 48,
                      px: 1.5,
                      py: 1,
                      justifyContent: 'center',
                      borderRadius: '9999px',
                      backgroundColor: isSelected ? '#0057B8' : 'transparent !important',
                      color: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                      '& svg': {
                        fill: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                      },
                      '& .MuiSvgIcon-root': {
                        fill: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                      },
                      '& path': {
                        fill: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                        stroke: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                      },
                      '& g': {
                        fill: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                      },
                      '& *': {
                        fill: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : ((isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important'),
                      },
                      '&:hover': {
                        backgroundColor: isSelected ? '#0057B8' : (isStaffShell ? 'rgba(0,0,0,0.06) !important' : 'rgba(255,255,255,.10) !important'),
                        color: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': { fill: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important', color: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important' },
                        '& .MuiSvgIcon-root': { fill: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important', color: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important' },
                        '& path': { fill: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important', stroke: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important' },
                        '& g': { fill: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important' },
                        '& *': { fill: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important', color: (isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF')) + ' !important' },
                      },
                      transition: 'background-color 150ms ease, color 150ms ease',
                      '&.Mui-focusVisible': {
                        backgroundColor: 'transparent !important',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        justifyContent: 'center',
                        display: 'flex',
                        color: isSelected ? '#FFFFFF !important' : 'inherit',
                        '& svg': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& .MuiSvgIcon-root': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& path': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          stroke: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& g': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& *': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                      }}
                    >
                      <WorkIcon />
                    </ListItemIcon>
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })()}
          {/* All menu items */}
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
            menuItemsWithIcons
              .filter(({ text }) => text !== 'Log out') // Remove Logout from sidebar
              .map(({ text, to, icon }) => {
              const isInbox = text === 'Inbox';
              const showBadge = isInbox && inboxUnreadCount > 0;
              const pathname = location.pathname;
              const isUserDetailsPath =
                pathname.includes('/users/') &&
                !pathname.includes('/recruiter/users/') &&
                pathname.split('/users/').length > 1;

              // Only mark as selected if pathname exactly matches or starts with the route.
              // Also treat `/users/{id}` as part of any `/.../users` list route (we redirect legacy detail routes).
              // Don't mark ChatGPT as active when on dashboard.
              const isSelected =
                !!to &&
                (pathname === to ||
                  (pathname.startsWith(to + '/') && !(text === 'ChatGPT' && pathname.startsWith('/dashboard'))) ||
                  (isUserDetailsPath && /\/users$/.test(to)));
              const defaultIconColor = isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)';
              
              // Clone icon to add color prop directly - MUI icons inherit color from parent
              const iconWithColor = React.isValidElement(icon) 
                ? React.cloneElement(icon as React.ReactElement<any>, { 
                    color: 'inherit', // Inherit from parent ListItemIcon color
                    sx: { 
                      ...(icon as any).props?.sx,
                      color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      stroke: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      '& path': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        stroke: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& .MuiSvgIcon-root': {
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& g': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& *': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        stroke: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                    }
                  })
                : icon;
              
              return (
              <ListItem key={text} disablePadding sx={{ display: 'block' }}>
                <Tooltip title={text} arrow placement="right" enterDelay={150}>
                  <ListItemButton
                    component={text === 'Log out' ? 'button' : Link}
                    {...(text !== 'Log out' ? { to } : {})}
                    onClick={text === 'Log out' 
                      ? async () => { await logout(); } 
                      : () => {
                          if (isMobile) setOpen(false);
                        }
                    }
                    sx={{
                      minHeight: 48,
                      px: 1.5,
                      py: 1,
                      justifyContent: 'center',
                      borderRadius: '9999px',
                      backgroundColor: isSelected ? '#0057B8' : 'transparent !important',
                      color: isSelected ? '#FFFFFF' : defaultIconColor,
                      '& svg': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& .MuiSvgIcon-root': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        color: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& path': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                        stroke: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '& g': {
                        fill: isSelected ? '#FFFFFF !important' : (defaultIconColor + ' !important'),
                      },
                      '&:hover': {
                        backgroundColor: isSelected ? '#0057B8' : (isStaffShell ? 'rgba(0,0,0,0.06) !important' : 'rgba(255,255,255,.10) !important'),
                        color: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': {
                          fill: isSelected ? '#FFFFFF' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        },
                      },
                      transition: 'background-color 150ms ease, color 150ms ease', // 150ms transition (per style guide)
                      '&.Mui-focusVisible': {
                        backgroundColor: 'transparent !important',
                      },
                      '&.Mui-selected': {
                        backgroundColor: isSelected ? '#0057B8 !important' : 'transparent !important',
                        color: isSelected ? '#FFFFFF !important' : '#FFD700',
                        '& svg': {
                          fill: isSelected ? '#FFFFFF !important' : '#FFD700 !important',
                        },
                        '&:hover': {
                          backgroundColor: isSelected ? '#0057B8 !important' : 'transparent !important',
                          color: isSelected ? '#FFFFFF !important' : '#FFD700',
                          '& svg': {
                            fill: isSelected ? '#FFFFFF !important' : '#FFD700 !important',
                          },
                        },
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        justifyContent: 'center',
                        display: 'flex',
                        color: isSelected ? '#FFFFFF !important' : 'inherit',
                        '& svg': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& .MuiSvgIcon-root': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& path': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          stroke: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& g': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                        '& *': {
                          fill: isSelected ? '#FFFFFF !important' : 'inherit',
                          color: isSelected ? '#FFFFFF !important' : 'inherit',
                        },
                      }}
                    >
                      {/* Show badge on icon - only when count > 0 */}
                      {showBadge && inboxUnreadCount > 0 ? (
                        <Badge 
                          badgeContent={inboxUnreadCount > 99 ? '99+' : inboxUnreadCount} 
                          color="error"
                          sx={{
                            '& .MuiBadge-badge': {
                              backgroundColor: '#0057B8', // Use brandPrimary for badge
                              color: '#FFFFFF',
                              fontSize: '0.65rem',
                              height: '16px',
                              minWidth: '16px',
                              padding: '0 4px',
                            }
                          }}
                        >
                          {iconWithColor}
                        </Badge>
                      ) : (
                        iconWithColor
                      )}
                    </ListItemIcon>
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
            })
          )}
        </List>
        
        {/* Theme Toggle Button */}
        {/* <Box sx={{ px: 0, py: 0, mb: 8 }}>
          <ListItem disablePadding sx={{ display: 'block' }}>
            <ListItemButton
              onClick={toggleMode}
              sx={{
                px: open ? 2.5 : 0,
                py: 1,
                justifyContent: open ? 'initial' : 'center',
                borderRadius: '8px',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                },
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
                {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </ListItemIcon>
              {open && <ListItemText primary={mode === 'dark' ? 'Light Mode' : 'Dark Mode'} />}
            </ListItemButton>
          </ListItem>
        </Box> */}
        
        {/* Removed collapse button - sidebar is always collapsed */}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          '--drawer-width': `${drawerWidth}px`,
          transition: (theme) =>
            theme.transitions.create(['margin', 'width'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
        }}
      >
        {/* Full-width top bar - Staff: white; admins: dark shell */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1100,
            backgroundColor: isStaffShell ? '#FFFFFF' : '#2E2E2E',
            borderBottom: isStaffShell ? '1px solid rgba(0,0,0,0.08)' : 'none',
            boxShadow: isStaffShell ? '0 1px 3px rgba(0,0,0,0.06)' : '0 2px 8px rgba(0,0,0,.07)',
            pl: 0, // No left padding - logo aligns with sidebar
            pr: { xs: 2, md: 4 }, // Keep right padding
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 64, // Top bar height
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {/* Logo Container - Same width as sidebar (76px) to align with icons */}
            <Box 
              sx={{ 
                width: `${drawerWidth}px`, // Same width as sidebar (76px)
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center', // Center logo within sidebar width (same as icons)
              }}
            >
              {/* Logo Wrapper */}
              <Box 
                sx={{ 
                  width: '52px', 
                  height: '52px', 
                  padding: '8px',
                  borderRadius: '12px',
                  background: isStaffShell ? 'rgba(0,0,0,0.06)' : 'rgba(255, 255, 255, 0.06)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                  '&:hover': {
                    background: isStaffShell ? 'rgba(0,0,0,0.08)' : 'rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                  },
                  '& img': {
                    display: 'block',
                    margin: 0,
                  },
                }}
                onClick={() => navigate('/')} // Optional: go home on click
              >
              <img
                src="/C1Y.png"
                alt="C1 Staffing Logo"
                style={{
                  display: 'block',
                  margin: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
                onError={(e: any) => {
                  // Logo image failed to load, trying fallback
                  // Fallback to C1.png if C1Y.png doesn't exist
                  if (e.target.src.endsWith('/C1Y.png')) {
                    e.target.src = '/C1.png';
                  } else {
                    e.target.style.display = 'none';
                  }
                }}
                onLoad={() => {
                  // Logo loaded successfully
                }}
              />
              </Box>
            </Box>
            {/* Page Title */}
            <Box sx={{ ml: '12px', display: 'flex', alignItems: 'center' }}>
              <Typography 
                variant="h5" 
                sx={{ 
                  fontWeight: 600, 
                  color: isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF',
                  lineHeight: 1.2, // Ensure consistent line height for center alignment
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {getPageTitle()}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Google Connection Chip - Show for security level 5-7 users (Staff Manager, Manager, Admin) */}
            {shouldProvideGoogleStatus && (
              <GoogleConnectionChip tenantId={effectiveGoogleTenantId} />
            )}
            
            {/* Top-Right Notifications Bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {/* 📥 Inbox Counter */}
              {inboxUnreadCount > 0 && (
                <Tooltip title={`${inboxUnreadCount} unread inbox messages`}>
                  <IconButton
                    onClick={() => navigate('/inbox')}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: location.pathname.startsWith('/inbox') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                      '& svg': {
                        fill: location.pathname.startsWith('/inbox') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important',
                      },
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: location.pathname.startsWith('/inbox') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': {
                          fill: location.pathname.startsWith('/inbox') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        },
                      },
                    }}
                  >
                    <Badge badgeContent={inboxUnreadCount > 99 ? '99+' : inboxUnreadCount} color="error">
                      <InboxIcon />
                    </Badge>
                  </IconButton>
                </Tooltip>
              )}
              
              {/* 💬 Messages Counter - Internal HRX Messages */}
              {messagesUnreadCount > 0 && (
                <Tooltip title={`${messagesUnreadCount} unread messages`}>
                  <IconButton
                    onClick={() => navigate('/messages')}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: location.pathname.startsWith('/messages') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                      '& svg': {
                        fill: (location.pathname.startsWith('/messages') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)')) + ' !important',
                      },
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: location.pathname.startsWith('/messages') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': {
                          fill: location.pathname.startsWith('/messages') ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        },
                      },
                    }}
                  >
                    <Badge badgeContent={messagesUnreadCount > 99 ? '99+' : messagesUnreadCount} color="primary">
                      <ChatIcon />
                    </Badge>
                  </IconButton>
                </Tooltip>
              )}
              
              {/* 🔔 Alerts Counter - System Notifications */}
              {alertsUnreadCount > 0 && (
                <Tooltip title={`${alertsUnreadCount} alert${alertsUnreadCount !== 1 ? 's' : ''} require${alertsUnreadCount === 1 ? 's' : ''} attention`}>
                  <IconButton
                    onClick={() => setAlertsDrawerOpen(true)}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: alertsDrawerOpen ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                      '& svg': {
                        fill: (alertsDrawerOpen ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)')) + ' !important',
                      },
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: alertsDrawerOpen ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        '& svg': {
                          fill: alertsDrawerOpen ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                        },
                      },
                      ...(alertsCriticalCount > 0 && {
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.6 },
                        },
                      }),
                    }}
                  >
                    <Badge 
                      badgeContent={alertsUnreadCount > 99 ? '99+' : alertsUnreadCount} 
                      color={alertsCriticalCount > 0 ? 'error' : 'warning'}
                    >
                      <NotificationsActiveIcon />
                    </Badge>
                  </IconButton>
                </Tooltip>
              )}
              
              {/* # Slack & Mentions Icon - Only for security levels 5-7 */}
              {hasAdminLevel && (
                <Tooltip title={mentionsUnreadCount > 0 ? `${mentionsUnreadCount} unread mention${mentionsUnreadCount !== 1 ? 's' : ''}` : 'Slack & Mentions'}>
                  <IconButton
                    onClick={() => navigate('/slack')}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: location.pathname.startsWith('/slack') ? '#FFFFFF' : 'rgba(255,255,255,.8)',
                      '& svg': {
                        fill: 'currentColor',
                        stroke: 'currentColor',
                      },
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: '#FFFFFF',
                        '& svg': {
                          fill: 'currentColor',
                          stroke: 'currentColor',
                        },
                      },
                    }}
                  >
                    <Badge 
                      badgeContent={mentionsUnreadCount > 99 ? '99+' : mentionsUnreadCount} 
                      color="secondary"
                      invisible={mentionsUnreadCount === 0}
                    >
                      <SlackHashIcon 
                        active={location.pathname.startsWith('/slack')} 
                        size={20}
                      />
                    </Badge>
                  </IconButton>
                </Tooltip>
              )}
              
              {/* Tasks Icon - Only for security levels 5-7 */}
              {hasAdminLevel && (
                <Tooltip title="Tasks">
                  <IconButton
                    onClick={() => navigate('/tasks')}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: location.pathname.startsWith('/tasks') ? '#FFFFFF' : 'rgba(255,255,255,.8)',
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: '#FFFFFF',
                      },
                    }}
                  >
                    <DoneAllIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* Calendar Icon - Only for security levels 5-7 */}
              {hasAdminLevel && (
                <Tooltip title="Calendar">
                  <IconButton
                    onClick={() => navigate('/calendar')}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: location.pathname.startsWith('/calendar') ? '#FFFFFF' : 'rgba(255,255,255,.8)',
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: '#FFFFFF',
                      },
                    }}
                  >
                    <CalendarMonthIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* ChatGPT Icon - Only for security levels 5-7 */}
              {hasAdminLevel && (
                <Tooltip title="ChatGPT">
                  <IconButton
                    onClick={() => openChatGPT()}
                    sx={{
                      backgroundColor: 'transparent !important',
                      color: 'rgba(255,255,255,.8)',
                      '&:hover': { 
                        backgroundColor: 'transparent !important',
                        color: '#FFFFFF',
                      },
                    }}
                  >
                    <RocketLaunchIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* Direct Messenger Icon - Only for security levels 5-7 */}
              {user && hasAdminLevel && (
                <MessengerIconButton />
              )}

              {/* Language (flag/globe) - preferred message language */}
              {user && (
                <Tooltip title={preferredLanguage === 'es' ? 'Message language: Español' : 'Message language: English'}>
                  <IconButton
                    onClick={(e) => setLanguageMenuAnchorEl(e.currentTarget)}
                    sx={{
                      p: 0.5,
                      backgroundColor: 'transparent !important',
                      color: languageMenuAnchorEl ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                      '&:hover': {
                        backgroundColor: 'transparent !important',
                        color: languageMenuAnchorEl ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                      },
                    }}
                    aria-label="Preferred message language"
                  >
                    <LanguageIcon sx={{ fontSize: 22 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* 👤 Avatar Menu */}
              <Tooltip title="Account menu">
                <IconButton
                  onClick={(e) => setAvatarMenuAnchorEl(e.currentTarget)}
                  sx={{
                    p: 0.5,
                    backgroundColor: 'transparent !important',
                    color: avatarMenuAnchorEl ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)'),
                    '&:hover': { 
                      backgroundColor: 'transparent !important',
                      color: avatarMenuAnchorEl ? '#0057B8' : (isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF'),
                    },
                  }}
                >
                  <Avatar
                    alt={`${firstName} ${lastName}`}
                    src={avatarUrl || undefined}
                    sx={{ width: 32, height: 32 }}
                  >
                    {!avatarUrl && initials}
                  </Avatar>
                </IconButton>
              </Tooltip>
              
              {/* Hamburger menu button - only show on mobile, positioned to the right of avatar */}
              {isMobile && (
                <IconButton
                  onClick={toggleDrawer}
                  sx={{ 
                    backgroundColor: 'transparent !important',
                    color: isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)',
                    '& svg': {
                      fill: (isStaffShell ? STAFF_SHELL_CHARCOAL : 'rgba(255,255,255,.8)') + ' !important',
                    },
                    '&:hover': { 
                      backgroundColor: 'transparent !important',
                      color: isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF',
                      '& svg': {
                        fill: isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF',
                      },
                    },
                  }}
                  aria-label="menu"
                >
                  <MenuIcon />
                </IconButton>
              )}
            </Box>
            
            {/* Avatar Dropdown Menu */}
            <Menu
              anchorEl={avatarMenuAnchorEl}
              open={Boolean(avatarMenuAnchorEl)}
              onClose={() => setAvatarMenuAnchorEl(null)}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <MenuItem disabled>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {firstName} {lastName}
                </Typography>
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => {
                const effectiveSecurityLevel = currentClaimsSecurityLevel || securityLevel;
                const isWorker = effectiveSecurityLevel && ['1', '2', '3', '4'].includes(effectiveSecurityLevel);
                const tenantSlug = activeTenant?.slug || 'c1';
                const profilePath = isWorker ? `/${tenantSlug}/users/${user?.uid}` : `/users/${user?.uid}`;
                navigate(profilePath);
                setAvatarMenuAnchorEl(null);
              }}>
                My Profile
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => {
                navigate('/privacy-settings');
                setAvatarMenuAnchorEl(null);
              }}>
                Settings
              </MenuItem>
              <Divider />
              <MenuItem onClick={async () => {
                setAvatarMenuAnchorEl(null);
                await logout();
              }}>
                <LogoutIcon sx={{ mr: 1, fontSize: 20 }} />
                Log Out
              </MenuItem>
            </Menu>

            {/* Language menu (opened from globe icon next to avatar) */}
            <Menu
              anchorEl={languageMenuAnchorEl}
              open={Boolean(languageMenuAnchorEl)}
              onClose={() => setLanguageMenuAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                selected={preferredLanguage === 'en'}
                onClick={async () => {
                  setLanguageMenuAnchorEl(null);
                  if (preferredLanguage === 'en') return;
                  setPreferredLanguage('en');
                  if (user?.uid) {
                    try {
                      const userRef = doc(db, 'users', user.uid);
                      await updateDoc(userRef, { preferredLanguage: 'en', updatedAt: new Date() });
                    } catch (err) {
                      console.error('Failed to update preferred language:', err);
                      setPreferredLanguage(preferredLanguage);
                    }
                  }
                }}
              >
                English
              </MenuItem>
              <MenuItem
                selected={preferredLanguage === 'es'}
                onClick={async () => {
                  setLanguageMenuAnchorEl(null);
                  if (preferredLanguage === 'es') return;
                  setPreferredLanguage('es');
                  if (user?.uid) {
                    try {
                      const userRef = doc(db, 'users', user.uid);
                      await updateDoc(userRef, { preferredLanguage: 'es', updatedAt: new Date() });
                    } catch (err) {
                      console.error('Failed to update preferred language:', err);
                      setPreferredLanguage(preferredLanguage);
                    }
                  }
                }}
              >
                Español
              </MenuItem>
            </Menu>
          </Box>
        </Box>

        {/* Scrollable content area - with top bar offset */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            mt: '64px', // Offset for fixed top bar
          }}
        >
          <Outlet />
        </Box>
        
        {/* Direct Messenger Drawer */}
        <MessengerDrawer />
        
        {/* ChatGPT Drawer */}
        <ChatGPTDrawer />
        
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

  return shouldProvideGoogleStatus ? (
    <GoogleStatusProvider tenantId={effectiveGoogleTenantId}>
      {layout}
    </GoogleStatusProvider>
  ) : (
    layout
  );
});

export default React.memo(Layout);
