/**
 * Mentions Drawer Component
 * 
 * Right-side drawer (desktop) or bottom sheet (mobile) for viewing
 * all mentions of the current user, organized by Slack channel.
 */

import React, { useMemo } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  useTheme,
  useMediaQuery,
  Link,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import { useAuth } from '../contexts/AuthContext';
import { DashboardFeedItem } from '../types/dashboardFeed';
import { getChannelColor } from '../utils/slackChannelUtils';

interface MentionsDrawerProps {
  open: boolean;
  mentions: DashboardFeedItem[];
  loading?: boolean;
  onClose: () => void;
  onMentionClick?: (mention: DashboardFeedItem) => void;
}

const MentionsDrawer: React.FC<MentionsDrawerProps> = ({
  open,
  mentions,
  loading = false,
  onClose,
  onMentionClick,
}) => {
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Group mentions by channel
  const mentionsByChannel = useMemo(() => {
    const grouped: Record<string, DashboardFeedItem[]> = {};
    
    mentions.forEach((mention) => {
      if (mention.mentionMetadata?.origin === 'slack') {
        const channelId = mention.mentionMetadata.slackChannelId;
        const channelName = mention.mentionMetadata.slackChannelName || mention.channelLabel || 'Unknown Channel';
        const key = `${channelId}:${channelName}`;
        
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(mention);
      } else {
        // HRX mentions - group by thread/context
        const key = mention.channelLabel || 'HRX Mentions';
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(mention);
      }
    });

    // Sort each group by timestamp (newest first)
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => b.timestamp - a.timestamp);
    });

    return grouped;
  }, [mentions]);

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const handleMentionClick = (mention: DashboardFeedItem) => {
    if (onMentionClick) {
      onMentionClick(mention);
    } else if (mention.mentionMetadata?.origin === 'slack' && mention.mentionMetadata.slackMessagePermalink) {
      // Open Slack message in new tab
      window.open(mention.mentionMetadata.slackMessagePermalink, '_blank');
    }
  };

  const channelKeys = Object.keys(mentionsByChannel).sort();

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', md: '600px' },
          height: { xs: '90%', md: '100%' },
          maxHeight: { xs: '90vh', md: '100vh' },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlternateEmailIcon sx={{ color: 'primary.main' }} />
            <Typography variant="h6" fontWeight={600}>
              Mentions
            </Typography>
            {mentions.length > 0 && (
              <Chip
                label={mentions.length}
                size="small"
                color="primary"
                sx={{ height: 24, fontSize: '0.75rem' }}
              />
            )}
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              <Typography color="text.secondary">Loading mentions...</Typography>
            </Box>
          ) : mentions.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, textAlign: 'center', px: 3 }}>
              <AlternateEmailIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2, opacity: 0.5 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No mentions yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                When someone mentions you in Slack or HRX, it will appear here.
              </Typography>
            </Box>
          ) : (
            channelKeys.map((channelKey, idx) => {
              const [channelId, channelName] = channelKey.split(':');
              const channelMentions = mentionsByChannel[channelKey];
              const channelColor = getChannelColor(channelName);

              return (
                <Box key={channelKey} sx={{ mb: idx < channelKeys.length - 1 ? 3 : 0 }}>
                  {/* Channel Header */}
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
                    <Typography variant="subtitle2" fontWeight={600} color="text.primary">
                      {channelName}
                    </Typography>
                    <Chip
                      label={channelMentions.length}
                      size="small"
                      sx={{ height: 20, fontSize: '0.7rem', ml: 'auto' }}
                    />
                  </Box>

                  {/* Mentions List */}
                  <List sx={{ py: 0 }}>
                    {channelMentions.map((mention, mentionIdx) => (
                      <React.Fragment key={mention.id}>
                        <ListItem
                          disablePadding
                          sx={{
                            borderRadius: 1,
                            mb: 0.5,
                            bgcolor: mention.isUnread ? 'action.hover' : 'transparent',
                            '&:hover': {
                              bgcolor: 'action.hover',
                            },
                          }}
                        >
                          <ListItemButton
                            onClick={() => handleMentionClick(mention)}
                            sx={{ py: 1.5, px: 1.5 }}
                          >
                            <ListItemAvatar>
                              <Avatar
                                sx={{
                                  width: 32,
                                  height: 32,
                                  bgcolor: getChannelColor(mention.fromLabel),
                                  color: 'white',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                {mention.fromLabel.charAt(0).toUpperCase()}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <Typography variant="body2" fontWeight={500}>
                                    {mention.fromLabel}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {formatTimeAgo(mention.timestamp)}
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
                              }
                              secondary={
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {mention.snippet}
                                </Typography>
                              }
                            />
                          </ListItemButton>
                        </ListItem>
                        {mentionIdx < channelMentions.length - 1 && <Divider component="li" variant="inset" />}
                      </React.Fragment>
                    ))}
                  </List>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default MentionsDrawer;

