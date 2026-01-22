
/**
 * Slack Channels Page
 * 
 * Dedicated Slack channels interface with membership support.
 * Focuses on channels only (no DMs).
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Box, Typography, Alert, CircularProgress, useMediaQuery, useTheme, Button, Snackbar, TextField, Tabs, Tab, Paper, Avatar } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import SyncIcon from '@mui/icons-material/Sync';
import SearchIcon from '@mui/icons-material/Search';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { useDashboardFeed } from '../hooks/useDashboardFeed';
import MentionsDrawer from '../components/MentionsDrawer';
import { canUserAccessSlack, getSecurityLevelForActiveTenant } from '../utils/security';
import { useSlackChannels } from '../hooks/useSlackChannels';
import { useSlackChannelMembership } from '../hooks/useSlackChannelMembership';
import SlackChannelsFilters, { SlackChannelFilterType } from '../components/SlackChannelsFilters';
import SlackChannelsTable from '../components/SlackChannelsTable';
import SlackChannelsMobileList from '../components/SlackChannelsMobileList';
import SlackChannelsEmptyState from '../components/SlackChannelsEmptyState';
import SlackChannelsSkeleton from '../components/SlackChannelsSkeleton';
import SlackChannelDrawer from '../components/SlackChannelDrawer';
import PageHeader from '../components/PageHeader';
import { SlackChannelView } from '../types/slackChannels';
import { DashboardFeedItem } from '../types/dashboardFeed';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useSlackChannelLastActivityFallback } from '../hooks/useSlackChannelLastActivityFallback';
import { getChannelColor } from '../utils/slackChannelUtils';

const SlackPage: React.FC = () => {
  const { user, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const effectiveTenantId = activeTenant?.id || '';
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Get active tab from URL, default to 'channels'
  const activeTab = searchParams.get('tab') || 'channels';
  
  // Get mentions for the Mentions tab
  const { feedItems } = useDashboardFeed({ limit: 500 });
  const mentions = feedItems.filter((item) => item.sourceType === 'mention');
  
  // Mentions drawer state
  const [mentionsDrawerOpen, setMentionsDrawerOpen] = useState(false);
  
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
  
  // Check if user has security level >= 7 for admin actions (delete button)
  const activeTenantSecurityLevel = userWithTenant 
    ? getSecurityLevelForActiveTenant(userWithTenant)
    : 1;
  const isAdmin = activeTenantSecurityLevel >= 7;
  
  // Only show sync button to specific admin user
  const ADMIN_USER_ID = 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2';
  const canManageChannels = user?.uid === ADMIN_USER_ID;
  
  // Membership tracking hook
  const {
    membersByChannel,
    isMemberByChannel,
    joinChannel,
    leaveChannel,
    loading: membershipLoading,
  } = useSlackChannelMembership(effectiveTenantId, user?.uid || null);

  const {
    channels,
    loading,
    error,
    filter,
    setFilter,
    deleteChannel,
    refresh,
  } = useSlackChannels(effectiveTenantId);

  // Apply membership filter
  const filteredChannels = useMemo(() => {
    if (filter.membershipFilter === 'myChannels') {
      return channels.filter(channel => isMemberByChannel[channel.id] === true);
    }
    return channels;
  }, [channels, filter.membershipFilter, isMemberByChannel]);

  // Fallback: for channels missing slackChannels.lastMessage* snapshot fields, use newest stored slack_messages.
  const lastActivityByChannel = useSlackChannelLastActivityFallback(
    effectiveTenantId,
    filteredChannels.map((c) => c.id),
  );

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

  const handleFilterChange = (newFilter: SlackChannelFilterType) => {
    setFilter({ ...filter, membershipFilter: newFilter });
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
    const params = new URLSearchParams(searchParams);
    if (newValue === 'channels') {
      params.delete('tab');
    } else {
      params.set('tab', newValue);
    }
    setSearchParams(params);
  };

  // Handle mention click - open the specific Slack channel
  const handleMentionClick = (mention: DashboardFeedItem) => {
    if (mention.mentionMetadata?.origin === 'slack' && mention.drawerScope.channelId) {
      const channel = channels.find((c) => c.id === mention.drawerScope.channelId);
      if (channel) {
        handleRowClick(channel);
        setMentionsDrawerOpen(false);
      }
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
        title={activeTab === 'mentions' ? 'Mentions' : 'Slack Channels'}
        subtitle={activeTab === 'mentions' 
          ? `You've been mentioned ${mentions.length} time${mentions.length !== 1 ? 's' : ''} in Slack.`
          : 'View activity across connected Slack channels. Join channels to stay updated.'}
        filters={
          <SlackChannelsFilters
            filter={filter.membershipFilter}
            onChangeFilter={handleFilterChange}
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

      {/* Tabs */}
      <Paper sx={{ borderRadius: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          sx={{
            px: 3,
            '& .MuiTabs-indicator': { bgcolor: '#0057B8' },
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              minHeight: 48,
            },
          }}
        >
          <Tab label="Channels" value="channels" />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AlternateEmailIcon sx={{ fontSize: '1.2rem' }} />
                Mentions
                {mentions.length > 0 && (
                  <Box
                    sx={{
                      minWidth: 20,
                      height: 20,
                      borderRadius: '10px',
                      bgcolor: 'primary.main',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      px: 0.75,
                    }}
                  >
                    {mentions.length > 99 ? '99+' : mentions.length}
                  </Box>
                )}
              </Box>
            }
            value="mentions"
          />
        </Tabs>
      </Paper>

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
        {activeTab === 'mentions' ? (
          <Box sx={{ p: 3 }}>
            {mentions.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, textAlign: 'center' }}>
                <AlternateEmailIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2, opacity: 0.5 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No mentions yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  When someone mentions you in Slack, it will appear here.
                </Typography>
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>
                    All Mentions ({mentions.length})
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => setMentionsDrawerOpen(true)}
                    size="small"
                  >
                    Open Drawer
                  </Button>
                </Box>
                {/* Show mentions grouped by channel */}
                {Object.entries(
                  mentions.reduce((acc, mention) => {
                    if (mention.mentionMetadata?.origin === 'slack') {
                      const channelId = mention.mentionMetadata.slackChannelId;
                      const channelName = mention.mentionMetadata.slackChannelName || mention.channelLabel || 'Unknown Channel';
                      const key = `${channelId}:${channelName}`;
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(mention);
                    } else {
                      const key = mention.channelLabel || 'HRX Mentions';
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(mention);
                    }
                    return acc;
                  }, {} as Record<string, DashboardFeedItem[]>)
                )
                  .sort(([a], [b]) => {
                    const aMentions = mentions.filter((m) => {
                      if (m.mentionMetadata?.origin === 'slack') {
                        const channelName = m.mentionMetadata.slackChannelName || m.channelLabel || '';
                        return `${m.mentionMetadata.slackChannelId}:${channelName}` === a;
                      }
                      return (m.channelLabel || 'HRX Mentions') === a;
                    });
                    const bMentions = mentions.filter((m) => {
                      if (m.mentionMetadata?.origin === 'slack') {
                        const channelName = m.mentionMetadata.slackChannelName || m.channelLabel || '';
                        return `${m.mentionMetadata.slackChannelId}:${channelName}` === b;
                      }
                      return (m.channelLabel || 'HRX Mentions') === b;
                    });
                    const aLatest = Math.max(...aMentions.map((m) => m.timestamp));
                    const bLatest = Math.max(...bMentions.map((m) => m.timestamp));
                    return bLatest - aLatest;
                  })
                  .map(([channelKey, channelMentions]) => {
                    const [channelId, channelName] = channelKey.split(':');
                    const sortedMentions = [...channelMentions].sort((a, b) => b.timestamp - a.timestamp);
                    const channelColor = getChannelColor(channelName);

                    return (
                      <Box key={channelKey} sx={{ mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                          <Avatar
                            sx={{
                              width: 24,
                              height: 24,
                              bgcolor: channelColor,
                              color: 'white',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            #
                          </Avatar>
                          <Typography variant="subtitle2" fontWeight={600}>
                            {channelName}
                          </Typography>
                          <Box
                            sx={{
                              minWidth: 24,
                              height: 24,
                              borderRadius: '12px',
                              bgcolor: 'primary.main',
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              px: 1,
                              ml: 'auto',
                            }}
                          >
                            {sortedMentions.length}
                          </Box>
                        </Box>
                        {sortedMentions.map((mention) => (
                          <Box
                            key={mention.id}
                            onClick={() => handleMentionClick(mention)}
                            sx={{
                              p: 2,
                              mb: 1,
                              borderRadius: 1,
                              bgcolor: mention.isUnread ? 'action.hover' : 'transparent',
                              border: '1px solid',
                              borderColor: 'divider',
                              cursor: 'pointer',
                              '&:hover': {
                                bgcolor: 'action.hover',
                              },
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant="body2" fontWeight={500}>
                                {mention.fromLabel}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(mention.timestamp).toLocaleString()}
                              </Typography>
                              {mention.isUnread && (
                                <Box
                                  sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    bgcolor: 'primary.main',
                                    ml: 'auto',
                                  }}
                                />
                              )}
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                              {mention.snippet}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    );
                  })}
              </Box>
            )}
          </Box>
        ) : (loading || membershipLoading) ? (
          <SlackChannelsSkeleton />
        ) : filteredChannels.length === 0 ? (
          <SlackChannelsEmptyState 
            filter={filter}
            onBrowseChannels={() => setFilter({ ...filter, membershipFilter: 'all' })}
          />
        ) : isMobile ? (
          <SlackChannelsMobileList
            channels={filteredChannels}
            membersByChannel={membersByChannel}
            isMemberByChannel={isMemberByChannel}
            lastActivityByChannel={lastActivityByChannel}
            onJoin={joinChannel}
            onLeave={leaveChannel}
            onDelete={deleteChannel}
            isAdmin={isAdmin}
            onRowClick={handleRowClick}
          />
        ) : (
          <SlackChannelsTable
            channels={filteredChannels}
            membersByChannel={membersByChannel}
            isMemberByChannel={isMemberByChannel}
            lastActivityByChannel={lastActivityByChannel}
            onJoin={joinChannel}
            onLeave={leaveChannel}
            onDelete={deleteChannel}
            isAdmin={isAdmin}
            onRowClick={handleRowClick}
          />
        )}
      </Box>

      {/* Slack Channel Drawer */}
      <SlackChannelDrawer
        open={drawerOpen}
        channel={selectedChannel}
        members={selectedChannel ? (membersByChannel[selectedChannel.id] || []) : []}
        onClose={handleDrawerClose}
        onToggleWatch={async () => {}} // No longer used
      />

      {/* Mentions Drawer */}
      <MentionsDrawer
        open={mentionsDrawerOpen}
        mentions={mentions}
        onClose={() => setMentionsDrawerOpen(false)}
        onMentionClick={handleMentionClick}
      />
    </Box>
  );
};

export default SlackPage;