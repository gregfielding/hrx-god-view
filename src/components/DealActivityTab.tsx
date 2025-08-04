import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Grid,
  Alert,
  CircularProgress,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Badge,
  Tooltip,
  Paper,
  Stack,
  Avatar
} from '@mui/material';
import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent
} from '@mui/lab';
import {
  Add as AddIcon,
  Email as EmailIcon,
  Task as TaskIcon,
  Note as NoteIcon,
  Timeline as TimelineIcon,
  Psychology as PsychologyIcon,
  Lightbulb as LightbulbIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as MoneyIcon,
  ExpandMore as ExpandMoreIcon,
  Send as SendIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Refresh as RefreshIcon,
  AutoAwesome as AutoAwesomeIcon,
  Phone as PhoneIcon
} from '@mui/icons-material';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';

interface DealActivityTabProps {
  dealId: string;
  tenantId: string;
  dealName: string;
}

interface ActivityItem {
  id: string;
  type: 'task' | 'email_sent' | 'email_received' | 'phone_call' | 'meeting' | 'note' | 'ai_log' | 'stage_change' | 'proposal_sent' | 'contract_signed';
  title: string;
  description?: string;
  timestamp: any;
  status: 'completed' | 'pending' | 'in_progress' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  dueDate?: any;
  aiInsights?: string[];
  aiSuggestions?: string[];
  metadata?: any;
}

interface AILog {
  id: string;
  eventType: string;
  actionType: string;
  reason: string;
  timestamp: any;
  success: boolean;
  aiInsights?: any;
  processingResults?: any[];
  engineTouched?: string[];
}

interface DealInsights {
  insights: string[];
  suggestions: string[];
  riskFactors: string[];
  nextActions: string[];
  dealSummary?: any;
  stageRecommendations: string[];
  emailDrafts: any[];
  taskSuggestions: any[];
}

