import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Grid,
  Badge,
} from '@mui/material';
import {
  Email as EmailIcon,
  Task as TaskIcon,
  Note as NoteIcon,
  Phone as PhoneIcon,
  MeetingRoom as MeetingIcon,
  NotificationsActive as FollowUpIcon,
  TrendingUp as StatusChangeIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  Search as SearchIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  Star as PriorityHighIcon,
  StarBorder as PriorityMediumIcon,
  StarOutline as PriorityLowIcon,
  AutoAwesome as AIIcon,
} from '@mui/icons-material';
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';

// import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

interface ActivityLog {
  id: string;
  eventType: string;
  targetType: string;
  targetId: string;
  reason: string;
  contextType: string;
  aiTags: string[];
  urgencyScore: number;
  success: boolean;
  latencyMs: number;
  tenantId: string;
  userId: string;
  associations: any;
  metadata: any;
  aiRelevant: boolean;
  createdAt: Timestamp;
  aiResponse?: string;
  errorMessage?: string;
}

interface ActivityLogTabProps {
  entityType: 'contact' | 'deal' | 'company' | 'salesperson' | 'location';
  entityId: string;
  entityName: string;
  tenantId: string;
  maxHeight?: number;
  showFilters?: boolean;
}

type SortField = 'createdAt' | 'eventType' | 'urgencyScore' | 'latencyMs';
type SortOrder = 'asc' | 'desc';

