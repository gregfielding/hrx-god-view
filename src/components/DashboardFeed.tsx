/**
 * Dashboard Feed Component
 * 
 * Unified activity stream table displaying items from Email, Slack DMs, and Slack Channels.
 * Follows the Inbox Standard UI patterns.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  TableRow,
  Typography,
  Avatar,
  Tooltip,
  CircularProgress,
  Alert,
  useMediaQuery,
  Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import EmailIcon from '@mui/icons-material/Email';
import MessageIcon from '@mui/icons-material/Message';
import TagIcon from '@mui/icons-material/Tag';
import EventIcon from '@mui/icons-material/Event';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import AssignmentIcon from '@mui/icons-material/Assignment';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import PersonIcon from '@mui/icons-material/Person';
import VideocamIcon from '@mui/icons-material/Videocam';
import CrownIcon from '@mui/icons-material/Star';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import BusinessIcon from '@mui/icons-material/Business';
import { useDashboardFeed } from '../hooks/useDashboardFeed';
import { DashboardFeedItem } from '../types/dashboardFeed';
import { openDrawerFromFeedItem, DrawerOpenCallbacks } from '../utils/dashboardFeedDrawer';
import { useAuth } from '../contexts/AuthContext';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import InboxSearchBar from './InboxSearchBar';
import { fetchEmailThreadCached } from '../utils/emailThreadCache';
import { DASHBOARD_WIDGET } from '../utils/dashboardWidgetTokens';
import { RenderedTextWithMentions } from './common/RenderedTextWithMentions';
import type { Mention } from '../types/crossSystemMentions';
import { DashboardFeedComposer } from './DashboardFeedComposer';

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
  calendar: {
    icon: <EventIcon fontSize="small" />,
    label: 'Calendar',
    color: '#1976d2',
  },
  mention: {
    icon: <AlternateEmailIcon fontSize="small" />,
    label: 'Mention',
    color: '#9c27b0',
  },
  notification: {
    icon: <NotificationsActiveIcon fontSize="small" />,
    label: 'Notification',
    color: '#0f766e',
  },
  task: {
    icon: <AssignmentIcon fontSize="small" />,
    label: 'Task',
    color: '#f59e0b',
  },
};

interface DashboardFeedProps {
  onOpenEmailDrawer: (options: { threadId: string; tenantId: string }) => void;
  onOpenSlackDMDrawer: (options: { threadId: string; tenantId: string }) => void;
  onOpenSlackChannelDrawer: (options: { channelId: string }) => void;
  onOpenMentionsDrawer?: () => void;
}

const DashboardFeed: React.FC<DashboardFeedProps> = ({
  onOpenEmailDrawer,
  onOpenSlackDMDrawer,
  onOpenSlackChannelDrawer,
  onOpenMentionsDrawer,
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeTenant, user } = useAuth();
  // Fetch a generous cap; UI reveals items progressively via infinite scroll.
  const { feedItems, loading, error } = useDashboardFeed({ limit: 500 });
  const isMobile = useMediaQuery('(max-width:767px)');
  const isTablet = useMediaQuery('(min-width:768px) and (max-width:1199px)');
  
  const LOAD_STEP = 40;
  const [visibleCount, setVisibleCount] = useState(60);
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const desktopSentinelRef = useRef<HTMLDivElement | null>(null);
  const mobileSentinelRef = useRef<HTMLDivElement | null>(null);

  const tenantId = activeTenant?.id || '';
  const userId = user?.uid || '';

  type QuickFilter = 'all' | 'unread' | 'pinned';
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<Array<DashboardFeedItem['sourceType']>>([]);
  const [search, setSearch] = useState('');

  // Read source filter from URL query parameter
  useEffect(() => {
    const sourceParam = searchParams.get('source');
    if (sourceParam === 'mention') {
      setSourceFilter(['mention']);
    } else if (sourceParam) {
      // Support other source types if needed
      const validSource = ['email', 'slack_dm', 'slack_channel', 'calendar', 'mention', 'notification', 'task'].includes(sourceParam);
      if (validSource) {
        setSourceFilter([sourceParam as DashboardFeedItem['sourceType']]);
      }
    } else {
      setSourceFilter([]);
    }
  }, [searchParams]);

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
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );

  // Reset reveal count when filters/search change
  useEffect(() => {
    setVisibleCount(60);
    try {
      desktopScrollRef.current?.scrollTo({ top: 0 });
    } catch {}
  }, [quickFilter, sourceFilter, search]);

  // Desktop infinite scroll sentinel (TableContainer is the scroll root)
  useEffect(() => {
    const root = desktopScrollRef.current;
    const target = desktopSentinelRef.current;
    if (!root || !target) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e?.isIntersecting) return;
        setVisibleCount((prev) =>
          prev >= filteredItems.length ? prev : Math.min(filteredItems.length, prev + LOAD_STEP),
        );
      },
      { root, rootMargin: '200px 0px 200px 0px', threshold: 0 },
    );

    obs.observe(target);
    return () => obs.disconnect();
  }, [filteredItems.length]);

  // Mobile infinite scroll sentinel (scrolling inside the Paper content Box)
  useEffect(() => {
    const target = mobileSentinelRef.current;
    if (!target) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e?.isIntersecting) return;
        setVisibleCount((prev) =>
          prev >= filteredItems.length ? prev : Math.min(filteredItems.length, prev + LOAD_STEP),
        );
      },
      { root: null, rootMargin: '200px 0px 200px 0px', threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [filteredItems.length]);

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
    
    // Calendar items navigate to /calendar page
    if (item.sourceType === 'calendar' && item.drawerScope.scopeType === 'calendar') {
      const { eventId, dateKey } = item.drawerScope;
      if (eventId && dateKey) {
        navigate(`/calendar?date=${dateKey}&eventId=${eventId}`);
      } else if (dateKey) {
        navigate(`/calendar?date=${dateKey}`);
      } else {
        navigate('/calendar');
      }
      return;
    }

    // Task items navigate to /tasks page
    if (item.sourceType === 'task' && item.drawerScope.scopeType === 'task') {
      navigate('/tasks');
      return;
    }

    // Internal notifications navigate to their route (if provided)
    if (item.sourceType === 'notification' && item.drawerScope.scopeType === 'notification') {
      const route = item.drawerScope.route;
      if (typeof route === 'string' && route.trim().length > 0) {
        navigate(route);
      } else {
        console.warn('Notification feed item missing route', item);
      }
      return;
    }
    
    // Other items open drawers
    const callbacks: DrawerOpenCallbacks = {
      openEmailDrawer: onOpenEmailDrawer,
      openSlackDMDrawer: onOpenSlackDMDrawer,
      openSlackChannelDrawer: onOpenSlackChannelDrawer,
      openMentionsDrawer: onOpenMentionsDrawer,
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
            maxHeight: 'calc(150vh - 120px)',
            paddingBottom: '16px',
          }}
        >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, overflowY: 'auto', pb: 2 }}>
          {/* Composer between filters and feed items for mobile */}
          <Box>
            <DashboardFeedComposer />
          </Box>
          {visibleItems.length === 0 ? (
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
            visibleItems.map((item) => {
              const sourceMeta = SOURCE_META[item.sourceType];
              const unread = !isRead(item);
              const pinned = isPinned(item.id);
              const fromLabel = item.fromLabel || 'Unknown';

              return (
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
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
                          {item.sourceType === 'calendar' && item.eventOwnership && (
                            <Tooltip
                              title={
                                item.eventOwnership === 'owned'
                                  ? 'You own this event'
                                  : item.eventOwnership === 'invited'
                                  ? 'You are invited'
                                  : 'External organization'
                              }
                            >
                              {item.eventOwnership === 'owned' ? (
                                <CrownIcon
                                  fontSize="small"
                                  sx={{ ml: 0.5, color: 'warning.main', fontSize: '16px', flexShrink: 0 }}
                                />
                              ) : item.eventOwnership === 'invited' ? (
                                <PersonAddIcon
                                  fontSize="small"
                                  sx={{ ml: 0.5, color: 'primary.main', fontSize: '16px', flexShrink: 0 }}
                                />
                              ) : (
                                <BusinessIcon
                                  fontSize="small"
                                  sx={{ ml: 0.5, color: 'text.secondary', fontSize: '16px', flexShrink: 0 }}
                                />
                              )}
                            </Tooltip>
                          )}
                          {item.sourceType === 'calendar' && item.rsvpStatus && (
                            <Tooltip
                              title={
                                item.rsvpStatus === 'accepted'
                                  ? 'Accepted'
                                  : item.rsvpStatus === 'tentative'
                                  ? 'Maybe'
                                  : item.rsvpStatus === 'declined'
                                  ? 'Declined'
                                  : 'No response'
                              }
                            >
                              <Box
                                component="span"
                                sx={{
                                  ml: 0.5,
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  display: 'inline-block',
                                  bgcolor:
                                    item.rsvpStatus === 'accepted'
                                      ? 'success.main'
                                      : item.rsvpStatus === 'tentative'
                                      ? 'warning.main'
                                      : item.rsvpStatus === 'declined'
                                      ? 'error.main'
                                      : 'text.disabled',
                                  border: item.rsvpStatus === 'needsAction' ? '1px solid' : 'none',
                                  borderColor: 'text.disabled',
                                  flexShrink: 0,
                                }}
                              />
                            </Tooltip>
                          )}
                          {item.sourceType === 'calendar' && item.hangoutLink && (
                            <Tooltip title="Google Meet">
                              <VideocamIcon fontSize="small" sx={{ color: 'text.secondary', fontSize: '16px', flexShrink: 0 }} />
                            </Tooltip>
                          )}
                          {item.sourceType === 'calendar' && item.eventStatus && item.eventStatus !== 'confirmed' && (
                            <Chip
                              size="small"
                              label={item.eventStatus === 'tentative' ? 'Tentative' : item.eventStatus === 'cancelled' ? 'Cancelled' : item.eventStatus}
                              color={item.eventStatus === 'cancelled' ? 'error' : 'warning'}
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0, ml: 0.5 }}
                            />
                          )}
                        </Box>

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
                      </Box>
                    </Box>
                  </Box>
                </Paper>
              );
            })
          )}
          <Box ref={mobileSentinelRef} sx={{ height: 1 }} />
        </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper
        elevation={0}
        sx={{
          borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
          border: '1px solid #EAEEF4',
          overflow: 'hidden',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(150vh - 120px)',
          paddingBottom: '16px',
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
                    setVisibleCount(60);
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
                setVisibleCount(60);
              }}
              renderValue={(selected) => {
                if (selected.length === 0) return 'All Sources';
                const labelByValue: Partial<Record<DashboardFeedItem['sourceType'], string>> = {
                  email: 'Email',
                  slack_dm: 'DMs',
                  slack_channel: 'Slack Channels',
                  calendar: 'Calendar',
                  mention: 'Mentions',
                  notification: 'Automations',
                  task: 'Tasks',
                };
                return selected.map((v) => labelByValue[v] || v).join(', ');
              }}
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
                { value: 'calendar', label: 'Calendar' },
                { value: 'mention', label: 'Mentions' },
                { value: 'notification', label: 'Automations' },
                { value: 'task', label: 'Tasks' },
              ] as Array<{ value: DashboardFeedItem['sourceType']; label: string }>).map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Checkbox checked={sourceFilter.indexOf(opt.value) > -1} />
                  <ListItemText primary={opt.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box
            sx={{
              ml: 'auto',
              minWidth: 280,
              flex: { xs: '1 1 100%', sm: '0 0 360px' },
            }}
          >
            <InboxSearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setVisibleCount(60);
              }}
              onSearch={(v) => {
                setSearch(v);
                setVisibleCount(60);
              }}
              placeholder="Search feed..."
            />
          </Box>
        </Box>

        {/* Composer between filters and feed items for desktop */}
        <Box>
          <DashboardFeedComposer />
        </Box>

        <TableContainer
          ref={desktopScrollRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'auto',
            width: '100%',
            // 16px left gutter so the source icons aren't flush to the card edge
            pl: 2,
            boxSizing: 'border-box',
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
          <Table
            stickyHeader={false}
            size="small"
            sx={{ width: '100%', tableLayout: 'fixed' }}
          >
          <TableBody>
            {visibleItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isTablet ? 3 : 4} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No activity to display
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              (() => {
                const rows: React.ReactNode[] = [];

                visibleItems.forEach((item) => {
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
                        fetchEmailThreadCached({ tenantId, threadId: item.sourceId, limit: 50 }).catch(() => {
                          // Silently ignore errors from hover prefetch (non-critical)
                        });
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
                      }}
                    >
                      {/* Source Column */}
                      <TableCell sx={{ width: 64, minWidth: 64, maxWidth: 64, textAlign: 'center', pl: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Tooltip title={sourceMeta.label}>
                            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                              {renderSourceIcon(item)}
                            </Box>
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
                      </TableCell>

                      {/* Time Column (2nd column) */}
                      <TableCell sx={{ width: 96, whiteSpace: 'nowrap' }}>
                        <Typography variant="body2" color="text.secondary">
                          {formatTime(item.timestamp)}
                        </Typography>
                      </TableCell>

                      {/* Activity Column (Title + Snippet) */}
                      <TableCell sx={{ width: 600, maxWidth: 600 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: unread ? 600 : 500,
                                fontSize: '14px',
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 1,
                                WebkitBoxOrient: 'vertical',
                                overflowWrap: 'anywhere',
                                lineHeight: 1.4,
                              }}
                            >
                              {item.title}
                            </Typography>
                            {item.sourceType === 'calendar' && item.eventOwnership && (
                              <Tooltip
                                title={
                                  item.eventOwnership === 'owned'
                                    ? 'You own this event'
                                    : item.eventOwnership === 'invited'
                                    ? 'You are invited'
                                    : 'External organization'
                                }
                              >
                                {item.eventOwnership === 'owned' ? (
                                  <CrownIcon
                                    fontSize="small"
                                    sx={{ color: 'warning.main', fontSize: '14px' }}
                                  />
                                ) : item.eventOwnership === 'invited' ? (
                                  <PersonAddIcon
                                    fontSize="small"
                                    sx={{ color: 'primary.main', fontSize: '14px' }}
                                  />
                                ) : (
                                  <BusinessIcon
                                    fontSize="small"
                                    sx={{ color: 'text.secondary', fontSize: '14px' }}
                                  />
                                )}
                              </Tooltip>
                            )}
                            {item.sourceType === 'calendar' && item.rsvpStatus && (
                              <Tooltip
                                title={
                                  item.rsvpStatus === 'accepted'
                                    ? 'Accepted'
                                    : item.rsvpStatus === 'tentative'
                                    ? 'Maybe'
                                    : item.rsvpStatus === 'declined'
                                    ? 'Declined'
                                    : 'No response'
                                }
                              >
                                <Box
                                  component="span"
                                  sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    display: 'inline-block',
                                    bgcolor:
                                      item.rsvpStatus === 'accepted'
                                        ? 'success.main'
                                        : item.rsvpStatus === 'tentative'
                                        ? 'warning.main'
                                        : item.rsvpStatus === 'declined'
                                        ? 'error.main'
                                        : 'text.disabled',
                                    border: item.rsvpStatus === 'needsAction' ? '1px solid' : 'none',
                                    borderColor: 'text.disabled',
                                  }}
                                />
                              </Tooltip>
                            )}
                            {item.sourceType === 'calendar' && item.hangoutLink && (
                              <Tooltip title="Google Meet">
                                <VideocamIcon fontSize="small" sx={{ color: 'text.secondary', fontSize: '14px' }} />
                              </Tooltip>
                            )}
                            {item.sourceType === 'calendar' && item.eventStatus && item.eventStatus !== 'confirmed' && (
                              <Chip
                                size="small"
                                label={item.eventStatus === 'tentative' ? 'Tentative' : item.eventStatus === 'cancelled' ? 'Cancelled' : item.eventStatus}
                                color={item.eventStatus === 'cancelled' ? 'error' : 'warning'}
                                variant="outlined"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            )}
                          </Box>
                          {item.mentions && item.mentions.length > 0 ? (
                            <RenderedTextWithMentions
                              text={item.snippet || '(no preview)'}
                              mentions={item.mentions.map(m => {
                                const base: any = {
                                  type: m.type,
                                  id: m.id,
                                  label: m.label,
                                  slug: m.slug,
                                };
                                if (m.type === 'user' && m.userId) {
                                  return { ...base, userId: m.userId } as Mention;
                                } else if (m.type === 'contact' && m.contactId) {
                                  return { ...base, contactId: m.contactId } as Mention;
                                } else if (m.type === 'company' && m.companyId) {
                                  return { ...base, companyId: m.companyId } as Mention;
                                } else if (m.type === 'deal' && m.dealId) {
                                  return { ...base, dealId: m.dealId } as Mention;
                                }
                                return base as Mention;
                              })}
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                fontWeight: 400,
                                fontSize: '13px',
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflowWrap: 'anywhere',
                                lineHeight: 1.35,
                                mt: 0.25,
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                fontWeight: 400,
                                fontSize: '13px',
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflowWrap: 'anywhere',
                                lineHeight: 1.35,
                                mt: 0.25,
                              }}
                            >
                              {item.snippet || '(no preview)'}
                            </Typography>
                          )}

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
                              From: {fromLabel}
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

                    </TableRow>,
                  );
                });

                return rows;
              })()
            )}
            <TableRow>
              <TableCell colSpan={isTablet ? 3 : 4} sx={{ p: 0 }}>
                <Box ref={desktopSentinelRef} sx={{ height: 1 }} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default DashboardFeed;

