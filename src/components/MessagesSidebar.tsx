/**
 * Messages Sidebar Component
 * 
 * Displays list of Direct Messages and Channels
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
  IconButton,
  Tooltip,
  Divider,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import AddIcon from '@mui/icons-material/Add';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';

interface DirectMessage {
  id: string;
  participants: string[];
  participantNames: string[];
  participantAvatars?: string[];
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageFrom?: string;
  unreadCounts: { [userId: string]: number };
  isGroup: boolean;
  groupName?: string;
}

interface InternalChannel {
  id: string;
  name: string;
  description?: string;
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageFrom?: string;
  unreadCounts: { [userId: string]: number };
  mutedBy: string[];
}

interface MessagesSidebarProps {
  activeTab: 'dms' | 'channels';
  dms: DirectMessage[];
  channels: InternalChannel[];
  selectedConversation: { type: 'dm' | 'channel'; id: string } | null;
  onConversationSelect: (type: 'dm' | 'channel', id: string) => void;
  onCreateChannel: () => void;
}

const MessagesSidebar: React.FC<MessagesSidebarProps> = ({
  activeTab,
  dms,
  channels,
  selectedConversation,
  onConversationSelect,
  onCreateChannel,
}) => {
  const { user } = useAuth();

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const getUnreadCount = (item: DirectMessage | InternalChannel): number => {
    if (!user?.uid) return 0;
    return item.unreadCounts[user.uid] || 0;
  };

  const getDMDisplayName = (dm: DirectMessage): string => {
    if (dm.isGroup && dm.groupName) {
      return dm.groupName;
    }
    // Find the other participant's name
    const otherParticipantIndex = dm.participants.findIndex(p => p !== user?.uid);
    if (otherParticipantIndex >= 0 && dm.participantNames[otherParticipantIndex]) {
      return dm.participantNames[otherParticipantIndex];
    }
    return 'Unknown User';
  };

  const getDMAvatar = (dm: DirectMessage): string | undefined => {
    if (dm.isGroup && (dm as any).groupAvatar) {
      return (dm as any).groupAvatar;
    }
    const otherParticipantIndex = dm.participants.findIndex(p => p !== user?.uid);
    if (otherParticipantIndex >= 0 && dm.participantAvatars?.[otherParticipantIndex]) {
      return dm.participantAvatars[otherParticipantIndex];
    }
    return undefined;
  };

  const getDMInitials = (dm: DirectMessage): string => {
    const name = getDMDisplayName(dm);
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      {activeTab === 'dms' ? (
        <List sx={{ p: 0 }}>
          {dms.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No direct messages yet
              </Typography>
            </Box>
          ) : (
            dms.map((dm) => {
              const unreadCount = getUnreadCount(dm);
              const isSelected = selectedConversation?.type === 'dm' && selectedConversation?.id === dm.id;

              return (
                <ListItem key={dm.id} disablePadding>
                  <ListItemButton
                    selected={isSelected}
                    onClick={() => onConversationSelect('dm', dm.id)}
                    sx={{
                      px: 2,
                      py: 1.5,
                      '&.Mui-selected': {
                        bgcolor: 'action.selected',
                        borderLeft: '3px solid',
                        borderColor: 'primary.main',
                      },
                    }}
                  >
                    <ListItemAvatar>
                      <Badge
                        badgeContent={unreadCount > 0 ? unreadCount : undefined}
                        color="primary"
                        max={99}
                      >
                        <Avatar
                          src={getDMAvatar(dm)}
                          sx={{ width: 40, height: 40 }}
                        >
                          {!getDMAvatar(dm) && getDMInitials(dm)}
                        </Avatar>
                      </Badge>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: unreadCount > 0 ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getDMDisplayName(dm)}
                        </Typography>
                      }
                      secondary={
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {dm.lastMessage || 'No messages yet'}
                        </Typography>
                      }
                    />
                    {dm.lastMessageAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {formatTime(dm.lastMessageAt)}
                      </Typography>
                    )}
                  </ListItemButton>
                </ListItem>
              );
            })
          )}
        </List>
      ) : (
        <List sx={{ p: 0 }}>
          <Box sx={{ px: 2, py: 1 }}>
            <Tooltip title="Create new channel">
              <IconButton
                size="small"
                onClick={onCreateChannel}
                sx={{
                  width: '100%',
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 1,
                  py: 1,
                }}
              >
                <AddIcon fontSize="small" />
                <Typography variant="body2" sx={{ ml: 1 }}>
                  New Channel
                </Typography>
              </IconButton>
            </Tooltip>
          </Box>
          <Divider />
          {channels.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No channels yet
              </Typography>
            </Box>
          ) : (
            channels.map((channel) => {
              const unreadCount = getUnreadCount(channel);
              const isSelected = selectedConversation?.type === 'channel' && selectedConversation?.id === channel.id;
              const isMuted = channel.mutedBy?.includes(user?.uid || '');

              return (
                <ListItem key={channel.id} disablePadding>
                  <ListItemButton
                    selected={isSelected}
                    onClick={() => onConversationSelect('channel', channel.id)}
                    sx={{
                      px: 2,
                      py: 1.5,
                      opacity: isMuted ? 0.6 : 1,
                      '&.Mui-selected': {
                        bgcolor: 'action.selected',
                        borderLeft: '3px solid',
                        borderColor: 'primary.main',
                      },
                    }}
                  >
                    <ListItemAvatar>
                      <Avatar
                        sx={{
                          width: 40,
                          height: 40,
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                        }}
                      >
                        #
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: unreadCount > 0 ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {channel.name}
                        </Typography>
                      }
                      secondary={
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {channel.lastMessage || 'No messages yet'}
                        </Typography>
                      }
                    />
                    {unreadCount > 0 && (
                      <Badge badgeContent={unreadCount} color="primary" max={99} sx={{ ml: 1 }} />
                    )}
                  </ListItemButton>
                </ListItem>
              );
            })
          )}
        </List>
      )}
    </Box>
  );
};

export default MessagesSidebar;

