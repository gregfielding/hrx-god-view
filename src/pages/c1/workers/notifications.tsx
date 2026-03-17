/**
 * Worker Inbox / Notification Center — /c1/workers/notifications
 * Persistent list of all push notifications. Every push creates an inbox message.
 * Filters: All, Unread, Assignments, Applications, Opportunities, Profile, System. Click → deepLink.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  List,
  ListItemButton,
  Chip,
  Button,
  CircularProgress,
  IconButton,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import CampaignIcon from '@mui/icons-material/Campaign';
import NotificationsIcon from '@mui/icons-material/Notifications';
import InfoIcon from '@mui/icons-material/Info';
import PersonIcon from '@mui/icons-material/Person';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerNotifications, getNotificationUrlAsync } from '../../../hooks/useWorkerNotifications';
import { markNotificationReadCallable } from '../../../api/workerNotificationsApi';
import type { NotificationType, NotificationCategory } from '../../../types/unifiedWorkerNotifications';

const typeLabels: Record<NotificationType, string> = {
  assignment: 'Assignments',
  application: 'Applications',
  document: 'Documents',
  shift: 'Shift',
  payroll: 'Payroll',
  general: 'General',
  system: 'System',
  opportunity: 'Opportunities',
  profile_action: 'Profile',
  support: 'System',
};

const typeIcons: Record<NotificationType, React.ReactNode> = {
  assignment: <AssignmentIcon fontSize="small" />,
  application: <WorkIcon fontSize="small" />,
  document: <InfoIcon fontSize="small" />,
  shift: <AssignmentIcon fontSize="small" />,
  payroll: <WorkIcon fontSize="small" />,
  general: <NotificationsIcon fontSize="small" />,
  system: <NotificationsIcon fontSize="small" />,
  opportunity: <CampaignIcon fontSize="small" />,
  profile_action: <PersonIcon fontSize="small" />,
  support: <NotificationsIcon fontSize="small" />,
};

const categoryLabels: Record<NotificationCategory, string> = {
  assignments: 'Assignments',
  applications: 'Applications',
  opportunities: 'Opportunities',
  profile: 'Profile',
  system: 'System',
};

function formatTime(ts: { toDate?: () => Date } | null): string {
  if (!ts) return '';
  const d = typeof (ts as any).toDate === 'function' ? (ts as any).toDate() : new Date((ts as any).seconds * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

const C1WorkerNotifications: React.FC = () => {
  const { user } = useAuth();
  const uid = user?.uid ?? undefined;
  const navigate = useNavigate();
  const { notifications, unreadCount, loading } = useWorkerNotifications(uid);
  const [filter, setFilter] = useState<'all' | 'unread' | NotificationCategory>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.readAt;
    if (filter === 'all') return true;
    const cat = n.category ?? (n.type === 'opportunity' ? 'opportunities' : n.type === 'assignment' || n.type === 'shift' ? 'assignments' : n.type === 'application' ? 'applications' : n.type === 'profile_action' ? 'profile' : 'system');
    return cat === filter;
  });

  const handleMarkRead = async (id: string) => {
    if (!uid) return;
    setMarkingId(id);
    try {
      await markNotificationReadCallable(uid, id);
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (!uid) return;
    for (const n of notifications.filter((n) => !n.readAt)) {
      await markNotificationReadCallable(uid, n.id);
    }
  };

  const handleClick = async (n: (typeof notifications)[0]) => {
    if (!n.readAt) await handleMarkRead(n.id);
    const url = n.deepLink ? n.deepLink : await getNotificationUrlAsync(n, uid);
    if (url.startsWith('/')) navigate(url);
    else if (url) window.location.href = url;
  };

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Notifications
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label="All"
          onClick={() => setFilter('all')}
          color={filter === 'all' ? 'primary' : 'default'}
          variant={filter === 'all' ? 'filled' : 'outlined'}
          size="small"
        />
        <Chip
          label={`Unread ${unreadCount > 0 ? `(${unreadCount})` : ''}`}
          onClick={() => setFilter('unread')}
          color={filter === 'unread' ? 'primary' : 'default'}
          variant={filter === 'unread' ? 'filled' : 'outlined'}
          size="small"
        />
        {(['assignments', 'applications', 'opportunities', 'profile', 'system'] as const).map((cat) => (
          <Chip
            key={cat}
            label={categoryLabels[cat]}
            onClick={() => setFilter(cat)}
            color={filter === cat ? 'primary' : 'default'}
            variant={filter === cat ? 'filled' : 'outlined'}
            size="small"
          />
        ))}
        {unreadCount > 0 && (
          <Button size="small" onClick={handleMarkAllRead} sx={{ ml: 1 }}>
            Mark all read
          </Button>
        )}
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Box>
          <Typography variant="body2" color="text.secondary" display="block">
            No notifications yet.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            We&apos;ll notify you about applications, documents, and shifts here.
          </Typography>
        </Box>
      ) : (
        <List disablePadding>
          {filtered.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => handleClick(n)}
              sx={{ alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider', gap: 1 }}
            >
              <Box sx={{ color: 'text.secondary', mt: 0.25 }}>{typeIcons[n.type] ?? typeIcons.system}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                  {!n.readAt && (
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
                  )}
                  <Typography variant="subtitle2" sx={{ fontWeight: n.readAt ? 400 : 600 }}>
                    {n.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(n.createdAt)}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                  {n.body}
                </Typography>
              </Box>
              {!n.readAt && (
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
                  disabled={markingId === n.id}
                  aria-label="Mark read"
                >
                  <NotificationsActiveIcon fontSize="small" />
                </IconButton>
              )}
            </ListItemButton>
          ))}
        </List>
      )}
    </>
  );
};

export default C1WorkerNotifications;
