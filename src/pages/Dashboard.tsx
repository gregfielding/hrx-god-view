/**
 * Dashboard Page
 * 
 * Unified activity feed showing recent items from Email, Slack DMs, and Slack Channels.
 */

import React, { useState } from 'react';
import { Box } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import DashboardFeed from '../components/DashboardFeed';
import EmailThreadView from '../components/EmailThreadView';
import SlackChannelDrawer from '../components/SlackChannelDrawer';
import { useDirectMessenger } from '../contexts/DirectMessengerContext';
import { useSlackChannels } from '../hooks/useSlackChannels';
import { SlackChannelView } from '../types/slackChannels';
import { canUserAccessSlack } from '../utils/security';

const Dashboard: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || '';
  const canAccessSlack = canUserAccessSlack(user);

  // Email drawer state
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(null);

  // Slack channel drawer state
  const [slackChannelDrawerOpen, setSlackChannelDrawerOpen] = useState(false);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState<SlackChannelView | null>(null);

  // DM drawer uses DirectMessengerContext
  const { openMessenger, setActiveThreadId, setMode } = useDirectMessenger();

  // Get Slack channels for drawer (need channel object for SlackChannelDrawer)
  const { channels: slackChannels } = useSlackChannels(
    canAccessSlack ? effectiveTenantId : null
  );

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

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Dashboard"
        subtitle="Unified activity stream from Email, Slack DMs, and Channels"
      />

      <Box sx={{ flex: 1, overflow: 'hidden', px: { xs: 2, md: 3 }, pb: 2 }}>
        <DashboardFeed
          onOpenEmailDrawer={handleOpenEmailDrawer}
          onOpenSlackDMDrawer={handleOpenSlackDMDrawer}
          onOpenSlackChannelDrawer={handleOpenSlackChannelDrawer}
        />
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
    </Box>
  );
};

export default Dashboard;
