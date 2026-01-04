/**
 * Slack Channels Page
 * 
 * Dedicated Slack channels interface per hrx-slack-channels-implementation.md
 * Focuses on channels only (no DMs).
 */

import React, { useState } from 'react';
import { Box, Typography, Alert, CircularProgress, useMediaQuery, useTheme, Button, Snackbar, TextField } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import SyncIcon from '@mui/icons-material/Sync';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../contexts/AuthContext';
import { canUserAccessSlack, getSecurityLevelForActiveTenant } from '../utils/security';
import { useSlackChannels } from '../hooks/useSlackChannels';
import SlackChannelsFilters from '../components/SlackChannelsFilters';
import SlackChannelsTable from '../components/SlackChannelsTable';
import SlackChannelsMobileList from '../components/SlackChannelsMobileList';
import SlackChannelsEmptyState from '../components/SlackChannelsEmptyState';
import SlackChannelsSkeleton from '../components/SlackChannelsSkeleton';
import SlackChannelDrawer from '../components/SlackChannelDrawer';
import PageHeader from '../components/PageHeader';
import { SlackChannelView } from '../types/slackChannels';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const SlackPage: React.FC = () => {
  const { user, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const effectiveTenantId = activeTenant?.id || '';
  
  // Ensure user object has activeTenantId and tenantIds for security check
  const userAny = user as any;
  const userWithTenant = user ? {
    ...userAny,
    activeTenantId: userAny.activeTenantId || activeTenant?.id,
    tenantIds: userAny.tenantIds || (activeTenant?.id ? {
      [activeTenant.id]: {
        securityLevel: currentClaimsSecurityLevel || securityLevel,
      }
    } : {}),
  } : null;
  
  const canAccess = canUserAccessSlack(userWithTenant);
  
  // Check if user has security level >= 7 for admin actions
  const activeTenantSecurityLevel = userWithTenant 
    ? getSecurityLevelForActiveTenant(userWithTenant)
    : 1;
  const isAdmin = activeTenantSecurityLevel >= 7;
  
  // Only show delete and sync buttons to specific admin user
  const ADMIN_USER_ID = 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2';
  const canManageChannels = user?.uid === ADMIN_USER_ID;
  
  const {
    channels,
    loading,
    error,
    filter,
    setFilter,
    toggleWatch,
    toggleMute,
    deleteChannel,
    refresh,
  } = useSlackChannels(effectiveTenantId);

  // Drawer state
  const [selectedChannel, setSelectedChannel] = useState<SlackChannelView | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Backfill state
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillSuccess, setBackfillSuccess] = useState<string | null>(null);

  // Handle row click to open drawer
  const handleRowClick = (channel: SlackChannelView) => {
    setSelectedChannel(channel);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    // Keep selectedChannel for a moment to allow smooth close animation
    setTimeout(() => setSelectedChannel(null), 300);
  };

  const handleBackfillClick = async () => {
    if (!effectiveTenantId) return;
    
    try {
      setIsBackfilling(true);
      setBackfillError(null);
      setBackfillSuccess(null);

      const backfillSlackChannelsFn = httpsCallable(functions, 'backfillSlackChannels');
      const result: any = await backfillSlackChannelsFn({ tenantId: effectiveTenantId });
      
      const channelsProcessed = result.data?.channelsProcessed || 0;
      const channelsArchived = result.data?.channelsArchived || 0;
      
      let successMessage = `Successfully synced ${channelsProcessed} channels from Slack.`;
      if (channelsArchived > 0) {
        successMessage += ` ${channelsArchived} deleted channel${channelsArchived === 1 ? '' : 's'} marked as archived.`;
      }
      
      setBackfillSuccess(successMessage);
      // Refresh the channels list
      refresh();
    } catch (err: any) {
      console.error('Slack backfill error:', err);
      const errorMessage = err.message || 'Failed to sync channels from Slack.';
      
      // Provide more helpful error message
      if (errorMessage.includes('No active Slack workspace') || errorMessage.includes('Bot token')) {
        setBackfillError(
          'Slack integration is not configured. Please go to Settings > Integrations and configure Slack with a valid bot token.'
        );
      } else {
        setBackfillError(errorMessage + ' Please try again.');
      }
    } finally {
      setIsBackfilling(false);
    }
  };

  // No access UI
  if (!canAccess) {
    return (
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: 'calc(100vh - 64px)',
        p: 4 
      }}>
        <Alert 
          severity="warning" 
          icon={<WarningAmberRoundedIcon />}
          sx={{ maxWidth: 600 }}
        >
          You do not have access to Slack. Slack access requires security level 5 or higher.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: 'calc(100vh - 64px)',
    }}>
      {/* Page Header with Standardized Layout */}
      <PageHeader
        title="Slack Channels"
        subtitle="View activity across connected Slack channels. Watch channels to prioritize them."
        filters={
          <SlackChannelsFilters
            filter={filter}
            onChangeFilter={setFilter}
            totalCount={channels.length}
            showSearch={false}
          />
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TextField
              placeholder="Search channels..."
              value={filter.search}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
              size="small"
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.2rem' }} />,
              }}
              sx={{ 
                width: { xs: '100%', md: 300 },
                maxWidth: { md: 420 },
                '& .MuiOutlinedInput-root': {
                  fontSize: '14px',
                  height: '40px', // Inbox standard
                  borderRadius: '24px', // Inbox standard
                }
              }}
            />
            {canManageChannels && (
              <Button
                variant="contained"
                startIcon={<SyncIcon />}
                onClick={handleBackfillClick}
                disabled={isBackfilling}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  px: 2.5,
                  py: 1,
                  height: '40px',
                  fontWeight: 500,
                  fontSize: '14px',
                  bgcolor: '#0057B8',
                  boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                  },
                  whiteSpace: 'nowrap',
                }}
              >
                {isBackfilling ? 'Syncing…' : 'Sync'}
              </Button>
            )}
          </Box>
        }
      />

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => {}}>
          {error.message || 'Failed to load Slack channels'}
        </Alert>
      )}

      {/* Backfill Success/Error Snackbars */}
      <Snackbar
        open={!!backfillSuccess}
        autoHideDuration={6000}
        onClose={() => setBackfillSuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setBackfillSuccess(null)}>
          {backfillSuccess}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!backfillError}
        autoHideDuration={6000}
        onClose={() => setBackfillError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="error" onClose={() => setBackfillError(null)}>
          {backfillError}
        </Alert>
      </Snackbar>

      {/* Content Area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          // Inbox standard: content is slightly less padded than the header
          px: 1,
          pt: 0,
          pb: 1,
        }}
      >
        {loading ? (
          <SlackChannelsSkeleton />
        ) : channels.length === 0 ? (
          <SlackChannelsEmptyState 
            filter={filter}
            onBrowseChannels={() => setFilter({ watchFilter: 'all' })}
          />
        ) : isMobile ? (
          <SlackChannelsMobileList
            channels={channels}
            onToggleWatch={toggleWatch}
            onToggleMute={toggleMute}
            onDelete={deleteChannel}
            isAdmin={canManageChannels}
            onRowClick={handleRowClick}
          />
        ) : (
          <SlackChannelsTable
            channels={channels}
            onToggleWatch={toggleWatch}
            onToggleMute={toggleMute}
            onDelete={deleteChannel}
            isAdmin={canManageChannels}
            onRowClick={handleRowClick}
          />
        )}
      </Box>

      {/* Slack Channel Drawer */}
      <SlackChannelDrawer
        open={drawerOpen}
        channel={selectedChannel}
        onClose={handleDrawerClose}
        onToggleWatch={toggleWatch}
        onToggleMute={toggleMute}
      />
    </Box>
  );
};

export default SlackPage;
