import React, { useState } from 'react';
import { Box, Grid, Paper } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import AIAssistantChat from '../../components/AIAssistantChat';
import AIThreadList from '../../components/AIThreadList';

const ChatGPT: React.FC = () => {
  const { user, tenantId } = useAuth();
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  if (!user || !tenantId) return null;

  return (
    <Box sx={{ borderRadius: 1, px: 2, pt: 2, pb: 0, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Grid item xs={12} md={3} lg={3} sx={{ borderRadius: 1, height: '100%' }}>
          <Paper variant="outlined" sx={{ borderRadius: 1, height: '100%', overflowY: 'auto' }}>
            <AIThreadList
              tenantId={tenantId}
              userId={user.uid}
              selectedThreadId={threadId}
              onSelect={setThreadId}
              onCreate={() => setThreadId(undefined)}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} md={9} lg={9} sx={{ borderRadius: 1, height: '100%' }}>
          <AIAssistantChat
            tenantId={tenantId}
            userId={user.uid}
            threadId={threadId}
            onThreadCreated={setThreadId}
            showThreadListPanel={false}
            title="ChatGPT"
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default ChatGPT;

