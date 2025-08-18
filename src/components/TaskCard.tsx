import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Chip,
  IconButton,
  Button,
  Avatar,
  Tooltip
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  CheckCircle as CheckCircleIcon,
  Business as BusinessIcon,
  AttachMoney as AttachMoneyIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Psychology as PsychologyIcon,
  AutoAwesome as AutoAwesomeIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material';

interface TaskCardProps {
  task: any;
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
  onEditTask?: (task: any) => void; // New prop for edit functionality
  getStatusColor: (status: string) => string;
  getTaskStatusDisplay: (task: any) => string;
  // Context flags to show/hide information
  showCompany?: boolean;
  showDeal?: boolean;
  showContacts?: boolean;
  // Context data
  company?: any;
  deal?: any;
  contacts?: any[];
  salespeople?: any[];
  // Custom styling
  variant?: 'default' | 'compact';
  sx?: any;
}

/**
 * Reusable TaskCard component that adapts to different contexts
 * 
 * Usage Examples:
 * 
 * // In Deal Details (current context) - hide company/deal, show contacts
 * <TaskCard
 *   task={task}
 *   onTaskClick={handleTaskClick}
 *   onQuickComplete={handleQuickComplete}
 *   getStatusColor={getStatusColor}
 *   getTaskStatusDisplay={getTaskStatusDisplay}
 *   showCompany={false}
 *   showDeal={false}
 *   showContacts={true}
 *   deal={deal}
 *   contacts={associatedContacts}
 * />
 * 
 * // In main Tasks tab - show all context information
 * <TaskCard
 *   task={task}
 *   onTaskClick={handleTaskClick}
 *   onQuickComplete={handleQuickComplete}
 *   getStatusColor={getStatusColor}
 *   getTaskStatusDisplay={getTaskStatusDisplay}
 *   showCompany={true}
 *   showDeal={true}
 *   showContacts={true}
 *   company={task.company}
 *   deal={task.deal}
 *   contacts={task.contacts}
 * />
 * 
 * // In Contact Details - hide company, show deal and contacts
 * <TaskCard
 *   task={task}
 *   onTaskClick={handleTaskClick}
 *   onQuickComplete={handleQuickComplete}
 *   getStatusColor={getStatusColor}
 *   getTaskStatusDisplay={getTaskStatusDisplay}
 *   showCompany={false}
 *   showDeal={true}
 *   showContacts={true}
 *   deal={task.deal}
 *   contacts={[contact]}
 * />
 */
