import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Autocomplete,
} from '@mui/material';
import { Search, LocationOn, Business, Schedule, Work, AttachMoney, People, Add } from '@mui/icons-material';
import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';

const JobsBoard: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [posts, setPosts] = useState<JobsBoardPost[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<JobsBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [openNewPostModal, setOpenNewPostModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const jobsBoardService = JobsBoardService.getInstance();

  // New post form state
  const [newPost, setNewPost] = useState({
    title: '',
    description: '',
    companyName: '',
    location: '',
    startDate: '',
    payRate: '',
    showPayRate: true,
    visibility: 'public' as 'public' | 'limited' | 'private',
    sourceType: 'generic' as 'generic' | 'job_order',
    sourceId: '',
  });

  // Load jobs board posts from Firestore
  useEffect(() => {
    loadPosts();
  }, [tenantId]);

  const loadPosts = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      const postsData = await jobsBoardService.getPublicPosts(tenantId);
      setPosts(postsData);
      setFilteredJobs(postsData);
    } catch (err: any) {
      console.error('Error loading jobs board posts:', err);
      setError(err.message || 'Failed to load jobs board posts');
    } finally {
      setLoading(false);
    }
  };

  // Filter jobs based on search and filters
  useEffect(() => {
    let filtered = posts;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(post =>
        post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.companyName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter(post => post.location === locationFilter);
    }

    // Company filter
    if (companyFilter !== 'all') {
      filtered = filtered.filter(post => post.companyName === companyFilter);
    }

    setFilteredJobs(filtered);
  }, [posts, searchTerm, locationFilter, companyFilter]);

  const getUniqueLocations = () => {
    return Array.from(new Set(posts.map(post => post.location))).sort();
  };

  const getUniqueCompanies = () => {
    return Array.from(new Set(posts.map(post => post.companyName))).sort();
  };

  const handleOpenNewPostModal = () => {
    setOpenNewPostModal(true);
    setSubmitError(null);
  };

  const handleCloseNewPostModal = () => {
    setOpenNewPostModal(false);
    setNewPost({
      title: '',
      description: '',
      companyName: '',
      location: '',
      startDate: '',
      payRate: '',
      showPayRate: true,
      visibility: 'public',
      sourceType: 'generic',
      sourceId: '',
    });
    setSubmitError(null);
  };

  const handleSubmitNewPost = async () => {
    if (!tenantId) return;

    // Validation
    if (!newPost.title.trim()) {
      setSubmitError('Job title is required');
      return;
    }
    if (!newPost.description.trim()) {
      setSubmitError('Job description is required');
      return;
    }
    if (!newPost.companyName.trim()) {
      setSubmitError('Company name is required');
      return;
    }
    if (!newPost.location.trim()) {
      setSubmitError('Location is required');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      await jobsBoardService.createPost(
        tenantId,
        {
          title: newPost.title.trim(),
          description: newPost.description.trim(),
          companyName: newPost.companyName.trim(),
          location: newPost.location.trim(),
          startDate: newPost.startDate || null,
          payRate: newPost.payRate ? parseFloat(newPost.payRate) : null,
          showPayRate: newPost.showPayRate,
          visibility: newPost.visibility,
          sourceType: newPost.sourceType,
          sourceId: newPost.sourceId || null,
        },
        user?.uid || 'system'
      );

      handleCloseNewPostModal();
      loadPosts(); // Reload posts
    } catch (err: any) {
      console.error('Error creating job post:', err);
      setSubmitError(err.message || 'Failed to create job post');
    } finally {
      setSubmitting(false);
    }
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
    <Box sx={{ p: 0, width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Jobs Board
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleOpenNewPostModal}
        >
          New Post
        </Button>
      </Stack>

      {/* Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              placeholder="Search jobs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem value="all">All Locations</MenuItem>
                {getUniqueLocations().map(location => (
                  <MenuItem key={location} value={location}>{location}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={companyFilter}
                label="Company"
                onChange={(e) => setCompanyFilter(e.target.value)}
              >
                <MenuItem value="all">All Companies</MenuItem>
                {getUniqueCompanies().map(company => (
                  <MenuItem key={company} value={company}>{company}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Typography variant="body2" color="text.secondary">
              {filteredJobs.length} jobs found
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((post) => (
            <Grid item xs={12} md={6} lg={4} key={post.id}>
              <Card elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                      {post.title}
                    </Typography>
                    <Chip
                      label="OPEN"
                      color="success"
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
                    {post.description.length > 150 
                      ? `${post.description.substring(0, 150)}...` 
                      : post.description
                    }
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Business sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {post.companyName}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {post.location}
                    </Typography>
                  </Box>

                  {post.startDate && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Schedule sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        Starts: {new Date(post.startDate).toLocaleDateString()}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <People sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {post.applicationCount} applications
                      </Typography>
                    </Box>
                    {post.payRate && post.showPayRate && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <AttachMoney sx={{ fontSize: 16, color: 'primary.main' }} />
                        <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
                          ${post.payRate}/hr
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Button 
                    variant="contained" 
                    fullWidth
                    sx={{ mt: 'auto' }}
                  >
                    Apply Now
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* New Post Modal */}
      <Dialog 
        open={openNewPostModal} 
        onClose={handleCloseNewPostModal}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Create New Job Post</DialogTitle>
        <DialogContent>
          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}
          
          <Stack spacing={3} sx={{ mt: 2 }}>
            <TextField
              label="Job Title"
              value={newPost.title}
              onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
              fullWidth
              required
            />

            <TextField
              label="Job Description"
              value={newPost.description}
              onChange={(e) => setNewPost({ ...newPost, description: e.target.value })}
              fullWidth
              required
              multiline
              rows={4}
              helperText="Provide a detailed description of the role, responsibilities, and requirements"
            />

            <TextField
              label="Company Name"
              value={newPost.companyName}
              onChange={(e) => setNewPost({ ...newPost, companyName: e.target.value })}
              fullWidth
              required
            />

            <TextField
              label="Location"
              value={newPost.location}
              onChange={(e) => setNewPost({ ...newPost, location: e.target.value })}
              fullWidth
              required
              helperText="City, State or full address"
            />

            <TextField
              label="Start Date"
              type="date"
              value={newPost.startDate}
              onChange={(e) => setNewPost({ ...newPost, startDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <Stack direction="row" spacing={2}>
              <TextField
                label="Pay Rate ($/hr)"
                type="number"
                value={newPost.payRate}
                onChange={(e) => setNewPost({ ...newPost, payRate: e.target.value })}
                fullWidth
                inputProps={{ min: 0, step: 0.01 }}
              />

              <FormControl fullWidth>
                <InputLabel>Show Pay Rate</InputLabel>
                <Select
                  value={newPost.showPayRate ? 'yes' : 'no'}
                  label="Show Pay Rate"
                  onChange={(e) => setNewPost({ ...newPost, showPayRate: e.target.value === 'yes' })}
                >
                  <MenuItem value="yes">Yes</MenuItem>
                  <MenuItem value="no">No</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <FormControl fullWidth>
              <InputLabel>Visibility</InputLabel>
              <Select
                value={newPost.visibility}
                label="Visibility"
                onChange={(e) => setNewPost({ ...newPost, visibility: e.target.value as any })}
              >
                <MenuItem value="public">Public - Visible to everyone</MenuItem>
                <MenuItem value="limited">Limited - Visible to specific user groups</MenuItem>
                <MenuItem value="private">Private - Internal only</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Source Type</InputLabel>
              <Select
                value={newPost.sourceType}
                label="Source Type"
                onChange={(e) => setNewPost({ ...newPost, sourceType: e.target.value as any })}
              >
                <MenuItem value="generic">Generic - Standalone posting</MenuItem>
                <MenuItem value="job_order">Job Order - Linked to a job order</MenuItem>
              </Select>
            </FormControl>

            {newPost.sourceType === 'job_order' && (
              <TextField
                label="Job Order ID"
                value={newPost.sourceId}
                onChange={(e) => setNewPost({ ...newPost, sourceId: e.target.value })}
                fullWidth
                helperText="Enter the ID of the job order this posting is linked to"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseNewPostModal} disabled={submitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmitNewPost} 
            variant="contained" 
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create Post'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobsBoard; 