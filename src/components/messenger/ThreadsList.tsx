/**
 * Threads List Component
 * 
 * Displays a list of DM threads (conversations) for the current user.
 */

import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Badge,
  CircularProgress,
  Alert,
} from '@mui/material';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useDMThreads } from '../../hooks/useDMThreads';
import { useAuth } from '../../contexts/AuthContext';
import { useDirectMessenger } from '../../contexts/DirectMessengerContext';
import { DMThreadView } from '../../types/directMessenger';
import { useTheme, useMediaQuery } from '@mui/material';

interface ThreadsListProps {
  searchQuery?: string;
}

const ThreadsList: React.FC<ThreadsListProps> = ({ searchQuery = '' }) => {
  const { user, activeTenant } = useAuth();
  const { activeThreadId } = useDirectMessenger();

  const tenantId = activeTenant?.id || '';
  const currentUserId = user?.uid || '';

  const { threads, loading, error } = useDMThreads({
    tenantId,
    currentUserId,
    maxThreads: 50,
  });

  // Filter threads by search query
  const filteredThreads = React.useMemo(() => {
    if (!searchQuery.trim()) return threads;

    const query = searchQuery.toLowerCase();
    return threads.filter((thread) => {
      const nameMatch = thread.otherUser.displayName.toLowerCase().includes(query);
      const emailMatch = thread.otherUser.email.toLowerCase().includes(query);
      const messageMatch = thread.lastMessageText.toLowerCase().includes(query);
      return nameMatch || emailMatch || messageMatch;
    });
  }, [threads, searchQuery]);

  const { setActiveThreadId, setMode } = useDirectMessenger();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleThreadClick = (thread: DMThreadView) => {
    setActiveThreadId(thread.id);
    if (isMobile) {
      setMode('conversation');
    }
    // Mark as read will be handled by ConversationView
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load conversations: {error.message}</Alert>
      </Box>
    );
  }

  if (filteredThreads.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {searchQuery ? 'No conversations match your search.' : 'No conversations yet.'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Start a conversation from the People tab.
        </Typography>
      </Box>
    );
  }

  return (
    <List sx={{ p: 0 }}>
      {filteredThreads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const hasUnread = thread.unreadCount > 0;

        return (
          <ListItem
            key={thread.id}
            disablePadding
            sx={{
              borderLeft: isActive ? '3px solid #0057B8' : '3px solid transparent',
              bgcolor: isActive ? 'action.selected' : 'transparent',
            }}
          >
            <ListItemButton
              onClick={() => handleThreadClick(thread)}
              sx={{
                py: 1.5,
                px: 2,
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <ListItemAvatar>
                <Badge
                  badgeContent={hasUnread ? (thread.unreadCount > 9 ? '9+' : thread.unreadCount) : 0}
                  color="primary"
                  sx={{
                    '& .MuiBadge-badge': {
                      right: 4,
                      top: 4,
                      fontSize: '0.625rem',
                      minWidth: '18px',
                      height: '18px',
                    },
                  }}
                >
                  <Avatar
                    src={thread.otherUser.avatarUrl}
                    sx={{
                      width: 48,
                      height: 48,
                      bgcolor: 'primary.main',
                    }}
                  >
                    {thread.otherUser.displayName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </Avatar>
                </Badge>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight={hasUnread ? 600 : 500}
                      sx={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {thread.otherUser.displayName}
                    </Typography>
                    {thread.isMuted && (
                      <VolumeOffIcon sx={{ fontSize: '1rem', color: 'text.secondary' }} />
                    )}
                  </Box>
                }
                secondary={
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                    <Typography
                      variant="body2"
                      color={hasUnread ? 'text.primary' : 'text.secondary'}
                      sx={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        mr: 1,
                        fontWeight: hasUnread ? 500 : 400,
                      }}
                    >
                      {thread.lastMessageText || 'No messages yet'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {thread.lastMessageTimeLabel}
                    </Typography>
                  </Box>
                }
              />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};

export default ThreadsList;

