/**
 * UnifiedTaskCard Component
 * 
 * Simplified task card optimized for the Unified Tasks Hub.
 * Shows key information and quick actions.
 */

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Stack,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Snooze as SnoozeIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  MoreVert as MoreVertIcon,
  CalendarToday as CalendarIcon,
  Repeat as RepeatIcon,
  Sync as SyncIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  AttachMoney as AttachMoneyIcon,
} from '@mui/icons-material';
import { UnifiedTask } from '../types/UnifiedTask';
import { format, parseISO, isPast, isToday } from 'date-fns';
import { formatDateForDisplay } from '../utils/dateUtils';

interface UnifiedTaskCardProps {
  task: UnifiedTask;
  onComplete: () => void;
  onSnooze: (task: UnifiedTask) => void;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
  onSnoozeClick?: (task: UnifiedTask) => void; // Optional callback to open snooze dialog
}

const UnifiedTaskCard: React.FC<UnifiedTaskCardProps> = ({
  task,
  onComplete,
  onSnooze,
  onSnoozeClick,
  onEdit,
  onDelete,
  onView,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  // Use onSnoozeClick if provided, fallback to onSnooze
  const handleSnooze = () => {
    if (onSnoozeClick) {
      onSnoozeClick(task);
    } else {
      onSnooze(task);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      case 'low':
        return 'default';
      default:
        return 'default';
    }
  };

  const getSourceLabel = (task: UnifiedTask) => {
    if (task.sourceName) return task.sourceName;
    if (task.sourceType) {
      switch (task.sourceType) {
        case 'crm':
          return 'CRM';
        case 'recruiting':
          return 'Recruiting';
        case 'onboarding':
          return 'Onboarding';
        case 'admin':
          return 'Admin';
        case 'google_tasks':
          return 'Google Tasks';
        default:
          return 'Other';
      }
    }
    return null;
  };

  const getDueDateDisplay = () => {
    const dueDate = task.dueDate || task.scheduledDate;
    if (!dueDate) return null;

    try {
      const date = parseISO(dueDate);
      if (isToday(date)) return 'Today';
      if (isPast(date)) return format(date, 'MMM d');
      return format(date, 'MMM d');
    } catch {
      return dueDate;
    }
  };

  const sourceLabel = getSourceLabel(task);
  const dueDateDisplay = getDueDateDisplay();
  const isCompleted = task.status === 'completed';

  return (
    <Card
      variant="outlined"
      sx={{
        cursor: 'pointer',
        transition: 'all 0.2s',
        '&:hover': {
          boxShadow: 2,
          transform: 'translateY(-1px)',
        },
        opacity: isCompleted ? 0.7 : 1,
      }}
      onClick={onView}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          {/* Complete Checkbox */}
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onComplete();
            }}
            sx={{
              mt: 0.5,
              color: isCompleted ? 'success.main' : 'action.disabled',
            }}
          >
            <CheckCircleIcon fontSize="small" />
          </IconButton>

          {/* Task Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: isCompleted ? 400 : 500,
                  textDecoration: isCompleted ? 'line-through' : 'none',
                  flex: 1,
                }}
              >
                {task.title}
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                {/* Badges */}
                {task.isScheduled && (
                  <Tooltip title="Scheduled">
                    <CalendarIcon fontSize="small" color="action" />
                  </Tooltip>
                )}
                {task.isRecurring && (
                  <Tooltip title="Recurring">
                    <RepeatIcon fontSize="small" color="action" />
                  </Tooltip>
                )}
                {task.isSynced && (
                  <Tooltip title={`Synced with ${task.syncSource === 'google_tasks' ? 'Google Tasks' : 'Google Calendar'}`}>
                    <SyncIcon fontSize="small" color="action" />
                  </Tooltip>
                )}

                {/* Menu */}
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuAnchor(e.currentTarget);
                  }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>

            {task.description && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mb: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {task.description}
              </Typography>
            )}

            {/* Metadata Row */}
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
              {/* Priority */}
              <Chip
                label={task.priority}
                size="small"
                color={getPriorityColor(task.priority) as any}
                variant="outlined"
              />

              {/* Due Date */}
              {dueDateDisplay && (
                <Chip
                  icon={<ScheduleIcon />}
                  label={dueDateDisplay}
                  size="small"
                  variant="outlined"
                />
              )}

              {/* Source */}
              {sourceLabel && (
                <Chip
                  label={sourceLabel}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              )}

              {/* Linked Objects */}
              {task.associations?.deals && task.associations.deals.length > 0 && (
                <Tooltip title={`Linked to ${task.associations.deals.length} deal(s)`}>
                  <Chip
                    icon={<AttachMoneyIcon />}
                    label={`${task.associations.deals.length} deal${task.associations.deals.length > 1 ? 's' : ''}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                </Tooltip>
              )}

              {task.associations?.contacts && task.associations.contacts.length > 0 && (
                <Tooltip title={`Linked to ${task.associations.contacts.length} contact(s)`}>
                  <Chip
                    icon={<PersonIcon />}
                    label={`${task.associations.contacts.length} contact${task.associations.contacts.length > 1 ? 's' : ''}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                </Tooltip>
              )}

              {task.associations?.companies && task.associations.companies.length > 0 && (
                <Tooltip title={`Linked to ${task.associations.companies.length} company/companies`}>
                  <Chip
                    icon={<BusinessIcon />}
                    label={`${task.associations.companies.length} company${task.associations.companies.length > 1 ? 'ies' : ''}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                </Tooltip>
              )}
            </Stack>
          </Box>
        </Box>
      </CardContent>

      {/* Action Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            handleSnooze();
          }}
        >
          <SnoozeIcon fontSize="small" sx={{ mr: 1 }} />
          Snooze
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onEdit();
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onDelete();
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Card>
  );
};

export default UnifiedTaskCard;

