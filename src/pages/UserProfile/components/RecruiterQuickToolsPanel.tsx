import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse, Stack, Button, Tooltip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import TimelineIcon from '@mui/icons-material/Timeline';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import SecurityIcon from '@mui/icons-material/Security';

interface RecruiterQuickToolsPanelProps {
  onAddNote?: () => void;
  onViewTimeline?: () => void;
  onAssignToJob?: () => void;
  onUploadDocs?: () => void;
  onVerifyID?: () => void;
  onRunBackgroundCheck?: () => void;
  isAdminView?: boolean;
}

const RecruiterQuickToolsPanel: React.FC<RecruiterQuickToolsPanelProps> = ({
  onAddNote,
  onViewTimeline,
  onAssignToJob,
  onUploadDocs,
  onVerifyID,
  onRunBackgroundCheck,
  isAdminView = false,
}) => {
  const [expanded, setExpanded] = useState(true);

  if (!isAdminView) {
    return null;
  }

  const tools = [
    { icon: <NoteAddIcon />, label: 'Add Note', onClick: onAddNote },
    { icon: <TimelineIcon />, label: 'View Timeline', onClick: onViewTimeline },
    { icon: <AssignmentIcon />, label: 'Assign to Job', onClick: onAssignToJob },
    { icon: <CloudUploadIcon />, label: 'Upload Docs', onClick: onUploadDocs },
    { icon: <VerifiedUserIcon />, label: 'Verify ID', onClick: onVerifyID },
    { icon: <SecurityIcon />, label: 'Run Background Check', onClick: onRunBackgroundCheck },
  ].filter(tool => tool.onClick);

  if (tools.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 80,
        width: expanded ? 240 : 48,
        transition: 'width 0.3s ease',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      {/* Toggle Button */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          p: 0.5,
          borderBottom: expanded ? '1px solid' : 'none',
          borderColor: 'divider',
        }}
      >
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{ p: 0.5 }}
        >
          {expanded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', mb: 1, display: 'block' }}>
            Quick Tools
          </Typography>
          <Stack spacing={0.5}>
            {tools.map((tool, index) => (
              <Button
                key={index}
                fullWidth
                size="small"
                startIcon={tool.icon}
                onClick={tool.onClick}
                sx={{
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  py: 0.75,
                  px: 1,
                }}
              >
                {tool.label}
              </Button>
            ))}
          </Stack>
        </Box>
      </Collapse>

      {!expanded && (
        <Box sx={{ p: 0.5 }}>
          <Stack spacing={0.5}>
            {tools.slice(0, 3).map((tool, index) => (
              <Tooltip key={index} title={tool.label} placement="right">
                <IconButton
                  size="small"
                  onClick={tool.onClick}
                  sx={{ p: 0.75 }}
                >
                  {tool.icon}
                </IconButton>
              </Tooltip>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

export default RecruiterQuickToolsPanel;

