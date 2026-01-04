/**
 * Slack Channels Table Component (Desktop)
 * 
 * Desktop table view for Slack channels with polished UX.
 */

import React from 'react';
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
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import { SlackChannelView } from '../types/slackChannels';
import { getChannelColor, isRecentlyActive } from '../utils/slackChannelUtils';
import StandardTablePagination from './StandardTablePagination';

interface SlackChannelsTableProps {
  channels: SlackChannelView[];
  onToggleWatch: (id: string) => void;
  onToggleMute: (id: string) => void;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
  onRowClick?: (channel: SlackChannelView) => void;
}

const SlackChannelsTable: React.FC<SlackChannelsTableProps> = ({
  channels,
  onToggleWatch,
  onToggleMute,
  onDelete,
  isAdmin = false,
  onRowClick,
}) => {
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);

  React.useEffect(() => {
    setPage(0);
  }, [channels.length]);

  const visibleChannels = React.useMemo(() => {
    return channels.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [channels, page, rowsPerPage]);

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
            
            return (
              <TableRow
                key={channel.id}
                hover
                onClick={() => onRowClick?.(channel)}
                sx={{ 
                  cursor: 'pointer',
                  opacity: isMuted ? 0.7 : 1,
                  // Inbox-style subtle striping + compact density
                  '&:nth-of-type(odd)': { bgcolor: 'rgba(0,0,0,0.02)' },
                  '&:hover': {
                    bgcolor: 'rgba(0, 0, 0, 0.02)', // Inbox hover style
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
                        {channel.isWatched && (
                          <Chip
                            label="Watched"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.65rem',
                              bgcolor: 'rgba(0, 87, 184, 0.1)',
                              color: '#0057B8',
                              border: '1px solid rgba(0, 87, 184, 0.2)',
                            }}
                          />
                        )}
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

                {/* Latest Activity Column */}
                <TableCell>
                  {channel.latestActivityLabel && channel.latestActivityLabel !== 'No recent activity' ? (
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
                          {channel.latestActivityLabel}
                        </Typography>
                      </Box>
                      {channel.latestActivityTimeLabel && (
                        <Typography variant="caption" color="text.secondary">
                          {channel.latestActivityTimeLabel}
                        </Typography>
                      )}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No recent activity
                    </Typography>
                  )}
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
                    {/* Unread Badge - Gray for low-priority, Blue for watched, never red */}
                    {channel.unreadCount && channel.unreadCount > 0 && (
                      <Chip
                        label={channel.unreadCount}
                        size="small"
                        sx={{
                          minWidth: 32,
                          bgcolor: channel.isWatched ? 'primary.main' : 'grey.300',
                          color: channel.isWatched ? 'white' : 'text.primary',
                          fontWeight: channel.isWatched ? 600 : 400,
                        }}
                      />
                    )}
                    
                    <Tooltip title={channel.isWatched ? 'Unwatch' : 'Watch'}>
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
                          <StarIcon fontSize="small" sx={{ color: '#0057B8' }} />
                        ) : (
                          <StarBorderIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>

                    <Tooltip title={channel.isMuted ? 'Unmute' : 'Mute'}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMute(channel.id);
                        }}
                        sx={{
                          color: channel.isMuted ? 'text.secondary' : 'text.secondary',
                        }}
                      >
                        {channel.isMuted ? (
                          <VolumeOffIcon fontSize="small" />
                        ) : (
                          <NotificationsOutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>

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
