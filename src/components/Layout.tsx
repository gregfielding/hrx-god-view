import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '../theme/theme';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

import {
  AppBar,
  Avatar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
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
} from '@mui/material';

import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import AppsIcon from '@mui/icons-material/Apps';

import { useAuth } from '../contexts/AuthContext';

const drawerFullWidth = 240;
const drawerCollapsedWidth = 64;
const appBarHeight = 64;

const Layout: React.FC = () => {
  const { toggleMode, mode } = useThemeMode();
  const { user, logout, avatarUrl } = useAuth(); // 👈 Added avatarUrl from context
  const isMobile = useMediaQuery('(max-width:768px)');
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(true);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  const drawerWidth = open ? drawerFullWidth : drawerCollapsedWidth;
  const isMenuOpen = Boolean(menuAnchorEl);

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

  const toggleDrawer = () => setOpen((prev) => !prev);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => setMenuAnchorEl(null);

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
    navigate('/login');
  };

  const handleSettings = () => {
    if (user) {
      navigate(`/users/${user.uid}`);
    }
    handleMenuClose();
  };

  const menuItems = [
    { text: 'Dashboard', to: '/', icon: <DashboardIcon /> },
    { text: 'Tenants', to: '/tenants', icon: <BusinessIcon /> },
    { text: 'Users', to: '/users', icon: <PeopleIcon /> },
    { text: 'Modules', to: '/modules', icon: <AppsIcon /> },
  ];

  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />

      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="h6" noWrap>
            HRX One – Admin
          </Typography>

          <Box display="flex" alignItems="center" gap={2}>
            <IconButton onClick={toggleMode} color="inherit" sx={{ mr: 1 }}>
              {mode === 'dark' ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
            <Typography variant="h6" noWrap>
              {firstName ? `Welcome, ${firstName}` : 'Welcome'}
            </Typography>
            <IconButton onClick={handleMenuClick}>
              <Avatar alt={`${firstName} ${lastName}`} src={avatarUrl || undefined}>
                {!avatarUrl && initials}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={menuAnchorEl}
              open={isMenuOpen}
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem onClick={handleSettings}>Settings</MenuItem>
              <MenuItem onClick={handleLogout}>Logout</MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: 'border-box',
            position: 'fixed',
            top: appBarHeight,
            left: 0,
            height: `calc(100vh - ${appBarHeight}px)`,
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
        <List sx={{ flexGrow: 1 }}>
          {menuItems.map(({ text, to, icon }) => (
            <ListItem key={text} disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                component={Link}
                to={to}
                selected={location.pathname === to}
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
                    color: 'inherit',
                  }}
                >
                  {icon}
                </ListItemIcon>
                {open && <ListItemText primary={text} />}
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            width: '100%',
          }}
        >
          <Divider />
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
          mt: `${appBarHeight}px`,
          height: `calc(100vh - ${appBarHeight}px)`,
          overflowY: 'auto',
          transition: (theme) =>
            theme.transitions.create(['margin', 'width'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;