const ActivityLogTab: React.FC<ActivityLogTabProps> = ({
  entityType,
  entityId,
  entityName,
  tenantId,
  maxHeight = 600,
  showFilters = true,
}) => {
  // const { user } = useAuth();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '',
    end: ''
  });
  
  // Sort states
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const eventTypes = [
    { value: 'all', label: 'All Events' },
    { value: 'contact', label: 'Contact Events' },
    { value: 'deal', label: 'Deal Events' },
    { value: 'company', label: 'Company Events' },
    { value: 'task', label: 'Task Events' },
    { value: 'email', label: 'Email Events' },
    { value: 'note', label: 'Note Events' },
    { value: 'ai', label: 'AI Events' },
  ];

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'success', label: 'Success' },
    { value: 'error', label: 'Error' },
  ];

  useEffect(() => {
    loadActivities();
  }, [entityId, tenantId]);

  const loadActivities = async () => {
    if (!tenantId || !entityId) return;
    
    try {
      setLoading(true);
      setError('');

      // Query AI logs for this entity
      const aiLogsRef = collection(db, 'ai_logs');
      const aiLogsQuery = query(
        aiLogsRef,
        where('tenantId', '==', tenantId),
        where('targetId', '==', entityId),
        orderBy('createdAt', 'desc'),
        limit(100)
      );

      const aiLogsSnapshot = await getDocs(aiLogsQuery);
      const aiLogs = aiLogsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLog[];

      setActivities(aiLogs);
    } catch (err: any) {
      console.error('Error loading activities:', err);
      setError(err.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort activities
  const filteredAndSortedActivities = useMemo(() => {
    const filtered = activities.filter(activity => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = 
          activity.reason.toLowerCase().includes(searchLower) ||
          activity.eventType.toLowerCase().includes(searchLower) ||
          activity.aiTags.some(tag => tag.toLowerCase().includes(searchLower));
        
        if (!matchesSearch) return false;
      }

      // Event type filter
      if (selectedEventType !== 'all') {
        if (!activity.eventType.startsWith(selectedEventType)) return false;
      }

      // Status filter
      if (selectedStatus !== 'all') {
        if (selectedStatus === 'success' && !activity.success) return false;
        if (selectedStatus === 'error' && activity.success) return false;
      }

      // Date range filter
      if (dateRange.start) {
        const startDate = new Date(dateRange.start);
        if (activity.createdAt.toDate() < startDate) return false;
      }
      if (dateRange.end) {
        const endDate = new Date(dateRange.end);
        if (activity.createdAt.toDate() > endDate) return false;
      }

      return true;
    });

    // Sort activities
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'createdAt':
          aValue = a.createdAt.toDate();
          bValue = b.createdAt.toDate();
          break;
        case 'eventType':
          aValue = a.eventType;
          bValue = b.eventType;
          break;
        case 'urgencyScore':
          aValue = a.urgencyScore;
          bValue = b.urgencyScore;
          break;
        case 'latencyMs':
          aValue = a.latencyMs;
          bValue = b.latencyMs;
          break;
        default:
          aValue = a.createdAt.toDate();
          bValue = b.createdAt.toDate();
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return sorted;
  }, [activities, searchTerm, selectedEventType, selectedStatus, dateRange, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const getEventIcon = (eventType: string) => {
    const iconMap: { [key: string]: React.ReactElement } = {
      'contact': <PersonIcon />,
      'deal': <DealIcon />,
      'company': <BusinessIcon />,
      'task': <TaskIcon />,
      'email': <EmailIcon />,
      'note': <NoteIcon />,
      'call': <PhoneIcon />,
      'meeting': <MeetingIcon />,
      'follow_up': <FollowUpIcon />,
      'status_change': <StatusChangeIcon />,
    };

    return iconMap[eventType.split('.')[0]] || <AIIcon />;
  };

  const getEventColor = (eventType: string) => {
    const colorMap: { [key: string]: string } = {
      'contact': 'primary',
      'deal': 'success',
      'company': 'info',
      'task': 'warning',
      'email': 'secondary',
      'note': 'default',
      'call': 'primary',
      'meeting': 'info',
      'follow_up': 'warning',
      'status_change': 'success',
    };

    return colorMap[eventType.split('.')[0]] || 'default';
  };

  const formatTimestamp = (timestamp: Timestamp) => {
    return timestamp.toDate().toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getUrgencyIcon = (score: number) => {
    if (score >= 8) return <PriorityHighIcon fontSize="small" />;
    if (score >= 5) return <PriorityMediumIcon fontSize="small" />;
    return <PriorityLowIcon fontSize="small" />;
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
          <Badge badgeContent={filteredAndSortedActivities.length} color="primary" sx={{ ml: 1 }}>
            <FilterIcon />
          </Badge>
        </Typography>
        
        <Tooltip title="Refresh">
          <IconButton onClick={loadActivities} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      {showFilters && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                  }}
                />
              </Grid>

              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Event Type</InputLabel>
                  <Select
                    value={selectedEventType}
                    label="Event Type"
                    onChange={(e) => setSelectedEventType(e.target.value)}
                  >
                    {eventTypes.map((type) => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={selectedStatus}
                    label="Status"
                    onChange={(e) => setSelectedStatus(e.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <MenuItem key={status.value} value={status.value}>
                        {status.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={2}>
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

              <Grid item xs={12} sm={2}>
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
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Activities Table */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          {filteredAndSortedActivities.length > 0 ? (
            <TableContainer component={Paper} sx={{ maxHeight }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === 'createdAt'}
                        direction={sortField === 'createdAt' ? sortOrder : 'asc'}
                        onClick={() => handleSort('createdAt')}
                      >
                        Timestamp
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Event</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === 'urgencyScore'}
                        direction={sortField === 'urgencyScore' ? sortOrder : 'asc'}
                        onClick={() => handleSort('urgencyScore')}
                      >
                        Urgency
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === 'latencyMs'}
                        direction={sortField === 'latencyMs' ? sortOrder : 'asc'}
                        onClick={() => handleSort('latencyMs')}
                      >
                        Duration
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Tags</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredAndSortedActivities.map((activity) => (
                    <TableRow key={activity.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CalendarIcon fontSize="small" color="action" />
                          <Typography variant="caption">
                            {formatTimestamp(activity.createdAt)}
                          </Typography>
                        </Box>
                      </TableCell>
                      
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getEventIcon(activity.eventType)}
                          <Chip
                            label={activity.eventType.split('.')[0]}
                            size="small"
                            color={getEventColor(activity.eventType) as any}
                            variant="outlined"
                          />
                        </Box>
                      </TableCell>
                      
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 300 }}>
                          {activity.reason}
                        </Typography>
                      </TableCell>
                      
                      <TableCell>
                        <Tooltip title={`Urgency Score: ${activity.urgencyScore}`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {getUrgencyIcon(activity.urgencyScore)}
                            <Typography variant="caption">
                              {activity.urgencyScore}
                            </Typography>
                          </Box>
                        </Tooltip>
                      </TableCell>
                      
                      <TableCell>
                        <Typography variant="caption">
                          {formatDuration(activity.latencyMs)}
                        </Typography>
                      </TableCell>
                      
                      <TableCell>
                        <Chip
                          label={activity.success ? 'Success' : 'Error'}
                          size="small"
                          color={activity.success ? 'success' : 'error'}
                          variant="outlined"
                        />
                      </TableCell>
                      
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {activity.aiTags.slice(0, 3).map((tag, index) => (
                            <Chip
                              key={index}
                              label={tag}
                              size="small"
                              variant="outlined"
                            />
                          ))}
                          {activity.aiTags.length > 3 && (
                            <Chip
                              label={`+${activity.aiTags.length - 3}`}
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                No activities found
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Activities will appear here as AI logging events occur
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ActivityLogTab;