import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';

interface CandidateNavigationProps {
  previousCandidateId?: string;
  nextCandidateId?: string;
  currentPath: string;
}

const CandidateNavigation: React.FC<CandidateNavigationProps> = ({
  previousCandidateId,
  nextCandidateId,
  currentPath,
}) => {
  const navigate = useNavigate();

  const basePath = currentPath.replace(/\/[^/]+$/, ''); // Remove last segment

  if (!previousCandidateId && !nextCandidateId) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {previousCandidateId ? (
        <Tooltip title="Previous Candidate">
          <IconButton
            size="small"
            onClick={() => navigate(`${basePath}/${previousCandidateId}`)}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <IconButton
          size="small"
          disabled
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            opacity: 0.3,
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
      )}

      <Box sx={{ fontSize: '0.75rem', color: 'text.secondary', px: 1 }}>
        {previousCandidateId && nextCandidateId ? '|' : ''}
      </Box>

      {nextCandidateId ? (
        <Tooltip title="Next Candidate">
          <IconButton
            size="small"
            onClick={() => navigate(`${basePath}/${nextCandidateId}`)}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <IconButton
          size="small"
          disabled
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            opacity: 0.3,
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
};

export default CandidateNavigation;

