/**
 * Dashboard Feed Component
 * 
 * Unified activity stream table displaying items from Email, Slack DMs, and Slack Channels.
 * Follows the Inbox Standard UI patterns.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Avatar,
  Chip,
  Tooltip,
  CircularProgress,
  Alert,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import EmailIcon from '@mui/icons-material/Email';
import MessageIcon from '@mui/icons-material/Message';
import TagIcon from '@mui/icons-material/Tag';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import PersonIcon from '@mui/icons-material/Person';
import { useDashboardFeed } from '../hooks/useDashboardFeed';
import { DashboardFeedItem } from '../types/dashboardFeed';
import { openDrawerFromFeedItem, DrawerOpenCallbacks } from '../utils/dashboardFeedDrawer';
import { useAuth } from '../contexts/AuthContext';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import StandardTablePagination from './StandardTablePagination';
import InboxSearchBar from './InboxSearchBar';
import { fetchEmailThreadCached } from '../utils/emailThreadCache';
import { DASHBOARD_WIDGET } from '../utils/dashboardWidgetTokens';

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
    color: '#6f42c1',
  },
  slack_channel: {
    icon: <TagIcon fontSize="small" />,
    label: 'Slack Channel',
    color: '#6f42c1',
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
  const { activeTenant, user } = useAuth();
  const { feedItems, loading, error } = useDashboardFeed({ limit: 100 });
  const isMobile = useMediaQuery('(max-width:767px)');
  const isTablet = useMediaQuery('(min-width:768px) and (max-width:1199px)');
  
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const tenantId = activeTenant?.id || '';
  const userId = user?.uid || '';

  type QuickFilter = 'all' | 'unread' | 'pinned';
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<Array<DashboardFeedItem['sourceType']>>([]);
  const [search, setSearch] = useState('');

  // Per-user lightweight UI state (Phase 2): read + pinned
  const LS_READ = useMemo(() => (userId ? `dashboardFeed.read.v1:${userId}` : ''), [userId]);
  const LS_PINNED = useMemo(() => (userId ? `dashboardFeed.pinned.v1:${userId}` : ''), [userId]);
  const [readOverrides, setReadOverrides] = useState<Record<string, true>>({});
  const [pinnedOverrides, setPinnedOverrides] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!LS_READ) {
      setReadOverrides({});
      return;
    }
    try {
      const raw = localStorage.getItem(LS_READ);
      setReadOverrides(raw ? (JSON.parse(raw) as Record<string, true>) : {});
    } catch {
      setReadOverrides({});
    }
  }, [LS_READ]);

  useEffect(() => {
    if (!LS_PINNED) {
      setPinnedOverrides({});
      return;
    }
    try {
      const raw = localStorage.getItem(LS_PINNED);
      setPinnedOverrides(raw ? (JSON.parse(raw) as Record<string, true>) : {});
    } catch {
      setPinnedOverrides({});
    }
  }, [LS_PINNED]);


  const persistRead = (next: Record<string, true>) => {
    setReadOverrides(next);
    if (!LS_READ) return;
    try {
      localStorage.setItem(LS_READ, JSON.stringify(next));
    } catch {}
  };

  const persistPinned = (next: Record<string, true>) => {
    setPinnedOverrides(next);
    if (!LS_PINNED) return;
    try {
      localStorage.setItem(LS_PINNED, JSON.stringify(next));
    } catch {}
  };


  const isPinned = (itemId: string) => !!pinnedOverrides[itemId];
  const isRead = (item: DashboardFeedItem) => !!readOverrides[item.id] || !item.isUnread;

  const markAsRead = (item: DashboardFeedItem) => {
    if (isRead(item)) return;
    persistRead({ ...readOverrides, [item.id]: true });
  };

  const togglePinned = (itemId: string) => {
    const next = { ...pinnedOverrides };
    if (next[itemId]) delete next[itemId];
    else next[itemId] = true;
    persistPinned(next);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    return feedItems.filter((item) => {
      if (sourceFilter.length > 0 && !sourceFilter.includes(item.sourceType)) return false;

      if (quickFilter === 'unread' && isRead(item)) return false;
      if (quickFilter === 'pinned' && !isPinned(item.id)) return false;

      if (!q) return true;
      const hay = `${item.title} ${item.snippet || ''} ${item.fromLabel || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [feedItems, quickFilter, search, sourceFilter, pinnedOverrides, readOverrides]);

  // Paginate feed items (after filter)
  const paginatedItems = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredItems.slice(start, start + rowsPerPage);
  }, [filteredItems, page, rowsPerPage]);

  const getTimeBucket = (timestamp: number): 'Now' | 'Earlier Today' | 'Yesterday' | 'This Week' | 'Older' => {
    if (!timestamp || timestamp <= 0) return 'Older';
    const now = new Date();
    const d = new Date(timestamp);

    const sameDay =
      now.getFullYear() === d.getFullYear() &&
      now.getMonth() === d.getMonth() &&
      now.getDate() === d.getDate();

    if (sameDay) {
      const diffMs = now.getTime() - d.getTime();
      const diffMinutes = Math.floor(diffMs / (60 * 1000));
      return diffMinutes <= 60 ? 'Now' : 'Earlier Today';
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      yesterday.getFullYear() === d.getFullYear() &&
      yesterday.getMonth() === d.getMonth() &&
      yesterday.getDate() === d.getDate();

    if (isYesterday) return 'Yesterday';

    const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 7) return 'This Week';

    return 'Older';
  };

  // Format relative time
  const formatTime = (timestamp: number): string => {
    if (!timestamp || timestamp <= 0) return '—';
    const now = new Date();
    const d = new Date(timestamp);
    const diffMs = now.getTime() - timestamp;
    const diffMinutes = Math.floor(diffMs / (60 * 1000));

    const sameDay =
      now.getFullYear() === d.getFullYear() &&
      now.getMonth() === d.getMonth() &&
      now.getDate() === d.getDate();

    if (diffMinutes <= 2) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      yesterday.getFullYear() === d.getFullYear() &&
      yesterday.getMonth() === d.getMonth() &&
      yesterday.getDate() === d.getDate();
    if (isYesterday) return 'Yesterday';

    const isSameYear = now.getFullYear() === d.getFullYear();
    return d.toLocaleDateString(
      [],
      isSameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
    );
  };

  // Get full date/time for tooltip
  const getFullDateTime = (timestamp: number): string => {
    if (!timestamp || timestamp <= 0) return '';
    return new Date(timestamp).toLocaleString();
  };

  // Handle row click
  const handleRowClick = (item: DashboardFeedItem) => {
    // Phase 2: opening marks as read (per-user UI state for now)
    markAsRead(item);
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

  const renderSourceIcon = (item: DashboardFeedItem) => {
    const meta = SOURCE_META[item.sourceType];
    const color = meta?.color || '#6B7280';
    return (
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 1.5, // ~12px
          bgcolor: alpha(color, 0.12),
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {meta?.icon}
      </Box>
    );
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

  if (isMobile) {
    // Mobile: stacked card list (calm + readable; actions always visible)
    let lastBucket: string | null = null;
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Paper
          elevation={0}
          sx={{
            borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
            border: '1px solid #EAEEF4',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, overflowY: 'auto', pb: 2 }}>
          {paginatedItems.length === 0 ? (
            <Paper
              elevation={0}
              sx={{
                borderRadius: `${DASHBOARD_WIDGET.innerRadiusPx}px`,
                border: '1px solid #EAEEF4',
                p: 2.5,
                textAlign: 'center',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                No activity to display
              </Typography>
            </Paper>
          ) : (
            paginatedItems.flatMap((item) => {
              const bucket = getTimeBucket(item.timestamp);
              const parts: React.ReactNode[] = [];
              if (bucket !== lastBucket) {
                parts.push(
                  <Typography
                    key={`bucket-${bucket}-${item.id}`}
                    variant="caption"
                    sx={{ fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', mt: lastBucket ? 1 : 0 }}
                  >
                    {bucket}
                  </Typography>,
                );
                lastBucket = bucket;
              }

              const sourceMeta = SOURCE_META[item.sourceType];
              const unread = !isRead(item);
              const pinned = isPinned(item.id);
              const fromLabel = item.fromLabel || 'Unknown';

              parts.push(
                <Paper
                  key={item.id}
                  elevation={0}
                  onClick={() => handleRowClick(item)}
                  onMouseEnter={() => {
                    if (!tenantId) return;
                    if (item.sourceType !== 'email') return;
                    void fetchEmailThreadCached({ tenantId, threadId: item.sourceId, limit: 50 });
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(item);
                    }
                  }}
                  sx={{
                    borderRadius: `${DASHBOARD_WIDGET.innerRadiusPx}px`,
                    border: '1px solid #EAEEF4',
                    p: 2.5,
                    cursor: 'pointer',
                    minHeight: 64,
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.02)' },
                  }}
                  aria-label={`${sourceMeta.label} from ${fromLabel}: ${item.title}`}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <Box sx={{ mt: 0.25, flexShrink: 0 }}>{renderSourceIcon(item)}</Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Typography
                          variant="body1"
                          sx={{
                            fontSize: '15px',
                            fontWeight: unread ? 600 : 500,
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          }}
                        >
                          {item.title}
                        </Typography>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                            {formatTime(item.timestamp)}
                          </Typography>
                          <Tooltip title={pinned ? 'Unpin' : 'Pin'}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinned(item.id);
                              }}
                              sx={{ width: 36, height: 36 }}
                            >
                              {pinned ? (
                                <PushPinIcon sx={{ fontSize: 18, color: '#0057B8' }} />
                              ) : (
                                <PushPinOutlinedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mt: 0.5,
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {item.snippet || '(no preview)'}
                      </Typography>

                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          From: {fromLabel}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                          {unread && (
                            <Chip
                              label="Unread"
                              size="small"
                              sx={{
                                height: 22,
                                fontSize: '0.7rem',
                                bgcolor: 'rgba(0, 87, 184, 0.12)',
                                color: '#0057B8',
                                fontWeight: 700,
                              }}
                            />
                          )}
                          {pinned && (
                            <Chip
                              label="Pinned"
                              size="small"
                              variant="outlined"
                              sx={{ height: 22, fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </Paper>,
              );

              return parts;
            })
          )}
        </Box>

        <StandardTablePagination
          count={filteredItems.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          sx={{ borderTop: 1, borderColor: 'divider' }}
        />
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper
        elevation={0}
        sx={{
          borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
          border: '1px solid #EAEEF4',
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Feed v2: Filter bar (chips + date range + source + search) */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: '1px solid #EAEEF4',
            bgcolor: '#FFFFFF',
            display: 'flex',
            gap: 1.5,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {([
              { key: 'all', label: 'All' },
              { key: 'unread', label: 'Unread' },
              { key: 'pinned', label: 'Pinned' },
            ] as Array<{ key: QuickFilter; label: string }>).map((f) => {
              const active = quickFilter === f.key;
              return (
                <Button
                  key={f.key}
                  onClick={() => {
                    setQuickFilter(f.key);
                    setPage(0);
                  }}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: active ? 600 : 500,
                    color: active ? '#FFFFFF' : 'rgba(0, 0, 0, 0.75)',
                    bgcolor: active ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: active ? '#004a9f' : 'rgba(0, 0, 0, 0.08)' },
                  }}
                >
                  {f.label}
                </Button>
              );
            })}
          </Box>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Source</InputLabel>
            <Select
              multiple
              value={sourceFilter}
              label="Source"
              onChange={(e: SelectChangeEvent<typeof sourceFilter>) => {
                setSourceFilter(e.target.value as typeof sourceFilter);
                setPage(0);
              }}
              renderValue={(selected) => (selected.length === 0 ? 'All Sources' : selected.join(', '))}
              sx={{
                height: 40,
                borderRadius: '999px',
                backgroundColor: 'white',
              }}
            >
              {([
                { value: 'email', label: 'Email' },
                { value: 'slack_dm', label: 'DMs' },
                { value: 'slack_channel', label: 'Slack Channels' },
              ] as Array<{ value: DashboardFeedItem['sourceType']; label: string }>).map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Checkbox checked={sourceFilter.indexOf(opt.value) > -1} />
                  <ListItemText primary={opt.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ flex: 1, minWidth: 240 }}>
            <InboxSearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              onSearch={(v) => {
                setSearch(v);
                setPage(0);
              }}
              placeholder="Search feed..."
            />
          </Box>
        </Box>

        <TableContainer
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'auto',
            width: '100%',
            '&::-webkit-scrollbar': { width: '8px', height: '8px' },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 0, 0, 0.02)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
            },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}
        >
          <Table stickyHeader={false} size="small" sx={{ width: '100%' }}>
          <TableBody>
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isTablet ? 3 : 5} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No activity to display
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              (() => {
                const rows: React.ReactNode[] = [];
                let lastBucket: string | null = null;

                paginatedItems.forEach((item) => {
                  const bucket = getTimeBucket(item.timestamp);
                  if (bucket !== lastBucket) {
                    rows.push(
                      <TableRow key={`bucket-${bucket}-${item.id}`} hover={false}>
                        <TableCell
                          colSpan={isTablet ? 3 : 5}
                          sx={{
                            bgcolor: '#F9FAFB',
                            borderTop: '1px solid #EAEEF4',
                            borderBottom: '1px solid #EAEEF4',
                            py: 0.75,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280' }}
                          >
                            {bucket}
                          </Typography>
                        </TableCell>
                      </TableRow>,
                    );
                    lastBucket = bucket;
                  }

                  const sourceMeta = SOURCE_META[item.sourceType];
                  const unread = !isRead(item);
                  const pinned = isPinned(item.id);
                  const fromLabel = item.fromLabel || 'Unknown';
                  const hasKnownFrom = !!item.fromLabel && item.fromLabel !== 'Unknown';
                  rows.push(
                    <TableRow
                      key={item.id}
                      hover
                      onClick={() => handleRowClick(item)}
                      onMouseEnter={() => {
                        // Hover-prefetch emails so opening the drawer feels instant (stale-while-revalidate cache)
                        if (!tenantId) return;
                        if (item.sourceType !== 'email') return;
                        void fetchEmailThreadCached({ tenantId, threadId: item.sourceId, limit: 50 });
                      }}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick(item);
                        }
                      }}
                      aria-label={`${sourceMeta.label} from ${fromLabel}: ${item.title}`}
                      sx={{
                        cursor: 'pointer',
                        '&:nth-of-type(odd)': {
                          bgcolor: 'action.hover',
                        },
                        minHeight: 56,
                        '& .feedRowActions': {
                          opacity: 0,
                          pointerEvents: 'none',
                          transition: 'opacity 150ms ease',
                        },
                        '&:hover .feedRowActions, &:focus-within .feedRowActions': {
                          opacity: 1,
                          pointerEvents: 'auto',
                        },
                      }}
                    >
                      {/* Source Column */}
                      <TableCell sx={{ width: 64, minWidth: 64, maxWidth: 64, textAlign: 'center' }}>
                        <Tooltip title={sourceMeta.label}>
                          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                            {renderSourceIcon(item)}
                          </Box>
                        </Tooltip>
                      </TableCell>

                      {/* Activity Column (Title + Snippet) */}
                      <TableCell sx={{ minWidth: 0 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: unread ? 600 : 500,
                              fontSize: '14px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.4,
                            }}
                          >
                            {item.title}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              fontWeight: 400,
                              fontSize: '13px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.35,
                              mt: 0.25,
                            }}
                          >
                            {item.snippet || '(no preview)'}
                          </Typography>

                          {isTablet && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                mt: 0.25,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              From: {fromLabel} · {formatTime(item.timestamp)}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>

                      {/* From Column (desktop only) */}
                      {!isTablet && (
                        <TableCell sx={{ maxWidth: 220 }}>
                          <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                            {hasKnownFrom ? (
                              <Avatar
                                src={item.avatarUrl}
                                sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: '0.7rem' }}
                              >
                                {getInitials(fromLabel)}
                              </Avatar>
                            ) : (
                              <Avatar
                                sx={{
                                  width: TABLE_AVATAR_SIZE,
                                  height: TABLE_AVATAR_SIZE,
                                  bgcolor: 'rgba(0,0,0,0.06)',
                                  color: 'rgba(0,0,0,0.35)',
                                }}
                              >
                                <PersonIcon sx={{ fontSize: 18 }} />
                              </Avatar>
                            )}
                            <Typography
                              variant="body2"
                              color={hasKnownFrom ? 'text.primary' : 'text.secondary'}
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fromLabel}
                            </Typography>
                          </Box>
                        </TableCell>
                      )}

                      {/* Status Column (desktop only) */}
                      {!isTablet && (
                        <TableCell sx={{ width: 140, whiteSpace: 'nowrap' }}>
                          <Box display="flex" alignItems="center" gap={0.75}>
                            {unread && (
                              <Chip
                                label="Unread"
                                size="small"
                                sx={{
                                  height: 22,
                                  fontSize: '0.7rem',
                                  bgcolor: 'rgba(0, 87, 184, 0.12)',
                                  color: '#0057B8',
                                  fontWeight: 700,
                                }}
                              />
                            )}
                            {pinned && (
                              <Chip
                                label="Pinned"
                                size="small"
                                variant="outlined"
                                sx={{
                                  height: 22,
                                  fontSize: '0.7rem',
                                  borderColor: 'rgba(0,0,0,0.15)',
                                  color: 'rgba(0,0,0,0.65)',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {!unread && !pinned && (
                              <Typography variant="body2" color="text.disabled">
                                —
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                      )}

                      {/* Time Column */}
                      <TableCell align="right">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                          <Box className="feedRowActions" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <Tooltip title="Open">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRowClick(item);
                                }}
                                sx={{ width: 28, height: 28 }}
                              >
                                <OpenInNewIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={pinned ? 'Unpin' : 'Pin'}>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePinned(item.id);
                                }}
                                sx={{ width: 28, height: 28 }}
                              >
                                {pinned ? (
                                  <PushPinIcon sx={{ fontSize: 16, color: '#0057B8' }} />
                                ) : (
                                  <PushPinOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                )}
                              </IconButton>
                            </Tooltip>
                          </Box>

                          <Typography variant="body2" color="text.secondary">
                            {formatTime(item.timestamp)}
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>,
                  );
                });

                return rows;
              })()
            )}
          </TableBody>
        </Table>
        </TableContainer>

        {/* Pagination */}
        <StandardTablePagination
          count={filteredItems.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          sx={{ borderTop: 1, borderColor: 'divider' }}
        />
      </Paper>
    </Box>
  );
};

export default DashboardFeed;

