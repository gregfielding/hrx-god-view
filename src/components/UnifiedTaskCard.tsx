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
  Link,
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
import { Link as RouterLink } from 'react-router-dom';

interface UnifiedTaskCardProps {
  task: UnifiedTask;
  onComplete: () => void;
  onSnooze: (task: UnifiedTask) => void;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
  onSnoozeClick?: (task: UnifiedTask) => void; // Optional callback to open snooze dialog
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

  const renderLinksLine = (
    label: string,
    icon: React.ReactNode,
    ids: string[],
    kind: 'deal' | 'contact' | 'company'
  ) => {
    if (!ids.length) return null;
    const MAX = 8;
    const shown = ids.slice(0, MAX);
    const remaining = ids.length - shown.length;

    const getName = (id: string) => {
      const map =
        kind === 'deal'
          ? associationLookups?.deals
          : kind === 'contact'
          ? associationLookups?.contacts
          : associationLookups?.companies;
      const fromMap = map?.[id];
      if (fromMap) return fromMap;
      // Use optimized relatedToName when it matches the singular association
      if (assoc?.relatedToName && assoc?.relatedTo?.id === id) return String(assoc.relatedToName);
      return `${label} ${shortId(id)}`;
    };

    const toFor = (id: string) => {
      if (kind === 'deal') return `/crm/deals/${id}`;
      if (kind === 'contact') return `/contacts/${id}`;
      return `/companies/${id}`;
    };

    const remainingNames = remaining
      ? ids.slice(MAX).map((id) => getName(id)).filter(Boolean).join(', ')
      : '';

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>{icon}</Box>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, fontWeight: 600 }}>
          {label}:
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
          {shown.map((id, idx) => (
            <React.Fragment key={id}>
              <Link
                component={RouterLink}
                to={toFor(id)}
                underline="hover"
                onClick={(e) => e.stopPropagation()}
                sx={{ fontWeight: 600 }}
              >
                {getName(id)}
              </Link>
              {idx < shown.length - 1 && (
                <Typography variant="body2" color="text.secondary">
                  ,
                </Typography>
              )}
            </React.Fragment>
          ))}
          {remaining > 0 && (
            <Tooltip title={remainingNames || `${remaining} more`} arrow>
              <Typography variant="body2" color="text.secondary" sx={{ cursor: 'help' }}>
                (+{remaining} more)
              </Typography>
            </Tooltip>
          )}
        </Box>
      </Box>
    );
  };

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
            </Stack>

            {/* Linked Objects (expanded) */}
            {(dealIds.length > 0 || contactIds.length > 0 || companyIds.length > 0) && (
              <Box sx={{ mt: 1 }}>
                <Stack spacing={0.5}>
                  {renderLinksLine('Deal', <AttachMoneyIcon fontSize="small" />, dealIds, 'deal')}
                  {renderLinksLine('Contacts', <PersonIcon fontSize="small" />, contactIds, 'contact')}
                  {renderLinksLine('Company', <BusinessIcon fontSize="small" />, companyIds, 'company')}
                </Stack>
              </Box>
            )}
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

