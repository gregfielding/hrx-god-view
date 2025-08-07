import React from 'react';
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
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';

interface TaskCardProps {
  task: any;
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
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
    return new Date(dateString).toLocaleDateString();
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

  return (
    <Card sx={{ mb: 2, ...sx }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            {/* Title Row */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              {getTaskTypeIcon(task.type)}
              <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                {task.title}
              </Typography>
            </Box>

            {/* Status and Priority Chips */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Chip
                label={getTaskStatusDisplay(task)}
                color={getStatusColor(getTaskStatusDisplay(task)) as any}
                size="small"
              />
              <Chip
                label={task.priority}
                color={getPriorityColor(task.priority) as any}
                size="small"
                sx={
                  task.priority === 'low' ? {
                    backgroundColor: '#e3f2fd', // Light blue background
                    color: '#1976d2', // Dark blue text
                    '&:hover': {
                      backgroundColor: '#bbdefb',
                    }
                  } : {}
                }
              />
              {task.aiSuggested && (
                <Chip
                  label="AI Suggested"
                  size="small"
                  color="info"
                  icon={<AutoAwesomeIcon />}
                />
              )}
            </Box>

            {/* Description */}
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              {task.description}
            </Typography>

            {/* Context Information */}
            {(showCompany || showDeal || showContacts) && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                {showCompany && company && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <BusinessIcon fontSize="small" color="action" />
                    <Typography variant="caption" color="textSecondary">
                      {company.companyName || company.name}
                    </Typography>
                  </Box>
                )}
                
                {showDeal && deal && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <AttachMoneyIcon fontSize="small" color="action" />
                    <Typography variant="caption" color="textSecondary">
                      {deal.name}
                    </Typography>
                  </Box>
                )}
                
                {showContacts && contacts && contacts.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <PersonIcon fontSize="small" color="action" />
                    <Typography variant="caption" color="textSecondary">
                      {getContactDisplay()}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {/* Metadata */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="textSecondary">
                {formatDate(task.scheduledDate)}
              </Typography>
              {task.estimatedDuration && (
                <Typography variant="caption" color="textSecondary">
                  • {task.estimatedDuration} min
                </Typography>
              )}
            </Box>
            
            {/* Assigned Salesperson */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <PersonIcon fontSize="small" color="action" />
              <Typography variant="caption" color="textSecondary">
                {getSalespersonDisplay()}
              </Typography>
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onTaskClick(task)}
              sx={{ minWidth: 'auto', px: 1 }}
            >
              View/Edit
            </Button>
            {task.status !== 'completed' && (
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => onQuickComplete(task.id)}
                sx={{ minWidth: 'auto', px: 1 }}
              >
                Mark Complete
              </Button>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default TaskCard; 