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
  Business as BusinessIcon
} from '@mui/icons-material';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  type: string;
  classification?: string;
  startTime?: string;
  duration?: number;
  scheduledDate?: string;
  dueDate?: string;
  aiSuggested?: boolean;
  completedAt?: string;
  assignedTo?: string;
  assignedToName?: string;
  associations?: {
    contacts?: (string | any)[];
    companies?: (string | any)[];
    salespeople?: (string | any)[];
  };
  googleMeetLink?: string;
  googleMeetConferenceId?: string;
  meetingAttendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
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
  showOnlyTodos?: boolean;
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
  associatedSalespeople = [],
  showOnlyTodos = false
}) => {
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [expandedTodos, setExpandedTodos] = useState<Set<string>>(new Set());

  // Debug logging
  console.log('🔍 EnhancedTasksLayout debug:', {
    tasksCount: tasks.length,
    associatedContactsCount: associatedContacts.length,
    associatedContacts: associatedContacts,
    deal: deal
  });

  const allTodoTasks = tasks.filter(task => task.classification === 'todo');
  const appointmentTasks = tasks.filter(task => task.classification === 'appointment' && task.status !== 'completed');
  
  const openTasks = allTodoTasks
    .filter(task => task.status !== 'completed')
    .sort((a, b) => {
      const dateA = (a.classification === 'todo' ? a.dueDate : a.scheduledDate) ? new Date((a.classification === 'todo' ? a.dueDate : a.scheduledDate) + 'T00:00:00').getTime() : 0;
      const dateB = (b.classification === 'todo' ? b.dueDate : b.scheduledDate) ? new Date((b.classification === 'todo' ? b.dueDate : b.scheduledDate) + 'T00:00:00').getTime() : 0;
      return dateB - dateA;
    });
  
  const completedTasks = allTodoTasks
    .filter(task => task.status === 'completed')
    .sort((a, b) => {
      const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return dateB - dateA;
    });

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

  const getStatusChipBackground = (status: string) => {
    switch (status.toLowerCase()) {
      case 'past due': return 'error.main';
      case 'overdue': return 'error.main';
      case 'completed': return 'success.main';
      case 'scheduled': return 'info.main';
      case 'due': return 'warning.main';
      default: return 'grey.300';
    }
  };

  const isTaskOverdue = (startTime: string) => {
    const now = new Date();
    const taskTime = new Date(startTime);
    return taskTime < now;
  };

  const formatAppointmentDate = (startTime: string) => {
    if (!startTime) return null;
    const date = new Date(startTime);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    const dayFormat = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
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
    
    const contactNames = contacts.map(contact => {
      if (typeof contact === 'string') {
        const foundContact = associatedContacts.find(c => c.id === contact);
        return foundContact ? (foundContact.fullName || foundContact.name) : null;
      }
      return contact.name || contact.fullName || contact.id;
    }).filter(Boolean);
    
    const salespeopleNames = salespeople.map(salesperson => {
      if (typeof salesperson === 'string') {
        const foundSalesperson = associatedSalespeople.find(s => s.id === salesperson);
        return foundSalesperson ? (foundSalesperson.fullName || foundSalesperson.name || foundSalesperson.displayName) : null;
      }
      return salesperson.name || salesperson.fullName || salesperson.displayName || salesperson.id;
    }).filter(Boolean);
    
    const allPeople = [...contactNames, ...salespeopleNames];
    
    if (allPeople.length === 0) return '';
    
    if (allPeople.length <= 3) {
      return allPeople.join(', ');
    }
    
    const displayCount = Math.min(3, allPeople.length);
    const displayed = allPeople.slice(0, displayCount).join(', ');
    const remaining = allPeople.length - displayCount;
    
    return `${displayed} +${remaining} more`;
  };

  return (
    <Box sx={{ 
      display: 'flex', 
      gap: 3, 
      flexDirection: { xs: 'column', md: 'row' }
    }}>
      <Box sx={{
        width: { xs: '100%', md: showOnlyTodos ? '100%' : '30%' },
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>


        <Box sx={{
          flex: 1
        }}>
          {(openTasks.length + completedTasks.length) === 0 ? (
            <Card sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" color="text.secondary" sx={{ fontSize: '2rem' }}>
                  🎉
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                  All caught up!
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  No tasks pending.
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={onCreateTask}
                  sx={{ mt: 1 }}
                >
                  Add Task
                </Button>
              </Box>
            </Card>
          ) : (
            <List sx={{ p: 0 }}>
              {openTasks.map((task) => (
                <Box
                  key={task.id}
                  sx={{
                    mb: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'grey.200',
                    bgcolor: 'white',
                    overflow: 'hidden',
                    '&:hover': {
                      borderColor: 'grey.300',
                      bgcolor: 'grey.50'
                    },
                    transition: 'all 0.2s ease-in-out'
                  }}
                  onMouseEnter={() => setHoveredTask(task.id)}
                  onMouseLeave={() => setHoveredTask(null)}
                >
                  {/* Main task row */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      p: 2,
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={task.status === 'completed'}
                      onChange={(e) => {
                        e.stopPropagation();
                        onQuickComplete(task.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
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
                    
                    <Typography
                      sx={{
                        flex: 1,
                        ml: 1,
                        fontWeight: 400,
                        fontSize: '0.9rem',
                        color: task.status === 'completed' ? 'text.disabled' : 'text.primary',
                        textDecoration: task.status === 'completed' ? 'line-through' : 'none'
                      }}
                    >
                      {task.title}
                    </Typography>
                    
                    {/* Status indicator on the right */}
                    {task.status === 'overdue' && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'error.main',
                          fontWeight: 500,
                          fontSize: '0.75rem'
                        }}
                      >
                        Required
                      </Typography>
                    )}
                    
                    {/* Edit button on hover */}
                    <Fade in={hoveredTask === task.id}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                        sx={{ 
                          color: 'primary.main',
                          ml: 1
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Fade>
                  </Box>

                  {/* Expanded details on hover */}
                  <Collapse in={hoveredTask === task.id}>
                    <Box
                      sx={{
                        px: 2,
                        pb: 2,
                        borderTop: '1px solid',
                        borderColor: 'grey.100',
                        bgcolor: 'grey.25'
                      }}
                    >
                      {/* Description */}
                      {task.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mb: 1, fontSize: '0.8rem' }}
                        >
                          {task.description}
                        </Typography>
                      )}

                      {/* Due date */}
                      {task.dueDate && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'text.secondary',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            📅 Due: {new Date(task.dueDate).toLocaleDateString()}
                          </Typography>
                        </Box>
                      )}

                      {/* Status and Priority chips */}
                      <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <Chip
                          label={getTaskStatusDisplay(task)}
                          size="small"
                          sx={{
                            fontSize: '0.7rem',
                            height: '20px',
                            bgcolor: getStatusChipBackground(getTaskStatusDisplay(task)),
                            color: 'white'
                          }}
                        />
                        <Chip
                          label={task.priority}
                          size="small"
                          sx={{
                            fontSize: '0.7rem',
                            height: '20px',
                            bgcolor: getPriorityColor(task.priority),
                            color: 'white',
                            textTransform: 'capitalize'
                          }}
                        />
                      </Box>

                      {/* Assigned salespeople */}
                      {task.assignedToName && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'text.secondary',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            👤 Assigned: {task.assignedToName}
                          </Typography>
                        </Box>
                      )}

                      {/* Associated contacts */}
                      {task.associations?.contacts && task.associations.contacts.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'text.secondary',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            👥 Contacts: {task.associations.contacts.map((contactId: any, index: number) => {
                              // Find the contact name from associatedContacts prop
                              const contact = associatedContacts?.find(c => c.id === contactId || c.uid === contactId);
                              if (contact) {
                                const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'Unknown';
                                const lastName = contact?.lastName || contact?.name?.split(' ').slice(1).join(' ') || '';
                                const fullName = lastName ? `${firstName} ${lastName}` : firstName;
                                
                                return (
                                  <span key={index}>
                                    {index > 0 ? ', ' : ''}{fullName}
                                  </span>
                                );
                              } else {
                                // Fallback to contact ID if name not found
                                return (
                                  <span key={index}>
                                    {index > 0 ? ', ' : ''}{contactId}
                                  </span>
                                );
                              }
                            })}
                          </Typography>
                        </Box>
                      )}

                      {/* Associated companies */}
                      {task.associations?.companies && task.associations.companies.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'text.secondary',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            🏢 Companies: {task.associations.companies.length} associated
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Collapse>
                </Box>
              ))}
              
              {completedTasks.length > 0 && (
                <>
                  <Box sx={{ mt: 2, mb: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, px: 1 }}>
                      ✔ Completed ({completedTasks.length})
                    </Typography>
                  </Box>
                  {completedTasks.map((task) => (
                    <Box
                      key={task.id}
                      sx={{
                        mb: 1,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'grey.200',
                        bgcolor: 'grey.50',
                        opacity: 0.7,
                        overflow: 'hidden',
                        '&:hover': {
                          borderColor: 'grey.300',
                          bgcolor: 'grey.100'
                        },
                        transition: 'all 0.2s ease-in-out'
                      }}
                      onMouseEnter={() => setHoveredTask(task.id)}
                      onMouseLeave={() => setHoveredTask(null)}
                    >
                      {/* Main task row */}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          p: 2,
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={true}
                          onChange={(e) => {
                            e.stopPropagation();
                            onQuickComplete(task.id);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          sx={{
                            color: 'success.main',
                            '&:hover': {
                              color: 'warning.main'
                            },
                            '&.Mui-checked': {
                              color: 'success.main'
                            }
                          }}
                        />
                        
                        <Typography
                          sx={{
                            flex: 1,
                            ml: 1,
                            fontWeight: 400,
                            fontSize: '0.9rem',
                            color: 'text.disabled',
                            textDecoration: 'line-through'
                          }}
                        >
                          {task.title}
                        </Typography>
                        
                        {task.completedAt && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: '0.75rem' }}
                          >
                            {(() => {
                              try {
                                const completedAt = task.completedAt;
                                
                                if (!completedAt) return 'Recently';
                                
                                if (typeof completedAt === 'object' && completedAt !== null) {
                                  const timestamp = completedAt as any;
                                  if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
                                    return timestamp.toDate().toLocaleDateString();
                                  }
                                }
                                if (typeof completedAt === 'string') {
                                  return new Date(completedAt).toLocaleDateString();
                                }
                                if (typeof completedAt === 'number') {
                                  return new Date(completedAt).toLocaleDateString();
                                }
                                return 'Recently';
                              } catch (error) {
                                console.warn('Error formatting completion date:', error);
                                return 'Recently';
                              }
                            })()}
                          </Typography>
                        )}
                        
                        <Fade in={hoveredTask === task.id}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditTask(task);
                            }}
                            sx={{ 
                              color: 'primary.main',
                              ml: 1
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Fade>
                      </Box>

                      {/* Expanded details on hover */}
                      <Collapse in={hoveredTask === task.id}>
                        <Box
                          sx={{
                            px: 2,
                            pb: 2,
                            borderTop: '1px solid',
                            borderColor: 'grey.100',
                            bgcolor: 'grey.75'
                          }}
                        >
                          {/* Description */}
                          {task.description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mb: 1, fontSize: '0.8rem' }}
                            >
                              {task.description}
                            </Typography>
                          )}

                          {/* Due date */}
                          {task.dueDate && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                📅 Due: {new Date(task.dueDate).toLocaleDateString()}
                              </Typography>
                            </Box>
                          )}

                          {/* Status and Priority chips */}
                          <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                            <Chip
                              label={getTaskStatusDisplay(task)}
                              size="small"
                              sx={{
                                fontSize: '0.7rem',
                                height: '20px',
                                bgcolor: getStatusChipBackground(getTaskStatusDisplay(task)),
                                color: 'white'
                              }}
                            />
                            <Chip
                              label={task.priority}
                              size="small"
                              sx={{
                                fontSize: '0.7rem',
                                height: '20px',
                                bgcolor: getPriorityColor(task.priority),
                                color: 'white',
                                textTransform: 'capitalize'
                              }}
                            />
                          </Box>

                          {/* Assigned salespeople */}
                          {task.assignedToName && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                👤 Assigned: {task.assignedToName}
                              </Typography>
                            </Box>
                          )}

                          {/* Associated contacts */}
                          {task.associations?.contacts && task.associations.contacts.length > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                👥 Contacts: {task.associations.contacts.map((contactId: any, index: number) => {
                                  // Find the contact name from associatedContacts prop
                                  const contact = associatedContacts?.find(c => c.id === contactId || c.uid === contactId);
                                  if (contact) {
                                    const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'Unknown';
                                    const lastName = contact?.lastName || contact?.name?.split(' ').slice(1).join(' ') || '';
                                    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
                                    
                                    return (
                                      <span key={index}>
                                        {index > 0 ? ', ' : ''}{fullName}
                                      </span>
                                    );
                                  } else {
                                    // Fallback to contact ID if name not found
                                    return (
                                      <span key={index}>
                                        {index > 0 ? ', ' : ''}{contactId}
                                      </span>
                                    );
                                  }
                                })}
                              </Typography>
                            </Box>
                          )}

                          {/* Associated companies */}
                          {task.associations?.companies && task.associations.companies.length > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <BusinessIcon fontSize="small" color="action" sx={{ mr: 0.5 }} />
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                Company: {task.associations.companies.map((companyId: any, index: number) => {
                                  // Try to find company name from associatedCompany or companies array
                                  let companyName = companyId; // fallback to ID
                                  
                                  // Check if we have an associatedCompany prop (from deal context)
                                  if (deal?.companyName) {
                                    companyName = deal.companyName;
                                  } else if (deal?.company?.name) {
                                    companyName = deal.company.name;
                                  }
                                  
                                  return (
                                    <span key={index}>
                                      {index > 0 ? ', ' : ''}{companyName}
                                    </span>
                                  );
                                })}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    </Box>
                  ))}
                </>
              )}
            </List>
          )}
        </Box>
      </Box>

      {!showOnlyTodos && (
        <>
          <Divider 
            orientation="vertical" 
            flexItem 
            sx={{ display: { xs: 'none', md: 'block' } }}
          />

          <Box sx={{
            width: { xs: '100%', md: '70%' },
            display: 'flex',
            flexDirection: 'column'
          }}>
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

            <Box sx={{
              flex: 1,
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
                    <Box
                      sx={{
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'grey.200',
                        bgcolor: 'white',
                        overflow: 'hidden',
                        '&:hover': {
                          borderColor: 'grey.300',
                          bgcolor: 'grey.50'
                        },
                        transition: 'all 0.2s ease-in-out',
                        ...(isTaskOverdue(task.startTime || '') && {
                          bgcolor: 'rgba(244, 67, 54, 0.06)',
                          borderColor: 'error.main'
                        })
                      }}
                      onMouseEnter={() => setHoveredTask(task.id)}
                      onMouseLeave={() => setHoveredTask(null)}
                    >
                      {/* Main appointment row */}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          p: 2,
                        }}
                      >
                        <Box sx={{ minWidth: 'fit-content', textAlign: 'center', mr: 1.5 }}>
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

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography fontWeight={600} sx={{ fontSize: '0.95rem' }}>
                            {task.title}
                          </Typography>
                          
                          {task.startTime && task.duration && (
                            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.85rem' }}>
                              {(() => {
                                const startTime = new Date(task.startTime);
                                const endTime = new Date(startTime.getTime() + task.duration * 60000);
                                return `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                              })()}
                            </Typography>
                          )}
                        </Box>

                        {/* Edit button on hover */}
                        <Fade in={hoveredTask === task.id}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditTask(task);
                            }}
                            sx={{ 
                              color: 'primary.main',
                              ml: 1
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Fade>
                      </Box>

                      {/* Expanded details on hover */}
                      <Collapse in={hoveredTask === task.id}>
                        <Box
                          sx={{
                            px: 2,
                            pb: 2,
                            borderTop: '1px solid',
                            borderColor: 'grey.100',
                            bgcolor: 'grey.25'
                          }}
                        >
                          {/* Description */}
                          {task.description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mb: 1, fontSize: '0.8rem' }}
                            >
                              {task.description}
                            </Typography>
                          )}

                          {/* Status and Priority chips */}
                          <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                            <Chip
                              label={getTaskStatusDisplay(task)}
                              size="small"
                              sx={{
                                fontSize: '0.7rem',
                                height: '20px',
                                bgcolor: getStatusChipBackground(getTaskStatusDisplay(task)),
                                color: 'white'
                              }}
                            />
                            <Chip
                              label={task.priority}
                              size="small"
                              sx={{
                                fontSize: '0.7rem',
                                height: '20px',
                                bgcolor: getPriorityColor(task.priority),
                                color: 'white',
                                textTransform: 'capitalize'
                              }}
                            />
                          </Box>

                          {/* Assigned salespeople */}
                          {task.assignedToName && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                👤 Assigned: {task.assignedToName}
                              </Typography>
                            </Box>
                          )}

                          {/* Associated contacts */}
                          {task.associations?.contacts && task.associations.contacts.length > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                👥 Contacts: {task.associations.contacts.map((contactId: any, index: number) => {
                                  // Find the contact name from associatedContacts prop
                                  const contact = associatedContacts?.find(c => c.id === contactId || c.uid === contactId);
                                  if (contact) {
                                    const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'Unknown';
                                    const lastName = contact?.lastName || contact?.name?.split(' ').slice(1).join(' ') || '';
                                    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
                                    
                                    return (
                                      <span key={index}>
                                        {index > 0 ? ', ' : ''}{fullName}
                                      </span>
                                    );
                                  } else {
                                    // Fallback to contact ID if name not found
                                    return (
                                      <span key={index}>
                                        {index > 0 ? ', ' : ''}{contactId}
                                      </span>
                                    );
                                  }
                                })}
                              </Typography>
                            </Box>
                          )}

                          {/* Associated companies */}
                          {task.associations?.companies && task.associations.companies.length > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                🏢 Companies: {task.associations.companies.length} associated
                              </Typography>
                            </Box>
                          )}

                          {/* Google Meet Link */}
                          {task.googleMeetLink && (
                            <Box sx={{ mt: 1 }}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<VideoCallIcon />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(task.googleMeetLink, '_blank');
                                }}
                                sx={{
                                  bgcolor: '#4285f4',
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
                        </Box>
                      </Collapse>
                    </Box>
                  </Grow>
                ))
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};

export default EnhancedTasksLayout;
