import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  CardContent,
  Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  Edit as EditIcon,
  Work as WorkIcon,
  Assignment as AssignmentIcon,
  Description as DescriptionIcon,
  Security as SecurityIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { collection, query, where, orderBy, limit, getDocs, startAfter, QueryDocumentSnapshot } from 'firebase/firestore';

import { db } from '../../../firebase';

interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  actionType: 'login' | 'logout' | 'profile_update' | 'job_application' | 'assignment_update' | 'document_upload' | 'security_change' | 'notification' | 'other';
  description: string;
  timestamp: Date;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    location?: string;
    deviceType?: string;
    changes?: any;
    targetId?: string;
    targetType?: string;
  };
  severity: 'low' | 'medium' | 'high';
  source: 'web' | 'mobile' | 'api' | 'system';
}

interface ActivityLogTabProps {
  uid: string;
  user: any;
}

const ActivityLogTab: React.FC<ActivityLogTabProps> = ({ uid, user }) => {
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string>('');

  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    loadActivities();
  }, [uid]);

  const loadActivities = async (isRefresh = false) => {
    if (!uid) return;

    setLoading(true);
    setError('');

    try {
      const activitiesRef = collection(db, 'users', uid, 'activityLogs');
      let q = query(
        activitiesRef,
        orderBy('timestamp', 'desc'),
        limit(ITEMS_PER_PAGE)
      );

      // Apply filters
      if (actionTypeFilter !== 'all') {
        q = query(q, where('actionType', '==', actionTypeFilter));
      }
      if (severityFilter !== 'all') {
        q = query(q, where('severity', '==', severityFilter));
      }
      if (sourceFilter !== 'all') {
        q = query(q, where('source', '==', sourceFilter));
      }

      // If not refreshing and we have a last document, start after it
      if (!isRefresh && lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const querySnapshot = await getDocs(q);
      
      const activitiesData: ActivityLog[] = [];
      querySnapshot.forEach((doc) => {
        activitiesData.push({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp.toDate(),
        } as ActivityLog);
      });

      if (isRefresh) {
        setActivities(activitiesData);
        setPage(1);
      } else {
        setActivities(prev => [...prev, ...activitiesData]);
      }

      setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1] || null);
      setHasMore(querySnapshot.docs.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Error loading activity logs:', error);
      setError('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLastDoc(null);
    setHasMore(true);
    loadActivities(true);
  };

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'login':
        return <LoginIcon fontSize="small" color="success" />;
      case 'logout':
        return <LogoutIcon fontSize="small" color="error" />;
      case 'profile_update':
        return <EditIcon fontSize="small" color="primary" />;
      case 'job_application':
        return <WorkIcon fontSize="small" color="info" />;
      case 'assignment_update':
        return <AssignmentIcon fontSize="small" color="warning" />;
      case 'document_upload':
        return <DescriptionIcon fontSize="small" color="secondary" />;
      case 'security_change':
        return <SecurityIcon fontSize="small" color="error" />;
      case 'notification':
        return <NotificationsIcon fontSize="small" color="info" />;
      default:
        return <InfoIcon fontSize="small" color="action" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'web':
        return 'primary';
      case 'mobile':
        return 'secondary';
      case 'api':
        return 'info';
      case 'system':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp);
  };

  const filteredActivities = activities.filter(activity =>
    activity.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    activity.action.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" gutterBottom>
        Activity Log
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        Track user activities, login sessions, profile updates, and system interactions.
      </Typography>

      {/* Filters and Search */}
      <Box sx={{ pt: 3, pb: 3, mb: 3, borderRadius: 2 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <FilterIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6">Filters & Search</Typography>
        </Box>
        <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search activities..."
                value={searchTerm}
                onChange={handleSearch}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <FormControl fullWidth>
                <InputLabel>Action Type</InputLabel>
                <Select
                  value={actionTypeFilter}
                  onChange={(e) => setActionTypeFilter(e.target.value)}
                  label="Action Type"
                >
                  <MenuItem value="all">All Actions</MenuItem>
                  <MenuItem value="login">Login</MenuItem>
                  <MenuItem value="logout">Logout</MenuItem>
                  <MenuItem value="profile_update">Profile Update</MenuItem>
                  <MenuItem value="job_application">Job Application</MenuItem>
                  <MenuItem value="assignment_update">Assignment Update</MenuItem>
                  <MenuItem value="document_upload">Document Upload</MenuItem>
                  <MenuItem value="security_change">Security Change</MenuItem>
                  <MenuItem value="notification">Notification</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <FormControl fullWidth>
                <InputLabel>Severity</InputLabel>
                <Select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  label="Severity"
                >
                  <MenuItem value="all">All Severities</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <FormControl fullWidth>
                <InputLabel>Source</InputLabel>
                <Select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  label="Source"
                >
                  <MenuItem value="all">All Sources</MenuItem>
                  <MenuItem value="web">Web</MenuItem>
                  <MenuItem value="mobile">Mobile</MenuItem>
                  <MenuItem value="api">API</MenuItem>
                  <MenuItem value="system">System</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Tooltip title="Refresh">
                <IconButton onClick={handleRefresh} disabled={loading}>
                  {loading ? <CircularProgress size={24} /> : <RefreshIcon />}
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </Box>

      {/* Activity Table */}
      <Box sx={{ pt: 3, pb: 3, mb: 3, borderRadius: 2 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <Typography variant="h6">Activity History ({filteredActivities.length} entries)</Typography>
        </Box>
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {loading && activities.length === 0 ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : filteredActivities.length === 0 ? (
            <Typography color="text.secondary" textAlign="center" py={3}>
              No activity logs found.
            </Typography>
          ) : (
            <>
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Action</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Severity</TableCell>
                      <TableCell>Source</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredActivities.map((activity) => (
                      <TableRow key={activity.id} hover>
                        <TableCell>
                          <Box display="flex" alignItems="center" gap={1}>
                            {getActionIcon(activity.actionType)}
                            <Typography variant="body2" fontWeight="medium">
                              {activity.action}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {activity.description}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={activity.severity}
                            color={getSeverityColor(activity.severity) as any}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={activity.source}
                            color={getSourceColor(activity.source) as any}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {formatTimestamp(activity.timestamp)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {activity.metadata && (
                            <Tooltip title="View details">
                              <IconButton size="small">
                                <InfoIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Load More */}
              {hasMore && (
                <Box display="flex" justifyContent="center" mt={2}>
                  <Button
                    variant="outlined"
                    onClick={() => loadActivities()}
                    disabled={loading}
                    startIcon={loading ? <CircularProgress size={16} /> : null}
                  >
                    {loading ? 'Loading...' : 'Load More'}
                  </Button>
                </Box>
              )}
            </>
          )}
        </CardContent>
      </Box>
    </Box>
  );
};

export default ActivityLogTab; 