/**
 * Dashboard Page
 * 
 * Unified activity feed showing recent items from Email, Slack DMs, and Slack Channels.
 */

import React, { useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, CardHeader, IconButton, Tab, Tabs, Typography, useMediaQuery } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import DashboardFeed from '../components/DashboardFeed';
import EmailThreadView from '../components/EmailThreadView';
import SlackChannelDrawer from '../components/SlackChannelDrawer';
import MentionsDrawer from '../components/MentionsDrawer';
import { useDashboardFeed } from '../hooks/useDashboardFeed';
import { DashboardFeedItem } from '../types/dashboardFeed';
import CalendarWidget from '../components/CalendarWidget';
import TasksDashboard from '../components/TasksDashboard';
import AddIcon from '@mui/icons-material/Add';
import { useDirectMessenger } from '../contexts/DirectMessengerContext';
import { useSlackChannels } from '../hooks/useSlackChannels';
import { SlackChannelView } from '../types/slackChannels';
import { normalizeSecurityLevel } from '../utils/security';
import { useNavigate } from 'react-router-dom';
import { useGoogleStatus } from '../contexts/GoogleStatusContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { DASHBOARD_WIDGET } from '../utils/dashboardWidgetTokens';

const Dashboard: React.FC = () => {
  const { user, activeTenant, securityLevel, currentClaimsSecurityLevel } = useAuth();
  const effectiveTenantId = activeTenant?.id || (user as any)?.activeTenantId || '';
  const canAccessSlack = normalizeSecurityLevel(currentClaimsSecurityLevel || securityLevel) >= 5;
  const navigate = useNavigate();
  const { googleStatus, isOAuthInProgress, setIsOAuthInProgress, refreshStatus } = useGoogleStatus();
  const [calendarConnectError, setCalendarConnectError] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width:767px)');
  const isTablet = useMediaQuery('(min-width:768px) and (max-width:1199px)');
  const [mobileTab, setMobileTab] = useState<'feed' | 'calendar' | 'todos'>('feed');

  // Email drawer state
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(null);

  // Slack channel drawer state
  const [slackChannelDrawerOpen, setSlackChannelDrawerOpen] = useState(false);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState<SlackChannelView | null>(null);

  // Mentions drawer state
  const [mentionsDrawerOpen, setMentionsDrawerOpen] = useState(false);

  // DM drawer uses DirectMessengerContext
  const { openMessenger, setActiveThreadId, setMode } = useDirectMessenger();

  // Get mentions for the drawer
  const { feedItems } = useDashboardFeed({ limit: 500 });
  const mentions = feedItems.filter((item) => item.sourceType === 'mention');

  // Get Slack channels for drawer (need channel object for SlackChannelDrawer)
  const { channels: slackChannels } = useSlackChannels(
    canAccessSlack ? effectiveTenantId : null
  );

  const tasksEntity = useMemo(() => ({
    id: user?.uid || 'dashboard',
    associations: {
      companies: [],
      contacts: [],
      deals: [],
      salespeople: user?.uid ? [user.uid] : [],
    },
  }), [user?.uid]);

  const handleSyncCalendar = async () => {
    if (!user?.uid || !effectiveTenantId) return;
    setCalendarConnectError(null);

    setIsOAuthInProgress(true);
    try {
      // Force refresh before starting OAuth to avoid stale cache
      await refreshStatus(true);
      const functions = getFunctions();
      const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
      const result = await getGmailAuthUrlFn({ userId: user.uid, tenantId: effectiveTenantId });
      const data = result.data as any;
      const authUrl = data?.authUrl;
      if (!authUrl) {
        throw new Error(data?.message || 'Could not start Google connection');
      }

      const w = 520;
      const h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        authUrl,
        'google-auth',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }
      popup.focus();
      // GoogleStatusContext will poll while isOAuthInProgress is true and stop once connected.
    } catch (e: any) {
      setIsOAuthInProgress(false);
      setCalendarConnectError(e?.message || 'Failed to start Google Calendar sync');
    }
  };

  // Open email drawer
  const handleOpenEmailDrawer = (options: { threadId: string; tenantId: string }) => {
    setSelectedEmailThreadId(options.threadId);
    setEmailDrawerOpen(true);
  };

  // Open Slack DM drawer
  const handleOpenSlackDMDrawer = (options: { threadId: string; tenantId: string }) => {
    setActiveThreadId(options.threadId);
    setMode('conversation'); // Open directly to conversation view
    openMessenger();
  };

  // Open Slack channel drawer
  const handleOpenSlackChannelDrawer = (options: { channelId: string }) => {
    const channel = slackChannels.find((c) => c.id === options.channelId);
    if (channel) {
      setSelectedSlackChannel(channel);
      setSlackChannelDrawerOpen(true);
    } else {
      console.warn('Channel not found:', options.channelId);
    }
  };

  // Open mentions drawer
  const handleOpenMentionsDrawer = () => {
    setMentionsDrawerOpen(true);
  };

  // Handle mention click - open the specific Slack channel
  const handleMentionClick = (mention: DashboardFeedItem) => {
    if (mention.mentionMetadata?.origin === 'slack' && mention.drawerScope.channelId) {
      handleOpenSlackChannelDrawer({ channelId: mention.drawerScope.channelId });
      setMentionsDrawerOpen(false);
    }
  };

  return (
    <Box sx={{ 
      minHeight: '150vh',
      maxHeight: '150vh',
      display: 'flex', 
      flexDirection: 'column',
      // On mobile and tablet, allow the page to scroll naturally
      overflow: (isMobile || isTablet) ? 'auto' : 'hidden',
    }}>
      <PageHeader
        title="Dashboard"
        subtitle={
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5, mb: '12px' }}>
              {(
              [
                { label: 'My Job Orders', onClick: () => navigate('/recruiter/my-orders'), kind: 'candidates' as const },
                { label: 'My Tasks', onClick: () => navigate('/tasks'), kind: 'tasks' as const },
                { label: 'My Calendar', onClick: () => navigate('/calendar'), kind: 'crm' as const },
                { label: 'Users', onClick: () => navigate('/recruiter/users'), kind: 'candidates' as const },
                { label: 'Contacts', onClick: () => navigate('/contacts'), kind: 'crm' as const },
                { label: 'Companies', onClick: () => navigate('/companies'), kind: 'crm' as const },
              ] as const
            ).map((b) => {
              const kindStyles =
                b.kind === 'candidates'
                  ? { bgcolor: 'rgba(0, 87, 184, 0.08)', hover: 'rgba(0, 87, 184, 0.14)' } // muted blue
                  : b.kind === 'crm'
                  ? { bgcolor: 'rgba(16, 185, 129, 0.10)', hover: 'rgba(16, 185, 129, 0.16)' } // muted green
                  : { bgcolor: 'rgba(245, 158, 11, 0.10)', hover: 'rgba(245, 158, 11, 0.16)' }; // muted amber

              return (
                <Button
                  key={b.label}
                  onClick={b.onClick}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.75)',
                    bgcolor: kindStyles.bgcolor,
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: kindStyles.hover },
                  }}
                >
                  {b.label}
                </Button>
              );
            })}
          </Box>
        }
        showDivider={false}
      />

      <Box sx={{ 
        flex: 1, 
        overflow: (isMobile || isTablet) ? 'auto' : 'hidden', 
        px: { xs: 2, md: 3 }, 
        pb: { xs: 2, md: 2 },
        // Add bottom padding for mobile/tablet scrolling
        '&::after': (isMobile || isTablet) ? {
          content: '""',
          display: 'block',
          height: '16px',
        } : {},
      }}>
        {/* Mobile tabs: Feed | Calendar | To-Dos */}
        {isMobile && (
          <Tabs
            value={mobileTab}
            onChange={(_, v) => setMobileTab(v)}
            variant="fullWidth"
            sx={{
              mb: 2,
              borderBottom: '1px solid #EAEEF4',
              '& .MuiTabs-indicator': { bgcolor: '#0057B8' },
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 0, // project standard for horizontal tabs
                minHeight: 44,
              },
            }}
          >
            <Tab value="feed" label="Feed" />
            <Tab value="calendar" label="Calendar" />
            <Tab value="todos" label="To-Dos" />
          </Tabs>
        )}

        <Box
          sx={{
            display: 'flex',
            gap: 2,
            flex: 1,
            flexDirection: isMobile || isTablet ? 'column' : 'row',
          }}
        >
          {/* Feed */}
          {(!isMobile || mobileTab === 'feed') && (
            <Box sx={{ 
              width: '100%', 
              flex: isMobile || isTablet ? 'none' : '0 0 66.666%', 
              display: 'flex',
              flexDirection: 'column',
              overflow: (isMobile || isTablet) ? 'visible' : 'hidden',
              pb: 2, // 16px bottom padding
            }}>
              <DashboardFeed
                onOpenEmailDrawer={handleOpenEmailDrawer}
                onOpenSlackDMDrawer={handleOpenSlackDMDrawer}
                onOpenSlackChannelDrawer={handleOpenSlackChannelDrawer}
                onOpenMentionsDrawer={handleOpenMentionsDrawer}
              />
            </Box>
          )}

          {/* Sidebar (tablet stacks below; desktop is right column) */}
          {!isMobile && (
            <Box
              sx={{
                width: '100%',
                flex: isTablet ? 'none' : 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                pb: 2, // 16px bottom padding
              }}
            >
              <Box sx={{ flex: 1, display: 'flex', flexDirection: isTablet ? 'row' : 'column', gap: 2, minHeight: 0 }}>
                {/* Calendar */}
                <Box
                  sx={{
                    flex: isTablet ? 1 : '0 0 calc(36% - 8px)', // desktop: calendar is 36% height (gap accounted for)
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    maxHeight: '400px',
                    minHeight: 0,
                  }}
                >
                  {googleStatus.calendar.connected ? (
                    <CalendarWidget
                      userId={user?.uid || ''}
                      tenantId={effectiveTenantId}
                      preloadedContacts={[]}
                      preloadedSalespeople={[]}
                      preloadedCompanies={[]}
                      preloadedDeals={[]}
                      variant="dashboard"
                    />
                  ) : (
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px` }}>
                      <CardHeader
                        title="Google Calendar"
                        titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                        sx={{ px: 3, pt: 3, pb: 1 }}
                      />
                      <CardContent sx={{ px: 3, pb: 3, pt: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                          Connect Google Calendar to see your schedule and create CRM-linked events.
                        </Typography>
                        {calendarConnectError && (
                          <Typography variant="body2" color="error">
                            {calendarConnectError}
                          </Typography>
                        )}
                        <Button
                          variant="contained"
                          onClick={handleSyncCalendar}
                          disabled={isOAuthInProgress}
                          sx={{
                            textTransform: 'none',
                            borderRadius: '24px',
                            height: '40px',
                            px: 2.5,
                            fontWeight: 500,
                            bgcolor: '#0057B8',
                            '&:hover': { bgcolor: '#004a9f' },
                            alignSelf: 'flex-start',
                          }}
                        >
                          {isOAuthInProgress ? 'Connecting…' : 'Sync Calendar'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </Box>

                {/* To-Dos */}
                <Box
                  sx={{
                    flex: isTablet ? 1 : '0 0 calc(64% - 8px)', // desktop: remaining height (gap accounted for)
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    minHeight: 0,
                  }}
                >
                  <Card sx={{ 
                    flex: 1, 
                    display: 'flex', 
                    padding: '16px', 
                    flexDirection: 'column', 
                    borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
                    maxHeight: 'calc(150vh - 504px)',
                    paddingBottom: '16px',
                  }}>
                    <CardHeader
                      title="To-Dos"
                      action={
                        <IconButton
                          size="small"
                          title="Add new task"
                          onClick={() => window.location.assign('/crm?tab=tasks')}
                          sx={{ width: 44, height: 44 }}
                        >
                          <AddIcon />
                        </IconButton>
                      }
                      titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                      sx={{ px: 1, pt: 1, pb: 1 }}
                    />
                    <CardContent sx={{ px: 0, pb: 0, pt: 0, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <TasksDashboard
                        entityId={user?.uid || 'dashboard'}
                        entityType="salesperson"
                        tenantId={effectiveTenantId}
                        entity={tasksEntity as any}
                        preloadedContacts={[]}
                        preloadedSalespeople={[]}
                        preloadedCompany={null}
                        preloadedDeals={[]}
                        preloadedCompanies={[]}
                        showOnlyTodos={true}
                        showCompletedInTodos={false}
                      />
                    </CardContent>
                  </Card>
                </Box>
              </Box>
            </Box>
          )}

          {/* Mobile: Calendar panel */}
          {isMobile && mobileTab === 'calendar' && (
            <Box sx={{ width: '100%', minHeight: 'auto', overflow: 'visible', mb: 2 }}>
              {googleStatus.calendar.connected ? (
                <CalendarWidget
                  userId={user?.uid || ''}
                  tenantId={effectiveTenantId}
                  preloadedContacts={[]}
                  preloadedSalespeople={[]}
                  preloadedCompanies={[]}
                  preloadedDeals={[]}
                  variant="dashboard"
                />
              ) : (
                <Card sx={{ borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px` }}>
                  <CardHeader title="Google Calendar" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} sx={{ px: 3, pt: 3, pb: 1 }} />
                  <CardContent sx={{ px: 3, pb: 3, pt: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                      Connect Google Calendar to see your schedule and create CRM-linked events.
                    </Typography>
                    <Button
                      variant="contained"
                      onClick={handleSyncCalendar}
                      disabled={isOAuthInProgress}
                      sx={{
                        textTransform: 'none',
                        borderRadius: '24px',
                        height: '40px',
                        px: 2.5,
                        fontWeight: 500,
                        bgcolor: '#0057B8',
                        '&:hover': { bgcolor: '#004a9f' },
                        alignSelf: 'flex-start',
                      }}
                    >
                      {isOAuthInProgress ? 'Connecting…' : 'Sync Calendar'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </Box>
          )}

          {/* Mobile: To-Dos panel */}
          {isMobile && mobileTab === 'todos' && (
            <Box sx={{ width: '100%', minHeight: 'auto', overflow: 'visible', mb: 2 }}>
              <Card sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
                maxHeight: 'calc(150vh - 504px)',
                paddingBottom: '16px',
              }}>
                <CardHeader
                  title="To-Dos"
                  action={
                    <IconButton
                      size="small"
                      title="Add new task"
                      onClick={() => window.location.assign('/crm?tab=tasks')}
                      sx={{ width: 44, height: 44 }}
                    >
                      <AddIcon />
                    </IconButton>
                  }
                  titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  sx={{ px: 2, pt: 2, pb: 1 }}
                />
                <CardContent sx={{ px: 0, pb: 0, pt: 0, flex: 1, minHeight: 'auto', overflow: 'visible' }}>
                  <TasksDashboard
                    entityId={user?.uid || 'dashboard'}
                    entityType="salesperson"
                    tenantId={effectiveTenantId}
                    entity={tasksEntity as any}
                    preloadedContacts={[]}
                    preloadedSalespeople={[]}
                    preloadedCompany={null}
                    preloadedDeals={[]}
                    preloadedCompanies={[]}
                    showOnlyTodos={true}
                    showCompletedInTodos={false}
                  />
                </CardContent>
              </Card>
            </Box>
          )}
        </Box>
      </Box>

      {/* Email Thread Drawer */}
      {selectedEmailThreadId && (
        <EmailThreadView
          open={emailDrawerOpen}
          onClose={() => {
            setEmailDrawerOpen(false);
            setSelectedEmailThreadId(null);
          }}
          threadId={selectedEmailThreadId}
          tenantId={effectiveTenantId}
          onThreadUpdated={() => {
            // Refresh feed could be triggered here if needed
          }}
        />
      )}

      {/* Slack Channel Drawer */}
      {selectedSlackChannel && (
        <SlackChannelDrawer
          open={slackChannelDrawerOpen}
          channel={selectedSlackChannel}
          onClose={() => {
            setSlackChannelDrawerOpen(false);
            setSelectedSlackChannel(null);
          }}
        />
      )}

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

export default Dashboard;
