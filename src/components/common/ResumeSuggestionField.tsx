import React from 'react';
import { Box, Stack } from '@mui/material';
import ResumeSuggestionBadge from './ResumeSuggestionBadge';

interface ResumeSuggestionFieldProps {
  children: React.ReactNode;
  isFromResume?: boolean;
  confidence?: number;
  showBadge?: boolean;
}

const ResumeSuggestionField: React.FC<ResumeSuggestionFieldProps> = ({
  children,
  isFromResume = false,
  confidence,
  showBadge = true
}) => {
  if (!isFromResume || !showBadge) {
    return <>{children}</>;
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0}>
        <Box sx={{ flex: 1 }}>
          {children}
        </Box>
        <ResumeSuggestionBadge confidence={confidence} />
      </Stack>
    </Box>
  );
};

export default ResumeSuggestionField;
