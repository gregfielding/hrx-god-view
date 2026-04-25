import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore';
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
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
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
import HowToRegIcon from '@mui/icons-material/HowToReg';
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
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import BarChartIcon from '@mui/icons-material/BarChart';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import PersonIcon from '@mui/icons-material/Person';
import CheckIcon from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { SlackHashIcon } from './icons/SlackHashIcon';

import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { useHeartbeatPresence } from '../hooks/useHeartbeatPresence';
import { getAccessRole } from '../utils/AccessRoles'; // Import AccessRoles helpers
import { generateMenuItems, MenuItem as MenuItemType } from '../utils/menuGenerator';
import { Role, SecurityLevel } from '../utils/AccessRoles';

import GoogleConnectionChip from './GoogleConnectionChip';
import { GoogleStatusProvider, useGoogleStatus } from '../contexts/GoogleStatusContext';
import MessengerIconButton from './messenger/MessengerIconButton';
import MessengerDrawer from './messenger/MessengerDrawer';
import { useUnreadMentionsCount } from '../hooks/useUnreadMentionsCount';
import { useEffectiveSecurityLevel, useIsAdminShell } from '../hooks/useEffectiveSecurityLevel';
import ChatGPTDrawer from './chatgpt/ChatGPTDrawer';
import { pathIsUsersListPath } from '../utils/usersLayoutPersistence';
import TopBarTitleContext from '../contexts/TopBarTitleContext';

/** Charcoal for staff (0-4) shell icons and text */
const STAFF_SHELL_CHARCOAL = '#36454F';

/** Gmail/Calendar integration badge on avatar; must only render under GoogleStatusProvider. */
const AccountAvatarWithGoogleStatus: React.FC<{
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  initials: string;
  avatarMenuAnchorEl: HTMLElement | null;
  setAvatarMenuAnchorEl: (el: HTMLElement | null) => void;
  isStaffShell: boolean;
}> = ({
  firstName,
  lastName,
  avatarUrl,
  initials,
  avatarMenuAnchorEl,
  setAvatarMenuAnchorEl,
  isStaffShell,
}) => {
  const { googleStatus, error, loading } = useGoogleStatus();
  const gmailOk = googleStatus.gmail.connected;
  const calendarOk = googleStatus.calendar.connected;
  const syncErr =
    googleStatus.gmail.syncStatus === 'error' ||
    googleStatus.calendar.syncStatus === 'error';
  const hasIssue = Boolean(error) || syncErr;

  let checkColor: string;
  if (gmailOk && calendarOk && !hasIssue) {
    checkColor = '#2e7d32'; // green — full connection
  } else if (!gmailOk && !calendarOk && !hasIssue && !loading) {
    checkColor = '#d32f2f'; // red — neither connected (after load)
  } else {
    checkColor = '#ed6c02'; // amber — partial, loading, or issues
  }

  const tooltipTitle =
    gmailOk && calendarOk && !hasIssue
      ? 'Google: Gmail & Calendar connected'
      : !gmailOk && !calendarOk && !hasIssue && !loading
        ? 'Google: not connected — use menu to link'
        : hasIssue
          ? 'Google: connection issue — use menu to fix'
          : gmailOk !== calendarOk
            ? 'Google: partial connection — use menu'
            : 'Account menu';

  return (
    <Tooltip title={tooltipTitle}>
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
        <Box sx={{ position: 'relative', display: 'inline-flex', width: 32, height: 32 }}>
          <Avatar alt={`${firstName} ${lastName}`} src={avatarUrl || undefined} sx={{ width: 32, height: 32 }}>
            {!avatarUrl && initials}
          </Avatar>
          <Box
            sx={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              bgcolor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.14)',
              pointerEvents: 'none',
            }}
          >
            <CheckIcon sx={{ fontSize: 11, color: checkColor }} />
          </Box>
        </Box>
      </IconButton>
    </Tooltip>
  );
};

