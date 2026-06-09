import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n';
import HomeIcon from '@mui/icons-material/Home';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import InboxIcon from '@mui/icons-material/Inbox';
import PersonIcon from '@mui/icons-material/Person';
import PaymentsIcon from '@mui/icons-material/Payments';

const drawerWidth = 240;

/** Routes guests can use without signing in (full shell still shown). */
const GUEST_NAV_PATHS = new Set([
  '/c1/workers/dashboard',
  '/c1/jobs-board',
  '/c1/workers/profile',
]);

// Worker sidebar. Notes on recent label/structure changes (2026-06-08):
//   - "Dashboard" → "Home" with a HomeIcon (nav.home). The worker landing
//     page reads as a home, not an analytics dashboard.
//   - "Find Work" → "Jobs Board" (nav.findWork value changed in i18n).
//   - "My Assignments" → "My Schedule" (nav.myAssignments value changed).
//   - Pre-screen entry REMOVED entirely. Interviews are now sent to
//     workers as a direct link when needed — they don't belong in the
//     standing nav, where they read as a perpetual to-do even after the
//     worker has completed one.
//   - "Notifications" → "Inbox" (nav.inbox) with an inbox-tray icon. The
//     destination page (/c1/workers/notifications) is a notification
//     feed (applications / assignments / reminders), so "Inbox" reads
//     truer than the earlier "Settings".
const baseNavConfig = [
  { key: 'nav.home', path: '/c1/workers/dashboard', icon: <HomeIcon /> },
  { key: 'nav.findWork', path: '/c1/jobs-board', icon: <WorkIcon /> },
  { key: 'nav.myAssignments', path: '/c1/workers/assignments', icon: <AssignmentIcon /> },
  { key: 'nav.myAccount', path: '/c1/workers/profile', icon: <PersonIcon /> },
  // "My Applications" removed from the standing nav — it now lives under
  // My Schedule → Archive → Applications (avoids two paths to the same list).
  { key: 'nav.payroll', path: '/c1/workers/payroll', icon: <PaymentsIcon /> },
  { key: 'nav.inbox', path: '/c1/workers/notifications', icon: <InboxIcon /> },
  /* Help & Support hidden: import HelpOutlineIcon, append nav.helpSupport -> /c1/workers/support */
];

/** Above main + page transition layers so sidebar clicks are never swallowed (see C1 worker layout). */
const DRAWER_Z = 1301;

const drawerPaperSx = {
  width: drawerWidth,
  boxSizing: 'border-box' as const,
  mt: 0,
  borderRadius: 0,
  borderRight: '1px solid',
  borderColor: 'divider',
  zIndex: DRAWER_Z,
};

function DrawerContent({
  location,
  tenantDisplayName,
  onNavClick,
  t,
  navItems,
}: {
  location: { pathname: string };
  tenantDisplayName: string;
  onNavClick?: () => void;
  t: (key: string) => string;
  navItems: typeof baseNavConfig;
}) {
  const navigate = useNavigate();

  const go = (path: string) => {
    navigate(path);
    onNavClick?.();
  };

  const getLabel = (key: string) => t(key);

  return (
    <>
      <Box
        sx={{
          pt: 2,
          pb: 1,
          px: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => go('/c1/workers/dashboard')}
          sx={{
            width: 52,
            height: 52,
            p: 1,
            borderRadius: '12px',
            background: 'rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            border: 'none',
            textDecoration: 'none',
            transition: 'background-color 150ms ease',
            '&:hover': {
              background: 'rgba(0,0,0,0.08)',
            },
            '& img': {
              display: 'block',
              margin: 0,
            },
          }}
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
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              const target = e.target as HTMLImageElement;
              if (target.src.endsWith('/C1Y.png')) {
                target.src = '/C1.png';
              } else {
                target.style.display = 'none';
              }
            }}
          />
        </Box>
        <Typography
          variant="caption"
          sx={{
            mt: 1,
            fontWeight: 600,
            color: 'text.secondary',
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          {tenantDisplayName}
        </Typography>
      </Box>
      <List sx={{ pt: 2 }}>
        {navItems.map(({ key, path, icon }) => (
          <ListItemButton
            key={path}
            selected={location.pathname === path || location.pathname.startsWith(path + '/')}
            onClick={() => go(path)}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText primary={getLabel(key)} />
          </ListItemButton>
        ))}
      </List>
    </>
  );
}

const WorkerNav: React.FC = () => {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useT();

  const { activeTenant, user } = useAuth();
  const tenantDisplayName = activeTenant?.name || 'HRX Platform';
  // Pre-screen was removed from the standing nav (interviews are sent as a
  // direct link when needed), so the prescreen-surface-signals hook is no
  // longer consulted here. Guests see only the public subset.
  const navItems = useMemo(() => {
    if (!user) {
      return baseNavConfig.filter((item) => GUEST_NAV_PATHS.has(item.path));
    }
    return baseNavConfig;
  }, [user]);

  const closeMobileDrawer = () => setMobileOpen(false);

  // Mobile: floating hamburger + temporary drawer
  if (isMobile) {
    return (
      <>
        <IconButton
          aria-label={t('nav.openMenu')}
          onClick={() => setMobileOpen(true)}
          sx={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: 1400,
            bgcolor: 'background.paper',
            boxShadow: 2,
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          <MenuIcon />
        </IconButton>
        <Drawer
          variant="temporary"
          anchor="left"
          open={mobileOpen}
          onClose={closeMobileDrawer}
          ModalProps={{ keepMounted: true }}
          sx={{
            zIndex: (theme) => theme.zIndex.drawer + 2,
            '& .MuiDrawer-paper': drawerPaperSx,
          }}
        >
          <DrawerContent
            location={location}
            tenantDisplayName={tenantDisplayName}
            onNavClick={closeMobileDrawer}
            t={t}
            navItems={navItems}
          />
        </Drawer>
      </>
    );
  }

  // Desktop: permanent drawer
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        zIndex: DRAWER_Z,
        '& .MuiDrawer-paper': drawerPaperSx,
      }}
    >
      <DrawerContent
        location={location}
        tenantDisplayName={tenantDisplayName}
        t={t}
        navItems={navItems}
      />
    </Drawer>
  );
};

export default WorkerNav;
