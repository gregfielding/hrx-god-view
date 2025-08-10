import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  IconButton,
  Collapse,
  Divider,
  Tooltip,
  Fade,
  Grow,
  Fab,
  List,
  ListItemButton,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Schedule as ScheduleIcon,
  Event as EventIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Psychology as PsychologyIcon,
  AccessTime as AccessTimeIcon,
  MoreVert as MoreVertIcon,
  CalendarMonth as CalendarMonthIcon,
  Directions as DirectionsIcon,
  VideoCall as VideoCallIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  List as ListIcon
} from '@mui/icons-material';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  type: string;
  classification?: string; // Add classification field
  startTime?: string;
  duration?: number;
  scheduledDate?: string;
  dueDate?: string; // Add dueDate field
  aiSuggested?: boolean;
  completedAt?: string;
  assignedTo?: string;
  assignedToName?: string;
  associations?: {
    contacts?: (string | any)[];
    companies?: (string | any)[];
    salespeople?: (string | any)[];
  };
  // Google Meet integration
  googleMeetLink?: string;
  googleMeetConferenceId?: string;
  meetingAttendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  // Task-type-specific fields
  agenda?: string;
  goals?: string[];
  researchTopics?: string[];
  callScript?: string;
  emailTemplate?: string;
  followUpNotes?: string;
}

interface EnhancedTasksLayoutProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onQuickComplete: (taskId: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onCreateTask: () => void;
  getStatusColor: (status: string) => string;
  getTaskTypeIcon: (type: string) => React.ReactNode;
  calculateUrgency: (task: Task) => string;
  getTaskStatusDisplay: (task: Task) => string;
  deal?: any;
  associatedContacts?: any[];
  associatedSalespeople?: any[];
}