const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onTaskClick,
  onQuickComplete,
  onEditTask,
  getStatusColor,
  getTaskStatusDisplay,
  showCompany = true,
  showDeal = true,
  showContacts = false,
  company,
  deal,
  contacts = [],
  salespeople = [],
  variant = 'default',
  sx = {}
}) => {
  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon fontSize="small" />;
      case 'phone_call': return <PhoneIcon fontSize="small" />;
      case 'scheduled_meeting_virtual': 
      case 'scheduled_meeting_in_person': return <ScheduleIcon fontSize="small" />;
      case 'research': return <PsychologyIcon fontSize="small" />;
      case 'business': return <BusinessIcon fontSize="small" />;
      default: return <AssignmentIcon fontSize="small" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'primary'; // Dark blue
      case 'medium': return 'info'; // Medium blue
      case 'low': return 'default'; // Light blue (will use custom styling)
      default: return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    
    try {
      const date = new Date(dateString);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return '';
      }
      
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.warn('Error formatting date:', dateString, error);
      return '';
    }
  };

  const getContactDisplay = () => {
    // First, try to get contacts from task associations
    if (task.associations?.contacts && task.associations.contacts.length > 0) {
      // If we have contact IDs in task associations, try to resolve them
      const taskContactIds = task.associations.contacts;
      
      // If we have contacts prop (from deal context), try to match by ID
      if (contacts && contacts.length > 0) {
        const matchedContacts = contacts.filter((contact: any) => 
          taskContactIds.includes(contact.id)
        );
        
        if (matchedContacts.length > 0) {
          if (matchedContacts.length === 1) {
            return matchedContacts[0].fullName || `${matchedContacts[0].firstName} ${matchedContacts[0].lastName}`;
          }
          return `${matchedContacts.length} contacts`;
        }
      }
      
      // Fallback: show the number of contact IDs
      return `${taskContactIds.length} contacts`;
    }
    
    // Fallback to contacts prop (for backward compatibility)
    if (contacts && contacts.length > 0) {
      if (contacts.length === 1) {
        return contacts[0].fullName || `${contacts[0].firstName} ${contacts[0].lastName}`;
      }
      return `${contacts.length} contacts`;
    }
    
    return null;
  };

  const getSalespersonDisplay = () => {
    // Check if task has assignedTo field
    if (task.assignedTo) {
      // First, try to use the optimized assignedToName field (new optimization)
      if (task.assignedToName) {
        return task.assignedToName;
      }
      
      // Fallback: try to get salespeople from task associations
      if (task.associations?.salespeople && task.associations.salespeople.length > 0) {
        const taskSalespersonIds = task.associations.salespeople;
        
        // If we have salespeople prop (from deal context), try to match by ID
        if (salespeople && salespeople.length > 0) {
          const matchedSalesperson = salespeople.find((s: any) => 
            taskSalespersonIds.includes(s.id) && s.id === task.assignedTo
          );
          if (matchedSalesperson) {
            return matchedSalesperson.fullName || matchedSalesperson.name || matchedSalesperson.displayName || 'Unknown User';
          }
        }
      }
      
      // Fallback: try to find by assignedTo ID in salespeople prop
      if (salespeople && salespeople.length > 0) {
        const salesperson = salespeople.find((s: any) => s.id === task.assignedTo);
        if (salesperson) {
          return salesperson.fullName || salesperson.name || salesperson.displayName || 'Unknown User';
        }
      }
      
      // Fallback to just showing the ID if no name found
      return task.assignedTo;
    }
    return 'Unassigned';
  };

  const getDealDisplay = () => {
    // First try to get deal from props
    if (deal) {
      return deal.name || deal.title || 'Unknown Deal';
    }
    
    // Then try to get from task associations
    const associatedDeals = task.associations?.deals || [];
    if (associatedDeals.length > 0) {
      // For now, just show the number of deals since we don't have the full deal data
      return `${associatedDeals.length} deal${associatedDeals.length > 1 ? 's' : ''}`;
    }
    
    return null;
  };

  // Simple, clean design matching DealDetails style with hover expansion
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        p: 1.5,
        mb: 1,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          backgroundColor: 'action.hover',
          borderColor: 'primary.main'
        },
        ...sx
      }}
      onClick={() => onTaskClick(task)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main row: Checkbox, Title, and Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Left side: Checkbox and Title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          <Box
            sx={{
              width: 16,
              height: 16,
              border: '2px solid',
              borderColor: task.status === 'completed' ? 'success.main' : 'text.secondary',
              borderRadius: 1,
              backgroundColor: task.status === 'completed' ? 'success.main' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              '&:hover': {
                borderColor: 'primary.main'
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              onQuickComplete(task.id);
            }}
          >
            {task.status === 'completed' && (
              <CheckCircleIcon sx={{ fontSize: 12, color: 'white' }} />
            )}
          </Box>
          
          <Typography 
            variant="body1" 
            sx={{ 
              flex: 1,
              fontWeight: 'bold',
              textDecoration: task.status === 'completed' ? 'line-through' : 'none',
              color: task.status === 'completed' ? 'text.secondary' : 'text.primary',
              opacity: task.status === 'completed' ? 0.7 : 1
            }}
          >
            {task.title}
          </Typography>
        </Box>

                {/* Right side: Status chips, completion date, and actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Status and Priority Chips */}
          <Chip
            label={getTaskStatusDisplay(task)}
            color={getStatusColor(getTaskStatusDisplay(task)) as any}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: '20px' }}
          />
          <Chip
            label={task.priority}
            color={getPriorityColor(task.priority) as any}
            size="small"
            variant="outlined"
            sx={{ 
              fontSize: '0.7rem', 
              height: '20px',
              ...(task.priority === 'low' ? {
                backgroundColor: '#e3f2fd',
                color: '#1976d2',
                '&:hover': {
                  backgroundColor: '#bbdefb',
                }
              } : {})
            }}
          />

          {/* Ellipsis menu for additional actions */}
          {onEditTask && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onEditTask(task);
              }}
              sx={{ 
                color: 'text.secondary',
                '&:hover': {
                  color: 'primary.main',
                  backgroundColor: 'primary.50'
                }
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Expanded details on hover */}
      {isHovered && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          {/* Description */}
          {task.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {task.description}
            </Typography>
          )}

          

          {/* Due Date */}
          {(task.dueDate || task.scheduledDate) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <ScheduleIcon fontSize="small" color="action" />
              <Typography variant="caption" color="text.secondary">
                Due: {formatDate(task.classification === 'todo' ? task.dueDate : task.scheduledDate)}
              </Typography>
            </Box>
          )}

          {/* Context Information */}
          {(showCompany || showDeal || showContacts) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {/* Assigned Person */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Assigned: {getSalespersonDisplay()}
                </Typography>
              </Box>
              
              {/* Contacts */}
              {showContacts && contacts && contacts.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <PersonIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    Contacts: {getContactDisplay() || 'Unknown'}
                  </Typography>
                </Box>
              )}
              
                            {/* Company */}
              {showCompany && company && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BusinessIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    Company: {company.companyName || company.name}
                  </Typography>
                </Box>
              )}

              {/* Deal */}
              {showDeal && getDealDisplay() && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AttachMoneyIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    Deal: {getDealDisplay()}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default TaskCard; 