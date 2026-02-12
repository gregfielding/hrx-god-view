import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Drawer, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PersonIcon from '@mui/icons-material/Person';
import FolderIcon from '@mui/icons-material/Folder';
import HelpIcon from '@mui/icons-material/Help';
import NotificationsIcon from '@mui/icons-material/Notifications';
import InboxIcon from '@mui/icons-material/Inbox';

const drawerWidth = 240;

const navItems = [
  { label: 'Dashboard', path: '/c1/workers/dashboard', icon: <DashboardIcon /> },
  { label: 'My Assignments', path: '/c1/workers/assignments', icon: <AssignmentIcon /> },
  { label: 'Notifications', path: '/c1/workers/notifications', icon: <NotificationsIcon /> },
  { label: 'Inbox', path: '/c1/workers/inbox', icon: <InboxIcon /> },
  { label: 'Applications', path: '/c1/applications', icon: <ListAltIcon /> },
  { label: 'Jobs Board', path: '/c1/jobs-board', icon: <WorkIcon /> },
  { label: 'My Profile', path: '/c1/workers/profile', icon: <PersonIcon /> },
  { label: 'My Documents', path: '/c1/workers/documents', icon: <FolderIcon /> },
  { label: 'Support', path: '/c1/workers/support', icon: <HelpIcon /> },
];

const WorkerNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          mt: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      <List sx={{ pt: 2 }}>
        {navItems.map(({ label, path, icon }) => (
          <ListItemButton
            key={path}
            selected={location.pathname === path || location.pathname.startsWith(path + '/')}
            onClick={() => navigate(path)}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
};

export default WorkerNav;