const EnhancedTasksLayout: React.FC<EnhancedTasksLayoutProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  onEditTask,
  onDeleteTask,
  onCreateTask,
  getStatusColor,
  getTaskTypeIcon,
  calculateUrgency,
  getTaskStatusDisplay,
  deal,
  associatedContacts = [],
  associatedSalespeople = []
}) => {
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [expandedTodos, setExpandedTodos] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false); // Collapsed by default
  const [activeFilter, setActiveFilter] = useState<'open' | 'completed'>('open');

                // Separate tasks by classification and filter
              const allTodoTasks = tasks.filter(task => task.classification === 'todo');
              const appointmentTasks = tasks.filter(task => task.classification === 'appointment' && task.status !== 'completed');
  
  // Filter tasks based on active filter
  const todoTasks = allTodoTasks.filter(task => {
    if (activeFilter === 'open') {
      return task.status !== 'completed';
    } else if (activeFilter === 'completed') {
      return task.status === 'completed';
    }
    return true;
                }).sort((a, b) => {
                // Sort by date in descending order (newest first)
                const dateA = (a.classification === 'todo' ? a.dueDate : a.scheduledDate) ? new Date((a.classification === 'todo' ? a.dueDate : a.scheduledDate) + 'T00:00:00').getTime() : 0;
                const dateB = (b.classification === 'todo' ? b.dueDate : b.scheduledDate) ? new Date((b.classification === 'todo' ? b.dueDate : b.scheduledDate) + 'T00:00:00').getTime() : 0;
                return dateB - dateA;
              });
  
  const completedTasks = allTodoTasks.filter(task => task.status === 'completed');

  const handleTodoHover = (taskId: string, isHovering: boolean) => {
    setHoveredTask(isHovering ? taskId : null);
    if (isHovering) {
      setExpandedTodos(prev => new Set([...prev, taskId]));
    } else {
      setExpandedTodos(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high': return '#f44336';
      case 'medium': return '#ff9800';
      case 'low': return '#4caf50';
      default: return '#757575';
    }
  };

  const getStatusChipColor = (status: string): 'error' | 'success' | 'default' => {
    switch (status.toLowerCase()) {
      case 'overdue': return 'error';
      case 'completed': return 'success';
      case 'upcoming': return 'default';
      default: return 'default';
    }
  };

  const getStatusChipBackground = (status: string) => {
    switch (status.toLowerCase()) {
      case 'overdue': return 'error.main';
      case 'completed': return 'success.main';
      default: return 'grey.300';
    }
  };

  const getStatusChipVariant = (status: string): 'filled' | 'outlined' => {
    switch (status.toLowerCase()) {
      case 'overdue': return 'filled';
      case 'completed': return 'filled';
      default: return 'filled';
    }
  };

  const getRelativeTime = (startTime: string) => {
    const now = new Date();
    const taskTime = new Date(startTime);
    const diffMs = taskTime.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffMs < 0) {
      return 'Past';
    } else if (diffHours === 0) {
      return `In ${diffMinutes}m`;
    } else if (diffHours === 1) {
      return `In 1h ${diffMinutes}m`;
    } else {
      return `In ${diffHours}h ${diffMinutes}m`;
    }
  };

  const isTaskApproaching = (startTime: string) => {
    const now = new Date();
    const taskTime = new Date(startTime);
    const diffMs = taskTime.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 2; // Within 2 hours
  };

  const isTaskOverdue = (startTime: string) => {
    const now = new Date();
    const taskTime = new Date(startTime);
    return taskTime < now;
  };

  const formatTaskDate = (dateString: string) => {
    if (!dateString) return '';
    // Ensure the date is interpreted as local time by appending a time component
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric' 
    });
  };

  const formatAppointmentDate = (startTime: string) => {
    if (!startTime) return null;
    const date = new Date(startTime);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    // Format: "Tue, Aug 12"
    const dayFormat = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
    // Calculate relative time
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let relativeText = '';
    if (isToday) {
      relativeText = 'today';
    } else if (diffDays === 1) {
      relativeText = 'tomorrow';
    } else if (diffDays > 1) {
      relativeText = `in ${diffDays} days`;
    } else if (diffDays < 0) {
      relativeText = `${Math.abs(diffDays)} days ago`;
    }
    
    return { dayFormat, relativeText, isToday };
  };

  const getAssociatedPeopleDisplay = (task: Task) => {
    const contacts = task.associations?.contacts || [];
    const salespeople = task.associations?.salespeople || [];
    
    console.log('🔍 getAssociatedPeopleDisplay called for task:', task.id);
    console.log('  - Task contacts:', contacts);
    console.log('  - Task salespeople:', salespeople);
    console.log('  - Available associatedContacts:', associatedContacts.length);
    console.log('  - Available associatedSalespeople:', associatedSalespeople.length);
    
    // Handle both string IDs and objects
    const contactNames = contacts.map(contact => {
      if (typeof contact === 'string') {
        const foundContact = associatedContacts.find(c => c.id === contact);
        console.log(`  - Looking for contact ${contact}, found:`, foundContact);
        // Only return name if we found the contact, otherwise return null to filter out
        return foundContact ? (foundContact.fullName || foundContact.name) : null;
      }
      return contact.name || contact.fullName || contact.id;
    }).filter(Boolean); // Remove null values
    
    const salespeopleNames = salespeople.map(salesperson => {
      if (typeof salesperson === 'string') {
        const foundSalesperson = associatedSalespeople.find(s => s.id === salesperson);
        console.log(`  - Looking for salesperson ${salesperson}, found:`, foundSalesperson);
        // Only return name if we found the salesperson, otherwise return null to filter out
        return foundSalesperson ? (foundSalesperson.fullName || foundSalesperson.name || foundSalesperson.displayName) : null;
      }
      return salesperson.name || salesperson.fullName || salesperson.displayName || salesperson.id;
    }).filter(Boolean); // Remove null values
    
    const allPeople = [...contactNames, ...salespeopleNames];
    
    console.log('  - Final people list:', allPeople);
    
    if (allPeople.length === 0) return '';
    
    if (allPeople.length <= 3) {
      return allPeople.join(', ');
    }
    
    // Show first 2-3 people and then count
    const displayCount = Math.min(3, allPeople.length);
    const displayed = allPeople.slice(0, displayCount).join(', ');
    const remaining = allPeople.length - displayCount;
    
    return `${displayed} +${remaining} more`;
  };

  const groupCompletedTasksByDate = (tasks: Task[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeekStart = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
    
    const groups = {
      today: [] as Task[],
      thisWeek: [] as Task[],
      earlier: [] as Task[]
    };
    
    tasks.forEach(task => {
      if (!task.completedAt) {
        groups.earlier.push(task);
        return;
      }
      
      const completedDate = new Date(task.completedAt);
      const completedDay = new Date(completedDate.getFullYear(), completedDate.getMonth(), completedDate.getDate());
      
      if (completedDay.getTime() === today.getTime()) {
        groups.today.push(task);
      } else if (completedDay >= thisWeekStart) {
        groups.thisWeek.push(task);
      } else {
        groups.earlier.push(task);
      }
    });
    
    return groups;
  };

    return (
    <Box sx={{ 
      display: 'flex', 
      gap: 3, 
      height: 'calc(100vh - 300px)',
      flexDirection: { xs: 'column', md: 'row' }
    }}>
      {/* Left Column - Todo Tasks (30%) */}
      <Box sx={{
        width: { xs: '100%', md: '30%' },
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Header with Filters */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ListIcon sx={{ color: 'primary.main', fontSize: '1.2rem' }} />
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              To-Dos
            </Typography>
            {todoTasks.length > 0 && (
              <Chip
                label={todoTasks.length}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.75rem', height: '20px' }}
              />
            )}
          </Box>
          <Button
            size="small"
            onClick={onCreateTask}
            sx={{ minWidth: 'auto' }}
          >
            + Todo
          </Button>
        </Box>

        {/* Filter Pills */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {[
            { key: 'open', label: 'Open' },
            { key: 'completed', label: 'Completed' }
          ].map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              size="small"
              variant={activeFilter === filter.key ? 'filled' : 'outlined'}
              onClick={() => setActiveFilter(filter.key as any)}
              sx={{ fontSize: '0.75rem' }}
            />
          ))}
        </Box>

        {/* Todo Tasks List - Compact Dense Style */}
        <Box sx={{
          flex: 1,
          overflowY: 'auto'
        }}>
          {todoTasks.length === 0 ? (
            <Card sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" color="text.secondary" sx={{ fontSize: '2rem' }}>
                  🎉
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                  {activeFilter === 'open' ? 'All caught up!' : 'No completed tasks yet'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {activeFilter === 'open' ? 'No tasks pending.' : 'Complete some tasks to see them here.'}
                </Typography>
                {activeFilter === 'open' && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={onCreateTask}
                    sx={{ mt: 1 }}
                  >
                    Add Task
                  </Button>
                )}
              </Box>
            </Card>
          ) : (
            <List sx={{ p: 0 }}>
              {todoTasks.map((task) => (
                <ListItemButton
                  key={task.id}
                  dense
                  onClick={() => onTaskClick(task)}
                  onMouseEnter={() => setHoveredTask(task.id)}
                  onMouseLeave={() => setHoveredTask(null)}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    boxShadow: 1,
                    py: 0.5, // Tightened vertical padding
                    px: 1,
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                      backgroundColor: 'action.hover'
                    },
                    transition: 'all 0.2s ease-in-out'
                  }}
                >
                  {/* Priority indicator bar - 2px */}
                  <Box
                    sx={{
                      width: 2,
                      bgcolor: getPriorityColor(task.priority),
                      borderRadius: 1,
                      mr: 0.5, // Reduced margin
                      height: '100%'
                    }}
                  />
                  
                  {/* Checkbox with tooltip */}
                  <Tooltip title={task.status === 'completed' ? 'Undo' : 'Mark Complete'}>
                    <Box onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        size="small"
                        checked={task.status === 'completed'}
                        onChange={(e) => {
                          e.stopPropagation();
                          onQuickComplete(task.id);
                        }}
                        sx={{
                          color: 'grey.400',
                          '&:hover': {
                            color: task.status === 'completed' ? 'warning.main' : 'success.main'
                          },
                          '&.Mui-checked': {
                            color: 'success.main'
                          }
                        }}
                      />
                    </Box>
                  </Tooltip>
                  
                  {/* Task Content - Compact Layout */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Title and Chips Row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        noWrap
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          color: task.status === 'completed' ? 'text.disabled' : 'text.primary',
                          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                          flex: 1
                        }}
                      >
                        {task.title}
                      </Typography>
                      
                      {/* Status and Priority Chips - Inline with title */}
                      <Stack direction="row" spacing={0.5}>
                        <Chip
                          label={getTaskStatusDisplay(task)}
                          size="small"
                          variant="filled"
                          sx={{ 
                            fontSize: '0.75rem', 
                            height: '18px',
                            bgcolor: getStatusChipBackground(task.status),
                            color: task.status.toLowerCase() === 'overdue' ? 'white' : 'text.primary'
                          }}
                        />
                        <Chip
                          label={task.priority}
                          size="small"
                          variant="outlined"
                          sx={{
                            fontSize: '0.75rem',
                            height: '18px',
                            borderColor: getPriorityColor(task.priority),
                            color: getPriorityColor(task.priority)
                          }}
                        />
                      </Stack>
                    </Box>
                    
                    {/* Description and metadata on hover - Only show if there's content */}
                    <Collapse in={hoveredTask === task.id && (!!task.description || !!task.assignedToName || ((task.associations?.contacts && task.associations.contacts.length > 0) || (task.associations?.salespeople && task.associations.salespeople.length > 0)))} timeout={200}>
                      <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                        {/* Description */}
                        {task.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: 'block',
                              lineHeight: 1.4,
                              mb: 0.5
                            }}
                          >
                            {task.description}
                          </Typography>
                        )}
                        
                        {/* Assigned Person */}
                        {task.assignedToName && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            <PersonIcon sx={{ fontSize: '0.7rem', color: 'text.secondary' }} />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontSize: '0.7rem' }}
                            >
                              {task.assignedToName}
                            </Typography>
                          </Box>
                        )}

                        {/* Associated People */}
                        {((task.associations?.contacts && task.associations.contacts.length > 0) || 
                          (task.associations?.salespeople && task.associations.salespeople.length > 0)) && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <BusinessIcon sx={{ fontSize: '0.7rem', color: 'text.secondary' }} />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontSize: '0.7rem' }}
                            >
                              {getAssociatedPeopleDisplay(task)}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Collapse>
                  </Box>
                  
                  {/* Kebab menu on hover */}
                  <Fade in={hoveredTask === task.id}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTask(task);
                      }}
                      sx={{ color: 'primary.main' }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Fade>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        {/* Completed Tasks Accordion - Only show when not in completed filter */}
        {activeFilter !== 'completed' && completedTasks.length > 0 && (
          <Accordion
            disableGutters
            expanded={showCompleted}
            onChange={() => setShowCompleted(!showCompleted)}
            sx={{
              boxShadow: 0,
              bgcolor: 'transparent',
              '&:before': { display: 'none' }
            }}
          >
            <AccordionSummary
              sx={{
                minHeight: 'auto',
                py: 1,
                '& .MuiAccordionSummary-content': {
                  margin: 0
                }
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                ✔ Completed ({completedTasks.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {(() => {
                const groupedTasks = groupCompletedTasksByDate(completedTasks);
                return (
                  <Box sx={{ p: 0 }}>
                    {groupedTasks.today.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5, fontWeight: 500 }}>
                          Today
                        </Typography>
                        <List sx={{ p: 0 }}>
                          {groupedTasks.today.map((task) => (
                            <ListItemButton
                              key={task.id}
                              dense
                              disabled
                              sx={{
                                borderRadius: 1,
                                mb: 0.5,
                                opacity: 0.7,
                                bgcolor: 'grey.50',
                                '&:hover': {
                                  bgcolor: 'grey.100'
                                }
                              }}
                            >
                              <CheckCircleIcon fontSize="small" color="success" sx={{ mr: 1 }} />
                              <Typography
                                variant="body2"
                                sx={{
                                  textDecoration: 'line-through',
                                  color: 'text.disabled',
                                  fontSize: '0.85rem'
                                }}
                              >
                                {task.title}
                              </Typography>
                            </ListItemButton>
                          ))}
                        </List>
                      </Box>
                    )}
                    
                    {groupedTasks.thisWeek.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5, fontWeight: 500 }}>
                          This Week
                        </Typography>
                        <List sx={{ p: 0 }}>
                          {groupedTasks.thisWeek.map((task) => (
                            <ListItemButton
                              key={task.id}
                              dense
                              disabled
                              sx={{
                                borderRadius: 1,
                                mb: 0.5,
                                opacity: 0.6,
                                bgcolor: 'grey.50',
                                '&:hover': {
                                  bgcolor: 'grey.100'
                                }
                              }}
                            >
                              <CheckCircleIcon fontSize="small" color="success" sx={{ mr: 1 }} />
                              <Typography
                                variant="body2"
                                sx={{
                                  textDecoration: 'line-through',
                                  color: 'text.disabled',
                                  fontSize: '0.85rem'
                                }}
                              >
                                {task.title}
                              </Typography>
                            </ListItemButton>
                          ))}
                        </List>
                      </Box>
                    )}
                    
                    {groupedTasks.earlier.length > 0 && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5, fontWeight: 500 }}>
                          Earlier
                        </Typography>
                        <List sx={{ p: 0 }}>
                          {groupedTasks.earlier.slice(0, 5).map((task) => (
                            <ListItemButton
                              key={task.id}
                              dense
                              disabled
                              sx={{
                                borderRadius: 1,
                                mb: 0.5,
                                opacity: 0.5,
                                bgcolor: 'grey.50',
                                '&:hover': {
                                  bgcolor: 'grey.100'
                                }
                              }}
                            >
                              <CheckCircleIcon fontSize="small" color="success" sx={{ mr: 1 }} />
                              <Typography
                                variant="body2"
                                sx={{
                                  textDecoration: 'line-through',
                                  color: 'text.disabled',
                                  fontSize: '0.85rem'
                                }}
                              >
                                {task.title}
                              </Typography>
                            </ListItemButton>
                          ))}
                          {groupedTasks.earlier.length > 5 && (
                            <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5, fontStyle: 'italic' }}>
                              +{groupedTasks.earlier.length - 5} more
                            </Typography>
                          )}
                        </List>
                      </Box>
                    )}
                  </Box>
                );
              })()}
            </AccordionDetails>
          </Accordion>
        )}


      </Box>

      {/* Vertical Divider - Hidden on mobile */}
      <Divider 
        orientation="vertical" 
        flexItem 
        sx={{ display: { xs: 'none', md: 'block' } }}
      />

      {/* Right Column - Appointments (70%) */}
      <Box sx={{
        width: { xs: '100%', md: '70%' },
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <EventIcon sx={{ color: 'primary.main', fontSize: '1.2rem' }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Appointments
          </Typography>
          {appointmentTasks.length > 0 && (
            <Chip
              label={appointmentTasks.length}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.75rem', height: '20px' }}
            />
          )}
        </Box>

        {/* Appointments List - Agenda Style */}
        <Box sx={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5
        }}>
          {appointmentTasks.length === 0 ? (
            <Card sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" color="text.secondary" sx={{ fontSize: '2rem' }}>
                  📅
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                  No appointments scheduled
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Schedule meetings and calls to see them here.
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={onCreateTask}
                  sx={{ mt: 1 }}
                >
                  Add Appointment
                </Button>
              </Box>
            </Card>
          ) : (
            appointmentTasks.map((task) => (
              <Grow key={task.id} in={true} timeout={300}>
                <Card
                  sx={{
                    p: 1.5, // Reduced padding for better balance
                    borderRadius: 2,
                    boxShadow: 1,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: 3,
                      backgroundColor: 'action.hover'
                    },
                    ...(isTaskOverdue(task.startTime || '') && {
                      bgcolor: 'rgba(244, 67, 54, 0.06)',
                      borderColor: 'error.main'
                    })
                  }}
                  onClick={() => onTaskClick(task)}
                  onMouseEnter={() => setHoveredTask(task.id)}
                  onMouseLeave={() => setHoveredTask(null)}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    {/* Left rail: Calendar icon + date */}
                    <Box sx={{ minWidth: 'fit-content', textAlign: 'center' }}>
                      <CalendarMonthIcon
                        fontSize="small"
                        sx={{
                          color: isTaskOverdue(task.startTime || '') ? 'error.main' : 'text.secondary',
                          mb: 0.5,
                          opacity: 0.7
                        }}
                      />
                      {task.startTime && (() => {
                        const dateInfo = formatAppointmentDate(task.startTime);
                        if (!dateInfo) return null;
                        
                        const { dayFormat, relativeText, isToday } = dateInfo;
                        return (
                          <>
                            <Typography 
                              fontWeight={600} 
                              sx={{ 
                                fontSize: '0.85rem',
                                ...(isToday && {
                                  bgcolor: 'alpha(primary.main, 0.06)',
                                  px: 1,
                                  py: 0.25,
                                  borderRadius: 1
                                })
                              }}
                            >
                              {dayFormat}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                              {relativeText}
                            </Typography>
                          </>
                        );
                      })()}
                    </Box>

                    {/* Center: Task content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap sx={{ fontSize: '0.95rem' }}>
                        {task.title}
                      </Typography>
                      
                      {/* Time and Duration */}
                      {task.startTime && task.duration && (
                        <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.85rem' }}>
                          {(() => {
                            const startTime = new Date(task.startTime);
                            const endTime = new Date(startTime.getTime() + task.duration * 60000);
                            return `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                          })()}
                        </Typography>
                      )}
                      
                      {task.description && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {task.description}
                        </Typography>
                      )}
                      
                      {/* Google Meet Button */}
                      {task.googleMeetLink && (
                        <Box sx={{ mt: 0.5 }}>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<VideoCallIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(task.googleMeetLink, '_blank');
                            }}
                            sx={{
                              bgcolor: '#4285f4', // Google Meet blue
                              color: 'white',
                              fontSize: '0.75rem',
                              py: 0.25,
                              px: 1,
                              minWidth: 'auto',
                              '&:hover': {
                                bgcolor: '#3367d6'
                              }
                            }}
                          >
                            Join Meeting
                          </Button>
                        </Box>
                      )}
                      
                      {/* Associated People - Company Contacts and Salespeople */}
                      {((task.associations?.contacts && task.associations.contacts.length > 0) || 
                        (task.associations?.salespeople && task.associations.salespeople.length > 0)) && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <BusinessIcon sx={{ fontSize: '0.8rem', color: 'text.secondary' }} />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: '0.7rem' }}
                          >
                            {getAssociatedPeopleDisplay(task)}
                          </Typography>
                        </Box>
                      )}
                      
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Chip
                          label={getTaskStatusDisplay(task)}
                          size="small"
                          variant={getStatusChipVariant(getTaskStatusDisplay(task))}
                          color={getStatusChipColor(getTaskStatusDisplay(task))}
                        />
                        <Chip
                          label={task.priority}
                          size="small"
                          variant="outlined"
                        />
                        {task.aiSuggested && (
                          <Chip
                            label="AI Suggested"
                            size="small"
                            color="primary"
                            variant="outlined"
                            icon={<PsychologyIcon />}
                          />
                        )}
                      </Stack>
                    </Box>

                    {/* Right: CTA area */}
                    <Stack direction="row" spacing={1}>
                      {task.googleMeetLink ? (
                        <Button 
                          size="small" 
                          variant="contained"
                          startIcon={<VideoCallIcon />}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(task.googleMeetLink, '_blank');
                          }}
                          sx={{
                            bgcolor: '#4285f4', // Google Meet blue
                            color: 'white',
                            '&:hover': {
                              bgcolor: '#3367d6'
                            }
                          }}
                        >
                          Join Meeting
                        </Button>
                      ) : (
                        <Button size="small" variant="contained">
                          Open
                        </Button>
                      )}
                      <Fade in={hoveredTask === task.id}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditTask(task);
                          }}
                          sx={{ color: 'primary.main' }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Fade>
                    </Stack>
                  </Stack>
                  
                  {/* Expanded hover state for meeting details */}
                  <Collapse in={hoveredTask === task.id} timeout={200}>
                    <Box sx={{ 
                      mt: 1, 
                      pt: 1, 
                      borderTop: '1px solid', 
                      borderColor: 'divider',
                      backgroundColor: 'background.paper'
                    }}>
                      {/* Meeting Details */}
                      {(task.agenda || task.goals || task.meetingAttendees) && (
                        <Box sx={{ mb: 1 }}>
                          {task.agenda && (
                            <Box sx={{ mb: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                                Agenda:
                              </Typography>
                              <Typography variant="caption" color="text.primary" sx={{ fontSize: '0.7rem', display: 'block' }}>
                                {task.agenda}
                              </Typography>
                            </Box>
                          )}
                          
                          {task.goals && task.goals.length > 0 && (
                            <Box sx={{ mb: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                                Goals:
                              </Typography>
                              {task.goals.map((goal, index) => (
                                <Typography key={index} variant="caption" color="text.primary" sx={{ fontSize: '0.7rem', display: 'block' }}>
                                  • {goal}
                                </Typography>
                              ))}
                            </Box>
                          )}
                          
                          {task.meetingAttendees && task.meetingAttendees.length > 0 && (
                            <Box>
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                                Attendees ({task.meetingAttendees.length}):
                              </Typography>
                              {task.meetingAttendees.slice(0, 3).map((attendee, index) => (
                                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography variant="caption" color="text.primary" sx={{ fontSize: '0.7rem' }}>
                                    {attendee.displayName || attendee.email}
                                  </Typography>
                                  {attendee.responseStatus && attendee.responseStatus !== 'needsAction' && (
                                    <Chip
                                      label={attendee.responseStatus}
                                      size="small"
                                      variant="outlined"
                                      sx={{ 
                                        fontSize: '0.6rem', 
                                        height: '16px',
                                        color: attendee.responseStatus === 'accepted' ? 'success.main' : 
                                               attendee.responseStatus === 'declined' ? 'error.main' : 'warning.main'
                                      }}
                                    />
                                  )}
                                </Box>
                              ))}
                              {task.meetingAttendees.length > 3 && (
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                  +{task.meetingAttendees.length - 3} more
                                </Typography>
                              )}
                            </Box>
                          )}
                        </Box>
                      )}
                      
                      {/* Task Type Specific Info */}
                      {task.type === 'research' && task.researchTopics && task.researchTopics.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                            Research Topics:
                          </Typography>
                          {task.researchTopics.map((topic, index) => (
                            <Typography key={index} variant="caption" color="text.primary" sx={{ fontSize: '0.7rem', display: 'block' }}>
                              • {topic}
                            </Typography>
                          ))}
                        </Box>
                      )}
                      
                      {task.type === 'phone_call' && task.callScript && (
                        <Box sx={{ mb: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                            Call Script:
                          </Typography>
                          <Typography variant="caption" color="text.primary" sx={{ fontSize: '0.7rem', display: 'block' }}>
                            {task.callScript}
                          </Typography>
                        </Box>
                      )}
                      
                      {task.type === 'email' && task.emailTemplate && (
                        <Box sx={{ mb: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                            Email Template:
                          </Typography>
                          <Typography variant="caption" color="text.primary" sx={{ fontSize: '0.7rem', display: 'block' }}>
                            {task.emailTemplate}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Collapse>
                </Card>
              </Grow>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default EnhancedTasksLayout;
