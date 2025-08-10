import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  IconButton,
  Checkbox,
  Paper,
  Alert
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Person as PersonIcon,
  AttachMoney as AttachMoneyIcon,
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';


interface TaskSplitViewProps {
  tasks: any[];
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
  getStatusColor: (status: string) => string;
  getTaskStatusDisplay: (task: any) => string;
  getPriorityColor: (priority: string) => string;
  deal?: any;
  associatedContacts?: any[];
  associatedSalespeople?: any[];
}

const TaskSplitView: React.FC<TaskSplitViewProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  getStatusColor,
  getTaskStatusDisplay,
  getPriorityColor,
  deal,
  associatedContacts = [],
  associatedSalespeople = []
}) => {
  // Separate tasks by classification
  const todos = tasks.filter(task => task.classification === 'todo');
  const appointments = tasks.filter(task => task.classification === 'appointment');

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <AssignmentIcon fontSize="small" />;
      case 'phone_call': return <AssignmentIcon fontSize="small" />;
      case 'scheduled_meeting_virtual':
      case 'scheduled_meeting_in_person': return <ScheduleIcon fontSize="small" />;
      case 'research': return <AssignmentIcon fontSize="small" />;
      default: return <AssignmentIcon fontSize="small" />;
    }
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    const date = new Date(timeString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getSalespersonDisplay = (task: any) => {
    if (task.assignedToName) {
      return task.assignedToName;
    }
    
    if (task.assignedTo) {
      const salesperson = associatedSalespeople.find((s: any) => s.id === task.assignedTo);
      if (salesperson) {
        return salesperson.fullName || salesperson.name || salesperson.displayName || 'Unknown User';
      }
      return task.assignedTo;
    }
    return 'Unassigned';
  };

  return (
    <Grid container spacing={2} sx={{ height: '100%' }}>
      {/* Left Side - To-Do Items (1/3) */}
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 2, height: '100%' }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <CheckCircleIcon color="primary" />
            <Typography variant="h6">To-Do Items</Typography>
            <Chip label={todos.length} size="small" />
          </Box>
          
          {todos.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No to-do items for today
            </Alert>
          ) : (
            <Box sx={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              {todos.map((task) => (
                <Card 
                  key={task.id} 
                  sx={{ 
                    mb: 1, 
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'action.hover' }
                  }}
                  onClick={() => onTaskClick(task)}
                >
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Box display="flex" alignItems="flex-start" gap={1}>
                      <Checkbox
                        checked={task.status === 'completed'}
                        onChange={(e) => {
                          e.stopPropagation();
                          onQuickComplete(task.id);
                        }}
                        size="small"
                        sx={{ mt: 0.5 }}
                      />
                      
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography 
                          variant="body2" 
                          fontWeight="medium"
                          sx={{ 
                            textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                            color: task.status === 'completed' ? 'text.secondary' : 'text.primary'
                          }}
                        >
                          {task.title}
                        </Typography>
                        
                        {task.description && (
                          <Typography 
                            variant="caption" 
                            color="text.secondary"
                            sx={{ 
                              textDecoration: task.status === 'completed' ? 'line-through' : 'none'
                            }}
                          >
                            {task.description}
                          </Typography>
                        )}
                        
                        <Box display="flex" alignItems="center" gap={1} mt={1}>
                          <Chip
                            label={task.priority}
                            size="small"
                            color={getPriorityColor(task.priority) as any}
                          />
                          {task.aiSuggested && (
                            <AutoAwesomeIcon fontSize="small" color="primary" />
                          )}
                        </Box>
                        
                        <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                          <PersonIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {getSalespersonDisplay(task)}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Right Side - Appointments (2/3) */}
      <Grid item xs={12} md={8}>
        <Paper sx={{ p: 2, height: '100%' }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <ScheduleIcon color="primary" />
            <Typography variant="h6">Appointments</Typography>
            <Chip label={appointments.length} size="small" />
          </Box>
          
          {appointments.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No appointments scheduled for today
            </Alert>
          ) : (
            <Box sx={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              {appointments.map((task) => (
                <Card 
                  key={task.id} 
                  sx={{ 
                    mb: 2, 
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'action.hover' }
                  }}
                  onClick={() => onTaskClick(task)}
                >
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ flex: 1 }}>
                        {/* Title Row */}
                        <Box display="flex" alignItems="center" mb={1}>
                          {getTaskTypeIcon(task.type)}
                          <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                            {task.title}
                          </Typography>
                        </Box>

                        {/* Time Information */}
                        <Box display="flex" alignItems="center" gap={2} mb={1}>
                          <Typography variant="body2" color="text.secondary">
                            {task.startTime ? formatTime(task.startTime) : 'No time set'}
                          </Typography>
                          {task.duration && (
                            <Typography variant="body2" color="text.secondary">
                              • {formatDuration(task.duration)}
                            </Typography>
                          )}
                        </Box>

                        {/* Status and Priority Chips */}
                        <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
                          <Chip
                            label={getTaskStatusDisplay(task)}
                            color={getStatusColor(getTaskStatusDisplay(task)) as any}
                            size="small"
                          />
                          <Chip
                            label={task.priority}
                            color={getPriorityColor(task.priority) as any}
                            size="small"
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
                        {task.description && (
                          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                            {task.description}
                          </Typography>
                        )}

                        {/* Context Information */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                          {deal && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <AttachMoneyIcon fontSize="small" color="action" />
                              <Typography variant="caption" color="text.secondary">
                                {deal.name}
                              </Typography>
                            </Box>
                          )}
                          
                          {associatedContacts && associatedContacts.length > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PersonIcon fontSize="small" color="action" />
                              <Typography variant="caption" color="text.secondary">
                                {associatedContacts.map((contact: any) => 
                                  contact.fullName || contact.name || 'Unknown Contact'
                                ).join(', ')}
                              </Typography>
                            </Box>
                          )}
                        </Box>

                        {/* Assigned Salesperson */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PersonIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {getSalespersonDisplay(task)}
                          </Typography>
                        </Box>
                      </Box>

                      {/* Quick Complete Button */}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickComplete(task.id);
                        }}
                        sx={{ color: 'success.main' }}
                      >
                        <CheckCircleIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </Paper>
      </Grid>
    </Grid>
  );
};

export default TaskSplitView;
