/**
 * Worker Notification Center — /c1/workers/notifications
 * Persistent list of all worker notifications (event feed + deep links).
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
import {
  useWorkerNotifications,
  getNotificationUrlAsync,
  getWorkerNotificationFilterKey,
  type WorkerNotificationFilterKey,
} from '../../../hooks/useWorkerNotifications';
import { markNotificationReadCallable } from '../../../api/workerNotificationsApi';
import WorkerNotificationListItem from '../../../components/worker/WorkerNotificationListItem';
import { useT } from '../../../i18n';

const C1WorkerNotifications: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const uid = user?.uid ?? undefined;
  const navigate = useNavigate();
  const { notifications, unreadCount, loading } = useWorkerNotifications(uid);
  const [filter, setFilter] = useState<WorkerNotificationFilterKey>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const filterLabels: Record<Exclude<WorkerNotificationFilterKey, 'all' | 'unread'>, string> = {
    applications: t('notifications.filterApplications'),
    assignments: t('notifications.filterAssignments'),
    reminders: t('notifications.filterReminders'),
    documents: t('notifications.filterDocuments'),
    system: t('notifications.filterSystem'),
  };

  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.readAt;
    if (filter === 'all') return true;
    return getWorkerNotificationFilterKey(n) === filter;
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
    if (url?.startsWith('/')) navigate(url);
    else if (url) window.location.href = url;
    else navigate('/c1/workers/notifications');
  };

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {t('nav.notifications')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        <Chip
          label={t('notifications.filterAll')}
          onClick={() => setFilter('all')}
          color={filter === 'all' ? 'primary' : 'default'}
          variant={filter === 'all' ? 'filled' : 'outlined'}
          size="small"
        />
        <Chip
          label={`${t('notifications.filterUnread')} ${unreadCount > 0 ? `(${unreadCount})` : ''}`.trim()}
          onClick={() => setFilter('unread')}
          color={filter === 'unread' ? 'primary' : 'default'}
          variant={filter === 'unread' ? 'filled' : 'outlined'}
          size="small"
        />
        {(['applications', 'assignments', 'reminders', 'documents', 'system'] as const).map((cat) => (
          <Chip
            key={cat}
            label={filterLabels[cat]}
            onClick={() => setFilter(cat)}
            color={filter === cat ? 'primary' : 'default'}
            variant={filter === cat ? 'filled' : 'outlined'}
            size="small"
          />
        ))}
        {unreadCount > 0 && (
          <Button size="small" onClick={handleMarkAllRead} sx={{ ml: 1 }}>
            {t('notifications.markAllRead')}
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
            {t('notifications.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('notifications.emptySubtitle')}
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
