import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Timeline as TimelineIcon,
  Task as TaskIcon,
  Note as NoteIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  AttachMoney as MoneyIcon,
  Psychology as PsychologyIcon
} from '@mui/icons-material';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';

import { db } from '../firebase';
// import { useAuth } from '../contexts/AuthContext';

interface DealActivityTabProps {
  dealId: string;
  tenantId: string;
  dealName: string;
}

interface ActivityLog {
  id: string;
  eventType: string;
  actionType: string;
  reason: string;
  timestamp: any;
  success: boolean;
  entityType: string;
  entityId: string;
  userId?: string;
  userName?: string;
  metadata?: any;
}

const DealActivityTab: React.FC<DealActivityTabProps> = ({
  dealId,
  tenantId,
  dealName
}) => {
  // const { user } = useAuth();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [sortField] = useState<'timestamp' | 'eventType' | 'actionType'>('timestamp');
  const [sortOrder] = useState<'asc' | 'desc'>('desc');

  const loadActivities = async () => {
    if (!dealId || !tenantId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Query ai_logs collection for activities related to this deal
      const logsRef = collection(db, 'ai_logs');
      const logsQuery = query(
        logsRef,
        where('entityType', '==', 'deal'),
        where('entityId', '==', dealId),
        orderBy('timestamp', 'desc'),
        limit(100)
      );
      
      const snapshot = await getDocs(logsQuery);
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLog[];
      
      setActivities(logs);
    } catch (err) {
      console.error('Error loading activities:', err);
      setError('Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort activities
  const filteredAndSortedActivities = React.useMemo(() => {
    const filtered = activities.filter(activity => {
      const matchesSearch = !searchTerm || 
        activity.eventType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        activity.actionType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        activity.reason.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesEventType = selectedEventType === 'all' || 
        activity.eventType === selectedEventType;
      
      const matchesStatus = selectedStatus === 'all' || 
        (selectedStatus === 'success' && activity.success) ||
        (selectedStatus === 'error' && !activity.success);
      
      return matchesSearch && matchesEventType && matchesStatus;
    });

    // Sort activities
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'timestamp':
          aValue = a.timestamp?.toDate?.() || a.timestamp;
          bValue = b.timestamp?.toDate?.() || b.timestamp;
          break;
        case 'eventType':
          aValue = a.eventType;
          bValue = b.eventType;
          break;
        case 'actionType':
          aValue = a.actionType;
          bValue = b.actionType;
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return sorted;
  }, [activities, searchTerm, selectedEventType, selectedStatus, sortField, sortOrder]);

  const getEventTypeIcon = (eventType: string) => {
    switch (eventType) {
      case 'task':
        return <TaskIcon fontSize="small" />;
      case 'note':
        return <NoteIcon fontSize="small" />;
      case 'email':
        return <EmailIcon fontSize="small" />;
      case 'phone':
        return <PhoneIcon fontSize="small" />;
      case 'company':
        return <BusinessIcon fontSize="small" />;
      case 'contact':
        return <PersonIcon fontSize="small" />;
      case 'deal':
        return <MoneyIcon fontSize="small" />;
      case 'ai':
        return <PsychologyIcon fontSize="small" />;
      default:
        return <TimelineIcon fontSize="small" />;
    }
  };

  const getStatusColor = (success: boolean) => {
    return success ? 'success' : 'error';
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  useEffect(() => {
    loadActivities();
  }, [dealId, tenantId]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TimelineIcon />
            Activity Log
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              placeholder="Search activities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
              sx={{ width: 200 }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Event Type</InputLabel>
              <Select
                value={selectedEventType}
                onChange={(e) => setSelectedEventType(e.target.value)}
                label="Event Type"
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="task">Task</MenuItem>
                <MenuItem value="note">Note</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="phone">Phone</MenuItem>
                <MenuItem value="company">Company</MenuItem>
                <MenuItem value="contact">Contact</MenuItem>
                <MenuItem value="deal">Deal</MenuItem>
                <MenuItem value="ai">AI</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                label="Status"
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="success">Success</MenuItem>
                <MenuItem value="error">Error</MenuItem>
              </Select>
            </FormControl>
            <IconButton onClick={loadActivities} title="Refresh">
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Activity Table */}
      <Card>
        <CardHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TimelineIcon />
              Deal Activities
            </Box>
          }
        />
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {filteredAndSortedActivities.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary" gutterBottom>
                No activities found.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                AI logging is enabled. Deal activities will appear here automatically as you interact with the deal.
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TimelineIcon fontSize="small" />
                        Event Type
                      </Box>
                    </TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Timestamp</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredAndSortedActivities.map((activity) => (
                    <TableRow key={activity.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getEventTypeIcon(activity.eventType)}
                          <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                            {activity.eventType}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                          {activity.actionType}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {activity.reason}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={activity.success ? 'Success' : 'Error'}
                          color={getStatusColor(activity.success)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatTimestamp(activity.timestamp)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default DealActivityTab; 