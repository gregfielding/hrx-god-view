import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  Lightbulb as LightbulbIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  TrendingUp as TrendingUpIcon,
  ExpandMore as ExpandMoreIcon,
  Task as TaskIcon,
  Psychology as PsychologyIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { TaskClassification } from '../types/Tasks';

interface AISuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  estimatedDuration: number;
  associations: any;
  aiGenerated: boolean;
  aiPrompt: string;
  aiReason?: string;
  fieldName?: string;
  fieldDescription?: string;
}

interface AISuggestionsWithClassificationProps {
  suggestions: AISuggestion[];
  onTaskCreated?: (taskId: string, classification: TaskClassification) => void;
  onRefresh?: () => void;
}

const AISuggestionsWithClassification: React.FC<AISuggestionsWithClassificationProps> = ({
  suggestions,
  onTaskCreated,
  onRefresh
}) => {
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());
  const [selectedClassifications, setSelectedClassifications] = useState<Record<string, TaskClassification>>({});

  const functions = getFunctions();
  const createTask = httpsCallable(functions, 'createTask');

  const handleClassificationChange = (suggestionId: string, classification: TaskClassification) => {
    setSelectedClassifications(prev => ({
      ...prev,
      [suggestionId]: classification
    }));
  };

  const handleCreateTask = async (suggestion: AISuggestion) => {
    const taskId = `${suggestion.type}_${Date.now()}`;
    setCreatingTasks(prev => new Set(prev).add(taskId));

    try {
      // Get the selected classification or determine based on task type
      let classification = selectedClassifications[suggestion.id] || 'todo';
      const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
      
      // If no classification was selected, determine based on task type
      if (!selectedClassifications[suggestion.id]) {
        if (appointmentTypes.includes(suggestion.type)) {
          classification = 'appointment';
        }
      }

      const result = await createTask({
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        priority: suggestion.priority,
        status: 'scheduled',
        classification,
        startTime: classification === 'appointment' ? new Date().toISOString() : null,
        duration: classification === 'appointment' ? 60 : null, // Default 1 hour for appointments
        scheduledDate: new Date().toISOString(),
        assignedTo: 'current-user', // This will be set by the backend
        createdBy: 'current-user', // This will be set by the backend
        tenantId: 'current-tenant', // This will be set by the backend
        category: suggestion.category,
        quotaCategory: suggestion.category,
        associations: suggestion.associations,
        aiSuggested: true,
        aiPrompt: suggestion.aiPrompt || suggestion.aiReason || ''
      });

      const data = result.data as any;
      if (data.success) {
        onTaskCreated?.(data.taskId, classification);
      }
    } catch (err) {
      console.error('Error creating task:', err);
    } finally {
      setCreatingTasks(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const getTaskIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon />;
      case 'phone_call': return <PhoneIcon />;
      case 'scheduled_meeting_virtual':
      case 'scheduled_meeting_in_person': return <ScheduleIcon />;
      case 'demo': return <BusinessIcon />;
      case 'presentation': return <TrendingUpIcon />;
      default: return <TaskIcon />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      case 'low': return 'default';
      default: return 'default';
    }
  };

  const getSuggestedClassification = (suggestion: AISuggestion): TaskClassification => {
    const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
    return appointmentTypes.includes(suggestion.type) ? 'appointment' : 'todo';
  };

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body1" color="textSecondary" align="center">
            No AI suggestions available
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <LightbulbIcon color="primary" />
        <Typography variant="h6">AI Task Suggestions</Typography>
        <Chip label={suggestions.length} size="small" color="primary" />
      </Box>

      <List>
        {suggestions.map((suggestion, index) => {
          const suggestedClassification = getSuggestedClassification(suggestion);
          const currentClassification = selectedClassifications[suggestion.id] || suggestedClassification;
          
          return (
            <Card key={index} sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      {getTaskIcon(suggestion.type)}
                      <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                        {suggestion.title}
                      </Typography>
                      <Chip
                        label={suggestion.priority}
                        color={getPriorityColor(suggestion.priority) as any}
                        size="small"
                      />
                    </Box>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                      {suggestion.description}
                    </Typography>
                    
                    {suggestion.aiReason && (
                      <Typography variant="caption" color="info.main" sx={{ display: 'block', mb: 1 }}>
                        AI Reason: {suggestion.aiReason}
                      </Typography>
                    )}

                    {/* Classification Toggle */}
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 1 }}>
                        Task Type:
                      </Typography>
                      <ToggleButtonGroup
                        value={currentClassification}
                        exclusive
                        onChange={(_, value) => value && handleClassificationChange(suggestion.id, value)}
                        size="small"
                      >
                        <ToggleButton value="todo">
                          <CheckCircleIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                          To-Do
                        </ToggleButton>
                        <ToggleButton value="appointment">
                          <ScheduleIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                          Appointment
                        </ToggleButton>
                      </ToggleButtonGroup>
                      
                      {currentClassification === 'appointment' && (
                        <Alert severity="info" sx={{ mt: 1, fontSize: '0.75rem' }}>
                          Will sync to Google Calendar
                        </Alert>
                      )}
                      
                      {currentClassification === 'todo' && (
                        <Alert severity="info" sx={{ mt: 1, fontSize: '0.75rem' }}>
                          Will sync to Google Tasks
                        </Alert>
                      )}
                    </Box>
                  </Box>
                  
                  <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
                    <Tooltip title={`Add as ${currentClassification === 'appointment' ? 'Appointment' : 'To-Do Item'}`}>
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleCreateTask(suggestion)}
                        disabled={creatingTasks.has(`${suggestion.type}_${index}`)}
                      >
                        {creatingTasks.has(`${suggestion.type}_${index}`) ? (
                          <CircularProgress size={20} />
                        ) : (
                          <AddIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </List>
    </Box>
  );
};

export default AISuggestionsWithClassification;
