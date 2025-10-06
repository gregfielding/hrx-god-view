import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Button,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  Close as CloseIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  People as PeopleIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon
} from '@mui/icons-material';
import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import PostToJobsBoardDialog from './PostToJobsBoardDialog';

interface JobsBoardPostsManagerProps {
  jobOrderId?: string;
  onPostSelect?: (post: JobsBoardPost) => void;
  onCreateNew?: () => void;
}

const JobsBoardPostsManager: React.FC<JobsBoardPostsManagerProps> = ({
  jobOrderId,
  onPostSelect,
  onCreateNew
}) => {
  const { tenantId } = useAuth();
  const [posts, setPosts] = useState<JobsBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('all');
  const [selectedPost, setSelectedPost] = useState<JobsBoardPost | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);

  const jobsBoardService = JobsBoardService.getInstance();

  useEffect(() => {
    loadPosts();
  }, [tenantId, jobOrderId]);

  const loadPosts = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      let postsData: JobsBoardPost[];
      
      if (jobOrderId) {
        postsData = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrderId);
      } else {
        postsData = await jobsBoardService.getPosts(tenantId);
      }
      
      setPosts(postsData);
    } catch (err: any) {
      console.error('Error loading jobs board posts:', err);
      setError(err.message || 'Failed to load jobs board posts');
    } finally {
      setLoading(false);
    }
  };

  const handlePostClick = (post: JobsBoardPost) => {
    setSelectedPost(post);
    setDetailsDialogOpen(true);
    if (onPostSelect) {
      onPostSelect(post);
    }
  };

  const handleStatusChange = async (postId: string, newStatus: 'draft' | 'posted' | 'paused' | 'closed') => {
    if (!tenantId) return;
    
    try {
      // Map old status names to new ones
      const statusMap: Record<string, 'draft' | 'active' | 'paused' | 'cancelled' | 'expired'> = {
        'posted': 'active',
        'closed': 'cancelled',
        'draft': 'draft',
        'paused': 'paused',
        'active': 'active',
        'cancelled': 'cancelled',
        'expired': 'expired'
      };
      await jobsBoardService.updatePostStatus(tenantId, postId, statusMap[newStatus] || newStatus as any);
      await loadPosts(); // Reload to get updated data
    } catch (err: any) {
      console.error('Error updating post status:', err);
      setError(err.message || 'Failed to update post status');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'posted': return 'success';
      case 'draft': return 'default';
      case 'paused': return 'warning';
      case 'closed': return 'error';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'posted': return <VisibilityIcon />;
      case 'draft': return <EditIcon />;
      case 'paused': return <PauseIcon />;
      case 'closed': return <CloseIcon />;
      default: return <WorkIcon />;
    }
  };

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case 'public': return 'success';
      case 'group_restricted': return 'warning';
      case 'hidden': return 'error';
      default: return 'default';
    }
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'public': return <VisibilityIcon />;
      case 'group_restricted': return <PeopleIcon />;
      case 'hidden': return <VisibilityOffIcon />;
      default: return <VisibilityIcon />;
    }
  };

  const filteredPosts = posts.filter(post => {
    const matchesSearch = 
      post.postTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.jobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.jobDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.worksiteName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.companyName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
    const matchesVisibility = visibilityFilter === 'all' || post.visibility === visibilityFilter;
    
    return matchesSearch && matchesStatus && matchesVisibility;
  });

  const getPostAge = (createdAt: Date) => {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdAt.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getAgeColor = (days: number) => {
    if (days <= 7) return 'success';
    if (days <= 14) return 'warning';
    return 'error';
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          Jobs Board Posts
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setPostDialogOpen(true)}
          sx={{ bgcolor: 'primary.main' }}
        >
          Create Post
        </Button>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search posts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="all">All Statuses</MenuItem>
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="posted">Posted</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                  <MenuItem value="closed">Closed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={visibilityFilter}
                  label="Visibility"
                  onChange={(e) => setVisibilityFilter(e.target.value)}
                >
                  <MenuItem value="all">All Visibility</MenuItem>
                  <MenuItem value="public">Public</MenuItem>
                  <MenuItem value="group_restricted">Group Restricted</MenuItem>
                  <MenuItem value="hidden">Hidden</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip 
                  label={`${filteredPosts.length} Posts`} 
                  color="primary" 
                  variant="outlined" 
                />
                <Chip 
                  label={`${posts.filter(p => p.status === 'active').length} Live`} 
                  color="success" 
                  variant="outlined" 
                />
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Posts Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Post</TableCell>
              <TableCell>Company</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Visibility</TableCell>
              <TableCell>Age</TableCell>
              <TableCell>Applications</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredPosts.map((post) => {
              const age = getPostAge(post.createdAt);
              return (
                <TableRow 
                  key={post.id} 
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handlePostClick(post)}
                >
                  <TableCell>
                    <Box>
                      <Typography variant="subtitle2" fontWeight="bold">
                        {post.postTitle}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {post.jobDescription.substring(0, 100)}...
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <BusinessIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {post.companyName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LocationIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {post.worksiteName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(post.status)}
                      label={post.status.toUpperCase()}
                      color={getStatusColor(post.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getVisibilityIcon(post.visibility)}
                      label={post.visibility.replace('_', ' ').toUpperCase()}
                      color={getVisibilityColor(post.visibility) as any}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={`${age} days`}
                      color={getAgeColor(age) as any}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PeopleIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {post.applicationCount}
                        {post.maxApplications && ` / ${post.maxApplications}`}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="View Details">
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePostClick(post);
                          }}
                        >
                          <VisibilityIcon />
                        </IconButton>
                      </Tooltip>
                      {post.status === 'draft' && (
                        <Tooltip title="Publish">
                          <IconButton 
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(post.id, 'posted');
                            }}
                          >
                            <PlayIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {post.status === 'active' && (
                        <Tooltip title="Pause">
                          <IconButton 
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(post.id, 'paused');
                            }}
                          >
                            <PauseIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {post.status === 'paused' && (
                        <Tooltip title="Resume">
                          <IconButton 
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(post.id, 'posted');
                            }}
                          >
                            <PlayIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {filteredPosts.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No jobs board posts found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm || statusFilter !== 'all' || visibilityFilter !== 'all'
              ? 'Try adjusting your search or filter criteria'
              : 'Create your first jobs board post to get started'
            }
          </Typography>
        </Box>
      )}

      {/* Post Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Jobs Board Post Details
        </DialogTitle>
        <DialogContent>
          {selectedPost && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedPost.postTitle}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Company
                  </Typography>
                  <Typography variant="body1">
                    {selectedPost.companyName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Location
                  </Typography>
                  <Typography variant="body1">
                    {selectedPost.worksiteName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    icon={getStatusIcon(selectedPost.status)}
                    label={selectedPost.status.toUpperCase()}
                    color={getStatusColor(selectedPost.status) as any}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Visibility
                  </Typography>
                  <Chip
                    icon={getVisibilityIcon(selectedPost.visibility)}
                    label={selectedPost.visibility.replace('_', ' ').toUpperCase()}
                    color={getVisibilityColor(selectedPost.visibility) as any}
                    size="small"
                    variant="outlined"
                  />
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Description
                  </Typography>
                  <Typography variant="body1">
                    {selectedPost.jobDescription}
                  </Typography>
                </Grid>
                {selectedPost.requirements.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Requirements
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {selectedPost.requirements.map((req, index) => (
                        <Chip key={index} label={req} size="small" />
                      ))}
                    </Box>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Post Creation Dialog */}
      <PostToJobsBoardDialog
        open={postDialogOpen}
        onClose={() => setPostDialogOpen(false)}
        jobOrder={jobOrderId ? { id: jobOrderId } as any : {} as any}
        onPostCreated={(postId) => {
          loadPosts();
          setPostDialogOpen(false);
        }}
      />
    </Box>
  );
};

export default JobsBoardPostsManager;
