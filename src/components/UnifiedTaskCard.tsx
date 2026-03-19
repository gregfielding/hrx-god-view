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
  Checkbox,
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
} from '@mui/icons-material';
import { format, parseISO, isPast, isToday } from 'date-fns';

import { UnifiedTask } from '../types/UnifiedTask';

interface UnifiedTaskCardProps {
  task: UnifiedTask;
  onComplete: () => void;
  onSnooze: (task: UnifiedTask) => void;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
  onSnoozeClick?: (task: UnifiedTask) => void; // Optional callback to open snooze dialog
  isCompleting?: boolean;
  associationLookups?: {
    deals?: Record<string, string>;
    contacts?: Record<string, string>;
    companies?: Record<string, string>;
  };
}

const UnifiedTaskCard: React.FC<UnifiedTaskCardProps> = ({
  task,
  onComplete,
  onSnooze,
  onSnoozeClick,
  onEdit,
  onDelete,
  onView,
  isCompleting = false,
  associationLookups,
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

  const assoc: any = (task as any).associations || {};
  const dealIds: string[] = Array.isArray(assoc?.deals) ? assoc.deals.filter((x: any) => typeof x === 'string') : [];
  const contactIds: string[] = Array.isArray(assoc?.contacts) ? assoc.contacts.filter((x: any) => typeof x === 'string') : [];
  const companyIds: string[] = Array.isArray(assoc?.companies) ? assoc.companies.filter((x: any) => typeof x === 'string') : [];

  // Also include the singular relatedTo association if present
  if (assoc?.relatedTo?.type && typeof assoc.relatedTo.id === 'string') {
    if (assoc.relatedTo.type === 'deal' && !dealIds.includes(assoc.relatedTo.id)) dealIds.push(assoc.relatedTo.id);
    if (assoc.relatedTo.type === 'contact' && !contactIds.includes(assoc.relatedTo.id)) contactIds.push(assoc.relatedTo.id);
    if (assoc.relatedTo.type === 'company' && !companyIds.includes(assoc.relatedTo.id)) companyIds.push(assoc.relatedTo.id);
  }

  const shortId = (id: string) => (id.length <= 8 ? id : `${id.slice(0, 6)}…`);

  // Shorten system-generated descriptions (e.g. "System-managed checklist task for job order 2YzN9...")
  const displayDescription = (() => {
    const d = task.description?.trim();
    if (!d) return null;
    const taskAny = task as any;
    if (taskAny.systemSource === 'job_order_checklist' && d.toLowerCase().includes('system-managed')) {
      return assoc?.relatedToName ? `Checklist: ${assoc.relatedToName}` : 'Job order checklist';
    }
    return d;
  })();

  // Single-line "Linked to" for compact view (first deal/contact/company name only)
  const linkedToShort = (() => {
    const parts: string[] = [];
    if (dealIds.length > 0) {
      const name = associationLookups?.deals?.[dealIds[0]] || assoc?.relatedToName || `Deal ${shortId(dealIds[0])}`;
      parts.push(name);
    }
    if (contactIds.length > 0 && parts.length < 2) {
      const name = associationLookups?.contacts?.[contactIds[0]] || `Contact ${shortId(contactIds[0])}`;
      parts.push(name);
    }
    if (companyIds.length > 0 && parts.length < 2) {
      const name = associationLookups?.companies?.[companyIds[0]] || `Company ${shortId(companyIds[0])}`;
      parts.push(name);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  return (
    <Card
      variant="outlined"
      sx={{
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        '&:hover': {
          boxShadow: 1,
          borderColor: 'action.selected',
        },
        opacity: isCompleted ? 0.75 : 1,
      }}
      onClick={onView}
    >
      <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* Complete — primary action on card */}
          <Tooltip title={isCompleted ? 'Mark incomplete' : 'Mark complete'}>
            <Checkbox
              checked={!!isCompleted}
              disabled={isCompleting}
              onChange={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              onClick={(e) => e.stopPropagation()}
              size="small"
              checkedIcon={<CheckCircleIcon />}
              sx={{
                p: 0.25,
                color: isCompleted ? 'success.main' : 'action.disabled',
                '&.Mui-checked': { color: 'success.main' },
                '&.Mui-disabled': { opacity: 0.8 },
              }}
            />
          </Tooltip>

          {/* Title + metadata on one row */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: isCompleted ? 400 : 600,
                textDecoration: isCompleted ? 'line-through' : 'none',
                flex: '1 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {task.title}
            </Typography>

            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" sx={{ flexShrink: 0 }}>
              <Chip
                label={task.priority}
                size="small"
                color={getPriorityColor(task.priority) as any}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 } }}
              />
              {dueDateDisplay && (
                <Chip
                  icon={<ScheduleIcon sx={{ fontSize: 14 }} />}
                  label={dueDateDisplay}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 }, '& .MuiChip-icon': { fontSize: 14 } }}
                />
              )}
              {sourceLabel && (
                <Chip
                  label={sourceLabel}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                />
              )}
              {task.isScheduled && (
                <Tooltip title="Scheduled">
                  <CalendarIcon sx={{ fontSize: 16, color: 'action.active' }} />
                </Tooltip>
              )}
              {task.isRecurring && (
                <Tooltip title="Recurring">
                  <RepeatIcon sx={{ fontSize: 16, color: 'action.active' }} />
                </Tooltip>
              )}
              {task.isSynced && (
                <Tooltip title={task.syncSource === 'google_tasks' ? 'Google Tasks' : 'Google Calendar'}>
                  <SyncIcon sx={{ fontSize: 16, color: 'action.active' }} />
                </Tooltip>
              )}
            </Stack>

            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchor(e.currentTarget);
              }}
              sx={{ ml: 0.5, p: 0.25 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Optional second line: description or linked-to (single line) */}
        {(displayDescription || linkedToShort) && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mt: 0.25,
              pl: 4.25, // align with title after checkbox
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {linkedToShort && displayDescription ? `${linkedToShort} — ${displayDescription}` : (linkedToShort || displayDescription)}
          </Typography>
        )}
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

