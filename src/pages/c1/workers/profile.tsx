import React from 'react';
import { Typography, Box } from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';

const WorkerProfile: React.FC = () => {
  const { user } = useAuth();
  return (
    <>
      <Typography variant="h5" sx={{ mb: 2 }}>My Profile</Typography>
      <Box sx={{ maxWidth: 480 }}>
        {user && (
          <>
            <Typography variant="body2" color="text.secondary">Email</Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>{user.email ?? '—'}</Typography>
            <Typography variant="body2" color="text.secondary">Display name</Typography>
            <Typography variant="body1">{user.displayName ?? '—'}</Typography>
          </>
        )}
      </Box>
    </>
  );
};

export default WorkerProfile;
