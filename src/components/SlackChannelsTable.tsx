/**
 * Slack Channels Table Component (Desktop)
 * 
 * Desktop table view for Slack channels with membership support.
 */

import React, { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  IconButton,
  Avatar,
  Tooltip,
  Button,
  CircularProgress,
} from '@mui/material';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import DeleteIcon from '@mui/icons-material/Delete';
import { SlackChannelView } from '../types/slackChannels';
import { getChannelColor, isRecentlyActive } from '../utils/slackChannelUtils';
import StandardTablePagination from './StandardTablePagination';
import { MemberPreview } from '../hooks/useSlackChannelMembership';
import type { SlackChannelLastActivity } from '../hooks/useSlackChannelLastActivityFallback';

interface SlackChannelsTableProps {
  channels: SlackChannelView[];
  membersByChannel: Record<string, MemberPreview[]>;
  isMemberByChannel: Record<string, boolean>;
  lastActivityByChannel?: Record<string, SlackChannelLastActivity>;
  onJoin: (channelId: string) => Promise<void>;
  onLeave: (channelId: string) => Promise<void>;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
  onRowClick?: (channel: SlackChannelView) => void;
}

const SlackChannelsTable: React.FC<SlackChannelsTableProps> = ({
  channels,
  membersByChannel,
  isMemberByChannel,
  lastActivityByChannel = {},
  onJoin,
  onLeave,
  onDelete,
  isAdmin = false,
  onRowClick,
}) => {
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setPage(0);
  }, [channels.length]);

  const visibleChannels = React.useMemo(() => {
    return channels.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [channels, page, rowsPerPage]);

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
      return <Typography variant="body2" color="text.secondary">—</Typography>;
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
                width: 32,
                height: 32,
                fontSize: '0.75rem',
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
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{
        borderRadius: 2, // Inbox standard
      }}
    >
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Channel</TableCell>
            <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Members</TableCell>
            <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Latest Activity</TableCell>
            <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Linked To</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visibleChannels.map((channel) => {
            const channelColor = getChannelColor(channel.name);
            const recentlyActive = isRecentlyActive(channel.lastMessageAt);
            const isMuted = channel.isMuted;
            const isMember = isMemberByChannel[channel.id] || false;
            const isLoadingAction = loadingActions[channel.id] || false;
            
            return (
              <TableRow
                key={channel.id}
                hover
                onClick={() => onRowClick?.(channel)}
                sx={{ 
                  cursor: 'pointer',
                  opacity: isMuted ? 0.7 : 1,
                  '&:nth-of-type(odd)': { bgcolor: 'rgba(0,0,0,0.02)' },
                  '&:hover': {
                    bgcolor: 'rgba(0, 0, 0, 0.02)',
                  }
                }}
              >
                {/* Channel Column */}
                <TableCell>
                  <Box display="flex" alignItems="center">
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        bgcolor: channelColor,
                        color: 'white',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        mr: 1.5,
                      }}
                    >
                      {channel.displayName.charAt(1) || '#'}
                    </Avatar>
                    <Box flex={1} minWidth={0}>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        <Typography variant="body2" fontWeight={600}>
                          {channel.displayName}
                        </Typography>
                        {isMuted && (
                          <Chip
                            icon={<VolumeOffIcon sx={{ fontSize: '0.75rem !important' }} />}
                            label="Muted"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.65rem',
                              bgcolor: 'rgba(0, 0, 0, 0.05)',
                              color: 'text.secondary',
                            }}
                          />
                        )}
                      </Box>
                      {channel.topic && (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 300, display: 'block', mt: 0.25 }}>
                          {channel.topic}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </TableCell>

                {/* Members Column */}
                <TableCell>
                  {renderMembers(channel.id)}
                </TableCell>

                {/* Latest Activity Column */}
                <TableCell>
                  {(() => {
                    const fallback = lastActivityByChannel[channel.id];
                    const label =
                      channel.latestActivityLabel && channel.latestActivityLabel !== 'No recent activity'
                        ? channel.latestActivityLabel
                        : fallback?.latestActivityLabel && fallback.latestActivityLabel !== 'No recent activity'
                          ? fallback.latestActivityLabel
                          : null;
                    const timeLabel =
                      channel.latestActivityTimeLabel && channel.latestActivityLabel !== 'No recent activity'
                        ? channel.latestActivityTimeLabel
                        : fallback?.latestActivityTimeLabel || '';

                    if (!label) {
                      return (
                        <Typography variant="body2" color="text.secondary">
                          No recent activity
                        </Typography>
                      );
                    }

                    return (
                    <Box>
                      <Box display="flex" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
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
                        <Typography variant="body2" noWrap sx={{ maxWidth: 400, flex: 1 }}>
                          {label}
                        </Typography>
                      </Box>
                      {timeLabel && (
                        <Typography variant="caption" color="text.secondary">
                          {timeLabel}
                        </Typography>
                      )}
                    </Box>
                    );
                  })()}
                </TableCell>

                {/* Linked To Column */}
                <TableCell>
                  <Box display="flex" flexWrap="wrap" gap={0.5}>
                    {channel.linkedDeal && (
                      <Chip 
                        label={`Deal · ${channel.linkedDeal.name}`} 
                        size="small" 
                        variant="outlined"
                      />
                    )}
                    {channel.linkedCustomer && (
                      <Chip 
                        label={`Customer · ${channel.linkedCustomer.name}`} 
                        size="small" 
                        variant="outlined"
                      />
                    )}
                    {channel.linkedJob && (
                      <Chip 
                        label={`Job · ${channel.linkedJob.title}`} 
                        size="small" 
                        variant="outlined"
                      />
                    )}
                    {channel.linkedTeam && (
                      <Chip 
                        label={`Team · ${channel.linkedTeam.name}`} 
                        size="small" 
                        variant="outlined"
                      />
                    )}
                    {!channel.linkedDeal && !channel.linkedCustomer && !channel.linkedJob && !channel.linkedTeam && (
                      <Typography variant="caption" color="text.secondary">
                        Not linked
                      </Typography>
                    )}
                  </Box>
                </TableCell>

                {/* Actions Column */}
                <TableCell align="right">
                  <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
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

                    {/* Admin Delete Button (only if securityLevel >= 7) */}
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {/* Inbox-standard footer */}
      <StandardTablePagination
        count={channels.length}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        sx={{ flexShrink: 0 }}
      />
    </TableContainer>
  );
};

export default SlackChannelsTable;