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
  Divider,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Lightbulb as LightbulbIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
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
import { useAuth } from '../contexts/AuthContext';

interface AISuggestion {
  type: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  category: string;
  estimatedDuration: number;
  associations: any;
  aiGenerated: boolean;
  aiPrompt: string;
  fieldName?: string;
  fieldDescription?: string;
}

interface AIStrategy {
  type: string;
  title: string;
  description: string;
  tasks: string[];
}

interface DealStageAIResults {
  stageTasks: AISuggestion[];
  stageStrategies: AIStrategy[];
  fieldCompletionTasks: AISuggestion[];
  nextStagePreparation: AISuggestion[];
  emailActivityTasks: AISuggestion[];
  contactEngagementTasks: AISuggestion[];
  companyResearchTasks: AISuggestion[];
  competitiveAdvantageTasks: AISuggestion[];
  stageInsights: string[];
}

interface DealStageAISuggestionsProps {
  dealId: string;
  tenantId: string;
  currentStage: string;
  onTaskCreated?: (taskId: string) => void;
  onRefresh?: () => void;
}

const DealStageAISuggestions: React.FC<DealStageAISuggestionsProps> = ({
  dealId,
  tenantId,
  currentStage,
  onTaskCreated,
  onRefresh
}) => {
  const { user } = useAuth();
  const [aiResults, setAiResults] = useState<DealStageAIResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());

  const functions = getFunctions();
  const createTask = httpsCallable(functions, 'createTask');
  const getDealStageAISuggestions = httpsCallable(functions, 'getDealStageAISuggestions');

  useEffect(() => {
    loadAISuggestions();
  }, [dealId, currentStage]);

  const loadAISuggestions = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const result = await getDealStageAISuggestions({
        dealId,
        tenantId,
        currentStage,
        userId: user.uid
      });

      const data = result.data as any;
      if (data.success) {
        setAiResults(data.results);
      } else {
        setError('Failed to load AI suggestions');
      }
    } catch (err) {
      console.error('Error loading AI suggestions:', err);
      setError('Failed to load AI suggestions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (suggestion: AISuggestion) => {
    if (!user) return;

    const taskId = `${suggestion.type}_${Date.now()}`;
    setCreatingTasks(prev => new Set(prev).add(taskId));

    try {
      const result = await createTask({
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        priority: suggestion.priority,
        status: 'scheduled',
        scheduledDate: new Date().toISOString(),
        assignedTo: user.uid,
        createdBy: user.uid,
        tenantId,
        category: suggestion.category,
        quotaCategory: suggestion.category,
        associations: suggestion.associations,
        aiSuggested: true,
        aiPrompt: suggestion.aiPrompt
      });

      const data = result.data as any;
      if (data.success) {
        onTaskCreated?.(data.taskId);
        // Remove the suggestion from the list
        setAiResults(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            stageTasks: prev.stageTasks.filter(s => s !== suggestion),
            fieldCompletionTasks: prev.fieldCompletionTasks.filter(s => s !== suggestion),
            nextStagePreparation: prev.nextStagePreparation.filter(s => s !== suggestion),
            emailActivityTasks: prev.emailActivityTasks.filter(s => s !== suggestion),
            contactEngagementTasks: prev.contactEngagementTasks.filter(s => s !== suggestion),
            companyResearchTasks: prev.companyResearchTasks.filter(s => s !== suggestion),
            competitiveAdvantageTasks: prev.competitiveAdvantageTasks.filter(s => s !== suggestion)
          };
        });
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
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'default';
    }
  };

  const getTaskIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon />;
      case 'phone_call': return <PhoneIcon />;
      case 'meeting': return <ScheduleIcon />;
      case 'research': return <PsychologyIcon />;
      case 'qualification': return <CheckCircleIcon />;
      case 'preparation': return <TaskIcon />;
      case 'follow_up': return <TrendingUpIcon />;
      default: return <TaskIcon />;
    }
  };

  const renderSuggestionList = (suggestions: AISuggestion[] | undefined, title: string, icon: React.ReactNode) => {
    if (!suggestions || suggestions.length === 0) return null;

    return (
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" gap={1}>
            {icon}
            <Typography variant="h6">{title}</Typography>
            <Chip label={suggestions.length} size="small" color="primary" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <List dense>
            {suggestions.map((suggestion, index) => (
              <ListItem key={index} divider>
                <ListItemIcon>
                  {getTaskIcon(suggestion.type)}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      {suggestion.title}
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
                  secondary={suggestion.description}
                />
                <Tooltip title="Add as Task">
                  <IconButton
                    onClick={() => handleCreateTask(suggestion)}
                    disabled={creatingTasks.has(`${suggestion.type}_${index}`)}
                    color="primary"
                  >
                    {creatingTasks.has(`${suggestion.type}_${index}`) ? (
                      <CircularProgress size={20} />
                    ) : (
                      <AddIcon />
                    )}
                  </IconButton>
                </Tooltip>
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>
    );
  };

  const renderStrategyList = (strategies: AIStrategy[] | undefined) => {
    if (!strategies || strategies.length === 0) return null;

    return (
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" gap={1}>
            <PsychologyIcon />
            <Typography variant="h6">Stage Strategies</Typography>
            <Chip label={strategies.length} size="small" color="primary" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {strategies.map((strategy, index) => (
            <Card key={index} variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {strategy.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {strategy.description}
                </Typography>
                <Typography variant="subtitle2" gutterBottom>
                  Recommended Tasks:
                </Typography>
                <List dense>
                  {strategy.tasks?.map((task, taskIndex) => (
                    <ListItem key={taskIndex}>
                      <ListItemIcon>
                        <TaskIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={task} />
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          ))}
        </AccordionDetails>
      </Accordion>
    );
  };

  const renderInsights = (insights: string[] | undefined) => {
    if (!insights || insights.length === 0) return null;

    return (
      <Alert severity="info" icon={<LightbulbIcon />}>
        <Typography variant="subtitle2" gutterBottom>
          Stage Insights:
        </Typography>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          {insights.map((insight, index) => (
            <li key={index}>
              <Typography variant="body2">{insight}</Typography>
            </li>
          ))}
        </ul>
      </Alert>
    );
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

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            <LightbulbIcon color="primary" />
            <Typography variant="h6">
              AI Suggestions for {currentStage.charAt(0).toUpperCase() + currentStage.slice(1)} Stage
            </Typography>
          </Box>
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadAISuggestions}
            disabled={loading}
            variant="outlined"
            size="small"
          >
            Refresh
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {aiResults && (
          <Box>
            {renderInsights(aiResults.stageInsights)}
            
            {renderStrategyList(aiResults.stageStrategies)}
            
            {renderSuggestionList(
              aiResults.stageTasks, 
              'Stage Tasks', 
              <TaskIcon />
            )}
            
            {renderSuggestionList(
              aiResults.fieldCompletionTasks, 
              'Field Completion', 
              <CheckCircleIcon />
            )}
            
            {renderSuggestionList(
              aiResults.nextStagePreparation, 
              'Next Stage Preparation', 
              <TrendingUpIcon />
            )}
            
            {renderSuggestionList(
              aiResults.emailActivityTasks, 
              'Email Activities', 
              <EmailIcon />
            )}
            
            {renderSuggestionList(
              aiResults.contactEngagementTasks, 
              'Contact Engagement', 
              <PhoneIcon />
            )}
            
            {renderSuggestionList(
              aiResults.companyResearchTasks, 
              'Company Research', 
              <BusinessIcon />
            )}
            
            {renderSuggestionList(
              aiResults.competitiveAdvantageTasks, 
              'Competitive Advantage', 
              <TrendingUpIcon />
            )}
          </Box>
        )}

        {!aiResults && !loading && (
          <Alert severity="info">
            No AI suggestions available. Click refresh to generate new suggestions.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default DealStageAISuggestions; 