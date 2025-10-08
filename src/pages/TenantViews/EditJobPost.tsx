import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Breadcrumbs,
} from '@mui/material';
import { ArrowBack, NavigateNext } from '@mui/icons-material';
import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import JobPostForm from '../../components/JobPostForm';

const EditJobPost: React.FC = () => {
  const { tenantId } = useAuth();
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<JobsBoardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const jobsBoardService = JobsBoardService.getInstance();

  useEffect(() => {
    if (postId && tenantId) {
      loadPost();
    }
  }, [postId, tenantId]);

  const loadPost = async () => {
    if (!tenantId || !postId) return;

    try {
      setLoading(true);
      setError(null);
      const postData = await jobsBoardService.getPost(tenantId, postId);
      setPost(postData);
    } catch (err: any) {
      console.error('Error loading job post:', err);
      setError(err.message || 'Failed to load job post');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updatedPost: Partial<JobsBoardPost>) => {
    if (!tenantId || !postId) return;

    try {
      setSaving(true);
      setError(null);
      
      await jobsBoardService.updatePost(tenantId, postId, updatedPost);
      
      // Navigate back to jobs board
      navigate('/jobs-dashboard');
    } catch (err: any) {
      console.error('Error updating job post:', err);
      setError(err.message || 'Failed to update job post');
      throw err; // Re-throw to let the form handle the error
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/jobs-dashboard');
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
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="contained"
          startIcon={<ArrowBack />}
          onClick={handleCancel}
        >
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  if (!post) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Job post not found
        </Alert>
        <Button
          variant="contained"
          startIcon={<ArrowBack />}
          onClick={handleCancel}
        >
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* Breadcrumb Navigation */}
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs 
          separator={<NavigateNext fontSize="small" />} 
          aria-label="breadcrumb"
          sx={{
            '& .MuiBreadcrumbs-separator': {
              color: 'text.secondary',
              mx: 1
            }
          }}
        >
          <Typography 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              '&:hover': {
                color: 'primary.main'
              }
            }}
            onClick={() => navigate('/jobs-dashboard')}
          >
            Jobs Board
          </Typography>
          <Typography 
            color="text.primary" 
            sx={{ 
              fontSize: '0.875rem',
              fontWeight: 600
            }}
          >
            {post.postTitle}
          </Typography>
        </Breadcrumbs>
      </Box>

      <Paper elevation={1} sx={{ p: 4, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Edit Job Post: {post.postTitle}
          </Typography>
          <Button
            startIcon={<ArrowBack />}
            onClick={handleCancel}
          >
            Back
          </Button>
        </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <JobPostForm
        initialData={post}
        onSave={handleSave}
        onCancel={handleCancel}
        loading={saving}
        mode="edit"
      />
      </Paper>
    </Box>
  );
};

export default EditJobPost;
