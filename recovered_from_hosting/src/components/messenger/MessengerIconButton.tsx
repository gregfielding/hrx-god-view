/**
 * Messenger Icon Button Component
 * 
 * Displays the messenger icon in the top bar with unread badge.
 * Opens the messenger drawer on click.
 */

import React from 'react';
import { IconButton, Badge, Tooltip } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useDirectMessenger } from '../../contexts/DirectMessengerContext';

interface MessengerIconButtonProps {
  onClick?: () => void;
}

const MessengerIconButton: React.FC<MessengerIconButtonProps> = ({ onClick }) => {
  const { isOpen, unreadCount, openMessenger } = useDirectMessenger();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      openMessenger();
    }
  };

  // Format badge content: show number if <= 9, otherwise "9+"
  const badgeContent = unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : null;

  return (
    <Tooltip title="Direct Messages">
      <IconButton
        onClick={handleClick}
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: isOpen ? '#0057B8' : 'transparent',
          color: isOpen ? '#ffffff' : '#f5f5f5',
          '&:hover': {
            backgroundColor: isOpen ? '#004a9f' : 'rgba(255, 255, 255, 0.06)',
            color: '#ffffff',
          },
          transition: 'all 0.2s ease',
          ...(isOpen && {
            boxShadow: '0 0 20px rgba(0, 87, 184, 0.55)',
          }),
        }}
      >
        <Badge
          badgeContent={badgeContent}
          invisible={unreadCount === 0}
          sx={{
            '& .MuiBadge-badge': {
              backgroundColor: '#0057B8',
              color: '#ffffff',
              fontSize: '0.625rem',
              fontWeight: 600,
              minWidth: '18px',
              height: '18px',
              padding: '0 4px',
              right: 4,
              top: 4,
              border: '2px solid #ffffff', // Add white border for visibility
            },
          }}
        >
          <ChatBubbleOutlineIcon
            sx={{
              fontSize: '1.25rem',
              strokeWidth: 1.5,
            }}
          />
        </Badge>
      </IconButton>
    </Tooltip>
  );
};

export default MessengerIconButton;