const DealActivityTab: React.FC<DealActivityTabProps> = ({
  dealId,
  tenantId,
  dealName
}) => {
  const { user } = useAuth();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [aiLogs, setAiLogs] = useState<AILog[]>([]);
  const [dealInsights, setDealInsights] = useState<DealInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAILogs, setShowAILogs] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [showActivityDialog, setShowActivityDialog] = useState(false);

  useEffect(() => {
    loadDealActivity();
  }, [dealId, tenantId]);

  const loadDealActivity = async () => {
    try {
      setLoading(true);
      
      // Load AI logs for this deal (if any exist)
      let logs: AILog[] = [];
      try {
        console.log('Querying AI logs for dealId:', dealId);
        const logsQuery = query(
          collection(db, 'ai_logs'),
          where('targetId', '==', dealId),
          orderBy('timestamp', 'desc')
        );
        
        const logsSnapshot = await getDocs(logsQuery);
        console.log('Found', logsSnapshot.docs.length, 'AI logs for deal');
        logs = logsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as AILog[];
        
        // Debug: Log the first few logs
        if (logs.length > 0) {
          console.log('First log:', logs[0]);
        }
      } catch (error) {
        // This is expected when AI logging is disabled or no logs exist yet
        console.log('AI logs query skipped - logging disabled or no logs exist:', error);
      }
      
      setAiLogs(logs);

      // Load deal insights from deal document
      try {
        const dealDoc = await getDocs(query(
          collection(db, 'tenants', tenantId, 'crm_deals'),
          where('__name__', '==', dealId)
        ));
        
        if (!dealDoc.empty) {
          const dealData = dealDoc.docs[0].data();
          if (dealData.aiInsights) {
            setDealInsights(dealData.aiInsights);
          }
        }
      } catch (error) {
        console.log('No deal insights found yet:', error);
      }

      // Convert AI logs to activity items
      const activityItems: ActivityItem[] = logs.map(log => ({
        id: log.id,
        type: 'ai_log',
        title: `${log.actionType} - ${log.eventType}`,
        description: log.reason,
        timestamp: log.timestamp,
        status: log.success ? 'completed' : 'pending',
        priority: 'medium',
        aiInsights: log.aiInsights?.insights || [],
        aiSuggestions: log.aiInsights?.suggestions || [],
        metadata: {
          eventType: log.eventType,
          actionType: log.actionType,
          engineTouched: log.engineTouched,
          processingResults: log.processingResults
        }
      }));

      console.log('Created', activityItems.length, 'activity items from logs');
      setActivities(activityItems);
      
    } catch (error) {
      console.error('Error loading deal activity:', error);
    } finally {
      setLoading(false);
    }
  };



  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'task':
        return <TaskIcon />;
      case 'email_sent':
        return <SendIcon />;
      case 'email_received':
        return <EmailIcon />;
      case 'phone_call':
        return <PhoneIcon />;
      case 'meeting':
        return <PersonIcon />;
      case 'note':
        return <NoteIcon />;
      case 'ai_log':
        return <PsychologyIcon />;
      case 'stage_change':
        return <TimelineIcon />;
      case 'proposal_sent':
        return <BusinessIcon />;
      case 'contract_signed':
        return <MoneyIcon />;
      default:
        return <TimelineIcon />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      case 'low':
        return 'default';
      default:
        return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'in_progress':
        return 'warning';
      case 'pending':
        return 'info';
      case 'cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header with AI Insights */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TimelineIcon />
            Deal Activity & AI Intelligence
          </Typography>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadDealActivity}
          >
            Refresh
          </Button>
        </Box>

      </Box>

      {/* Activity Timeline */}
      <Card>
        <CardHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TimelineIcon />
              Activity Timeline
              <Badge badgeContent={activities.length} color="primary" sx={{ ml: 1 }} />
            </Box>
          }
        />
        <CardContent>
          {activities.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary" gutterBottom>
                No activity recorded yet.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                AI logging is now enabled. Deal activities will appear here automatically as you interact with the deal.
              </Typography>
            </Box>
          ) : (
            <Timeline>
              {activities.map((activity, index) => (
                <TimelineItem key={activity.id}>
                  <TimelineOppositeContent sx={{ m: 'auto 0' }} variant="body2" color="text.secondary">
                    {formatTimestamp(activity.timestamp)}
                  </TimelineOppositeContent>
                  <TimelineSeparator>
                    <TimelineDot color={getStatusColor(activity.status) as any}>
                      {getActivityIcon(activity.type)}
                    </TimelineDot>
                    {index < activities.length - 1 && <TimelineConnector />}
                  </TimelineSeparator>
                  <TimelineContent sx={{ py: '12px', px: 2 }}>
                    <Paper elevation={1} sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Typography variant="h6" component="span">
                          {activity.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Chip
                            label={activity.priority}
                            color={getPriorityColor(activity.priority) as any}
                            size="small"
                          />
                          <Chip
                            label={activity.status}
                            color={getStatusColor(activity.status) as any}
                            size="small"
                          />
                        </Box>
                      </Box>
                      
                      {activity.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {activity.description}
                        </Typography>
                      )}

                      {/* AI Insights for this activity */}
                      {activity.aiInsights && activity.aiInsights.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="primary" sx={{ fontWeight: 'bold' }}>
                            AI Insights:
                          </Typography>
                          <List dense sx={{ py: 0 }}>
                            {activity.aiInsights.map((insight, idx) => (
                              <ListItem key={idx} sx={{ py: 0 }}>
                                <ListItemIcon sx={{ minWidth: 24 }}>
                                  <LightbulbIcon fontSize="small" color="primary" />
                                </ListItemIcon>
                                <ListItemText primary={insight} />
                              </ListItem>
                            ))}
                          </List>
                        </Box>
                      )}

                      {/* AI Suggestions for this activity */}
                      {activity.aiSuggestions && activity.aiSuggestions.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="primary" sx={{ fontWeight: 'bold' }}>
                            AI Suggestions:
                          </Typography>
                          <List dense sx={{ py: 0 }}>
                            {activity.aiSuggestions.map((suggestion, idx) => (
                              <ListItem key={idx} sx={{ py: 0 }}>
                                <ListItemIcon sx={{ minWidth: 24 }}>
                                  <PsychologyIcon fontSize="small" color="primary" />
                                </ListItemIcon>
                                <ListItemText primary={suggestion} />
                              </ListItem>
                            ))}
                          </List>
                        </Box>
                      )}

                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Button
                          size="small"
                          startIcon={<VisibilityIcon />}
                          onClick={() => {
                            setSelectedActivity(activity);
                            setShowActivityDialog(true);
                          }}
                        >
                          View Details
                        </Button>
                      </Box>
                    </Paper>
                  </TimelineContent>
                </TimelineItem>
              ))}
            </Timeline>
          )}
        </CardContent>
      </Card>

      {/* AI Logs Section (Collapsible) */}
      {showAILogs && (
        <Card sx={{ mt: 3 }}>
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PsychologyIcon />
                AI Processing Logs
                <Badge badgeContent={aiLogs.length} color="secondary" sx={{ ml: 1 }} />
              </Box>
            }
          />
          <CardContent>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>View AI Processing Details</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  {aiLogs.map((log) => (
                    <ListItem key={log.id} divider>
                      <ListItemIcon>
                        <PsychologyIcon color={log.success ? 'success' : 'error'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${log.actionType} - ${log.eventType}`}
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              {log.reason}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatTimestamp(log.timestamp)}
                            </Typography>
                            {log.engineTouched && (
                              <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="primary">
                                  Engines: {log.engineTouched.join(', ')}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        }
                      />
                      <Chip
                        label={log.success ? 'Success' : 'Error'}
                        color={log.success ? 'success' : 'error'}
                        size="small"
                      />
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
          </CardContent>
        </Card>
      )}



      {/* Activity Details Dialog */}
      <Dialog open={showActivityDialog} onClose={() => setShowActivityDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Activity Details
          {selectedActivity && (
            <Typography variant="body2" color="text.secondary">
              {selectedActivity.title}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {selectedActivity && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Details
              </Typography>
              <Typography variant="body2" paragraph>
                <strong>Type:</strong> {selectedActivity.type}
              </Typography>
              <Typography variant="body2" paragraph>
                <strong>Status:</strong> {selectedActivity.status}
              </Typography>
              <Typography variant="body2" paragraph>
                <strong>Priority:</strong> {selectedActivity.priority}
              </Typography>
              <Typography variant="body2" paragraph>
                <strong>Timestamp:</strong> {formatTimestamp(selectedActivity.timestamp)}
              </Typography>
              
              {selectedActivity.description && (
                <Typography variant="body2" paragraph>
                  <strong>Description:</strong> {selectedActivity.description}
                </Typography>
              )}

              {selectedActivity.metadata && (
                <>
                  <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                    AI Processing Details
                  </Typography>
                  <Typography variant="body2" paragraph>
                    <strong>Event Type:</strong> {selectedActivity.metadata.eventType}
                  </Typography>
                  <Typography variant="body2" paragraph>
                    <strong>Action Type:</strong> {selectedActivity.metadata.actionType}
                  </Typography>
                  {selectedActivity.metadata.engineTouched && (
                    <Typography variant="body2" paragraph>
                      <strong>AI Engines:</strong> {selectedActivity.metadata.engineTouched.join(', ')}
                    </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowActivityDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DealActivityTab; 