/** Wrapper that consumes router location so it re-renders on navigation. */
const LayoutOutlet: React.FC = () => {
  useLocation(); // subscribe to location so Outlet re-renders on nav
  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        // Allow wide tables (e.g. profile → Backgrounds) to scroll horizontally instead of clipping
        // when a nested ancestor is a flex item (min-width: auto would otherwise expand past the viewport).
        overflowX: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        // Match the fixed top bar height below — keep these two values in
        // sync so the page content sits flush beneath the bar.
        mt: '48px',
        pb: '16px',
      }}
    >
      <Outlet />
    </Box>
  );
};

const Layout: React.FC = function Layout() {
  // REMOVED: Excessive logging causing re-renders
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
  useHeartbeatPresence(); // Write user presence to Firestore
  const isMobile = useMediaQuery('(max-width:768px)');
  const location = useLocation();
  const navigate = useNavigate();
  const [firestoreInboxTotal, setFirestoreInboxTotal] = useState(0);
  const [gmailInboxTotal, setGmailInboxTotal] = useState<number | null>(null);
  // Prefer the LOWER of Gmail (tab-parity) and Firestore (real-time) counts.
  // Gmail label counts lag by up to 30s and only refresh on poll or eager-refresh;
  // Firestore fires immediately when a thread's unreadCount changes, so the
  // Firestore total drops the moment a user reads a thread. Taking the min lets
  // the badge update in real time without drifting above Gmail's tab totals.
  const inboxUnreadCount = Math.min(
    99,
    gmailInboxTotal != null
      ? Math.min(gmailInboxTotal, firestoreInboxTotal)
      : firestoreInboxTotal
  );
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);
  // Alerts/notifications counts: values are still rendered as badges + tooltips
  // in the top bar, but nothing currently writes to them. Setters are dropped
  // until the alerts feed is wired up — re-add `setAlertsUnreadCount` /
  // `setAlertsCriticalCount` here when that lands.
  const [alertsUnreadCount] = useState(0);
  const [alertsCriticalCount] = useState(0);
  const [avatarMenuAnchorEl, setAvatarMenuAnchorEl] = useState<null | HTMLElement>(null);
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

    // Accounts list routes
    if (pathname === '/accounts' || pathname.startsWith('/accounts/my')) {
      return 'Accounts';
    }

    // Account detail
    if (pathname.startsWith('/accounts/')) {
      return 'Account Details';
    }
    
    // Jobs Board routes
    if (pathname.includes('/jobs/jobs-board') || pathname.includes('/recruiter/jobs-board')) {
      return 'Jobs';
    }
    if (pathname.includes('/jobs-board') || pathname.includes('/jobs-dashboard')) {
      return 'Jobs Board';
    }
    
    // Company Setup routes
    if (pathname.includes('/company-setup')) {
      return 'Company Setup';
    }
    
    // Users hub list tabs (/users, /users/all, /users/my, …) — before profile routes below
    if (pathname === '/users' || pathIsUsersListPath(pathname)) {
      return 'Users';
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
        // If viewing your own profile, show "My Account"
        if (uidPart === user?.uid) {
          return 'My Account';
        }
        // Default to "User Details" if we can't determine (likely viewing someone else)
        return 'User Details';
      }
      return 'My Account';
    }
    
    // CRM routes
    if (pathname.includes('/crm')) {
      return 'CRM';
    }
    
    // Recruiter routes
    if (pathname.includes('/jobs') || pathname.includes('/recruiter')) {
      return 'Jobs';
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

  const [topBarTitleOverride, setTopBarTitleOverride] = useState<React.ReactNode | null>(null);
  const topBarTitleContextValue = useMemo(
    () => ({ titleOverride: topBarTitleOverride, setTitleOverride: setTopBarTitleOverride }),
    [topBarTitleOverride],
  );

  const [open, setOpen] = useState(true);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  // Development role switcher state — the dev override UI was removed but we
  // preserve the indirection so any future re-introduction of the switcher
  // doesn't have to re-thread `role`/`securityLevel` through every consumer.
  const [devRole] = useState<Role>(role);
  const [devSecurityLevel] = useState<SecurityLevel>(securityLevel);

  // Tenant state — the array itself isn't read anywhere (we only need the
  // setter so we can populate `activeTenant` once below); keep the setter via
  // an empty destructure so React still owns the state for re-renders.
  const [, setTenants] = useState<any[]>([]); // TODO: type Tenant
  const [tenantsLoading, setTenantsLoading] = useState(false);

  // Add a ref to track if we've already set the initial tenant
  const hasSetInitialTenant = useRef(false);

  // Always use collapsed width for dark shell (64-72px)
  const drawerWidth = 76; // Fixed width for always-collapsed sidebar (per logo spec)

  // Use development values for testing, fallback to real values
  const effectiveRole = devRole || role;
  const effectiveSecurityLevel = devSecurityLevel || securityLevel;
  const userAccessRole = getAccessRole(effectiveRole, effectiveSecurityLevel);
  const isApplicant = currentClaimsSecurityLevel === '2' || effectiveSecurityLevel === '2';

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

  // Tenant logo fetch is kept (the listener still warms the avatar/branding
  // path), but we don't currently render `agencyLogoUrl` anywhere — keep just
  // the setter so the effect below stays correct without warning.
  const [, setAgencyLogoUrl] = useState<string | null>(null);

  // Gmail mailbox counts loader — kept in a ref so the Firestore listener can
  // eagerly call it when read state changes locally (no more 30s badge lag
  // after marking messages read).
  const gmailCountsLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const firestoreInboxTotalRef = useRef<number>(0);

  // Inbox nav badge: prefer Gmail mailbox counts (matches Inbox tabs: Primary, Updates, etc.).
  // Fall back to Firestore thread unread sum when Gmail is not connected.
  useEffect(() => {
    if (!user?.uid || !activeTenant?.id) {
      setFirestoreInboxTotal(0);
      firestoreInboxTotalRef.current = 0;
      return;
    }

    const threadsRef = collection(db, 'tenants', activeTenant.id, 'emailThreads');
    const threadsQuery = query(
      threadsRef,
      where('participantUserIds', 'array-contains', user.uid),
      where('status', '==', 'active'),
      orderBy('lastMessageAt', 'desc'),
      limit(500)
    );

    const unsubscribe = onSnapshot(
      threadsQuery,
      (snapshot) => {
        const total = snapshot.docs.reduce(
          (sum, d) => sum + (Number((d.data() as any)?.unreadCount) || 0),
          0
        );
        const prev = firestoreInboxTotalRef.current;
        firestoreInboxTotalRef.current = total;
        setFirestoreInboxTotal(total);
        // If Firestore says the local unread count changed (a read action fired,
        // an inbound arrived, etc.), refresh Gmail counts now instead of waiting
        // for the next poll. This keeps the nav badge in sync with the UI.
        if (total !== prev) {
          const loader = gmailCountsLoaderRef.current;
          if (loader) loader().catch(() => void 0);
        }
      },
      (err) => {
        console.warn('Inbox unread count listener failed:', err);
        setFirestoreInboxTotal(0);
        firestoreInboxTotalRef.current = 0;
      }
    );

    return () => unsubscribe();
  }, [user?.uid, activeTenant?.id]);

  // Gmail mailbox counts: single source of truth for badge so it matches Inbox tabs (e.g. Updates 10).
  // Self-healing circuit breaker: we start the 30s interval ONLY after a successful first call.
  // This prevents hammering `getGmailMailboxCounts` for users who don't have Gmail connected
  // (previously: N-page-load × 30s = perpetual 500s in the console, since the callable fails
  // hard when no OAuth tokens are on the user doc). Refresh the page after connecting Gmail
  // to resume polling.
  useEffect(() => {
    if (!user?.uid) {
      setGmailInboxTotal(null);
      gmailCountsLoaderRef.current = null;
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    /** How many times in a row the load call has failed — used to stop polling after repeated failures. */
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 1; // one strike and we stop for this session

    const load = async (): Promise<boolean> => {
      try {
        const getCounts = httpsCallable<{ userId: string }, { success: boolean; counts?: Record<string, { threadsUnread?: number }> }>(functions, 'getGmailMailboxCounts');
        const result = await getCounts({ userId: user.uid });
        if (cancelled) return false;
        const data = result.data;
        if (!data?.success || !data.counts) {
          setGmailInboxTotal(null);
          consecutiveFailures += 1;
          return false;
        }
        const c = data.counts;
        const total = Number(c.primary?.threadsUnread || 0) + Number(c.social?.threadsUnread || 0) + Number(c.promotions?.threadsUnread || 0) + Number(c.updates?.threadsUnread || 0) + Number(c.forums?.threadsUnread || 0) + Number(c.spam?.threadsUnread || 0);
        setGmailInboxTotal(total);
        consecutiveFailures = 0;
        return true;
      } catch {
        if (!cancelled) setGmailInboxTotal(null);
        consecutiveFailures += 1;
        return false;
      }
    };

    gmailCountsLoaderRef.current = async () => {
      await load();
    };

    (async () => {
      const ok = await load();
      if (cancelled) return;
      if (!ok) return; // Gmail not connected or backend broken — don't start the interval.
      interval = setInterval(async () => {
        const pollOk = await load();
        if (!pollOk && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && interval) {
          // Recovered-then-failed case: stop the bleeding until next mount.
          clearInterval(interval);
          interval = null;
        }
      }, 30000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      gmailCountsLoaderRef.current = null;
    };
  }, [user?.uid]);

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
    // Intentional one-shot — `tenantsLoading` is excluded to prevent the
    // setTenantsLoading(true)/setTenantsLoading(false) cycle from re-firing
    // this effect (infinite loop), and `activeTenant`/`setActiveTenant` are
    // excluded so a user-driven tenant switch doesn't get clobbered by a
    // re-fetch that resets back to the default initial tenant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user, tenantIds, tenantId]);

  const toggleDrawer = () => setOpen((prev) => !prev);

  // SPA-safe navigation helper for sidebar/topbar actions.
  const navigateSafe = (target: string) => {
    navigate(target);
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

  const getEffectiveSecurityLevel = useEffectiveSecurityLevel();
  const hasAdminLevel = useIsAdminShell();

  // Filter menu items based on user flags without regenerating the entire menu
  const filteredMenuItems = useMemo(() => {
    // Get effective security level for filtering
    const secLevel = getEffectiveSecurityLevel;
    const isLowLevel = secLevel && ['0', '1', '2', '3', '4'].includes(String(secLevel));
    const hideWorkerPrivacyForAdminShell = hasAdminLevel;

    return menuItems.filter((mi) => {
      if (mi.text === 'Sales CRM' && !crmSalesEnabled) return false;
      if (mi.text === 'Recruiter' && !recruiterEnabled) return false;
      if (mi.text === 'Jobs Board' && !jobsBoardEnabled) return false;
      // Hide "Jobs Board" from menu items if user is low level (0-4) - it's shown as a shortcut instead
      if (mi.text === 'Jobs Board' && isLowLevel) return false;
      // Worker privacy / notifications — not for internal shell (5–7)
      if (hideWorkerPrivacyForAdminShell && mi.text === 'Privacy & Notifications') return false;
      return true;
    });
  }, [menuItems, crmSalesEnabled, recruiterEnabled, jobsBoardEnabled, getEffectiveSecurityLevel, hasAdminLevel]);

  const menuItemsWithIcons = filteredMenuItems.map(item => {
    const iconMap: Record<string, React.ReactNode> = {
      'Dashboard': <RocketLaunchIcon />, 
      'ChatGPT': <RocketLaunchIcon />,
      'Chat GPT': <RocketLaunchIcon />, 
      'Customers': <BusinessIcon />, 
      'Agencies': <GroupWorkIcon />,
      'Tenants': <BusinessIcon />,
      'Team Access': <RecordVoiceOverIcon />,
      'Recruiter': <WorkIcon />,
      'Jobs': <WorkIcon />,
      'Finances and Budgeting': <BarChartIcon />,
      'Onboarding': <HowToRegIcon />,
      'Workforce': <PeopleIcon />,
      'Users': <GroupsIcon />,
      'Accounts': <AccountBalanceIcon />,
      'Invoicing': <AttachMoneyIcon />,
      'Workers Comp': <HealthAndSafetyIcon />,
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
      'Messages': <ChatIcon />,
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
            top: 0,
            left: 0,
            height: '100vh',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            borderRadius: 0,
            zIndex: 1000, // Below app bar (1100) so top bar and sidebar meet flush
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
        {/* Logo removed - now in top bar; pad so nav icons sit below the 48px app bar */}
        <List sx={{ flexGrow: 1, pb: '80px', paddingTop: '48px' }}>
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
                    component="button"
                    onClick={() => {
                      navigateSafe(dashboardPath);
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
          {/* Jobs Board shortcut for security levels 0-4 (above My Account) */}
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
                    component="button"
                    onClick={() => {
                      navigateSafe(jobsPath);
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
              .filter(({ text }) => {
                if (text === 'Log out') return false; // Remove Logout from sidebar
                const isWorkerSurface =
                  location.pathname.startsWith('/c1/workers') ||
                  location.pathname.startsWith('/c1/jobs-board');
                // MVP worker comms model: hide legacy Inbox surface on worker routes.
                if (isWorkerSurface && text === 'Inbox') return false;
                return true;
              })
              .map(({ text, to, icon }) => {
              const isInbox = text === 'Inbox';
              const showBadge = isInbox && inboxUnreadCount > 0;
              const pathname = location.pathname;
              const navSearchParams = new URLSearchParams(
                location.search.startsWith('?') ? location.search.slice(1) : location.search,
              );
              const isUserDetailsPath =
                pathname.includes('/users/') &&
                !pathname.includes('/recruiter/users/') &&
                pathname.split('/users/').length > 1;

              // Only mark as selected if pathname exactly matches or starts with the route.
              // Support query targets (e.g. /settings?tab=workers-comp).
              // Also treat `/users/{id}` as part of any `/.../users` list route (we redirect legacy detail routes).
              // Don't mark ChatGPT as active when on dashboard.
              let isSelected = false;
              if (to && to !== '#') {
                if (to.includes('?')) {
                  const [pathPart, queryPart] = to.split('?');
                  const expectedParams = new URLSearchParams(queryPart);
                  const pathMatches = pathname === pathPart || pathname.startsWith(`${pathPart}/`);
                  if (pathMatches) {
                    isSelected = true;
                    for (const [key, value] of expectedParams.entries()) {
                      if (navSearchParams.get(key) !== value) {
                        isSelected = false;
                        break;
                      }
                    }
                  }
                } else {
                  isSelected =
                    pathname === to ||
                    (pathname.startsWith(to + '/') && !(text === 'ChatGPT' && pathname.startsWith('/dashboard'))) ||
                    (isUserDetailsPath && /\/users$/.test(to));
                  if (to === '/settings' && navSearchParams.get('tab') === 'workers-comp') {
                    isSelected = false;
                  }
                }
              }
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
                    component="button"
                    onClick={text === 'Log out'
                      ? async () => { await logout(); }
                      : () => {
                          if (to) navigateSafe(to);
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
        data-router-path={location.pathname}
        sx={{
          flexGrow: 1,
          minWidth: 0,
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
            // Right gutter: 16px on phones, 24px from md and up.
            // (Was md:4 = 32px; trimmed to keep top bar visually compact.)
            pr: { xs: 2, md: 3 },
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Top bar height — paired with the page content `mt: '48px'`
            // and the sidebar List `paddingTop: '48px'` above. Update all
            // three together if you change this.
            height: 48,
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
                onClick={() => navigateSafe('/')} // Optional: go home on click
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
            <Box sx={{ ml: '12px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
              {topBarTitleOverride != null ? (
                <Box
                  sx={{
                    color: isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    minWidth: 0,
                  }}
                >
                  {topBarTitleOverride}
                </Box>
              ) : (
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 600,
                    color: isStaffShell ? STAFF_SHELL_CHARCOAL : '#FFFFFF',
                    lineHeight: 1.2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {getPageTitle()}
                </Typography>
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Top-Right Notifications Bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {/* 📥 Inbox Counter (temporarily hidden)
              {inboxUnreadCount > 0 && (
                <Tooltip title={`${inboxUnreadCount} unread inbox messages`}>
                  <IconButton
                    onClick={() => navigateSafe('/inbox')}
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
              */}
              
              {/* 💬 Messages Counter - Internal HRX Messages */}
              {messagesUnreadCount > 0 && (
                <Tooltip title={`${messagesUnreadCount} unread messages`}>
                  <IconButton
                    onClick={() => navigateSafe('/messages')}
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
                    onClick={() => navigateSafe('/slack')}
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
                    onClick={() => navigateSafe('/tasks')}
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
              
              
              {/* ChatGPT Icon - Only for security levels 5-7 (temporarily hidden) */}
              {/* {hasAdminLevel && (
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
              )} */}
              
              {/* Direct Messenger Icon - Only for security levels 5-7 */}
              {user && hasAdminLevel && (
                <MessengerIconButton />
              )}

              
              {/* 👤 Avatar Menu */}
              {shouldProvideGoogleStatus ? (
                <AccountAvatarWithGoogleStatus
                  firstName={firstName}
                  lastName={lastName}
                  avatarUrl={avatarUrl}
                  initials={initials}
                  avatarMenuAnchorEl={avatarMenuAnchorEl}
                  setAvatarMenuAnchorEl={setAvatarMenuAnchorEl}
                  isStaffShell={isStaffShell}
                />
              ) : (
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
              )}
              
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
              {shouldProvideGoogleStatus ? (
                <>
                  <Box
                    component="li"
                    sx={{
                      listStyle: 'none',
                      px: 2,
                      py: 1.25,
                      display: 'flex',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <GoogleConnectionChip tenantId={effectiveGoogleTenantId} />
                  </Box>
                  <Divider component="li" sx={{ margin: 0 }} />
                </>
              ) : null}
              <MenuItem onClick={() => {
                const effectiveSecurityLevel = currentClaimsSecurityLevel || securityLevel;
                const isWorker = effectiveSecurityLevel && ['1', '2', '3', '4'].includes(effectiveSecurityLevel);
                const tenantSlug = activeTenant?.slug || 'c1';
                const profilePath = isWorker ? `/${tenantSlug}/users/${user?.uid}` : `/users/${user?.uid}`;
                navigateSafe(profilePath);
                setAvatarMenuAnchorEl(null);
              }}>
                My Account
              </MenuItem>
              {!hasAdminLevel ? (
                <>
                  <Divider />
                  <MenuItem
                    onClick={() => {
                      navigateSafe('/privacy-settings');
                      setAvatarMenuAnchorEl(null);
                    }}
                  >
                    Settings
                  </MenuItem>
                </>
              ) : null}
              <Divider />
              <MenuItem onClick={async () => {
                setAvatarMenuAnchorEl(null);
                await logout();
              }}>
                <LogoutIcon sx={{ mr: 1, fontSize: 20 }} />
                Log Out
              </MenuItem>
            </Menu>

          </Box>
        </Box>

        {/* Scrollable content area - LayoutOutlet re-renders on location change and remounts Outlet so content updates when clicking sidebar links */}
        <TopBarTitleContext.Provider value={topBarTitleContextValue}>
          <LayoutOutlet />
        </TopBarTitleContext.Provider>
        
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
};

export default Layout;
