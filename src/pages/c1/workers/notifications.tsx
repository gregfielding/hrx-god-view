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
  Chip,
  Button,
  CircularProgress,
} from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerNotifications, getNotificationUrlAsync } from '../../../hooks/useWorkerNotifications';
import { markNotificationReadCallable } from '../../../api/workerNotificationsApi';
import type { NotificationCategory } from '../../../types/unifiedWorkerNotifications';
import WorkerNotificationListItem from '../../../components/worker/WorkerNotificationListItem';

const categoryLabels: Record<NotificationCategory, string> = {
  assignments: 'Assignments',
  applications: 'Applications',
  opportunities: 'Opportunities',
  profile: 'Profile',
  system: 'System',
};

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
            <WorkerNotificationListItem
              key={n.id}
              notification={n}
              onClick={handleClick}
              onMarkRead={handleMarkRead}
              isMarkingRead={markingId === n.id}
            />
          ))}
        </List>
      )}
    </>
  );
};

export default C1WorkerNotifications;
