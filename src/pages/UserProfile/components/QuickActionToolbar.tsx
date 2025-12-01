import React from 'react';
import { Stack, IconButton, Tooltip, Button } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DescriptionIcon from '@mui/icons-material/Description';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import LinkIcon from '@mui/icons-material/Link';
import PrintIcon from '@mui/icons-material/Print';
import AssignmentIcon from '@mui/icons-material/Assignment';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import TimelineIcon from '@mui/icons-material/Timeline';

interface QuickActionToolbarProps {
  onEdit?: () => void;
  onViewResume?: () => void;
  onAddNote?: () => void;
  onSendLink?: () => void;
  onPrint?: () => void;
  onCreateAssignment?: () => void;
  onCallNow?: () => void;
  onMessageApplicant?: () => void;
  onViewTimeline?: () => void;
  hasResume?: boolean;
  hasPhone?: boolean;
  isAdminView?: boolean;
  compact?: boolean; // If true, shows only icons
}

const QuickActionToolbar: React.FC<QuickActionToolbarProps> = ({
  onEdit,
  onViewResume,
  onAddNote,
  onSendLink,
  onPrint,
  onCreateAssignment,
  onCallNow,
  onMessageApplicant,
  onViewTimeline,
  hasResume = false,
  hasPhone = false,
  isAdminView = false,
  compact = false,
}) => {
  if (!isAdminView) {
    return null;
  }

  const actions = [];

  // Primary actions - Call and Message (most used)
  if (onCallNow && hasPhone) {
    actions.push({
      icon: <PhoneIcon />,
      label: 'Call Now',
      onClick: onCallNow,
      priority: 'high',
    });
  }

  if (onMessageApplicant) {
    actions.push({
      icon: <MessageIcon />,
      label: 'Message Applicant',
      onClick: onMessageApplicant,
      priority: 'high',
    });
  }

  if (onViewTimeline) {
    actions.push({
      icon: <TimelineIcon />,
      label: 'View Timeline',
      onClick: onViewTimeline,
      priority: 'high',
    });
  }

  // Secondary actions
  if (onViewResume && hasResume) {
    actions.push({
      icon: <DescriptionIcon />,
      label: 'View Resume',
      onClick: onViewResume,
      priority: 'medium',
    });
  }

  if (onAddNote) {
    actions.push({
      icon: <NoteAddIcon />,
      label: 'Add Note',
      onClick: onAddNote,
      priority: 'medium',
    });
  }

  if (onEdit) {
    actions.push({
      icon: <EditIcon />,
      label: 'Edit Profile',
      onClick: onEdit,
      priority: 'medium',
    });
  }

  if (onSendLink) {
    actions.push({
      icon: <LinkIcon />,
      label: 'Send Application Link',
      onClick: onSendLink,
      priority: 'low',
    });
  }

  if (onCreateAssignment) {
    actions.push({
      icon: <AssignmentIcon />,
      label: 'Create Assignment',
      onClick: onCreateAssignment,
      priority: 'low',
    });
  }

  if (onPrint) {
    actions.push({
      icon: <PrintIcon />,
      label: 'Print Profile',
      onClick: onPrint,
      priority: 'low',
    });
  }

  // Sort by priority: high > medium > low
  actions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
  });

  if (actions.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {actions.map((action, index) => (
          <Tooltip key={index} title={action.label}>
            <IconButton
              size="small"
              onClick={action.onClick}
              sx={{
                color: 'primary.main',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              {action.icon}
            </IconButton>
          </Tooltip>
        ))}
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      {actions.map((action, index) => (
        <Button
          key={index}
          variant="outlined"
          size="small"
          startIcon={action.icon}
          onClick={action.onClick}
          sx={{
            height: 32,
            textTransform: 'none',
            borderRadius: 1,
          }}
        >
          {action.label}
        </Button>
      ))}
    </Stack>
  );
};

export default QuickActionToolbar;

