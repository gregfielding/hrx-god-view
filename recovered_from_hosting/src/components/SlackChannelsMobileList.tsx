/**
 * Slack Channels Mobile List Component
 * 
 * Mobile card layout for Slack channels with polished UX.
 */

import React from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  Avatar,
  IconButton,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import { Tooltip } from '@mui/material';
import { SlackChannelView } from '../types/slackChannels';
import { getChannelColor, isRecentlyActive } from '../utils/slackChannelUtils';

interface SlackChannelsMobileListProps {
  channels: SlackChannelView[];
  onToggleWatch: (id: string) => void;
  onToggleMute: (id: string) => void;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
  onRowClick?: (channel: SlackChannelView) => void;
}

const SlackChannelsMobileList: React.FC<SlackChannelsMobileListProps> = ({
  channels,
  onToggleWatch,
  onToggleMute,
  onDelete,
  isAdmin = false,
  onRowClick,
}) => {
  const formatDate = (date: Date | null | undefined): string => {
    if (!date) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Stack spacing={2}>
      {channels.map((channel) => {
        const channelColor = getChannelColor(channel.name);
        const recentlyActive = isRecentlyActive(channel.lastMessageAt);
        const isMuted = channel.isMuted;

        return (
          <Paper
            key={channel.id}
            variant="outlined"
            sx={{
              p: 2.5,
              cursor: 'pointer',
              opacity: isMuted ? 0.7 : 1,
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            {/* Top Row: Channel Name */}
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
              <Box display="flex" alignItems="center" flex={1} minWidth={0}>
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: channelColor,
                    color: 'white',
                    fontSize: '1rem',
                    fontWeight: 600,
                    mr: 1.5,
                  }}
                >
                  {channel.displayName.charAt(1) || '#'}
                </Avatar>
                <Box flex={1} minWidth={0}>
                  <Typography variant="subtitle2" fontWeight={600} noWrap>
                    {channel.displayName}
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5} mt={0.25}>
                    {channel.isWatched && (
                      <Chip
                        label="Watched"
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.65rem',
                          bgcolor: 'rgba(0, 87, 184, 0.1)',
                          color: '#0057B8',
                          border: '1px solid rgba(0, 87, 184, 0.2)',
                        }}
                      />
                    )}
                    {isMuted && (
                      <Chip
                        icon={<VolumeOffIcon sx={{ fontSize: '0.7rem !important' }} />}
                        label="Muted"
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.65rem',
                          bgcolor: 'rgba(0, 0, 0, 0.05)',
                          color: 'text.secondary',
                        }}
                      />
                    )}
                  </Box>
                </Box>
              </Box>
              {/* Unread Badge - Gray for low-priority, Blue for watched, never red */}
              {channel.unreadCount && channel.unreadCount > 0 && (
                <Chip
                  label={channel.unreadCount}
                  size="small"
                  sx={{
                    ml: 1,
                    minWidth: 32,
                    bgcolor: channel.isWatched ? 'primary.main' : 'grey.300',
                    color: channel.isWatched ? 'white' : 'text.primary',
                    fontWeight: channel.isWatched ? 600 : 400,
                  }}
                />
              )}
            </Box>

            {/* Middle: Activity Preview */}
            {channel.latestActivityLabel && channel.latestActivityLabel !== 'No recent activity' ? (
              <Box mb={1.5}>
                <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                  {recentlyActive && !isMuted && channel.activityBucket === 'active' && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: '#0057B8',
                        animation: 'pulse 2s infinite',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.5 },
                        },
                      }}
                    />
                  )}
                  {channel.latestActivityTimeLabel && (
                    <Typography variant="caption" color="text.secondary">
                      {channel.latestActivityTimeLabel}
                    </Typography>
                  )}
                </Box>
                {/* Activity label (includes sender and message preview) */}
                <Typography variant="body2" color="text.secondary" sx={{ 
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {channel.latestActivityLabel}
                </Typography>
              </Box>
            ) : (
              <Box mb={1.5}>
                <Typography variant="body2" color="text.secondary">
                  No recent activity
                </Typography>
              </Box>
            )}

            {/* Bottom: Chips (Watched, Muted) and Footer actions */}
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
              <Box display="flex" flexWrap="wrap" gap={0.5} flex={1}>
                {channel.linkedDeal && (
                  <Chip label={`Deal · ${channel.linkedDeal.name}`} size="small" variant="outlined" />
                )}
                {channel.linkedCustomer && (
                  <Chip label={`Customer · ${channel.linkedCustomer.name}`} size="small" variant="outlined" />
                )}
                {channel.linkedJob && (
                  <Chip label={`Job · ${channel.linkedJob.title}`} size="small" variant="outlined" />
                )}
                {channel.linkedTeam && (
                  <Chip label={`Team · ${channel.linkedTeam.name}`} size="small" variant="outlined" />
                )}
              </Box>
              
              {/* Footer actions row */}
              <Box display="flex" alignItems="center" gap={0.5}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatch(channel.id);
                  }}
                  sx={{
                    color: channel.isWatched ? '#0057B8' : 'text.secondary',
                  }}
                >
                  {channel.isWatched ? (
                    <StarIcon fontSize="small" />
                  ) : (
                    <StarBorderIcon fontSize="small" />
                  )}
                </IconButton>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMute(channel.id);
                  }}
                >
                  {channel.isMuted ? (
                    <VolumeOffIcon fontSize="small" />
                  ) : (
                    <NotificationsOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
                {isAdmin && onDelete && (
                  <Tooltip title="Delete channel">
                    <IconButton
                      size="small"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.confirm(`Are you sure you want to delete ${channel.displayName}? This action cannot be undone.`)) {
                          try {
                            await onDelete(channel.id);
                          } catch (err) {
                            console.error('Error deleting channel:', err);
                            alert('Failed to delete channel. Please try again.');
                          }
                        }
                      }}
                      sx={{
                        color: 'error.main',
                        '&:hover': {
                          bgcolor: 'error.light',
                          color: 'error.dark',
                        },
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
};

export default SlackChannelsMobileList;
