import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  IconButton,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Grid,
  CircularProgress,
  Alert,
  Divider,
  Badge,
  Tooltip,
} from '@mui/material';
import {
  Email as EmailIcon,
  Task as TaskIcon,
  Note as NoteIcon,
  Phone as PhoneIcon,
  MeetingRoom as MeetingIcon,
  NotificationsActive as FollowUpIcon,
  TrendingUp as StatusChangeIcon,
  Add as AddIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Cancel as CancelIcon,
  Star as PriorityHighIcon,
  StarBorder as PriorityMediumIcon,
  StarOutline as PriorityLowIcon,
} from '@mui/icons-material';
import { createActivityService, ActivityLog, ActivityQuery } from '../utils/activityService';
import { useAuth } from '../contexts/AuthContext';

interface ActivityLogTabProps {
  entityType: 'contact' | 'deal' | 'company' | 'salesperson';
  entityId: string;
  entityName: string;
  tenantId: string;
  maxHeight?: number;
  showFilters?: boolean;
  showAddActivity?: boolean;
}

const ActivityLogTab: React.FC<ActivityLogTabProps> = ({
  entityType,
  entityId,
  entityName,
  tenantId,
  maxHeight = 600,
  showFilters = true,
  showAddActivity = true,
}) => {
  const { currentUser } = useAuth();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activityService] = useState(() => createActivityService(tenantId, currentUser?.uid || ''));

  // Filter states
  const [selectedActivityType, setSelectedActivityType] = useState<string>('all');
  const [includeRelated, setIncludeRelated] = useState(true);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '',
    end: ''
  });

  const activityTypes = [
    { value: 'all', label: 'All Activities' },
    { value: 'email', label: 'Emails' },
    { value: 'task', label: 'Tasks' },
    { value: 'note', label: 'Notes' },
    { value: 'call', label: 'Calls' },
    { value: 'meeting', label: 'Meetings' },
    { value: 'follow_up', label: 'Follow-ups' },
    { value: 'status_change', label: 'Status Changes' },
    { value: 'custom', label: 'Custom' },
  ];

  useEffect(() => {
    loadActivities();
  }, [entityId, selectedActivityType, includeRelated, dateRange]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      setError('');

      const queryParams: ActivityQuery = {
        tenantId,
        entityType,
        entityId,
        includeRelated,
      };

      // Add activity type filter
      if (selectedActivityType !== 'all') {
        queryParams.activityTypes = [selectedActivityType];
      }

      // Add date range filter
      if (dateRange.start) {
        queryParams.startDate = new Date(dateRange.start);
      }
      if (dateRange.end) {
        queryParams.endDate = new Date(dateRange.end);
      }

      const activitiesData = await activityService.queryActivities(queryParams);
      setActivities(activitiesData);

    } catch (err: any) {
      console.error('Error loading activities:', err);
      setError(err.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (activityType: string) => {
    switch (activityType) {
      case 'email': return <EmailIcon />;
      case 'task': return <TaskIcon />;
      case 'note': return <NoteIcon />;
      case 'call': return <PhoneIcon />;
      case 'meeting': return <MeetingIcon />;
      case 'follow_up': return <FollowUpIcon />;
      case 'status_change': return <StatusChangeIcon />;
      default: return <NoteIcon />;
    }
  };

  const getActivityColor = (activityType: string) => {
    switch (activityType) {
      case 'email': return 'primary';
      case 'task': return 'secondary';
      case 'note': return 'info';
      case 'call': return 'success';
      case 'meeting': return 'warning';
      case 'follow_up': return 'error';
      case 'status_change': return 'default';
      default: return 'default';
    }
  };

  const getPriorityIcon = (priority?: string) => {
    switch (priority) {
      case 'high': return <PriorityHighIcon fontSize="small" />;
      case 'medium': return <PriorityMediumIcon fontSize="small" />;
      case 'low': return <PriorityLowIcon fontSize="small" />;
      default: return null;
    }
  };

  const getTaskStatusIcon = (status?: string) => {
    switch (status) {
      case 'completed': return <CheckCircleIcon fontSize="small" color="success" />;
      case 'pending': return <ScheduleIcon fontSize="small" color="warning" />;
      case 'cancelled': return <CancelIcon fontSize="small" color="error" />;
      default: return null;
    }
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case 'contact': return <PersonIcon fontSize="small" />;
      case 'deal': return <DealIcon fontSize="small" />;
      case 'company': return <BusinessIcon fontSize="small" />;
      default: return <PersonIcon fontSize="small" />;
    }
  };

  const getEntityLabel = (entityType: string) => {
    switch (entityType) {
      case 'contact': return 'Contact';
      case 'deal': return 'Deal';
      case 'company': return 'Company';
      default: return 'Entity';
    }
  };

  const handleRefresh = () => {
    loadActivities();
  };

  const handleAddActivity = () => {
    // TODO: Implement add activity modal
    console.log('Add activity clicked');
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Activity Log
          <Badge badgeContent={activities.length} color="primary" sx={{ ml: 1 }}>
            <FilterIcon />
          </Badge>
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          
          {showAddActivity && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleAddActivity}
              startIcon={<AddIcon />}
            >
              Add Activity
            </Button>
          )}
        </Box>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {!loading && activities.length === 0 && !error && (
        <Alert severity="info">
          Activity logging is not yet implemented. This feature will be available soon to track emails, tasks, calls, and other interactions with this {entityType}.
        </Alert>
      )}

      {/* Filters */}
      {showFilters && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Activity Type</InputLabel>
                  <Select
                    value={selectedActivityType}
                    label="Activity Type"
                    onChange={(e) => setSelectedActivityType(e.target.value)}
                  >
                    {activityTypes.map((type) => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Start Date"
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="End Date"
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Include Related</InputLabel>
                  <Select
                    value={includeRelated ? 'yes' : 'no'}
                    label="Include Related"
                    onChange={(e) => setIncludeRelated(e.target.value === 'yes')}
                  >
                    <MenuItem value="yes">Include Related Entities</MenuItem>
                    <MenuItem value="no">This Entity Only</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Activities List */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          {activities.length > 0 ? (
            <List sx={{ maxHeight, overflow: 'auto' }}>
              {activities.map((activity, index) => (
                <React.Fragment key={activity.id}>
                  <ListItem alignItems="flex-start">
                    <ListItemIcon>
                      {getActivityIcon(activity.activityType)}
                    </ListItemIcon>
                    
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle2" component="span">
                            {activity.title}
                          </Typography>
                          
                          {/* Activity type chip */}
                          <Chip
                            label={activity.activityType}
                            size="small"
                            color={getActivityColor(activity.activityType) as any}
                            variant="outlined"
                          />
                          
                          {/* Priority icon for tasks */}
                          {activity.activityType === 'task' && activity.metadata?.priority && (
                            <Tooltip title={`Priority: ${activity.metadata.priority}`}>
                              <Box>
                                {getPriorityIcon(activity.metadata.priority)}
                              </Box>
                            </Tooltip>
                          )}
                          
                          {/* Status icon for tasks */}
                          {activity.activityType === 'task' && activity.metadata?.taskStatus && (
                            <Tooltip title={`Status: ${activity.metadata.taskStatus}`}>
                              <Box>
                                {getTaskStatusIcon(activity.metadata.taskStatus)}
                              </Box>
                            </Tooltip>
                          )}
                          
                          {/* AI logged indicator */}
                          {activity.aiLogged && (
                            <Tooltip title="AI Logged">
                              <Chip
                                label="AI"
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                            </Tooltip>
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {activity.description}
                          </Typography>
                          
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <CalendarIcon fontSize="small" />
                              <Typography variant="caption" color="text.secondary">
                                {formatTimestamp(activity.timestamp)}
                              </Typography>
                            </Box>
                            
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PersonIcon fontSize="small" />
                              <Typography variant="caption" color="text.secondary">
                                {activity.userName}
                              </Typography>
                            </Box>
                            
                            {/* Show if this activity is from a related entity */}
                            {activity.entityType !== entityType && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {getEntityIcon(activity.entityType)}
                                <Typography variant="caption" color="text.secondary">
                                  {getEntityLabel(activity.entityType)}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                          
                          {/* Metadata display */}
                          {activity.metadata && (
                            <Box sx={{ mt: 1 }}>
                              {activity.metadata.emailSubject && (
                                <Chip
                                  label={`Subject: ${activity.metadata.emailSubject}`}
                                  size="small"
                                  variant="outlined"
                                  sx={{ mr: 1, mb: 1 }}
                                />
                              )}
                              
                              {activity.metadata.tags && activity.metadata.tags.length > 0 && (
                                activity.metadata.tags.map((tag, tagIndex) => (
                                  <Chip
                                    key={tagIndex}
                                    label={tag}
                                    size="small"
                                    variant="outlined"
                                    sx={{ mr: 1, mb: 1 }}
                                  />
                                ))
                              )}
                            </Box>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                  
                  {index < activities.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          ) : (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                No activities found
              </Typography>
              {showAddActivity && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAddActivity}
                  sx={{ mt: 1 }}
                >
                  Add First Activity
                </Button>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ActivityLogTab;