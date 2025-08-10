import React from 'react';
import { Box, Typography, Chip, IconButton, Card } from '@mui/material';
import { CheckCircle as CheckCircleIcon, Schedule as ScheduleIcon, Person as PersonIcon } from '@mui/icons-material';
import { Task } from '../types/Tasks';

interface TaskItemProps {
  task: Task;
  onMarkComplete?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  showDetails?: boolean;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return '#1E9E6A';
    case 'overdue':
      return '#D14343';
    case 'in_progress':
      return '#B88207';
    default:
      return '#8B94A3';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'overdue':
      return 'Overdue';
    case 'in_progress':
      return 'In Progress';
    default:
      return 'Pending';
  }
};

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onMarkComplete,
  onEdit,
  showDetails = false
}) => {
  const statusColor = getStatusColor(task.status);
  const isOverdue = task.status === 'overdue';

  return (
    <Card
      sx={{
        position: 'relative',
        border: '1px solid rgba(0,0,0,.08)',
        borderRadius: 12,
        padding: '16px',
        backgroundColor: '#FFFFFF',
        '&:hover': {
          borderColor: 'rgba(0,0,0,.12)',
          transform: 'translateY(-1px)',
          transition: 'all 200ms ease-in-out'
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          backgroundColor: statusColor,
          borderTopLeftRadius: 12,
          borderBottomLeftRadius: 12
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        {/* Task Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Title and Status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                color: '#0B0D12',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {task.title}
            </Typography>
            
            {isOverdue && (
              <Chip
                label="● Overdue"
                size="small"
                sx={{
                  backgroundColor: '#FDECEC',
                  color: '#D14343',
                  fontSize: '0.75rem',
                  height: 20,
                  '& .MuiChip-label': {
                    padding: '0 6px'
                  }
                }}
              />
            )}
          </Box>

          {/* Meta Information */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            {task.assignedToName && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon sx={{ fontSize: 14, color: '#8B94A3' }} />
                <Typography variant="caption" color="#8B94A3">
                  {task.assignedToName}
                </Typography>
              </Box>
            )}
            
            {(task.classification === 'todo' ? task.dueDate : task.scheduledDate) && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: 14, color: '#8B94A3' }} />
                <Typography variant="caption" color="#8B94A3">
                  {new Date((task.classification === 'todo' ? task.dueDate : task.scheduledDate) + 'T00:00:00').toLocaleDateString()}
                </Typography>
              </Box>
            )}
            
            {task.estimatedDuration && (
              <Typography variant="caption" color="#8B94A3">
                {task.estimatedDuration} min
              </Typography>
            )}
          </Box>

          {/* Description (shown on hover or when showDetails is true) */}
          {showDetails && task.description && (
            <Typography
              variant="body2"
              color="#5A6372"
              sx={{
                mt: 1,
                lineHeight: 1.5,
                maxHeight: showDetails ? 'none' : 0,
                overflow: 'hidden',
                transition: 'max-height 200ms ease-in-out'
              }}
            >
              {task.description}
            </Typography>
          )}

          {/* Associated Contacts/Companies */}
          {(task.associations?.contacts?.length > 0 || task.associations?.companies?.length > 0) && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {task.associations?.contacts?.map((contactId, index) => (
                <Chip
                  key={contactId || index}
                  label={`Contact ${contactId}`}
                  size="small"
                  sx={{
                    backgroundColor: '#E8F1FC',
                    color: '#1F6FC9',
                    fontSize: '0.75rem',
                    height: 20
                  }}
                />
              ))}
              {task.associations?.companies?.map((companyId, index) => (
                <Chip
                  key={companyId || index}
                  label={`Company ${companyId}`}
                  size="small"
                  sx={{
                    backgroundColor: '#F7F9FC',
                    color: '#5A6372',
                    fontSize: '0.75rem',
                    height: 20
                  }}
                />
              ))}
            </Box>
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {task.status !== 'completed' && onMarkComplete && (
            <IconButton
              size="small"
              onClick={() => onMarkComplete(task.id)}
              sx={{
                color: '#1E9E6A',
                '&:hover': {
                  backgroundColor: '#E7F7F0'
                }
              }}
            >
              <CheckCircleIcon fontSize="small" />
            </IconButton>
          )}
          
          {onEdit && (
            <Typography
              variant="caption"
              sx={{
                color: '#4A90E2',
                cursor: 'pointer',
                fontWeight: 600,
                '&:hover': {
                  textDecoration: 'underline'
                }
              }}
              onClick={() => onEdit(task.id)}
            >
              View / Edit
            </Typography>
          )}
        </Box>
      </Box>
    </Card>
  );
};
