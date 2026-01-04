/**
 * Slack Channels Mobile List Component
 * 
 * Mobile card layout for Slack channels with membership support.
 */

import React, { useState } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  Avatar,
  IconButton,
  Button,
  CircularProgress,
} from '@mui/material';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import { Tooltip } from '@mui/material';
import { SlackChannelView } from '../types/slackChannels';
import { getChannelColor, isRecentlyActive } from '../utils/slackChannelUtils';
import { MemberPreview } from '../hooks/useSlackChannelMembership';

interface SlackChannelsMobileListProps {
  channels: SlackChannelView[];
  membersByChannel: Record<string, MemberPreview[]>;
  isMemberByChannel: Record<string, boolean>;
  onJoin: (channelId: string) => Promise<void>;
  onLeave: (channelId: string) => Promise<void>;
  onToggleMute: (id: string) => void;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
  onRowClick?: (channel: SlackChannelView) => void;
}

const SlackChannelsMobileList: React.FC<SlackChannelsMobileListProps> = ({
  channels,
  membersByChannel,
  isMemberByChannel,
  onJoin,
  onLeave,
  onToggleMute,
  onDelete,
  isAdmin = false,
  onRowClick,
}) => {
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});

  const handleJoin = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingActions(prev => ({ ...prev, [channelId]: true }));
    try {
      await onJoin(channelId);
    } catch (err) {
      console.error('Error joining channel:', err);
      alert('Failed to join channel. Please try again.');
    } finally {
      setLoadingActions(prev => ({ ...prev, [channelId]: false }));
    }
  };

  const handleLeave = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingActions(prev => ({ ...prev, [channelId]: true }));
    try {
      await onLeave(channelId);
    } catch (err) {
      console.error('Error leaving channel:', err);
      alert('Failed to leave channel. Please try again.');
    } finally {
      setLoadingActions(prev => ({ ...prev, [channelId]: false }));
    }
  };

  const renderMembers = (channelId: string) => {
    const members = membersByChannel[channelId] || [];
    
    if (members.length === 0) {
      return <Typography variant="caption" color="text.secondary">—</Typography>;
    }

    const displayMembers = members.slice(0, 3);
    const remainingCount = members.length - 3;

    return (
      <Box display="flex" alignItems="center" gap={0.5}>
        {displayMembers.map((member, idx) => {
          const initials = member.displayName
            ?.split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || member.email?.slice(0, 2).toUpperCase() || '?';
          
          return (
            <Avatar
              key={member.userId}
              src={member.avatarUrl}
              sx={{
                width: 28,
                height: 28,
                fontSize: '0.7rem',
                border: '2px solid white',
                marginLeft: idx > 0 ? '-8px' : 0,
                zIndex: 3 - idx,
              }}
            >
              {initials}
            </Avatar>
          );
        })}
        {remainingCount > 0 && (
          <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 500 }}>
            +{remainingCount}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Stack spacing={2}>
      {channels.map((channel) => {
        const channelColor = getChannelColor(channel.name);
        const recentlyActive = isRecentlyActive(channel.lastMessageAt);
        const isMuted = channel.isMuted;
        const isMember = isMemberByChannel[channel.id] || false;
        const isLoadingAction = loadingActions[channel.id] || false;

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
            {/* Top Row: Channel Name and Members */}
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
              {/* Members */}
              <Box ml={1}>
                {renderMembers(channel.id)}
              </Box>
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

            {/* Bottom: Chips and Footer actions */}
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
                {/* Join/Leave Button */}
                {isMember ? (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={(e) => handleLeave(channel.id, e)}
                    disabled={isLoadingAction}
                    sx={{
                      textTransform: 'none',
                      minWidth: 70,
                    }}
                  >
                    {isLoadingAction ? <CircularProgress size={16} /> : 'Leave'}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={(e) => handleJoin(channel.id, e)}
                    disabled={isLoadingAction}
                    sx={{
                      textTransform: 'none',
                      minWidth: 70,
                      bgcolor: '#0057B8',
                      '&:hover': { bgcolor: '#004a9f' },
                    }}
                  >
                    {isLoadingAction ? <CircularProgress size={16} /> : 'Join'}
                  </Button>
                )}

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