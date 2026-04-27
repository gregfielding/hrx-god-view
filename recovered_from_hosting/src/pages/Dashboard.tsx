import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const Dashboard: React.FC = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 200px)',
        p: 4,
      }}
    >
      <Paper
        sx={{
          p: 6,
          textAlign: 'center',
          maxWidth: 600,
          borderRadius: 2,
        }}
      >
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          Coming Soon
        </Typography>
        <Typography variant="body1" color="text.secondary">
          The dashboard is under development and will be available soon.
        </Typography>
      </Paper>
    </Box>
  );
};

export default Dashboard;
