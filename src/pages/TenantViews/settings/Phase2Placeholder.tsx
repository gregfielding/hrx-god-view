/**
 * Placeholder for Phase 2 admin areas. See docs/PHASE2_SYSTEMS_ARCHITECTURE.md.
 */
import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

export interface Phase2PlaceholderProps {
  title: string;
  description?: string;
  system?: 'Compliance' | 'Benefits' | 'Payroll' | 'AI Signals';
}

const Phase2Placeholder: React.FC<Phase2PlaceholderProps> = ({
  title,
  description,
  system,
}) => (
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
      <ConstructionIcon sx={{ fontSize: 48, color: 'action.disabled', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      {system && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Phase 2 — {system} System
        </Typography>
      )}
      {description && (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      )}
      <Typography variant="caption" display="block" sx={{ mt: 2 }} color="text.disabled">
        Coming in Phase 2. See docs/PHASE2_SYSTEMS_ARCHITECTURE.md.
      </Typography>
    </Paper>
  </Box>
);

export default Phase2Placeholder;
