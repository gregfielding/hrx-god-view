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
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Divider,
  Tabs,
  Tab,
  IconButton,
  CardMedia,
} from '@mui/material';
import {
  Search,
  LocationOn,
  Business,
  Schedule,
  AttachMoney,
  Work,
  School,
  Person,
  People,
  Security,
  HealthAndSafety,
  Language,
  FitnessCenter,
  Checkroom,
  Build,
  BookmarkBorder,
  Bookmark,
  Close,
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';

interface PublicJobPosting {
  id: string;
  tenantId: string;
  postTitle: string;
  jobTitle?: string;
  jobType: 'gig' | 'career';
  jobDescription: string;
  companyName: string;
  worksiteName: string;
  worksiteAddress?: {
    street?: string;
    city: string;
    state: string;
    zipCode?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  startDate?: Date;
  endDate?: Date;
  expDate?: Date;
  showStart?: boolean;
  showEnd?: boolean;
  payRate?: number;
  showPayRate: boolean;
  workersNeeded?: number;
  eVerifyRequired?: boolean;
  backgroundCheckPackages?: string[];
  showBackgroundChecks?: boolean;
  drugScreeningPanels?: string[];
  showDrugScreening?: boolean;
  additionalScreenings?: string[];
  showAdditionalScreenings?: boolean;
  skills?: string[];
  showSkills?: boolean;
  licensesCerts?: string[];
  showLicensesCerts?: boolean;
  experienceLevels?: string[];
  showExperience?: boolean;
  educationLevels?: string[];
  showEducation?: boolean;
  languages?: string[];
  showLanguages?: boolean;
  physicalRequirements?: string[];
  showPhysicalRequirements?: boolean;
  uniformRequirements?: string[];
  showUniformRequirements?: boolean;
  requiredPpe?: string[];
  showRequiredPpe?: boolean;
  shift?: string[];
  showShift: boolean;
  startTime?: string;
  endTime?: string;
  showStartTime?: boolean;
  showEndTime?: boolean;
  status: string;
  visibility: string;
  createdAt: Date;
  benefits?: string;
}

const PublicJobsBoard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, securityLevel } = useAuth();

  const [jobs, setJobs] = useState<PublicJobPosting[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<PublicJobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<PublicJobPosting | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [savedJobs, setSavedJobs] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [sortBy, setSortBy] = useState('newest');
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [jobViewFilter, setJobViewFilter] = useState('all');

  // Check if we're on the C1 route and should use specific tenantId
  const isC1Route = location.pathname.startsWith('/c1/');
  const specificTenantId = isC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : null;

  useEffect(() => {
    loadPublicJobs();
    loadSavedJobs();
    requestLocationPermission();
  }, [specificTenantId]);

  // Request user's location permission and get coordinates
  const requestLocationPermission = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setLocationPermission('granted');
        },
        (error) => {
          console.warn('Location permission denied or error:', error);
          setLocationPermission('denied');
        }
      );
    } else {
      console.warn('Geolocation not supported');
      setLocationPermission('denied');
    }
  };

  // Calculate distance between two points using Haversine formula (in miles)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
  };

  // Load saved jobs from localStorage
  const loadSavedJobs = () => {
    try {
      const saved = localStorage.getItem('savedJobs');
      if (saved) {
        setSavedJobs(JSON.parse(saved));
      }
    } catch (err) {
      console.warn('Failed to load saved jobs:', err);
    }
  };

  // Save job to localStorage
  const saveJob = (jobId: string) => {
    try {
      const updatedSavedJobs = [...savedJobs, jobId];
      setSavedJobs(updatedSavedJobs);
      localStorage.setItem('savedJobs', JSON.stringify(updatedSavedJobs));
    } catch (err) {
      console.warn('Failed to save job:', err);
    }
  };

  // Remove job from saved jobs
  const unsaveJob = (jobId: string) => {
    try {
      const updatedSavedJobs = savedJobs.filter(id => id !== jobId);
      setSavedJobs(updatedSavedJobs);
      localStorage.setItem('savedJobs', JSON.stringify(updatedSavedJobs));
    } catch (err) {
      console.warn('Failed to unsave job:', err);
    }
  };

  const loadPublicJobs = async () => {
    try {
      setLoading(true);
      const jobsBoardService = JobsBoardService.getInstance();
      
      const allJobs: PublicJobPosting[] = [];

      if (specificTenantId) {
        // If we're on the C1 route, only load jobs from the specific tenant
        try {
          const publicPosts = await jobsBoardService.getPostsByVisibility(specificTenantId, 'public');
          
          // Filter for active posts only
          const activePosts = publicPosts.filter(post => post.status === 'active');
          
          // Convert to PublicJobPosting format
          const convertedPosts: PublicJobPosting[] = activePosts.map(post => ({
            id: post.id,
            tenantId: post.tenantId,
            postTitle: post.postTitle,
            jobTitle: post.jobTitle,
            jobType: post.jobType,
            jobDescription: post.jobDescription,
            companyName: post.companyName,
            worksiteName: post.worksiteName,
            worksiteAddress: post.worksiteAddress,
            startDate: post.startDate,
            endDate: post.endDate,
            expDate: post.expDate,
            showStart: post.showStart,
            showEnd: post.showEnd,
            payRate: post.payRate,
            showPayRate: post.showPayRate,
            workersNeeded: post.workersNeeded,
            eVerifyRequired: post.eVerifyRequired,
            backgroundCheckPackages: post.backgroundCheckPackages,
            showBackgroundChecks: post.showBackgroundChecks,
            drugScreeningPanels: post.drugScreeningPanels,
            showDrugScreening: post.showDrugScreening,
            additionalScreenings: post.additionalScreenings,
            showAdditionalScreenings: post.showAdditionalScreenings,
            skills: post.skills,
            showSkills: post.showSkills,
            licensesCerts: post.licensesCerts,
            showLicensesCerts: post.showLicensesCerts,
            experienceLevels: post.experienceLevels,
            showExperience: post.showExperience,
            educationLevels: post.educationLevels,
            showEducation: post.showEducation,
            languages: post.languages,
            showLanguages: post.showLanguages,
            physicalRequirements: post.physicalRequirements,
            showPhysicalRequirements: post.showPhysicalRequirements,
            uniformRequirements: post.uniformRequirements,
            showUniformRequirements: post.showUniformRequirements,
            requiredPpe: post.requiredPpe,
            showRequiredPpe: post.showRequiredPpe,
            shift: post.shift,
            showShift: post.showShift,
            startTime: post.startTime,
            endTime: post.endTime,
            showStartTime: post.showStartTime,
            showEndTime: post.showEndTime,
            status: post.status,
            visibility: post.visibility,
            createdAt: post.createdAt,
            benefits: post.benefits,
          }));
          
          allJobs.push(...convertedPosts);
        } catch (err) {
          console.error(`Failed to load jobs for specific tenant ${specificTenantId}:`, err);
        }
      } else {
        // Original behavior: Query all tenants for public job postings
        const tenantsSnapshot = await getDocs(collection(db, 'tenants'));

        for (const tenantDoc of tenantsSnapshot.docs) {
          const tenantId = tenantDoc.id;
          
          try {
            // Use the JobsBoardService to get public posts
            const publicPosts = await jobsBoardService.getPostsByVisibility(tenantId, 'public');
            
            // Filter for active posts only
            const activePosts = publicPosts.filter(post => post.status === 'active');
            
            // Convert to PublicJobPosting format
            const convertedPosts: PublicJobPosting[] = activePosts.map(post => ({
              id: post.id,
              tenantId: post.tenantId,
              postTitle: post.postTitle,
              jobTitle: post.jobTitle,
              jobType: post.jobType,
              jobDescription: post.jobDescription,
              companyName: post.companyName,
              worksiteName: post.worksiteName,
              worksiteAddress: post.worksiteAddress,
              startDate: post.startDate,
              endDate: post.endDate,
              expDate: post.expDate,
              showStart: post.showStart,
              showEnd: post.showEnd,
              payRate: post.payRate,
              showPayRate: post.showPayRate,
              workersNeeded: post.workersNeeded,
              eVerifyRequired: post.eVerifyRequired,
              backgroundCheckPackages: post.backgroundCheckPackages,
              showBackgroundChecks: post.showBackgroundChecks,
              drugScreeningPanels: post.drugScreeningPanels,
              showDrugScreening: post.showDrugScreening,
              additionalScreenings: post.additionalScreenings,
              showAdditionalScreenings: post.showAdditionalScreenings,
              skills: post.skills,
              showSkills: post.showSkills,
              licensesCerts: post.licensesCerts,
              showLicensesCerts: post.showLicensesCerts,
              experienceLevels: post.experienceLevels,
              showExperience: post.showExperience,
              educationLevels: post.educationLevels,
              showEducation: post.showEducation,
              languages: post.languages,
              showLanguages: post.showLanguages,
              physicalRequirements: post.physicalRequirements,
              showPhysicalRequirements: post.showPhysicalRequirements,
              uniformRequirements: post.uniformRequirements,
              showUniformRequirements: post.showUniformRequirements,
              requiredPpe: post.requiredPpe,
              showRequiredPpe: post.showRequiredPpe,
              shift: post.shift,
              showShift: post.showShift,
              startTime: post.startTime,
              endTime: post.endTime,
              showStartTime: post.showStartTime,
              showEndTime: post.showEndTime,
              status: post.status,
              visibility: post.visibility,
              createdAt: post.createdAt,
              benefits: post.benefits,
            }));
            
            allJobs.push(...convertedPosts);
          } catch (err) {
            console.warn(`Failed to load jobs for tenant ${tenantId}:`, err);
            // Continue with other tenants
          }
        }
      }

      // Sort by creation date (newest first)
      allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setJobs(allJobs);
      setFilteredJobs(allJobs);
    } catch (err: any) {
      console.error('Error loading public jobs:', err);
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = jobs;

    if (searchTerm) {
      filtered = filtered.filter(
        (job) =>
          job.postTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (job.jobTitle && job.jobTitle.toLowerCase().includes(searchTerm.toLowerCase())) ||
          job.jobDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.worksiteName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (job.skills && job.skills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase())))
      );
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter((job) => 
        job.worksiteAddress && 
        job.worksiteAddress.city && 
        job.worksiteAddress.state &&
        `${job.worksiteAddress.city}, ${job.worksiteAddress.state}` === locationFilter
      );
    }

    if (jobTypeFilter !== 'all') {
      filtered = filtered.filter((job) => job.jobType === jobTypeFilter);
    }

    if (jobViewFilter === 'bookmarked') {
      filtered = filtered.filter((job) => savedJobs.includes(job.id));
    }

    // Apply sorting
    if (sortBy === 'closest' && userLocation) {
      // Sort by distance (closest first)
      filtered = filtered.filter(job => 
        job.worksiteAddress?.coordinates?.lat && job.worksiteAddress?.coordinates?.lng
      ).sort((a, b) => {
        const distanceA = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          a.worksiteAddress!.coordinates!.lat,
          a.worksiteAddress!.coordinates!.lng
        );
        const distanceB = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          b.worksiteAddress!.coordinates!.lat,
          b.worksiteAddress!.coordinates!.lng
        );
        return distanceA - distanceB;
      });
    } else {
      // Default sort by newest
      filtered = filtered.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    setFilteredJobs(filtered);
  }, [jobs, searchTerm, locationFilter, jobTypeFilter, jobViewFilter, savedJobs, sortBy, userLocation]);

  const getUniqueLocations = () => {
    const locations = new Set<string>();
    jobs.forEach(job => {
      if (job.worksiteAddress && job.worksiteAddress.city && job.worksiteAddress.state) {
        locations.add(`${job.worksiteAddress.city}, ${job.worksiteAddress.state}`);
      }
    });
    return Array.from(locations).sort();
  };


  const handleApply = (job: PublicJobPosting) => {
    // Navigate to application page (to be created)
    navigate(`/apply/${job.tenantId}/${job.id}`);
  };

  const handleCardClick = (job: PublicJobPosting) => {
    setSelectedJob(job);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedJob(null);
    setActiveTab(0); // Reset to first tab
  };

  // Helper function to safely format dates for display
  const formatDateForDisplay = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      let date: Date;
      
      if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        // Firestore Timestamp
        date = dateValue.toDate();
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        // Date object
        date = dateValue;
      } else {
        date = new Date(dateValue);
      }
      
      return isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    } catch (error) {
      console.warn('Error formatting date for display:', dateValue, error);
      return '';
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  // If user is logged in, show with Layout component (sidebar handled by Layout)
  if (user) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Paper elevation={1} sx={{ p: 4, borderRadius: 2 }}>
          <Box sx={{ mb: 4 }}>
        {/* Main Page Title - Centered */}
        <Typography variant="h3" gutterBottom sx={{ fontWeight: 700, fontSize: '2.2rem', textAlign: 'center', mb: 3 }}>
          {isC1Route ? 'Jobs Board' : 'Find Your Next Opportunity'}
        </Typography>

        {/* C1 Logo - Centered below title */}
        {isC1Route && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <img 
              src="/C1_Logo.jpg" 
              alt="C1 Staffing" 
              style={{ 
                height: '96px', 
                width: 'auto',
                objectFit: 'contain'
              }}
              onError={(e) => {
                // Fallback if logo doesn't exist yet
                e.currentTarget.style.display = 'none';
              }}
            />
          </Box>
        )}
      </Box>

      {/* Search and Filters */}
      <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              placeholder="Search jobs by title, description, company, or skills..."
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
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem value="all">All Locations</MenuItem>
                {getUniqueLocations().map((location) => (
                  <MenuItem key={location} value={location}>
                    {location}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Job Type</InputLabel>
              <Select
                value={jobTypeFilter}
                label="Job Type"
                onChange={(e) => setJobTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="gig">Gig</MenuItem>
                <MenuItem value="career">Career</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>View</InputLabel>
              <Select
                value={jobViewFilter}
                label="View"
                onChange={(e) => setJobViewFilter(e.target.value)}
              >
                <MenuItem value="all">All Jobs</MenuItem>
                <MenuItem value="bookmarked">Bookmarked Jobs</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
                onChange={(e) => setSortBy(e.target.value)}
              >
                <MenuItem value="newest">Newest First</MenuItem>
                {userLocation && locationPermission === 'granted' && (
                  <MenuItem value="closest">Closest to Me</MenuItem>
                )}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {(searchTerm || locationFilter !== 'all' || jobTypeFilter !== 'all' || jobViewFilter !== 'all' || sortBy !== 'newest') && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSearchTerm('');
                setLocationFilter('all');
                setJobTypeFilter('all');
                setJobViewFilter('all');
                setSortBy('newest');
              }}
            >
              Clear Filters
            </Button>
          )}
        </Box>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} key={`${job.tenantId}-${job.id}`}>
              <Card
                elevation={2}
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                  position: 'relative',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                }}
                onClick={() => handleCardClick(job)}
              >
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Job Title and Bookmark on same line */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600, flex: 1 }}>
                      {job.postTitle}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent card click
                        if (savedJobs.includes(job.id)) {
                          unsaveJob(job.id);
                        } else {
                          saveJob(job.id);
                        }
                      }}
                      sx={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 1)',
                        }
                      }}
                    >
                      {savedJobs.includes(job.id) ? <Bookmark /> : <BookmarkBorder />}
                    </IconButton>
                  </Box>

                  {job.payRate && job.showPayRate && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${job.payRate}/hr
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {job.companyName}
                    </Typography>
                  </Box>

                  {job.jobTitle && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Work sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.jobTitle}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.worksiteAddress?.city && job.worksiteAddress?.state ? (
                        `${job.worksiteAddress.city}, ${job.worksiteAddress.state}${job.worksiteAddress.zipCode ? ` ${job.worksiteAddress.zipCode}` : ''}`
                      ) : (
                        job.worksiteName
                      )}
                    </Typography>
                  </Box>

                  {job.startDate && job.showStart && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Schedule sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        Starts: {formatDateForDisplay(job.startDate)}
                      </Typography>
                    </Box>
                  )}

                  {job.shift && job.shift.length > 0 && job.showShift && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Build sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.shift.slice(0, 2).join(', ')}
                        {job.shift.length > 2 && ` +${job.shift.length - 2} more`}
                      </Typography>
                    </Box>
                  )}



                  <Box sx={{ mt: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {/* E-Verify in footer (left side) */}
                    {job.eVerifyRequired && (
                      <img 
                        src="/img/everify.png" 
                        alt="E-Verify" 
                        style={{ 
                          height: '30px', 
                          width: 'auto',
                          objectFit: 'contain'
                        }}
                      />
                    )}
                    
                    {/* Apply Now button (right side, half width) */}
                    <Button 
                      variant="contained" 
                      sx={{ 
                        width: '50%',
                        ml: job.eVerifyRequired ? 'auto' : 0
                      }} 
                      onClick={() => handleApply(job)}
                    >
                      Apply Now
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Job Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="lg"
        fullWidth
        scroll="paper"
      >
        {selectedJob && (
          <>
            {/* Dialog Header */}
            <DialogTitle sx={{ pb: 1 }}>
              <Box sx={{ mb: 2, position: 'relative' }}>
                <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
                  {selectedJob.postTitle}
                </Typography>
                
                {/* E-Verify Image */}
                {selectedJob.eVerifyRequired && (
                  <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                    <img 
                      src="/img/everify.png" 
                      alt="E-Verify" 
                      style={{ 
                        height: '60px', 
                        width: 'auto',
                        objectFit: 'contain'
                      }} 
                    />
                  </Box>
                )}
                
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {selectedJob.companyName}
                    </Typography>
                    {selectedJob.payRate && selectedJob.showPayRate && (
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${selectedJob.payRate}/hr
                      </Typography>
                    )}
                  </Stack>
                  
                  {selectedJob.jobTitle && (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Work sx={{ fontSize: 20, color: 'text.secondary' }} />
                      <Typography variant="body1">
                        {selectedJob.jobTitle}
                      </Typography>
                    </Stack>
                  )}
                  
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LocationOn sx={{ fontSize: 20, color: 'text.secondary' }} />
                    <Typography variant="body1">
                      {selectedJob.worksiteAddress?.city && selectedJob.worksiteAddress?.state ? (
                        `${selectedJob.worksiteAddress.city}, ${selectedJob.worksiteAddress.state}${selectedJob.worksiteAddress.zipCode ? ` ${selectedJob.worksiteAddress.zipCode}` : ''}`
                      ) : (
                        selectedJob.worksiteName
                      )}
                    </Typography>
                  </Stack>
                  
                  {/* Schedule in Header */}
                  {(selectedJob.startDate || selectedJob.endDate || selectedJob.startTime || selectedJob.endTime) && (
                    <Stack spacing={1}>
                      {selectedJob.startDate && selectedJob.showStart && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            Start Date: {formatDateForDisplay(selectedJob.startDate)}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.endDate && selectedJob.showEnd && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Date: {formatDateForDisplay(selectedJob.endDate)}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.startTime && selectedJob.showStartTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            Start Time: {selectedJob.startTime}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.endTime && selectedJob.showEndTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Time: {selectedJob.endTime}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Box>
            </DialogTitle>

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                  <Tab label="Job Description" />
                  <Tab label="Requirements" />
                </Tabs>
            </Box>

            {/* Tab Content */}
            <DialogContent sx={{ px: 3, py: 4 }}>
              {/* Job Description Tab */}
              {activeTab === 0 && (
                <Stack spacing={4}>
                  {/* Job Description */}
                  <Box>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {selectedJob.jobDescription}
                    </Typography>
                  </Box>



                  {/* Shift Details */}
                  {selectedJob.shift && selectedJob.shift.length > 0 && selectedJob.showShift && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Work sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Shift Details
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.shift.map((shift, index) => (
                          <Chip key={index} label={shift} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Benefits */}
                  {selectedJob.benefits && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Benefits
                      </Typography>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                        {selectedJob.benefits}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

              {/* Requirements Tab */}
              {activeTab === 1 && (
                <Stack spacing={4}>
                  {/* Skills */}
                  {selectedJob.skills && selectedJob.skills.length > 0 && selectedJob.showSkills && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Required Skills
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.skills.map((skill, index) => (
                          <Chip key={index} label={skill} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Licenses & Certifications */}
                  {selectedJob.licensesCerts && selectedJob.licensesCerts.length > 0 && selectedJob.showLicensesCerts && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Licenses & Certifications
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.licensesCerts.map((license, index) => (
                          <Chip key={index} label={license} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Experience */}
                  {selectedJob.experienceLevels && selectedJob.experienceLevels.length > 0 && selectedJob.showExperience && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Person sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Experience Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.experienceLevels.map((experience, index) => (
                          <Chip key={index} label={experience} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Education */}
                  {selectedJob.educationLevels && selectedJob.educationLevels.length > 0 && selectedJob.showEducation && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <School sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Education Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.educationLevels.map((education, index) => (
                          <Chip key={index} label={education} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Languages */}
                  {selectedJob.languages && selectedJob.languages.length > 0 && selectedJob.showLanguages && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Language sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Language Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.languages.map((language, index) => (
                          <Chip key={index} label={language} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Physical Requirements */}
                  {selectedJob.physicalRequirements && selectedJob.physicalRequirements.length > 0 && selectedJob.showPhysicalRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <FitnessCenter sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Physical Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.physicalRequirements.map((requirement, index) => (
                          <Chip key={index} label={requirement} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Uniform Requirements */}
                  {selectedJob.uniformRequirements && selectedJob.uniformRequirements.length > 0 && selectedJob.showUniformRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Checkroom sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Uniform Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.uniformRequirements.map((uniform, index) => (
                          <Chip key={index} label={uniform} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Required PPE */}
                  {selectedJob.requiredPpe && selectedJob.requiredPpe.length > 0 && selectedJob.showRequiredPpe && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Required PPE
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.requiredPpe.map((ppe, index) => (
                          <Chip key={index} label={ppe} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Background Checks */}
                  {selectedJob.backgroundCheckPackages && selectedJob.backgroundCheckPackages.length > 0 && selectedJob.showBackgroundChecks && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Background Check Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.backgroundCheckPackages.map((check, index) => (
                          <Chip key={index} label={check} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Drug Screening */}
                  {selectedJob.drugScreeningPanels && selectedJob.drugScreeningPanels.length > 0 && selectedJob.showDrugScreening && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Drug Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.drugScreeningPanels.map((panel, index) => (
                          <Chip key={index} label={panel} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Additional Screenings */}
                  {selectedJob.additionalScreenings && selectedJob.additionalScreenings.length > 0 && selectedJob.showAdditionalScreenings && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Build sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Additional Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.additionalScreenings.map((screening, index) => (
                          <Chip key={index} label={screening} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* E-Verify */}
                  {selectedJob.eVerifyRequired && (
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 500, color: 'warning.main' }}>
                        E-Verify Required
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

            </DialogContent>

            {/* Dialog Footer */}
            <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
              <Button
                startIcon={savedJobs.includes(selectedJob.id) ? <Bookmark /> : <BookmarkBorder />}
                onClick={() => {
                  if (savedJobs.includes(selectedJob.id)) {
                    unsaveJob(selectedJob.id);
                  } else {
                    saveJob(selectedJob.id);
                  }
                }}
                sx={{ mr: 'auto' }}
              >
                {savedJobs.includes(selectedJob.id) ? 'Saved' : 'Save Job'}
              </Button>
              
              <Button onClick={handleCloseDialog} sx={{ mr: 1 }}>
                Close
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleApply(selectedJob)}
                sx={{ 
                  minWidth: 120,
                  backgroundColor: 'success.main',
                  '&:hover': {
                    backgroundColor: 'success.dark',
                  }
                }}
              >
                Apply Now
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
        </Paper>
      </Container>
    );
  }

  // If user is not logged in, show public view
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Paper elevation={1} sx={{ p: 4, borderRadius: 2 }}>
        <Box sx={{ mb: 4 }}>
        {/* Main Page Title - Centered */}
        <Typography variant="h3" gutterBottom sx={{ fontWeight: 700, fontSize: '2.2rem', textAlign: 'center', mb: 3 }}>
          {isC1Route ? 'Jobs Board' : 'Find Your Next Opportunity'}
        </Typography>

        {/* C1 Logo - Centered below title */}
        {isC1Route && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <img 
              src="/C1_Logo.jpg" 
              alt="C1 Staffing" 
              style={{ 
                height: '96px', 
                width: 'auto',
                objectFit: 'contain'
              }}
              onError={(e) => {
                // Fallback if logo doesn't exist yet
                e.currentTarget.style.display = 'none';
              }}
            />
          </Box>
        )}
      </Box>

      {/* Search and Filters */}
      <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              placeholder="Search jobs by title, description, company, or skills..."
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
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem value="all">All Locations</MenuItem>
                {getUniqueLocations().map((location) => (
                  <MenuItem key={location} value={location}>
                    {location}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Job Type</InputLabel>
              <Select
                value={jobTypeFilter}
                label="Job Type"
                onChange={(e) => setJobTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="gig">Gig</MenuItem>
                <MenuItem value="career">Career</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>View</InputLabel>
              <Select
                value={jobViewFilter}
                label="View"
                onChange={(e) => setJobViewFilter(e.target.value)}
              >
                <MenuItem value="all">All Jobs</MenuItem>
                <MenuItem value="bookmarked">Bookmarked Jobs</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
                onChange={(e) => setSortBy(e.target.value)}
              >
                <MenuItem value="newest">Newest First</MenuItem>
                {userLocation && locationPermission === 'granted' && (
                  <MenuItem value="closest">Closest to Me</MenuItem>
                )}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {(searchTerm || locationFilter !== 'all' || jobTypeFilter !== 'all' || jobViewFilter !== 'all' || sortBy !== 'newest') && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSearchTerm('');
                setLocationFilter('all');
                setJobTypeFilter('all');
                setJobViewFilter('all');
                setSortBy('newest');
              }}
            >
              Clear Filters
            </Button>
          )}
        </Box>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} key={`${job.tenantId}-${job.id}`}>
              <Card
                elevation={2}
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                  position: 'relative',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                }}
                onClick={() => handleCardClick(job)}
              >
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Job Title and Bookmark on same line */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600, flex: 1 }}>
                      {job.postTitle}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent card click
                        if (savedJobs.includes(job.id)) {
                          unsaveJob(job.id);
                        } else {
                          saveJob(job.id);
                        }
                      }}
                      sx={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 1)',
                        }
                      }}
                    >
                      {savedJobs.includes(job.id) ? <Bookmark /> : <BookmarkBorder />}
                    </IconButton>
                  </Box>

                  {job.payRate && job.showPayRate && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${job.payRate}/hr
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {job.companyName}
                    </Typography>
                  </Box>

                  {job.jobTitle && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Work sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.jobTitle}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.worksiteAddress?.city && job.worksiteAddress?.state ? (
                        `${job.worksiteAddress.city}, ${job.worksiteAddress.state}${job.worksiteAddress.zipCode ? ` ${job.worksiteAddress.zipCode}` : ''}`
                      ) : (
                        job.worksiteName
                      )}
                    </Typography>
                  </Box>

                  {job.startDate && job.showStart && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Schedule sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        Starts: {formatDateForDisplay(job.startDate)}
                      </Typography>
                    </Box>
                  )}

                  {job.shift && job.shift.length > 0 && job.showShift && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Build sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.shift.slice(0, 2).join(', ')}
                        {job.shift.length > 2 && ` +${job.shift.length - 2} more`}
                      </Typography>
                    </Box>
                  )}



                  <Box sx={{ mt: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {/* E-Verify in footer (left side) */}
                    {job.eVerifyRequired && (
                      <img 
                        src="/img/everify.png" 
                        alt="E-Verify" 
                        style={{ 
                          height: '30px', 
                          width: 'auto',
                          objectFit: 'contain'
                        }}
                      />
                    )}
                    
                    {/* Apply Now button (right side, half width) */}
                    <Button 
                      variant="contained" 
                      sx={{ 
                        width: '50%',
                        ml: job.eVerifyRequired ? 'auto' : 0
                      }} 
                      onClick={() => handleApply(job)}
                    >
                      Apply Now
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Job Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="lg"
        fullWidth
        scroll="paper"
      >
        {selectedJob && (
          <>
            {/* Dialog Header */}
            <DialogTitle sx={{ pb: 1 }}>
              <Box sx={{ mb: 2, position: 'relative' }}>
                <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
                  {selectedJob.postTitle}
                </Typography>
                
                {/* E-Verify Image */}
                {selectedJob.eVerifyRequired && (
                  <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                    <img 
                      src="/img/everify.png" 
                      alt="E-Verify" 
                      style={{ 
                        height: '60px', 
                        width: 'auto',
                        objectFit: 'contain'
                      }} 
                    />
                  </Box>
                )}
                
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {selectedJob.companyName}
                    </Typography>
                    {selectedJob.payRate && selectedJob.showPayRate && (
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${selectedJob.payRate}/hr
                      </Typography>
                    )}
                  </Stack>
                  
                  {selectedJob.jobTitle && (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Work sx={{ fontSize: 20, color: 'text.secondary' }} />
                      <Typography variant="body1">
                        {selectedJob.jobTitle}
                      </Typography>
                    </Stack>
                  )}
                  
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LocationOn sx={{ fontSize: 20, color: 'text.secondary' }} />
                    <Typography variant="body1">
                      {selectedJob.worksiteAddress?.city && selectedJob.worksiteAddress?.state ? (
                        `${selectedJob.worksiteAddress.city}, ${selectedJob.worksiteAddress.state}${selectedJob.worksiteAddress.zipCode ? ` ${selectedJob.worksiteAddress.zipCode}` : ''}`
                      ) : (
                        selectedJob.worksiteName
                      )}
                    </Typography>
                  </Stack>
                  
                  {/* Schedule in Header */}
                  {(selectedJob.startDate || selectedJob.endDate || selectedJob.startTime || selectedJob.endTime) && (
                    <Stack spacing={1}>
                      {selectedJob.startDate && selectedJob.showStart && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            Start Date: {formatDateForDisplay(selectedJob.startDate)}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.endDate && selectedJob.showEnd && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Date: {formatDateForDisplay(selectedJob.endDate)}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.startTime && selectedJob.showStartTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            Start Time: {selectedJob.startTime}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.endTime && selectedJob.showEndTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Time: {selectedJob.endTime}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Box>
            </DialogTitle>

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                  <Tab label="Job Description" />
                  <Tab label="Requirements" />
                </Tabs>
            </Box>

            {/* Tab Content */}
            <DialogContent sx={{ px: 3, py: 4 }}>
              {/* Job Description Tab */}
              {activeTab === 0 && (
                <Stack spacing={4}>
                  {/* Job Description */}
                  <Box>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {selectedJob.jobDescription}
                    </Typography>
                  </Box>



                  {/* Shift Details */}
                  {selectedJob.shift && selectedJob.shift.length > 0 && selectedJob.showShift && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Work sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Shift Details
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.shift.map((shift, index) => (
                          <Chip key={index} label={shift} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Benefits */}
                  {selectedJob.benefits && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Benefits
                      </Typography>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                        {selectedJob.benefits}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

              {/* Requirements Tab */}
              {activeTab === 1 && (
                <Stack spacing={4}>
                  {/* Skills */}
                  {selectedJob.skills && selectedJob.skills.length > 0 && selectedJob.showSkills && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Required Skills
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.skills.map((skill, index) => (
                          <Chip key={index} label={skill} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Licenses & Certifications */}
                  {selectedJob.licensesCerts && selectedJob.licensesCerts.length > 0 && selectedJob.showLicensesCerts && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Licenses & Certifications
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.licensesCerts.map((license, index) => (
                          <Chip key={index} label={license} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Experience */}
                  {selectedJob.experienceLevels && selectedJob.experienceLevels.length > 0 && selectedJob.showExperience && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Person sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Experience Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.experienceLevels.map((experience, index) => (
                          <Chip key={index} label={experience} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Education */}
                  {selectedJob.educationLevels && selectedJob.educationLevels.length > 0 && selectedJob.showEducation && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <School sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Education Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.educationLevels.map((education, index) => (
                          <Chip key={index} label={education} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Languages */}
                  {selectedJob.languages && selectedJob.languages.length > 0 && selectedJob.showLanguages && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Language sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Language Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.languages.map((language, index) => (
                          <Chip key={index} label={language} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Physical Requirements */}
                  {selectedJob.physicalRequirements && selectedJob.physicalRequirements.length > 0 && selectedJob.showPhysicalRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <FitnessCenter sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Physical Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.physicalRequirements.map((requirement, index) => (
                          <Chip key={index} label={requirement} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Uniform Requirements */}
                  {selectedJob.uniformRequirements && selectedJob.uniformRequirements.length > 0 && selectedJob.showUniformRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Checkroom sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Uniform Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.uniformRequirements.map((uniform, index) => (
                          <Chip key={index} label={uniform} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Required PPE */}
                  {selectedJob.requiredPpe && selectedJob.requiredPpe.length > 0 && selectedJob.showRequiredPpe && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Required PPE
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.requiredPpe.map((ppe, index) => (
                          <Chip key={index} label={ppe} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Background Checks */}
                  {selectedJob.backgroundCheckPackages && selectedJob.backgroundCheckPackages.length > 0 && selectedJob.showBackgroundChecks && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Background Check Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.backgroundCheckPackages.map((check, index) => (
                          <Chip key={index} label={check} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Drug Screening */}
                  {selectedJob.drugScreeningPanels && selectedJob.drugScreeningPanels.length > 0 && selectedJob.showDrugScreening && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Drug Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.drugScreeningPanels.map((panel, index) => (
                          <Chip key={index} label={panel} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Additional Screenings */}
                  {selectedJob.additionalScreenings && selectedJob.additionalScreenings.length > 0 && selectedJob.showAdditionalScreenings && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Build sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Additional Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.additionalScreenings.map((screening, index) => (
                          <Chip key={index} label={screening} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* E-Verify */}
                  {selectedJob.eVerifyRequired && (
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 500, color: 'warning.main' }}>
                        E-Verify Required
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

            </DialogContent>

            {/* Dialog Footer */}
            <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
              <Button
                startIcon={savedJobs.includes(selectedJob.id) ? <Bookmark /> : <BookmarkBorder />}
                onClick={() => {
                  if (savedJobs.includes(selectedJob.id)) {
                    unsaveJob(selectedJob.id);
                  } else {
                    saveJob(selectedJob.id);
                  }
                }}
                sx={{ mr: 'auto' }}
              >
                {savedJobs.includes(selectedJob.id) ? 'Saved' : 'Save Job'}
              </Button>
              
              <Button onClick={handleCloseDialog} sx={{ mr: 1 }}>
                Close
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleApply(selectedJob)}
                sx={{ 
                  minWidth: 120,
                  backgroundColor: 'success.main',
                  '&:hover': {
                    backgroundColor: 'success.dark',
                  }
                }}
              >
                Apply Now
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      </Paper>
    </Container>
  );
};

export default PublicJobsBoard;
