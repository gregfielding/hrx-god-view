/**
 * Channel Badge Component
 * 
 * Displays a visual badge indicating the message channel (Email, SMS, Slack, Internal)
 */

import React from 'react';
import { Chip } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import CircleIcon from '@mui/icons-material/Circle';
import ChatIcon from '@mui/icons-material/Chat';
import { MessageSource } from '../types/unifiedInbox';

interface ChannelBadgeProps {
  source: MessageSource;
  size?: 'small' | 'medium';
}

export const ChannelBadge: React.FC<ChannelBadgeProps> = ({ source, size = 'small' }) => {
  const getIcon = () => {
    switch (source) {
      case 'email':
        return <EmailIcon fontSize={size === 'small' ? 'small' : 'medium'} />;
      case 'sms':
        return <SmsIcon fontSize={size === 'small' ? 'small' : 'medium'} />;
      case 'slack':
        return <CircleIcon fontSize={size === 'small' ? 'small' : 'medium'} />;
      case 'internal':
        return <ChatIcon fontSize={size === 'small' ? 'small' : 'medium'} />;
      default:
        return null;
    }
  };

  const getLabel = () => {
    switch (source) {
      case 'email':
        return 'Email';
      case 'sms':
        return 'SMS';
      case 'slack':
        return 'Slack';
      case 'internal':
        return 'Internal';
      default:
        return '';
    }
  };

  const getColor = () => {
    switch (source) {
      case 'email':
        return 'primary';
      case 'sms':
        return 'success';
      case 'slack':
        return 'secondary';
      case 'internal':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <Chip
      icon={getIcon()}
      label={getLabel()}
      size={size}
      color={getColor() as any}
      variant="outlined"
      sx={{
        height: size === 'small' ? 24 : 28,
        fontSize: size === 'small' ? '0.7rem' : '0.75rem',
        fontWeight: 500,
        '& .MuiChip-icon': {
          fontSize: size === 'small' ? '14px' : '16px',
        },
      }}
    />
  );
};



