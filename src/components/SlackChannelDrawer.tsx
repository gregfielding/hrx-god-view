/**
 * Slack Channel Drawer Component
 * 
 * Right-side drawer (desktop) or bottom sheet (mobile) for viewing
 * Slack channel messages and posting new messages.
 */

import React, { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Button,
  Avatar,
  AvatarGroup,
  Divider,
  Alert,
  Snackbar,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useAuth } from '../contexts/AuthContext';
import { SlackChannelView } from '../types/slackChannels';
import { useSlackChannelThread } from '../hooks/useSlackChannelThread';
import SlackMessageList from './SlackMessageList';
import SlackChannelComposer from './SlackChannelComposer';
import { getChannelColor } from '../utils/slackChannelUtils';
import type { MemberPreview } from '../hooks/useSlackChannelMembership';

interface SlackChannelDrawerProps {
  open: boolean;
  channel: SlackChannelView | null;
  members?: MemberPreview[];
  onClose: () => void;
  onToggleWatch?: (channelId: string) => Promise<void>;
}

const SlackChannelDrawer: React.FC<SlackChannelDrawerProps> = ({
  open,
  channel,
  members = [],
  onClose,
  onToggleWatch,
}) => {
  const { user, activeTenant } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [snackbarError, setSnackbarError] = useState<string | null>(null);

  const tenantId = activeTenant?.id || '';
  const channelId = channel?.id || null;

  const { messages, loading, error, sendMessage, sending } = useSlackChannelThread({
    tenantId,
    channelId,
    limit: 50,
  });

  const handleSendMessage = async (text: string) => {
    try {
      await sendMessage(text);
      setSnackbarMessage(`Message sent to ${channel?.displayName || 'channel'}`);
    } catch (err: any) {
      setSnackbarError(err.message || 'Could not send message to Slack');
    }
  };

  if (!channel) {
    return (
      <Drawer
        anchor={isMobile ? 'bottom' : 'right'}
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: { xs: '100%', md: '520px' },
            height: { xs: '90%', md: '100%' },
            maxHeight: { xs: '90vh', md: '100vh' },
          },
        }}
      >
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Alert severity="warning">This Slack channel is no longer available.</Alert>
          <Button onClick={onClose} sx={{ mt: 2 }}>
            Close
          </Button>
        </Box>
      </Drawer>
    );
  }

  const channelColor = getChannelColor(channel.name);
  const channelInitial = channel.displayName.charAt(1) || '#';

  return (
    <>
      <Drawer
        anchor={isMobile ? 'bottom' : 'right'}
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: { xs: '100%', md: '520px' },
            minWidth: { md: '520px' },
            maxWidth: { md: '520px' },
            height: { xs: '90%', md: '100%' },
            maxHeight: { xs: '90vh', md: '100vh' },
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
            // Prevent any width changes on hover
            '&:hover': {
              width: { xs: '100%', md: '520px' },
              minWidth: { md: '520px' },
              maxWidth: { md: '520px' },
            },
            // Prevent pointer events from interfering with hover
            pointerEvents: 'auto',
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header */}
          <Box
            sx={{
              p: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: channelColor,
                    color: 'white',
                    fontSize: '1rem',
                    fontWeight: 600,
                  }}
                >
                  {channelInitial}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" fontWeight={600} noWrap>
                    {channel.displayName}
                  </Typography>
                  {channel.latestActivityTimeLabel && (
                    <Typography variant="caption" color="text.secondary">
                      {channel.latestActivityTimeLabel}
                    </Typography>
                  )}
                </Box>
              </Box>
              <IconButton onClick={onClose} size="small">
                <CloseIcon />
              </IconButton>
            </Box>

            {/* Meta row */}
            {channel.topic && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {channel.topic}
              </Typography>
            )}

            {/* Action buttons */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
              {members.length > 0 && (
                <AvatarGroup
                  max={4}
                  sx={{
                    '& .MuiAvatar-root': {
                      width: 24,
                      height: 24,
                      fontSize: '0.75rem',
                      border: '2px solid #fff',
                      boxSizing: 'content-box',
                    },
                    '& .MuiAvatarGroup-avatar': {
                      borderColor: '#fff',
                    },
                    mr: 0.5,
                  }}
                >
                  {members.map((m) => (
                    <Avatar
                      key={m.userId}
                      src={m.avatarUrl}
                      alt={m.displayName || m.email || m.userId}
                    >
                      {(m.displayName || m.email || 'U').charAt(0).toUpperCase()}
                    </Avatar>
                  ))}
                </AvatarGroup>
              )}
            </Box>
          </Box>

          {/* Error display */}
          {error && (
            <Alert severity="error" sx={{ m: 2 }} onClose={() => {}}>
              {error}
            </Alert>
          )}

          {/* Messages list */}
          <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'grey.50' }}>
            <SlackMessageList messages={messages} loading={loading} channelId={channel.slackChannelId} />
          </Box>

          {/* Composer */}
          <SlackChannelComposer
            sending={sending}
            onSend={handleSendMessage}
            channelName={channel.name}
          />
        </Box>
      </Drawer>

      {/* Success/Error Snackbars */}
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarMessage(null)} severity="success" sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
      <Snackbar
        open={!!snackbarError}
        autoHideDuration={6000}
        onClose={() => setSnackbarError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarError(null)} severity="error" sx={{ width: '100%' }}>
          {snackbarError}
        </Alert>
      </Snackbar>
    </>
  );
};

export default SlackChannelDrawer;

