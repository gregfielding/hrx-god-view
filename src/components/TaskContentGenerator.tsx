import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Button,
  Grid,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  LinearProgress,
  IconButton
} from '@mui/material';
import {
  Email as EmailIcon,
  Phone as PhoneIcon,
  MeetingRoom as MeetingIcon,
  Psychology as PsychologyIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as CopyIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';

interface TaskContentGeneratorProps {
  taskId: string;
  tenantId: string;
  task: any;
  onContentGenerated?: (content: any) => void;
}

interface GeneratedContent {
  email?: {
    subject: string;
    greeting: string;
    body: string;
    callToAction: string;
    personalization: any;
  };
  callScript?: {
    opening: string;
    agenda: string[];
    questions: string[];
    closing: string;
    notes: string;
  };
  meetingAgenda?: {
    title: string;
    duration: string;
    agenda: string[];
    objectives: string[];
    preparation: string[];
  };
  researchPlan?: {
    objectives: string[];
    researchAreas: string[];
    sources: string[];
    deliverables: string[];
  };
  followUpContent?: any;
  generalContent?: any;
}

const TaskContentGenerator: React.FC<TaskContentGeneratorProps> = ({
  taskId,
  tenantId,
  task,
  onContentGenerated
}) => {
  const { user } = useAuth();
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContentDialog, setShowContentDialog] = useState(false);
  const [selectedContent, setSelectedContent] = useState<any>(null);

  const taskService = TaskService.getInstance();

  useEffect(() => {
    if (taskId && user) {
      generateContent();
    }
  }, [taskId, user]);

  const generateContent = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const result = await taskService.generateTaskContent(taskId, tenantId, user.uid);
      
      if (result.success) {
        setContent(result.content);
        setSuggestions(result.suggestions || []);
        setInsights(result.insights || []);
        
        if (onContentGenerated) {
          onContentGenerated(result.content);
        }
      } else {
        setError('Failed to generate content');
      }
    } catch (err) {
      console.error('Error generating content:', err);
      setError('Failed to generate content');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyContent = (content: string, type: string) => {
    navigator.clipboard.writeText(content);
    // You could add a toast notification here
  };

  const handleEditContent = (content: any, type: string) => {
    setSelectedContent({ ...content, type });
    setShowContentDialog(true);
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon />;
      case 'phone_call': return <PhoneIcon />;
      case 'scheduled_meeting_virtual':
      case 'scheduled_meeting_in_person': return <MeetingIcon />;
      case 'research': return <PsychologyIcon />;
      default: return <AutoAwesomeIcon />;
    }
  };

  const getTaskTypeColor = (type: string) => {
    switch (type) {
      case 'email': return 'primary';
      case 'phone_call': return 'success';
      case 'scheduled_meeting_virtual':
      case 'scheduled_meeting_in_person': return 'info';
      case 'research': return 'warning';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress />
        <Typography variant="body2" sx={{ mt: 1 }}>
          Generating AI content...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          onClick={generateContent}
          sx={{ mt: 2 }}
        >
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="h3">
          AI-Generated Content
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={generateContent}
          size="small"
        >
          Regenerate
        </Button>
      </Box>

      {/* Content Sections */}
      {content && (
        <Grid container spacing={2}>
          {/* Email Content */}
          {content.email && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardHeader
                  title="Email Content"
                  avatar={<EmailIcon color="primary" />}
                  action={
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyContent(
                          `${content.email.subject}\n\n${content.email.greeting}\n\n${content.email.body}\n\n${content.email.callToAction}`,
                          'email'
                        )}
                      >
                        <CopyIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleEditContent(content.email, 'email')}
                      >
                        <EditIcon />
                      </IconButton>
                    </Box>
                  }
                />
                <CardContent>
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    Subject: {content.email.subject}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {content.email.greeting}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {content.email.body}
                  </Typography>
                  <Chip
                    label={content.email.callToAction}
                    color="primary"
                    size="small"
                  />
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Call Script */}
          {content.callScript && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardHeader
                  title="Call Script"
                  avatar={<PhoneIcon color="success" />}
                  action={
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyContent(
                          `Opening: ${content.callScript.opening}\n\nAgenda: ${content.callScript.agenda.join(', ')}\n\nQuestions: ${content.callScript.questions.join(', ')}\n\nClosing: ${content.callScript.closing}`,
                          'call_script'
                        )}
                      >
                        <CopyIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleEditContent(content.callScript, 'call_script')}
                      >
                        <EditIcon />
                      </IconButton>
                    </Box>
                  }
                />
                <CardContent>
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    Opening
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {content.callScript.opening}
                  </Typography>
                  
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    Agenda
                  </Typography>
                  <List dense>
                    {content.callScript.agenda.map((item: string, index: number) => (
                      <ListItem key={index} sx={{ py: 0 }}>
                        <ListItemIcon sx={{ minWidth: 20 }}>
                          <CheckCircleIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={item} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Meeting Agenda */}
          {content.meetingAgenda && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardHeader
                  title="Meeting Agenda"
                  avatar={<MeetingIcon color="info" />}
                  action={
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyContent(
                          `Title: ${content.meetingAgenda.title}\nDuration: ${content.meetingAgenda.duration}\n\nAgenda:\n${content.meetingAgenda.agenda.join('\n')}\n\nObjectives:\n${content.meetingAgenda.objectives.join('\n')}`,
                          'meeting_agenda'
                        )}
                      >
                        <CopyIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleEditContent(content.meetingAgenda, 'meeting_agenda')}
                      >
                        <EditIcon />
                      </IconButton>
                    </Box>
                  }
                />
                <CardContent>
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    {content.meetingAgenda.title} ({content.meetingAgenda.duration})
                  </Typography>
                  
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom sx={{ mt: 2 }}>
                    Agenda
                  </Typography>
                  <List dense>
                    {content.meetingAgenda.agenda.map((item: string, index: number) => (
                      <ListItem key={index} sx={{ py: 0 }}>
                        <ListItemIcon sx={{ minWidth: 20 }}>
                          <ScheduleIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={item} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Research Plan */}
          {content.researchPlan && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardHeader
                  title="Research Plan"
                  avatar={<PsychologyIcon color="warning" />}
                />
                <CardContent>
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    Objectives
                  </Typography>
                  <List dense>
                    {content.researchPlan.objectives.map((objective: string, index: number) => (
                      <ListItem key={index} sx={{ py: 0 }}>
                        <ListItemIcon sx={{ minWidth: 20 }}>
                          <TrendingUpIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={objective} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      )}

      {/* AI Insights */}
      {insights.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardHeader
            title="AI Insights"
            avatar={<AutoAwesomeIcon color="secondary" />}
          />
          <CardContent>
            <Grid container spacing={2}>
              {insights.map((insight, index) => (
                <Grid item xs={12} md={6} key={index}>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="primary" gutterBottom>
                      {insight.title}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {insight.description}
                    </Typography>
                    <Chip
                      label={insight.recommendation}
                      size="small"
                      color="info"
                    />
                  </Box>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Content Edit Dialog */}
      <Dialog
        open={showContentDialog}
        onClose={() => setShowContentDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Edit {selectedContent?.type === 'email' ? 'Email' : 
                selectedContent?.type === 'call_script' ? 'Call Script' : 
                selectedContent?.type === 'meeting_agenda' ? 'Meeting Agenda' : 'Content'}
        </DialogTitle>
        <DialogContent>
          {selectedContent?.type === 'email' && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Subject"
                  value={selectedContent.subject}
                  onChange={(e) => setSelectedContent({ ...selectedContent, subject: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Greeting"
                  value={selectedContent.greeting}
                  onChange={(e) => setSelectedContent({ ...selectedContent, greeting: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Body"
                  value={selectedContent.body}
                  onChange={(e) => setSelectedContent({ ...selectedContent, body: e.target.value })}
                  multiline
                  rows={6}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Call to Action"
                  value={selectedContent.callToAction}
                  onChange={(e) => setSelectedContent({ ...selectedContent, callToAction: e.target.value })}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowContentDialog(false)}>Cancel</Button>
          <Button 
            onClick={() => {
              // Handle saving edited content
              setShowContentDialog(false);
            }} 
            variant="contained"
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaskContentGenerator; 