import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

type CardProps = { title?: string; actions?: React.ReactNode; children: React.ReactNode };

export const Card: React.FC<CardProps> = ({ title, actions, children }) => {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      {(title || actions) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">{title}</Typography>
          <Box>{actions}</Box>
        </Box>
      )}
      {children}
    </Paper>
  );
};

export default Card;


