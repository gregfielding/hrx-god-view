/**
 * Worker Notifications — /c1/workers/notifications
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md §7.1
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  List,
  ListItemButton,
  ListItemText,
  Chip,
  Button,
  CircularProgress,
  IconButton,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerNotifications } from '../../../hooks/useWorkerNotifications';
import { markNotificationReadCallable } from '../../../api/workerNotificationsApi';
import type { NotificationType } from '../../../types/unifiedWorkerNotifications';

const typeLabels: Record<NotificationType, string> = {
  assignment: 'Assignments',
  application: 'Applications',
  document: 'Documents',
  shift: 'Shift',
  payroll: 'Payroll',
  general: 'General',
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
  const [filter, setFilter] = useState<'all' | 'unread' | NotificationType>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.readAt;
    if (filter === 'all') return true;
    return n.type === filter;
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

  const handleClick = (n: (typeof notifications)[0]) => {
    if (!n.readAt) handleMarkRead(n.id);
    if (n.threadId) navigate(`/c1/workers/inbox/${n.threadId}`);
    else if (n.ctaUrl) window.location.href = n.ctaUrl;
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
        {(['assignment', 'document', 'application', 'general'] as const).map((t) => (
          <Chip
            key={t}
            label={typeLabels[t]}
            onClick={() => setFilter(t)}
            color={filter === t ? 'primary' : 'default'}
            variant={filter === t ? 'filled' : 'outlined'}
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
        <Typography variant="body2" color="text.secondary">
          No notifications.
        </Typography>
      ) : (
        <List disablePadding>
          {filtered.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => handleClick(n)}
              sx={{ alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
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
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                  {n.body}
                </Typography>
                {(n.ctaUrl || n.threadId) && (
                  <Button size="small" sx={{ mt: 1 }}>
                    {n.ctaLabel || (n.threadId ? 'View conversation' : 'Open')}
                  </Button>
                )}
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
