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
import { C1_WORKER_AI_PRESCREEN_PATH } from '../../constants/c1WorkerRoutes';
import { useWorkerAiPrescreenSurfaceSignals } from '../../hooks/useWorkerAiPrescreenSurfaceSignals';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import ListAltIcon from '@mui/icons-material/ListAlt';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import PersonIcon from '@mui/icons-material/Person';
import QuizOutlinedIcon from '@mui/icons-material/QuizOutlined';

const drawerWidth = 240;

const baseNavConfig = [
  { key: 'nav.dashboard', path: '/c1/workers/dashboard', icon: <DashboardIcon /> },
  { key: 'nav.findWork', path: '/c1/jobs-board', icon: <WorkIcon /> },
  { key: 'nav.myAccount', path: '/c1/workers/profile', icon: <PersonIcon /> },
  { key: 'nav.prescreen', path: C1_WORKER_AI_PRESCREEN_PATH, icon: <QuizOutlinedIcon /> },
  { key: 'nav.myAssignments', path: '/c1/workers/assignments', icon: <AssignmentIcon /> },
  { key: 'nav.myApplications', path: '/c1/workers/applications', icon: <ListAltIcon /> },
  { key: 'nav.notifications', path: '/c1/workers/notifications', icon: <NotificationsNoneIcon /> },
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

  const getLabel = (key: string) => {
    if (key === 'nav.notifications') {
      const translated = t('nav.notifications');
      // Safety guard: never show "Inbox" for this worker nav slot.
      return translated?.toLowerCase?.() === 'inbox' ? 'Notifications' : translated;
    }
    return t(key);
  };

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
  const { showPrescreenNav } = useWorkerAiPrescreenSurfaceSignals(activeTenant?.id, user?.uid ?? null);
  const navItems = useMemo(() => {
    if (showPrescreenNav) return baseNavConfig;
    return baseNavConfig.filter((item) => item.path !== C1_WORKER_AI_PRESCREEN_PATH);
  }, [showPrescreenNav]);

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
