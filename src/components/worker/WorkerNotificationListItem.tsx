import React from 'react';
import { Box, IconButton, ListItemButton, Typography } from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WorkIcon from '@mui/icons-material/Work';
import CampaignIcon from '@mui/icons-material/Campaign';
import NotificationsIcon from '@mui/icons-material/Notifications';
import InfoIcon from '@mui/icons-material/Info';
import PersonIcon from '@mui/icons-material/Person';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import type { NotificationType, WorkerNotification } from '../../types/unifiedWorkerNotifications';
import { t } from '../../i18n';

type WorkerNotificationWithId = WorkerNotification & { id: string };

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

function defaultFormatTime(ts: { toDate?: () => Date } | null): string {
  if (!ts) return '';
  const d = typeof (ts as any).toDate === 'function' ? (ts as any).toDate() : new Date((ts as any).seconds * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return t('dashboard.timeAgo.justNow');
  if (diff < 3600000) return t('dashboard.timeAgo.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

export interface WorkerNotificationListItemProps {
  notification: WorkerNotificationWithId;
  onClick: (notification: WorkerNotificationWithId) => void;
  onMarkRead: (id: string) => void;
  isMarkingRead?: boolean;
  formatTime?: (ts: { toDate?: () => Date } | null) => string;
}

const WorkerNotificationListItem: React.FC<WorkerNotificationListItemProps> = ({
  notification,
  onClick,
  onMarkRead,
  isMarkingRead = false,
  formatTime = defaultFormatTime,
}) => {
  return (
    <ListItemButton
      onClick={() => onClick(notification)}
      sx={{ alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider', gap: 1 }}
    >
      <Box sx={{ color: 'text.secondary', mt: 0.25 }}>{typeIcons[notification.type] ?? typeIcons.system}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          {!notification.readAt && (
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
          )}
          <Typography variant="subtitle2" sx={{ fontWeight: notification.readAt ? 400 : 600 }}>
            {notification.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatTime(notification.createdAt)}
          </Typography>
        </Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
        >
          {notification.body}
        </Typography>
      </Box>
      {!notification.readAt && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(notification.id);
          }}
          disabled={isMarkingRead}
          aria-label={t('notifications.markRead')}
        >
          <NotificationsActiveIcon fontSize="small" />
        </IconButton>
      )}
    </ListItemButton>
  );
};

export default WorkerNotificationListItem;
