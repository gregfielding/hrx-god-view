import React, { useState } from 'react';
import { Box, Grid, Paper, Typography } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import AIAssistantChat from '../../components/AIAssistantChat';
import AIThreadList from '../../components/AIThreadList';

const AIDashboard: React.FC = () => {
  const { user, tenantId } = useAuth();
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  if (!user || !tenantId) return null;

  return (
    <Box sx={{ p: 0, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold' }}>AI Assistant</Typography>
      <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Grid item xs={12} md={3} lg={3} sx={{ height: '100%' }}>
          <Paper variant="outlined" sx={{ borderRadius: 0, height: '100%', overflowY: 'auto' }}>
            <AIThreadList
              tenantId={tenantId}
              userId={user.uid}
              selectedThreadId={threadId}
              onSelect={setThreadId}
              onCreate={() => setThreadId(undefined)}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} md={9} lg={9} sx={{ height: '100%' }}>
          <AIAssistantChat
            tenantId={tenantId}
            userId={user.uid}
            threadId={threadId}
            onThreadCreated={setThreadId}
            showThreadListPanel={false}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default AIDashboard;


