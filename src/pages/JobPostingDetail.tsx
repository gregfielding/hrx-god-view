import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  Stack,
  Paper,
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Work as WorkIcon,
  AttachMoney as MoneyIcon,
  Schedule as ScheduleIcon,
  Business as BusinessIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

const JobPostingDetail: React.FC = () => {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  const [posting, setPosting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenantId || !postId) return;

    const loadPosting = async () => {
      try {
        setLoading(true);
        const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
        const postSnap = await getDoc(postRef);

        if (postSnap.exists()) {
          setPosting({ id: postSnap.id, ...postSnap.data() });
        } else {
          setError('Job posting not found');
        }
      } catch (err: any) {
        console.error('Error loading job posting:', err);
        setError(err.message || 'Failed to load job posting');
      } finally {
        setLoading(false);
      }
    };

    loadPosting();
  }, [tenantId, postId]);

  const handleApply = () => {
    if (!user) {
      // Redirect to login/signup with return URL
      navigate(`/apply/${postId}?returnTo=/jobs/${postId}`);
    } else {
      // Navigate to application wizard
      navigate(`/apply/${postId}`);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !posting) {
    return (
      <Box p={3}>
        <Alert severity="error">{error || 'Job posting not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/jobs-board')} sx={{ mt: 2 }}>
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* Back Button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/jobs-board')}
        sx={{ mb: 3 }}
      >
        Back to Jobs Board
      </Button>

      {/* Header */}
      <Paper elevation={2} sx={{ p: 4, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
              {posting.postTitle}
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {posting.companyName && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BusinessIcon fontSize="small" color="primary" />
                  <Typography variant="body1" color="text.secondary">
                    {posting.companyName}
                  </Typography>
                </Box>
              )}
              
              {posting.worksiteName && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon fontSize="small" color="primary" />
                  <Typography variant="body1" color="text.secondary">
                    {posting.worksiteName}
                    {posting.worksiteAddress?.city && `, ${posting.worksiteAddress.city}`}
                    {posting.worksiteAddress?.state && `, ${posting.worksiteAddress.state}`}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip 
                label={posting.jobType === 'gig' ? 'Gig' : 'Career'} 
                color="primary" 
                size="small"
              />
              
              {posting.showPayRate && posting.payRate && (
                <Chip 
                  icon={<MoneyIcon />}
                  label={`$${posting.payRate}/hr`} 
                  color="success" 
                  size="small"
                />
              )}
              
              {posting.workersNeeded && (
                <Chip 
                  icon={<WorkIcon />}
                  label={`${posting.workersNeeded} position${posting.workersNeeded > 1 ? 's' : ''}`} 
                  size="small"
                  variant="outlined"
                />
              )}
              
              {posting.startDate && (
                <Chip 
                  icon={<ScheduleIcon />}
                  label={`Starts ${new Date(posting.startDate).toLocaleDateString()}`} 
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
          </Box>

          <Button
            variant="contained"
            size="large"
            onClick={handleApply}
            sx={{
              minWidth: 200,
              py: 1.5,
              fontSize: '1.1rem',
              fontWeight: 'bold'
            }}
          >
            Apply Now
          </Button>
        </Box>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 3 }}>
        {/* Main Content */}
        <Box>
          {/* Job Description */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                Job Description
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {posting.jobDescription || 'No description provided'}
              </Typography>
            </CardContent>
          </Card>

          {/* Requirements */}
          {(posting.licensesCerts?.length > 0 || 
            posting.skills?.length > 0 || 
            posting.experienceLevels?.length > 0 ||
            posting.educationLevels?.length > 0 ||
            posting.languages?.length > 0 ||
            posting.physicalRequirements?.length > 0 ||
            posting.uniformRequirements?.length > 0 ||
            posting.requiredPpe?.length > 0) && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                  Requirements
                </Typography>
                
                <Stack spacing={2}>
                  {posting.licensesCerts?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Licenses & Certifications
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.licensesCerts.map((cert: string, index: number) => (
                          <Chip key={index} label={cert} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.skills?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Required Skills
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.skills.map((skill: string, index: number) => (
                          <Chip key={index} label={skill} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.experienceLevels?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Experience
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.experienceLevels.map((exp: string, index: number) => (
                          <Chip key={index} label={exp} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.educationLevels?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Education
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.educationLevels.map((edu: string, index: number) => (
                          <Chip key={index} label={edu} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.languages?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Languages
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.languages.map((lang: string, index: number) => (
                          <Chip key={index} label={lang} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.physicalRequirements?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Physical Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.physicalRequirements.map((req: string, index: number) => (
                          <Chip key={index} label={req} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.uniformRequirements?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Uniform Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.uniformRequirements.map((uniform: string, index: number) => (
                          <Chip key={index} label={uniform} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.requiredPpe?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Required PPE
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.requiredPpe.map((ppe: string, index: number) => (
                          <Chip key={index} label={ppe} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Box>

        {/* Sidebar */}
        <Box>
          {/* Quick Apply Card */}
          <Card sx={{ mb: 3, position: 'sticky', top: 80 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                Apply for this Position
              </Typography>
              
              <Divider sx={{ my: 2 }} />
              
              <Stack spacing={2}>
                {posting.showPayRate && posting.payRate && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Pay Rate
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      ${posting.payRate}/hr
                    </Typography>
                  </Box>
                )}
                
                {posting.workersNeeded && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Openings
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {posting.workersNeeded}
                    </Typography>
                  </Box>
                )}
                
                {posting.jobType && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Type
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {posting.jobType === 'gig' ? 'Gig' : 'Career'}
                    </Typography>
                  </Box>
                )}
                
                {posting.startDate && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Start Date
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {new Date(posting.startDate).toLocaleDateString()}
                    </Typography>
                  </Box>
                )}
              </Stack>

              <Button
                variant="contained"
                fullWidth
                size="large"
                onClick={handleApply}
                sx={{ mt: 3, py: 1.5 }}
              >
                Apply Now
              </Button>

              {posting.status === 'expired' && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  This posting has expired
                </Alert>
              )}

              {posting.status === 'paused' && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  This posting is currently paused
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Share Card */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                Share this Job
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Share this job posting with others
              </Typography>
              <Button
                variant="outlined"
                fullWidth
                size="small"
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url);
                  alert('Link copied to clipboard!');
                }}
              >
                Copy Link
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
};

export default JobPostingDetail;

