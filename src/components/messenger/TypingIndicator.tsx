/**
 * Typing Indicator Component
 * 
 * Shows an animated "typing..." indicator when the other user is typing.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';

interface TypingIndicatorProps {
  userName?: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ userName }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1.5,
        mb: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          alignItems: 'center',
          '@keyframes typing': {
            '0%, 60%, 100%': {
              transform: 'translateY(0)',
              opacity: 0.7,
            },
            '30%': {
              transform: 'translateY(-10px)',
              opacity: 1,
            },
          },
        }}
      >
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: 'text.secondary',
              animation: 'typing 1.4s infinite',
              animationDelay: `${index * 0.2}s`,
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
        {userName ? `${userName} is typing...` : 'Typing...'}
      </Typography>
    </Box>
  );
};

export default TypingIndicator;

