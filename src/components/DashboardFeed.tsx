/**
 * Dashboard Feed Component
 * 
 * Unified activity stream table displaying items from Email, Slack DMs, and Slack Channels.
 * Follows the Inbox Standard UI patterns.
 */

import React, { useState, useMemo } from 'react';
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
  Avatar,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import MessageIcon from '@mui/icons-material/Message';
import TagIcon from '@mui/icons-material/Tag';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useDashboardFeed } from '../hooks/useDashboardFeed';
import { DashboardFeedItem } from '../types/dashboardFeed';
import { openDrawerFromFeedItem, DrawerOpenCallbacks } from '../utils/dashboardFeedDrawer';
import { useAuth } from '../contexts/AuthContext';
import StandardTablePagination from './StandardTablePagination';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';

// Source metadata for icons and labels
const SOURCE_META: Record<
  DashboardFeedItem['sourceType'],
  { icon: React.ReactNode; label: string; color: string }
> = {
  email: {
    icon: <EmailIcon fontSize="small" />,
    label: 'Email',
    color: '#1976d2',
  },
  slack_dm: {
    icon: <MessageIcon fontSize="small" />,
    label: 'Slack DM',
    color: '#4caf50',
  },
  slack_channel: {
    icon: <TagIcon fontSize="small" />,
    label: 'Slack Channel',
    color: '#ff9800',
  },
};

interface DashboardFeedProps {
  onOpenEmailDrawer: (options: { threadId: string; tenantId: string }) => void;
  onOpenSlackDMDrawer: (options: { threadId: string; tenantId: string }) => void;
  onOpenSlackChannelDrawer: (options: { channelId: string }) => void;
}

const DashboardFeed: React.FC<DashboardFeedProps> = ({
  onOpenEmailDrawer,
  onOpenSlackDMDrawer,
  onOpenSlackChannelDrawer,
}) => {
  const { activeTenant } = useAuth();
  const { feedItems, loading, error, refresh } = useDashboardFeed({ limit: 100 });
  
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const tenantId = activeTenant?.id || '';

  // Paginate feed items
  const paginatedItems = useMemo(() => {
    const start = page * rowsPerPage;
    return feedItems.slice(start, start + rowsPerPage);
  }, [feedItems, page, rowsPerPage]);

  // Format relative time
  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return new Date(timestamp).toLocaleDateString();
  };

  // Get full date/time for tooltip
  const getFullDateTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  // Handle row click
  const handleRowClick = (item: DashboardFeedItem) => {
    const callbacks: DrawerOpenCallbacks = {
      openEmailDrawer: onOpenEmailDrawer,
      openSlackDMDrawer: onOpenSlackDMDrawer,
      openSlackChannelDrawer: onOpenSlackChannelDrawer,
    };
    openDrawerFromFeedItem(item, tenantId, callbacks);
  };

  // Get initials from display name
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading && feedItems.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <TableContainer component={Paper} sx={{ maxHeight: 'calc(100vh - 300px)' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Source</TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Snippet</TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>From</TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textAlign: 'right' }}>
                Time
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No activity to display
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((item) => {
                const sourceMeta = SOURCE_META[item.sourceType];
                return (
                  <TableRow
                    key={item.id}
                    hover
                    onClick={() => handleRowClick(item)}
                    sx={{
                      cursor: 'pointer',
                      '&:nth-of-type(odd)': {
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    {/* Source Column */}
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Box
                          sx={{
                            color: sourceMeta.color,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {sourceMeta.icon}
                        </Box>
                        <Typography variant="body2">{sourceMeta.label}</Typography>
                      </Box>
                    </TableCell>

                    {/* Title Column */}
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: item.isUnread ? 600 : 400,
                        }}
                      >
                        {item.title}
                      </Typography>
                    </TableCell>

                    {/* Snippet Column */}
                    <TableCell>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 300,
                        }}
                      >
                        {item.snippet || '(no preview)'}
                      </Typography>
                    </TableCell>

                    {/* From Column */}
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        {item.avatarUrl ? (
                          <Avatar
                            src={item.avatarUrl}
                            sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: '0.7rem' }}
                          >
                            {getInitials(item.fromLabel)}
                          </Avatar>
                        ) : (
                          <Avatar sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: '0.7rem' }}>
                            {getInitials(item.fromLabel)}
                          </Avatar>
                        )}
                        <Typography variant="body2">{item.fromLabel}</Typography>
                      </Box>
                    </TableCell>

                    {/* Status Column */}
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        {item.isUnread && (
                          <Chip
                            label="Unread"
                            size="small"
                            color="primary"
                            sx={{ height: 20, fontSize: '0.65rem' }}
                          />
                        )}
                        {item.hasMentions && (
                          <Tooltip title="Mentioned">
                            <Chip
                              icon={<NotificationsActiveIcon sx={{ fontSize: '0.9rem !important' }} />}
                              label="@"
                              size="small"
                              color="warning"
                              sx={{ height: 20, fontSize: '0.65rem' }}
                            />
                          </Tooltip>
                        )}
                        {item.isMuted && (
                          <Tooltip title="Muted">
                            <VolumeOffIcon sx={{ fontSize: '1rem', color: 'text.disabled' }} />
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>

                    {/* Time Column */}
                    <TableCell align="right">
                      <Tooltip title={getFullDateTime(item.timestamp)}>
                        <Typography variant="body2" color="text.secondary">
                          {formatTime(item.timestamp)}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      <StandardTablePagination
        count={feedItems.length}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
};

export default DashboardFeed;

