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
  Close,
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';
import { useFavorites, useFavoritesFilter } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import Layout from '../components/Layout';
import AuthDialog from '../components/AuthDialog';
import EligibilityModal from '../components/EligibilityModal';

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
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [sortBy, setSortBy] = useState('newest');
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [eligibilityModalOpen, setEligibilityModalOpen] = useState({
    open: false,
    needDOB: false,
    needPhone: false,
    jobId: null as string | null
  });
  
  // Favorites system
  const { favorites } = useFavorites('jobPosts');

  // Check if we're on the C1 route and should use specific tenantId
  const isC1Route = location.pathname.startsWith('/c1/');
  const specificTenantId = isC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : null;

  useEffect(() => {
    loadPublicJobs();
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

    if (showFavoritesOnly) {
      filtered = filtered.filter((job) => favorites.includes(job.id));
    }

    // Apply sorting
    if (sortBy === 'closest' && userLocation) {
      console.log('🔍 Closest sorting - User location:', userLocation);
      console.log('🔍 Jobs with coordinates:', filtered.map(job => ({
        id: job.id,
        title: job.postTitle,
        hasCoords: !!(job.worksiteAddress?.coordinates?.lat && job.worksiteAddress?.coordinates?.lng),
        coords: job.worksiteAddress?.coordinates
      })));
      
      // Sort by distance (closest first) - keep all jobs, just sort them
      filtered = filtered.sort((a, b) => {
        const aHasCoords = a.worksiteAddress?.coordinates?.lat && a.worksiteAddress?.coordinates?.lng;
        const bHasCoords = b.worksiteAddress?.coordinates?.lat && b.worksiteAddress?.coordinates?.lng;
        
        // If both have coordinates, sort by distance
        if (aHasCoords && bHasCoords) {
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
        }
        
        // If only one has coordinates, prioritize the one with coordinates
        if (aHasCoords && !bHasCoords) return -1;
        if (!aHasCoords && bHasCoords) return 1;
        
        // If neither has coordinates, maintain original order
        return 0;
      });
    } else {
      // Default sort by newest
      filtered = filtered.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    setFilteredJobs(filtered);
  }, [jobs, searchTerm, locationFilter, jobTypeFilter, showFavoritesOnly, favorites, sortBy, userLocation]);

  const getUniqueLocations = () => {
    const locations = new Set<string>();
    jobs.forEach(job => {
      if (job.worksiteAddress && job.worksiteAddress.city && job.worksiteAddress.state) {
        locations.add(`${job.worksiteAddress.city}, ${job.worksiteAddress.state}`);
      }
    });
    return Array.from(locations).sort();
  };


  const handleApply = async (job: PublicJobPosting) => {
    // Check if user is logged in
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setAuthDialogOpen(true);
      return;
    }

    try {
      // Check user eligibility
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const userData = userDoc.data();

      const needDOB = !userData?.dob;
      const needPhone = !userData?.phoneVerified;

      // If either verification is missing or workEligibility is false, show modal
      if (needDOB || needPhone || !userData?.workEligibility) {
        setEligibilityModalOpen({
          open: true,
          needDOB,
          needPhone,
          jobId: job.id
        });
        return;
      }

      // User is eligible, proceed with application
      navigate(`/apply/${job.tenantId}/${job.id}`);
    } catch (error) {
      console.error('Error checking eligibility:', error);
      // Fallback to auth dialog
      setAuthDialogOpen(true);
    }
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

  // Define the main content
  const mainContent = (
    <>
      {/* Only show header for non-logged-in users */}
      {!user && (
        <Box sx={{ mb: 4 }}>
          {/* Header with logo, title, and auth button */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {/* C1 Logo - Left side */}
              {isC1Route && (
                <img 
                  src="/C1.png" 
                  alt="C1 Staffing" 
                  style={{ 
                    height: '64px', 
                    width: 'auto',
                    objectFit: 'contain'
                  }}
                  onError={(e) => {
                    // Fallback if logo doesn't exist yet
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              
              {/* Main Page Title - Next to logo */}
              <Typography variant="h3" sx={{ fontWeight: 700 }}>
                {isC1Route ? 'Jobs Board' : 'Find Your Next Opportunity'}
              </Typography>
            </Box>

            {/* Sign In or Create Account Button - Top right */}
            <Button
              variant="contained"
              onClick={() => setAuthDialogOpen(true)}
              sx={{
                px: 3,
                py: 1.5,
                fontWeight: 600,
                borderRadius: 2,
                textTransform: 'none',
                fontSize: '1rem'
              }}
            >
              Sign In or Create Account
            </Button>
          </Box>
        </Box>
      )}

      {/* Search and Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search jobs by title, location, or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <FavoritesFilter
                      favoriteType="jobPosts"
                      showFavoritesOnly={showFavoritesOnly}
                      onToggle={setShowFavoritesOnly}
                      showText={false}
                      size="small"
                      sx={{
                        minWidth: '32px',
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        '&:hover': {
                          backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover'
                        }
                      }}
                    />
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
          {(searchTerm || locationFilter !== 'all' || jobTypeFilter !== 'all' || showFavoritesOnly || sortBy !== 'newest') && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSearchTerm('');
                setLocationFilter('all');
                setJobTypeFilter('all');
              setShowFavoritesOnly(false);
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
                    <FavoriteButton
                      itemId={job.id}
                      favoriteType="jobPosts"
                    size="small"
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites'
                      }}
                    />
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
                
                {/* Star Icon - Top Right */}
                <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                  <FavoriteButton
                    itemId={selectedJob.id}
                    favoriteType="jobPosts"
                    size="small"
                    sx={{
                      backgroundColor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      px: 2,
                      py: 1,
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                  />
                </Box>
                
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
              {/* E-Verify Image - Bottom Left */}
              {selectedJob.eVerifyRequired && (
                <Box sx={{ mr: 'auto' }}>
                  <img 
                    src="/img/everify.png" 
                    alt="E-Verify" 
                    style={{ 
                      height: '40px', 
                      width: 'auto',
                      objectFit: 'contain'
                    }} 
                  />
                </Box>
              )}
              
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

      {/* Authentication Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onAuthSuccess={() => {
          // Page will automatically update due to auth state change
          // No need for manual refresh
        }}
      />

      {/* Eligibility Verification Modal */}
      <EligibilityModal
        open={eligibilityModalOpen.open}
        onClose={() => setEligibilityModalOpen({ open: false, needDOB: false, needPhone: false, jobId: null })}
        onComplete={() => {
          // User has completed verification, proceed with application
          const jobId = eligibilityModalOpen.jobId;
          setEligibilityModalOpen({ open: false, needDOB: false, needPhone: false, jobId: null });
          
          if (jobId) {
            // Find the job and navigate to application
            const job = jobs.find(j => j.id === jobId);
            if (job) {
              navigate(`/apply/${job.tenantId}/${job.id}`);
            }
          }
        }}
        needDOB={eligibilityModalOpen.needDOB}
        needPhone={eligibilityModalOpen.needPhone}
        jobId={eligibilityModalOpen.jobId || undefined}
      />
    </>
  );

  // If user is logged in, return content without Container (Layout will handle it)
  // If user is not logged in, wrap in Container for proper spacing
  return user ? mainContent : (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {mainContent}
    </Container>
  );
};

export default PublicJobsBoard;
