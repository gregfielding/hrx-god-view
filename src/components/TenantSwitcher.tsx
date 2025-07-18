import React, { useState } from 'react';
import {
  Box,
  Avatar,
  Menu,
  MenuItem,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Alert,
  Snackbar,
  Backdrop
} from '@mui/material';
import {
  Business as BusinessIcon,
  AccountBalance as AccountBalanceIcon,
  Store as StoreIcon,
  Check as CheckIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface Tenant {
  id: string;
  name: string;
  type: string;
  avatar?: string;
  slug?: string;
}

interface TenantSwitcherProps {
  tenants: Tenant[];
  activeTenant: Tenant | null;
  setActiveTenant: (tenant: Tenant) => void;
  loading: boolean;
  open?: boolean; // Add open prop
}

const TenantSwitcher: React.FC<TenantSwitcherProps> = ({ tenants, activeTenant, setActiveTenant, loading, open = true }) => {
  const { user, tenantId } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const openMenu = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTenantSwitch = async (newTenantId: string) => {
    if (!user || newTenantId === tenantId) {
      handleClose();
      return;
    }
    try {
      setSwitching(true);
      // Update activeTenantId in Firestore
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { activeTenantId: newTenantId });
      setSuccess('Tenant switched successfully');
      handleClose();
      setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (err: any) {
      setError(err.message || 'Failed to switch tenant');
      setSwitching(false);
    }
  };

  const getTenantIcon = (type: string) => {
    switch (type) {
      case 'Agency':
        return <AccountBalanceIcon />;
      case 'Customer':
        return <StoreIcon />;
      case 'Employer':
        return <BusinessIcon />;
      default:
        return <BusinessIcon />;
    }
  };

  const getTenantInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Determine avatar/icon size
  // 25% larger when expanded: 30px collapsed, 37.5px (rounded to 38px) expanded
  const avatarSize = open ? 72 : 38;
  const avatarPadding = open ? 1 : 0;
  const avatarRadius = open ? 2 : 0;

  if (!tenants || tenants.length <= 1) {
    return null;
  }

  if (!activeTenant) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Loading tenants...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <Tooltip title="Switch Tenant">
        <IconButton
          onClick={handleClick}
          sx={{
            p: avatarPadding,
            borderRadius: avatarRadius,
            border: '1px solid',
            backgroundColor: 'white',
            borderColor: 'divider',
            '&:hover': {
              borderColor: 'transparent',
            },
          }}
        >
          {activeTenant.avatar ? (
            <Avatar
              src={activeTenant.avatar}
              alt={activeTenant.name}
              sx={{ width: avatarSize, height: avatarSize, border: '0px solid #e0e0e0' }}
              imgProps={{
                onError: (e: any) => {
                  // Remove src to trigger fallback to initials
                  e.target.onerror = null;
                  e.target.src = '';
                  // Optionally, you could also update the activeTenant object to clear avatar if you want
                },
              }}
            >
              {getTenantInitials(activeTenant.name)}
            </Avatar>
          ) : activeTenant.name ? (
            <Avatar
              sx={{
                width: avatarSize,
                height: avatarSize,
                bgcolor: 'primary.main',
                fontSize: open ? '0.875rem' : '0.75rem',
                border: '1px solid #e0e0e0',
              }}
            >
              {getTenantInitials(activeTenant.name)}
            </Avatar>
          ) : (
            React.cloneElement(getTenantIcon(activeTenant.type), { sx: { fontSize: avatarSize } })
          )}
        </IconButton>
      </Tooltip>
      {/* Removed tenant name label/text below the icon/avatar */}

      <Menu
        anchorEl={anchorEl}
        open={openMenu}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        PaperProps={{
          sx: {
            minWidth: 200,
            maxHeight: 300,
            overflow: 'auto',
          },
        }}
      >
        {tenants.map((tenant) => (
          <MenuItem
            key={tenant.id}
            onClick={async () => {
              setActiveTenant(tenant);
              handleClose();
              if (user && tenant.id !== tenantId) {
                try {
                  const userRef = doc(db, 'users', user.uid);
                  await updateDoc(userRef, { activeTenantId: tenant.id });
                  // No reload needed; app will update reactively
                } catch (err) {
                  setError('Failed to switch tenant');
                }
              }
            }}
            selected={tenant.id === activeTenant.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <ListItemIcon>
              {tenant.avatar ? (
                <Avatar
                  src={tenant.avatar}
                  alt={tenant.name}
                  sx={{ width: 38, height: 38, border: '1px solid #e0e0e0' }}
                  imgProps={{
                    onError: (e: any) => {
                      e.target.onerror = null;
                      e.target.src = '';
                    },
                  }}
                >
                  {getTenantInitials(tenant.name)}
                </Avatar>
              ) : tenant.name ? (
                <Avatar
                  sx={{
                    width: 38,
                    height: 38,
                    bgcolor: 'primary.main',
                    fontSize: '0.75rem',
                    border: '1px solid #e0e0e0',
                  }}
                >
                  {getTenantInitials(tenant.name)}
                </Avatar>
              ) : (
                getTenantIcon(tenant.type)
              )}
            </ListItemIcon>
            <ListItemText
              primary={tenant.name}
              secondary={tenant.type}
              primaryTypographyProps={{ fontSize: '0.875rem' }}
              secondaryTypographyProps={{ fontSize: '0.75rem' }}
            />
            {tenant.id === activeTenant.id && (
              <CheckIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            )}
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!success}
        autoHideDuration={3000}
        onClose={() => setSuccess(null)}
      >
        <Alert severity="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      </Snackbar>
      <Backdrop open={switching} sx={{ zIndex: 2000, color: '#fff' }}>
        <CircularProgress color="inherit" />
      </Backdrop>
    </Box>
  );
};

export default TenantSwitcher; 