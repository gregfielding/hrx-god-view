import React, { useState, useEffect } from 'react';
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
  IconButton,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Lightbulb as LightbulbIcon,
  Assignment as AssignmentIcon,
  Business as BusinessIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';

interface UnifiedSuggestion {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  estimatedDuration: number;
  associations: {
    deals?: string[];
    companies?: string[];
    contacts?: string[];
  };
  aiGenerated: boolean;
  aiReason: string;
  aiConfidence: number;
  source: 'stage_requirements' | 'productivity' | 'deal_specific' | 'quota';
  fieldName?: string;
  stage?: string;
}

interface UnifiedAISuggestionsProps {
  tenantId: string;
  dealId?: string;
  onTaskCreated?: (taskId: string) => void;
  onRefresh?: () => void;
}

const UnifiedAISuggestions: React.FC<UnifiedAISuggestionsProps> = ({
  tenantId,
  dealId,
  onTaskCreated,
  onRefresh
}) => {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<UnifiedSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());

  const functions = getFunctions();
  const getUnifiedAISuggestions = httpsCallable(functions, 'getUnifiedAISuggestions');
  const createTask = httpsCallable(functions, 'createTask');

  useEffect(() => {
    loadSuggestions();
  }, [dealId, tenantId]);

  const loadSuggestions = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const result = await getUnifiedAISuggestions({
        userId: user.uid,
        tenantId,
        filters: dealId ? { dealId } : {}
      });

      const data = result.data as any;
      if (data.success) {
        setSuggestions(data.suggestions || []);
      } else {
        setError('Failed to load AI suggestions');
      }
    } catch (err) {
      console.error('Error loading unified AI suggestions:', err);
      setError('Failed to load AI suggestions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (suggestion: UnifiedSuggestion) => {
    if (!user) return;

    const taskId = `${suggestion.type}_${Date.now()}`;
    setCreatingTasks(prev => new Set(prev).add(taskId));

    try {
      // Determine classification based on task type
      let classification: 'todo' | 'appointment' = 'todo';
      const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
      if (appointmentTypes.includes(suggestion.type)) {
        classification = 'appointment';
      }

      const result = await createTask({
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        priority: suggestion.priority,
        status: 'scheduled',
        classification, // Add classification
        startTime: classification === 'appointment' ? new Date().toISOString() : null,
        duration: classification === 'appointment' ? 60 : null, // Default 1 hour for appointments
        scheduledDate: new Date().toISOString(),
        assignedTo: user.uid,
        createdBy: user.uid,
        tenantId,
        category: suggestion.category,
        quotaCategory: suggestion.category,
        associations: suggestion.associations,
        aiSuggested: true,
        aiPrompt: suggestion.aiReason
      });

      const data = result.data as any;
      if (data.success) {
        onTaskCreated?.(data.taskId);
        // Remove the suggestion from the list
        setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
      }
    } catch (err) {
      console.error('Error creating task:', err);
      setError('Failed to create task');
    } finally {
      setCreatingTasks(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
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

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'stage_requirements': return <CheckCircleIcon />;
      case 'productivity': return <TrendingUpIcon />;
      case 'deal_specific': return <BusinessIcon />;
      case 'quota': return <ScheduleIcon />;
      default: return <LightbulbIcon />;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'stage_requirements': return 'success';
      case 'productivity': return 'primary';
      case 'deal_specific': return 'info';
      case 'quota': return 'warning';
      default: return 'default';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon />;
      case 'phone_call': return <PhoneIcon />;
      case 'meeting': return <AssignmentIcon />;
      case 'research': return <BusinessIcon />;
      case 'field_completion': return <CheckCircleIcon />;
      default: return <AssignmentIcon />;
    }
  };

  const groupSuggestionsBySource = () => {
    const grouped: { [key: string]: UnifiedSuggestion[] } = {};
    
    suggestions.forEach(suggestion => {
      const source = suggestion.source;
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(suggestion);
    });

    return grouped;
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'stage_requirements': return 'Stage Requirements';
      case 'productivity': return 'Productivity';
      case 'deal_specific': return 'Deal-Specific';
      case 'quota': return 'Quota Goals';
      default: return 'AI Suggestions';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  const groupedSuggestions = groupSuggestionsBySource();

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6" component="h3">
            <LightbulbIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Intelligent Task Suggestions
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={loadSuggestions}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>

        {suggestions.length === 0 ? (
          <Alert severity="info">
            No AI suggestions available. Click refresh to generate new suggestions.
          </Alert>
        ) : (
          <Box>
            {Object.entries(groupedSuggestions).map(([source, sourceSuggestions]) => (
              <Box key={source} mb={3}>
                <Box display="flex" alignItems="center" mb={1}>
                  {getSourceIcon(source)}
                  <Typography variant="subtitle1" sx={{ ml: 1, fontWeight: 'bold' }}>
                    {getSourceLabel(source)}
                  </Typography>
                  <Chip
                    label={sourceSuggestions.length}
                    size="small"
                    color={getSourceColor(source) as any}
                    sx={{ ml: 1 }}
                  />
                </Box>
                
                <List dense>
                  {sourceSuggestions.map((suggestion) => (
                    <ListItem
                      key={suggestion.id}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        mb: 1,
                        backgroundColor: 'background.paper'
                      }}
                    >
                      <ListItemIcon>
                        {getTypeIcon(suggestion.type)}
                      </ListItemIcon>
                      
                      <ListItemText
                        primary={
                          <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="body1" fontWeight="medium">
                              {suggestion.title}
                            </Typography>
                            <Chip
                              label={suggestion.priority}
                              size="small"
                              color={getPriorityColor(suggestion.priority) as any}
                            />
                            <Chip
                              label={`${suggestion.estimatedDuration}m`}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              {suggestion.description}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              AI Confidence: {suggestion.aiConfidence}% • {suggestion.aiReason}
                            </Typography>
                          </Box>
                        }
                      />
                      
                      <IconButton
                        color="primary"
                        onClick={() => handleCreateTask(suggestion)}
                        disabled={creatingTasks.has(suggestion.id)}
                        title="Add to tasks"
                      >
                        <AddIcon />
                      </IconButton>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default UnifiedAISuggestions; 