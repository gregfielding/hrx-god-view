import React from 'react';
import { Box, Button, Grid, Tooltip } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import TimelineIcon from '@mui/icons-material/Timeline';
import DescriptionIcon from '@mui/icons-material/Description';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import AssignmentIcon from '@mui/icons-material/Assignment';

interface CompactActionGridProps {
  onCallNow?: () => void;
  onMessageApplicant?: () => void;
  onViewTimeline?: () => void;
  onViewResume?: () => void;
  onAddNote?: () => void;
  onEditProfile?: () => void;
  onSendLink?: () => void;
  onCreateAssignment?: () => void;
  hasResume?: boolean;
  hasPhone?: boolean;
  isAdminView?: boolean;
}

const CompactActionGrid: React.FC<CompactActionGridProps> = ({
  onCallNow,
  onMessageApplicant,
  onViewTimeline,
  onViewResume,
  onAddNote,
  onEditProfile,
  onSendLink,
  onCreateAssignment,
  hasResume = false,
  hasPhone = false,
  isAdminView = false,
}) => {
  if (!isAdminView) {
    return null;
  }

  const actions = [
    { label: 'Call Now', icon: <PhoneIcon sx={{ fontSize: 16 }} />, onClick: onCallNow, disabled: !hasPhone },
    { label: 'Message', icon: <MessageIcon sx={{ fontSize: 16 }} />, onClick: onMessageApplicant },
    { label: 'Timeline', icon: <TimelineIcon sx={{ fontSize: 16 }} />, onClick: onViewTimeline },
    { label: 'Resume', icon: <DescriptionIcon sx={{ fontSize: 16 }} />, onClick: onViewResume, disabled: !hasResume },
    { label: 'Add Note', icon: <NoteAddIcon sx={{ fontSize: 16 }} />, onClick: onAddNote },
    { label: 'Edit', icon: <EditIcon sx={{ fontSize: 16 }} />, onClick: onEditProfile },
    { label: 'Send Link', icon: <LinkIcon sx={{ fontSize: 16 }} />, onClick: onSendLink },
    { label: 'Assignment', icon: <AssignmentIcon sx={{ fontSize: 16 }} />, onClick: onCreateAssignment },
  ].filter(action => action.onClick);

  return (
    <Box sx={{ width: 300 }}>
      <Grid container spacing={0.75} sx={{ width: '100%' }}>
        {actions.map((action, index) => (
          <Grid item xs={6} key={index}>
            <Tooltip title={action.disabled ? `${action.label} unavailable` : action.label}>
              <span>
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={action.icon}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  sx={{
                    height: 36,
                    fontSize: '0.875rem',
                    textTransform: 'none',
                    px: 1.5,
                    py: 0.75,
                    justifyContent: 'flex-start',
                    borderRadius: 1,
                  }}
                >
                  {action.label}
                </Button>
              </span>
            </Tooltip>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default CompactActionGrid;

