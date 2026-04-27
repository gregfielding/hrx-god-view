/**
 * Placeholder for the Messaging Sequences admin area. Replace with the real
 * sequence list + authoring UI once the schema is finalized. The CORT CSR
 * waitlist re-engagement will be the first sequence modeled here.
 */
import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';

const MessagingSequencesPlaceholder: React.FC = () => (
  <Box sx={{ p: 3 }}>
    <Paper
      variant="outlined"
      sx={{
        p: 4,
        textAlign: 'center',
        maxWidth: 480,
        mx: 'auto',
        borderRadius: 2,
        borderStyle: 'dashed',
      }}
    >
      <AutoAwesomeMotionIcon sx={{ fontSize: 48, color: 'action.disabled', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        Messaging Sequences
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Multi-step outreach flows with a defined start, end, and purpose. Sequence authoring, trigger
        configuration, and the list of active sequences will live here. The CORT CSR waitlist
        re-engagement will be the first sequence.
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 2 }} color="text.disabled">
        Coming soon.
      </Typography>
    </Paper>
  </Box>
);

export default MessagingSequencesPlaceholder;
