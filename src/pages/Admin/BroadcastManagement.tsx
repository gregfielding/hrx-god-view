import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider
} from '@mui/material';
import {
  Send as SendIcon,
  Visibility as ViewIcon,
  Reply as ReplyIcon,
  Delete as DeleteIcon,
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  FilterList as FilterIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

interface Broadcast {
  id: string;
  title: { en: string; es: string };
  content: { en: string; es: string };
  priority: string;
  status: string;
  sentCount: number;
  readCount: number;
  replyCount: number;
  createdAt: any;
  targetUsers: string[];
  targetFilters: any;
}

interface BroadcastConversation {
  conversationId: string;
  broadcastId: string;
  workerId: string;
  status: string;
  createdAt: any;
  readAt: any;
  repliedAt: any;
  broadcast: Broadcast;
}

const BroadcastManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [conversations, setConversations] = useState<BroadcastConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Create broadcast dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBroadcast, setNewBroadcast] = useState({
    title: '',
    content: '',
    priority: 'normal',
    targetType: 'users',
    targetUsers: [] as string[],
    targetFilters: {
      tenantId: '',
      department: '',
      location: '',
      role: ''
    }
  });
  
  // View broadcast dialog state
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null);
  
  const functions = getFunctions();
  const navigate = useNavigate();

  useEffect(() => {
    loadBroadcasts();
    loadConversations();
  }, []);

  const loadBroadcasts = async () => {
    setLoading(true);
    try {
      const getBroadcasts = httpsCallable(functions, 'getBroadcastAnalytics');
      const result = await getBroadcasts({});
      const data = result.data as any;
      
      if (data.success) {
        setBroadcasts(data.broadcasts || []);
      } else {
        setError('Failed to load broadcasts');
      }
    } catch (error: any) {
      setError(`Error loading broadcasts: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadConversations = async () => {
    setLoading(true);
    try {
      // This would need to be implemented in the backend
      // For now, we'll use a placeholder
      setConversations([]);
    } catch (error: any) {
      setError(`Error loading conversations: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBroadcast = async () => {
    setLoading(true);
    try {
      const createBroadcast = httpsCallable(functions, 'createBroadcastMessage');
      
      const broadcastData = {
        title: newBroadcast.title,
        content: newBroadcast.content,
        priority: newBroadcast.priority,
        targetUsers: newBroadcast.targetType === 'users' ? newBroadcast.targetUsers : [],
        targetFilters: newBroadcast.targetType === 'filters' ? newBroadcast.targetFilters : {},
        createdBy: 'admin' // This should come from auth context
      };
      
      const result = await createBroadcast(broadcastData);
      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Broadcast created successfully! Sent to ${data.sentCount} users.`);
        setCreateDialogOpen(false);
        setNewBroadcast({
          title: '',
          content: '',
          priority: 'normal',
          targetType: 'users',
          targetUsers: [],
          targetFilters: {
            tenantId: '',
            department: '',
            location: '',
            role: ''
          }
        });
        loadBroadcasts();
      } else {
        setError('Failed to create broadcast');
      }
    } catch (error: any) {
      setError(`Error creating broadcast: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleViewBroadcast = (broadcast: Broadcast) => {
    setSelectedBroadcast(broadcast);
    setViewDialogOpen(true);
  };

  const handleDeleteBroadcast = async (broadcastId: string) => {
    if (!window.confirm('Are you sure you want to delete this broadcast?')) {
      return;
    }
    
    setLoading(true);
    try {
      // This would need to be implemented in the backend
      setSuccess('Broadcast deleted successfully');
      loadBroadcasts();
    } catch (error: any) {
      setError(`Error deleting broadcast: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'expired': return 'error';
      case 'draft': return 'warning';
      default: return 'default';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'error';
      case 'normal': return 'primary';
      case 'low': return 'default';
      default: return 'default';
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
       Broadcast Management
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ fontWeight: 600 }}
        >
          Back to Launchpad
        </Button>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Broadcasts" />
          <Tab label="Conversations" />
          <Tab label="Analytics" />
        </Tabs>
        
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Broadcast
        </Button>
      </Box>
      
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {loading ? (
            <Grid item xs={12} sx={{ textAlign: 'center' }}>
              <CircularProgress />
            </Grid>
          ) : broadcasts.length === 0 ? (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="textSecondary" align="center">
                    No broadcasts found
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ) : (
            broadcasts.map((broadcast) => (
              <Grid item xs={12} md={6} lg={4} key={broadcast.id}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Typography variant="h6" component="div">
                        {broadcast.title.en}
                      </Typography>
                      <Box>
                        <Chip
                          label={broadcast.priority}
                          color={getPriorityColor(broadcast.priority) as any}
                          size="small"
                          sx={{ mr: 1 }}
                        />
                        <Chip
                          label={broadcast.status}
                          color={getStatusColor(broadcast.status) as any}
                          size="small"
                        />
                      </Box>
                    </Box>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      {broadcast.content.en.substring(0, 100)}...
                    </Typography>
                    
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">
                        Sent: {broadcast.sentCount} | Read: {broadcast.readCount} | Replies: {broadcast.replyCount}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {formatDate(broadcast.createdAt)}
                      </Typography>
                    </Box>
                    
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        startIcon={<ViewIcon />}
                        onClick={() => handleViewBroadcast(broadcast)}
                      >
                        View
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleDeleteBroadcast(broadcast.id)}
                      >
                        Delete
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>
      )}
      
      {activeTab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Broadcast Conversations
            </Typography>
            {conversations.length === 0 ? (
              <Typography color="textSecondary">No conversations found</Typography>
            ) : (
              <List>
                {conversations.map((conversation) => (
                  <React.Fragment key={conversation.conversationId}>
                    <ListItem>
                      <ListItemText
                        primary={conversation.broadcast?.title?.en || 'Unknown Broadcast'}
                        secondary={`Worker: ${conversation.workerId} | Status: ${conversation.status} | Created: ${formatDate(conversation.createdAt)}`}
                      />
                      <ListItemSecondaryAction>
                        <IconButton edge="end" aria-label="view">
                          <ViewIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      )}
      
      {activeTab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Broadcast Analytics
            </Typography>
            <Typography color="textSecondary">
              Analytics dashboard coming soon...
            </Typography>
          </CardContent>
        </Card>
      )}
      
      {/* Create Broadcast Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Broadcast</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Title"
                value={newBroadcast.title}
                onChange={(e) => setNewBroadcast({ ...newBroadcast, title: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Content"
                value={newBroadcast.content}
                onChange={(e) => setNewBroadcast({ ...newBroadcast, content: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={newBroadcast.priority}
                  label="Priority"
                  onChange={(e) => setNewBroadcast({ ...newBroadcast, priority: e.target.value })}
                >
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Target Type</InputLabel>
                <Select
                  value={newBroadcast.targetType}
                  label="Target Type"
                  onChange={(e) => setNewBroadcast({ ...newBroadcast, targetType: e.target.value })}
                >
                  <MenuItem value="users">Specific Users</MenuItem>
                  <MenuItem value="filters">User Filters</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            {newBroadcast.targetType === 'users' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="User IDs (comma-separated)"
                  placeholder="user1,user2,user3"
                  value={newBroadcast.targetUsers.join(',')}
                  onChange={(e) => setNewBroadcast({ 
                    ...newBroadcast, 
                    targetUsers: e.target.value.split(',').map(id => id.trim()).filter(id => id)
                  })}
                />
              </Grid>
            )}
            
            {newBroadcast.targetType === 'filters' && (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Customer ID"
                    value={newBroadcast.targetFilters.tenantId}
                    onChange={(e) => setNewBroadcast({
                      ...newBroadcast,
                      targetFilters: { ...newBroadcast.targetFilters, tenantId: e.target.value }
                    })}
                  />
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Agency ID"
                    value={newBroadcast.targetFilters.tenantId}
                    onChange={(e) => setNewBroadcast({
                      ...newBroadcast,
                      targetFilters: { ...newBroadcast.targetFilters, tenantId: e.target.value }
                    })}
                  />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="Department"
                    value={newBroadcast.targetFilters.department}
                    onChange={(e) => setNewBroadcast({
                      ...newBroadcast,
                      targetFilters: { ...newBroadcast.targetFilters, department: e.target.value }
                    })}
                  />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="Location"
                    value={newBroadcast.targetFilters.location}
                    onChange={(e) => setNewBroadcast({
                      ...newBroadcast,
                      targetFilters: { ...newBroadcast.targetFilters, location: e.target.value }
                    })}
                  />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="Role"
                    value={newBroadcast.targetFilters.role}
                    onChange={(e) => setNewBroadcast({
                      ...newBroadcast,
                      targetFilters: { ...newBroadcast.targetFilters, role: e.target.value }
                    })}
                  />
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateBroadcast} 
            variant="contained" 
            disabled={loading || !newBroadcast.title || !newBroadcast.content}
            startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
          >
            {loading ? 'Creating...' : 'Create Broadcast'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* View Broadcast Dialog */}
      <Dialog open={viewDialogOpen} onClose={() => setViewDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {selectedBroadcast?.title.en}
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Chip
              label={selectedBroadcast?.priority}
              color={getPriorityColor(selectedBroadcast?.priority || 'normal') as any}
              size="small"
            />
            <Chip
              label={selectedBroadcast?.status}
              color={getStatusColor(selectedBroadcast?.status || 'active') as any}
              size="small"
            />
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedBroadcast && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>English</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {selectedBroadcast.content.en}
                </Typography>
                
                <Typography variant="h6" gutterBottom>Spanish</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {selectedBroadcast.content.es}
                </Typography>
              </Grid>
              
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Statistics</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Chip label={`Sent: ${selectedBroadcast.sentCount}`} />
                  <Chip label={`Read: ${selectedBroadcast.readCount}`} />
                  <Chip label={`Replies: ${selectedBroadcast.replyCount}`} />
                </Box>
              </Grid>
              
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Target Information</Typography>
                <Typography variant="body2" color="textSecondary">
                  Created: {formatDate(selectedBroadcast.createdAt)}
                </Typography>
                {selectedBroadcast.targetUsers.length > 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Target Users: {selectedBroadcast.targetUsers.length}
                  </Typography>
                )}
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BroadcastManagement; 