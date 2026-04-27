/**
 * Typing Indicator Component
 * 
 * Shows when users are typing
 */

import React from 'react';
import { Box, Typography, Avatar } from '@mui/material';

interface TypingIndicatorProps {
  userName: string;
  userAvatar?: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ userName, userAvatar }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 1,
        px: 2,
      }}
    >
      {userAvatar ? (
        <Avatar src={userAvatar} sx={{ width: 24, height: 24 }} />
      ) : (
        <Avatar sx={{ width: 24, height: 24, bgcolor: 'primary.main' }}>
          {userName.substring(0, 2).toUpperCase()}
        </Avatar>
      )}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderRadius: 2,
          bgcolor: 'action.hover',
          display: 'flex',
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'text.secondary',
            animation: 'typing 1.4s infinite',
            '@keyframes typing': {
              '0%, 60%, 100%': { transform: 'translateY(0)' },
              '30%': { transform: 'translateY(-10px)' },
            },
          }}
          style={{ animationDelay: '0s' }}
        />
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'text.secondary',
            animation: 'typing 1.4s infinite',
            '@keyframes typing': {
              '0%, 60%, 100%': { transform: 'translateY(0)' },
              '30%': { transform: 'translateY(-10px)' },
            },
          }}
          style={{ animationDelay: '0.2s' }}
        />
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'text.secondary',
            animation: 'typing 1.4s infinite',
            '@keyframes typing': {
              '0%, 60%, 100%': { transform: 'translateY(0)' },
              '30%': { transform: 'translateY(-10px)' },
            },
          }}
          style={{ animationDelay: '0.4s' }}
        />
      </Box>
    </Box>
  );
};

export default TypingIndicator;




