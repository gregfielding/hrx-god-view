import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
import { C1_WORKER_SCREENING_PATH } from '../../constants/c1WorkerRoutes';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import ListAltIcon from '@mui/icons-material/ListAlt';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import PersonIcon from '@mui/icons-material/Person';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

const drawerWidth = 240;

const navConfig = [
  { key: 'nav.dashboard', path: '/c1/workers/dashboard', icon: <DashboardIcon /> },
  { key: 'nav.findWork', path: '/c1/jobs-board', icon: <WorkIcon /> },
  { key: 'nav.myProfile', path: '/c1/workers/profile', icon: <PersonIcon /> },
  { key: 'nav.screening', path: C1_WORKER_SCREENING_PATH, icon: <VerifiedUserIcon /> },
  { key: 'nav.myAssignments', path: '/c1/workers/assignments', icon: <AssignmentIcon /> },
  { key: 'nav.myApplications', path: '/c1/workers/applications', icon: <ListAltIcon /> },
  { key: 'nav.notifications', path: '/c1/workers/notifications', icon: <NotificationsNoneIcon /> },
  /* Help & Support hidden: import HelpOutlineIcon, append nav.helpSupport -> /c1/workers/support */
];

const drawerPaperSx = {
  width: drawerWidth,
  boxSizing: 'border-box' as const,
  mt: 0,
  borderRadius: 0,
  borderRight: '1px solid',
  borderColor: 'divider',
};

function DrawerContent({
  navigate,
  location,
  tenantDisplayName,
  onNavClick,
  t,
}: {
  navigate: (path: string) => void;
  location: { pathname: string };
  tenantDisplayName: string;
  onNavClick?: () => void;
  t: (key: string) => string;
}) {
  const getLabel = (key: string) => {
    if (key === 'nav.notifications') {
      const translated = t('nav.notifications');
      // Safety guard: never show "Inbox" for this worker nav slot.
      return translated?.toLowerCase?.() === 'inbox' ? 'Notifications' : translated;
    }
    return t(key);
  };

  const handleNav = (path: string) => {
    navigate(path);
    onNavClick?.();
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
          onClick={() => handleNav('/c1/workers/dashboard')}
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
        {navConfig.map(({ key, path, icon }) => (
          <ListItemButton
            key={path}
            selected={location.pathname === path || location.pathname.startsWith(path + '/')}
            onClick={() => handleNav(path)}
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
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useT();

  const { activeTenant } = useAuth();
  const tenantDisplayName = activeTenant?.name || 'HRX Platform';

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
            zIndex: 1300,
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
            '& .MuiDrawer-paper': drawerPaperSx,
          }}
        >
          <DrawerContent
            navigate={navigate}
            location={location}
            tenantDisplayName={tenantDisplayName}
            onNavClick={closeMobileDrawer}
            t={t}
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
        '& .MuiDrawer-paper': drawerPaperSx,
      }}
    >
      <DrawerContent
        navigate={navigate}
        location={location}
        tenantDisplayName={tenantDisplayName}
        t={t}
      />
    </Drawer>
  );
};

export default WorkerNav;
