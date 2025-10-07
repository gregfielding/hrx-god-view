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
  Switch,
  FormControlLabel,
} from '@mui/material';
import { Search, LocationOn, Business, Schedule, Work, AttachMoney, People, Add, Close as CloseIcon } from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { collection, getDocs, query, orderBy as firestoreOrderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import jobTitlesList from '../../data/onetJobTitles.json';
import onetSkills from '../../data/onetSkills.json';

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

  // Company and location data for dropdowns
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; nickname?: string; address: any }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [useCompanyLocation, setUseCompanyLocation] = useState(true);
  const [cityAutocomplete, setCityAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  const [cityInputRef, setCityInputRef] = useState<HTMLInputElement | null>(null);

  // Job orders for connection
  const [jobOrders, setJobOrders] = useState<Array<{ id: string; jobOrderName: string; status: string }>>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  
  // User groups for restricted visibility
  const [userGroups, setUserGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingUserGroups, setLoadingUserGroups] = useState(false);
  
  // Track original form values before job order connection
  const [originalFormValues, setOriginalFormValues] = useState<{
    postTitle: string;
    jobTitle: string;
    jobDescription: string;
    companyId: string;
    companyName: string;
    worksiteId: string;
    worksiteName: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    startDate: string;
    endDate: string;
    showStart: boolean;
    showEnd: boolean;
    payRate: string;
    skills: string[];
    restrictedGroups: string[];
  } | null>(null);

  const jobsBoardService = JobsBoardService.getInstance();

  // New post form state
  const [newPost, setNewPost] = useState({
    postTitle: '',
    jobTitle: '',
    jobDescription: '',
    companyId: '',
    companyName: '',
    worksiteId: '',
    worksiteName: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    startDate: '',
    endDate: '',
    expDate: '',
    showStart: false,
    showEnd: false,
    payRate: '',
    showPayRate: true,
    visibility: 'public' as 'public' | 'private' | 'restricted',
    restrictedGroups: [] as string[],
    status: 'draft' as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired',
    jobOrderId: '',
    skills: [] as string[],
    autoAddToUserGroup: '',
  });

  // Load jobs board posts from Firestore
  useEffect(() => {
    loadPosts();
    loadJobOrders();
    loadUserGroups();
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

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingJobOrders(true);
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      const q = query(jobOrdersRef, where('status', 'in', ['draft', 'open', 'interviewing', 'offer', 'partially_filled']));
      const querySnapshot = await getDocs(q);
      
      const jobOrdersData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        jobOrderName: doc.data().jobOrderName || 'Unnamed Job Order',
        status: doc.data().status || 'Unknown'
      }));
      
      setJobOrders(jobOrdersData);
    } catch (err: any) {
      console.error('Error loading job orders:', err);
    } finally {
      setLoadingJobOrders(false);
    }
  };

  const loadUserGroups = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingUserGroups(true);
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const userGroupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const querySnapshot = await getDocs(userGroupsRef);
      
      const userGroupsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Unnamed Group'
      }));
      
      setUserGroups(userGroupsData);
    } catch (err: any) {
      console.error('Error loading user groups:', err);
    } finally {
      setLoadingUserGroups(false);
    }
  };

  // Filter jobs based on search and filters
  useEffect(() => {
    let filtered = posts;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(post =>
        post.postTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.jobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.jobDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.worksiteName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.companyName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter(post => post.worksiteName === locationFilter);
    }

    // Company filter
    if (companyFilter !== 'all') {
      filtered = filtered.filter(post => post.companyName === companyFilter);
    }

    setFilteredJobs(filtered);
  }, [posts, searchTerm, locationFilter, companyFilter]);

  const getUniqueLocations = () => {
    return Array.from(new Set(posts.map(post => post.worksiteName))).sort();
  };

  const getUniqueCompanies = () => {
    return Array.from(new Set(posts.map(post => post.companyName))).sort();
  };

  const handleOpenNewPostModal = async () => {
    setOpenNewPostModal(true);
    setSubmitError(null);
    // Load companies when modal opens
    await loadCompanies();
  };

  const loadCompanies = async () => {
    if (!tenantId) return;
    try {
      setLoadingCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, firestoreOrderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().companyName || doc.data().name || 'Unnamed Company'
      }));
      setCompanies(companiesData);
    } catch (err: any) {
      console.error('Error loading companies:', err);
      setSubmitError('Failed to load companies');
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadLocationsForCompany = async (companyId: string) => {
    if (!tenantId || !companyId) return;
    try {
      setLoadingLocations(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || 'Unnamed Location',
          nickname: data.nickname,
          address: {
            street: data.address || '',
            city: data.city || '',
            state: data.state || '',
            zipCode: data.zipcode || data.zipCode || '',
            coordinates: data.latitude && data.longitude ? {
              lat: data.latitude,
              lng: data.longitude
            } : undefined
          }
        };
      });
      setLocations(locationsData);
    } catch (err: any) {
      console.error('Error loading locations:', err);
      setSubmitError('Failed to load locations for selected company');
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedLocationId('');
    setLocations([]);
    
    const selectedCompany = companies.find(c => c.id === companyId);
    if (selectedCompany) {
      setNewPost({
        ...newPost,
        companyId,
        companyName: selectedCompany.name,
        worksiteId: '',
        worksiteName: '',
        street: '',
        city: '',
        state: '',
        zipCode: ''
      });
      await loadLocationsForCompany(companyId);
    }
  };

  const handleLocationChange = (locationId: string) => {
    setSelectedLocationId(locationId);
    const selectedLocation = locations.find(l => l.id === locationId);
    if (selectedLocation) {
      setNewPost({
        ...newPost,
        worksiteId: locationId,
        worksiteName: selectedLocation.nickname || selectedLocation.name,
        street: selectedLocation.address.street,
        city: selectedLocation.address.city,
        state: selectedLocation.address.state,
        zipCode: selectedLocation.address.zipCode
      });
    }
  };

  // Helper function to safely convert dates to YYYY-MM-DD format for date inputs
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      if (typeof dateValue === 'string') {
        // If it's already a string, check if it's in the right format
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return dateValue;
        }
        // Try to parse and format
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        // Firestore Timestamp
        return dateValue.toDate().toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        // Date object
        return dateValue.toISOString().split('T')[0];
      } else {
        // Try to create a Date object
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      }
    } catch (error) {
      console.warn('Error formatting date:', dateValue, error);
      return '';
    }
  };

  const handleJobOrderChange = async (jobOrderId: string) => {
    if (jobOrderId) {
      // Save current form values before populating from job order
      setOriginalFormValues({
        postTitle: newPost.postTitle,
        jobTitle: newPost.jobTitle,
        jobDescription: newPost.jobDescription,
        companyId: newPost.companyId,
        companyName: newPost.companyName,
        worksiteId: newPost.worksiteId,
        worksiteName: newPost.worksiteName,
        street: newPost.street,
        city: newPost.city,
        state: newPost.state,
        zipCode: newPost.zipCode,
        startDate: newPost.startDate,
        endDate: newPost.endDate,
        showStart: newPost.showStart,
        showEnd: newPost.showEnd,
        payRate: newPost.payRate,
        skills: newPost.skills,
        restrictedGroups: newPost.restrictedGroups
      });
      
      try {
        // Load job order data to pre-fill form
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../../firebase');
        
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderDoc = await getDoc(jobOrderRef);
        
        if (jobOrderDoc.exists()) {
          const jobOrderData = jobOrderDoc.data();
          
          // Pre-fill form with job order data
          setNewPost(prev => ({
            ...prev,
            jobOrderId,
            postTitle: prev.postTitle || jobOrderData.jobOrderName || '',
            jobTitle: prev.jobTitle || jobOrderData.jobTitle || '',
            jobDescription: prev.jobDescription || jobOrderData.jobOrderDescription || jobOrderData.jobDescription || '',
            companyId: jobOrderData.companyId || '',
            companyName: jobOrderData.companyName || '',
            worksiteId: jobOrderData.worksiteId || '',
            worksiteName: jobOrderData.worksiteName || '',
            street: jobOrderData.worksiteAddress?.street || '',
            city: jobOrderData.worksiteAddress?.city || '',
            state: jobOrderData.worksiteAddress?.state || '',
            zipCode: jobOrderData.worksiteAddress?.zipCode || '',
            startDate: formatDateForInput(jobOrderData.startDate),
            endDate: formatDateForInput(jobOrderData.endDate),
            payRate: jobOrderData.payRate?.toString() || ''
          }));
          
          // Set company and location if available
          if (jobOrderData.companyId) {
            setSelectedCompanyId(jobOrderData.companyId);
            await loadLocationsForCompany(jobOrderData.companyId);
            if (jobOrderData.worksiteId) {
              setSelectedLocationId(jobOrderData.worksiteId);
            }
          }
        }
      } catch (err) {
        console.error('Error loading job order data:', err);
      }
    } else {
      // Clear job order connection
      setNewPost({ ...newPost, jobOrderId: '' });
    }
  };

  const onCityAutocompleteLoad = (autocomplete: google.maps.places.Autocomplete) => {
    setCityAutocomplete(autocomplete);
  };

  const onCityPlaceChanged = () => {
    if (cityAutocomplete) {
      const place = cityAutocomplete.getPlace();
      if (place.geometry && place.geometry.location) {
        // Extract city and state from address components
        let city = '';
        let state = '';
        let zipCode = '';
        
        place.address_components?.forEach((component) => {
          if (component.types.includes('locality')) {
            city = component.long_name;
          }
          if (component.types.includes('administrative_area_level_1')) {
            state = component.short_name;
          }
          if (component.types.includes('postal_code')) {
            zipCode = component.long_name;
          }
        });

        setNewPost({
          ...newPost,
          worksiteName: place.formatted_address || `${city}, ${state}`,
          street: '',
          city,
          state,
          zipCode
        });
      }
    }
  };

  const handleCloseNewPostModal = () => {
    setOpenNewPostModal(false);
    setNewPost({
      postTitle: '',
      jobTitle: '',
      jobDescription: '',
      companyId: '',
      companyName: '',
      worksiteId: '',
      worksiteName: '',
      street: '',
      city: '',
      state: '',
      zipCode: '',
      startDate: '',
      endDate: '',
      expDate: '',
      showStart: false,
      showEnd: false,
      payRate: '',
      showPayRate: true,
      visibility: 'public',
      restrictedGroups: [],
      status: 'draft',
      jobOrderId: '',
      skills: [],
      autoAddToUserGroup: '',
    });
    setSelectedCompanyId('');
    setSelectedLocationId('');
    setCompanies([]);
    setLocations([]);
    setUseCompanyLocation(true);
    setSubmitError(null);
    setOriginalFormValues(null);
  };

  const handleSubmitNewPost = async () => {
    if (!tenantId) return;

    // Validation
    if (!newPost.postTitle.trim()) {
      setSubmitError('Post title is required');
      return;
    }
    if (!newPost.jobDescription.trim()) {
      setSubmitError('Job description is required');
      return;
    }
    
    if (useCompanyLocation) {
      if (!selectedCompanyId) {
        setSubmitError('Please select a company');
        return;
      }
      if (!selectedLocationId) {
        setSubmitError('Please select a worksite location');
        return;
      }
    } else {
      if (!newPost.city.trim() || !newPost.state.trim()) {
        setSubmitError('Please select a city and state');
        return;
      }
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      await jobsBoardService.createPost(
        tenantId,
        {
          postTitle: newPost.postTitle.trim(),
          jobTitle: newPost.jobTitle.trim(),
          jobDescription: newPost.jobDescription.trim(),
          companyName: newPost.companyName.trim(),
          worksiteName: newPost.worksiteName.trim(),
          worksiteAddress: {
            street: newPost.street.trim(),
            city: newPost.city.trim(),
            state: newPost.state.trim(),
            zipCode: newPost.zipCode.trim(),
          },
          startDate: newPost.startDate || null,
          endDate: newPost.endDate || null,
          payRate: newPost.payRate ? parseFloat(newPost.payRate) : null,
          showPayRate: newPost.showPayRate,
          visibility: newPost.visibility,
          jobOrderId: newPost.jobOrderId || undefined,
          autoAddToUserGroup: newPost.autoAddToUserGroup || undefined,
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
                      {post.postTitle}
                    </Typography>
                    <Chip
                      label="OPEN"
                      color="success"
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
                    {post.jobDescription.length > 150 
                      ? `${post.jobDescription.substring(0, 150)}...` 
                      : post.jobDescription
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
                      {post.worksiteName}
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
          
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Post Title"
                  value={newPost.postTitle}
                  onChange={(e) => setNewPost({ ...newPost, postTitle: e.target.value })}
                  fullWidth
                  required
                  helperText="Title for the job posting (may differ from actual job title)"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={newPost.status}
                    label="Status"
                    onChange={(e) => setNewPost({ ...newPost, status: e.target.value as any })}
                  >
                    <MenuItem value="draft">Draft</MenuItem>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="paused">Paused</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                    <MenuItem value="expired">Expired</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>

          <Stack spacing={3} sx={{ mt: 3 }}>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={8}>
                  <Autocomplete
                    fullWidth
                    freeSolo
                    options={jobTitlesList}
                    value={newPost.jobTitle}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, jobTitle: newValue || '' });
                    }}
                    onInputChange={(event, newInputValue) => {
                      setNewPost({ ...newPost, jobTitle: newInputValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Job Title (Optional)"
                        helperText="Search or enter a job title - leave blank for generic multi-role postings"
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Expiration Date"
                    type="date"
                    value={newPost.expDate || ''}
                    onChange={(e) => setNewPost({ ...newPost, expDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    helperText="When this posting will automatically expire"
                  />
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={8}>
                  <FormControl fullWidth>
                    <InputLabel>Connect with Job Order</InputLabel>
                    <Select
                      value={newPost.jobOrderId}
                      label="Connect with Job Order"
                      onChange={(e) => handleJobOrderChange(e.target.value)}
                      disabled={loadingJobOrders}
                    >
                      <MenuItem value="">
                        <em>No Job Order Connection</em>
                      </MenuItem>
                      {loadingJobOrders ? (
                        <MenuItem value="" disabled>Loading job orders...</MenuItem>
                      ) : jobOrders.length === 0 ? (
                        <MenuItem value="" disabled>No available job orders to connect</MenuItem>
                      ) : (
                        jobOrders.map((jobOrder) => (
                          <MenuItem key={jobOrder.id} value={jobOrder.id}>
                            {jobOrder.jobOrderName}
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => {
                      // Clear job order connection and restore original form values
                      if (originalFormValues) {
                        setNewPost(prev => ({
                          ...prev,
                          jobOrderId: '',
                          // Restore original values
                          postTitle: originalFormValues.postTitle,
                          jobTitle: originalFormValues.jobTitle,
                          jobDescription: originalFormValues.jobDescription,
                          companyId: originalFormValues.companyId,
                          companyName: originalFormValues.companyName,
                          worksiteId: originalFormValues.worksiteId,
                          worksiteName: originalFormValues.worksiteName,
                          street: originalFormValues.street,
                          city: originalFormValues.city,
                          state: originalFormValues.state,
                          zipCode: originalFormValues.zipCode,
                          startDate: originalFormValues.startDate,
                          endDate: originalFormValues.endDate,
                          showStart: originalFormValues.showStart,
                          showEnd: originalFormValues.showEnd,
                          payRate: originalFormValues.payRate,
                          skills: originalFormValues.skills,
                          restrictedGroups: originalFormValues.restrictedGroups
                        }));
                      } else {
                        // Fallback: clear job order connection only
                        setNewPost(prev => ({ ...prev, jobOrderId: '' }));
                      }
                      
                      // Clear company and location selections
                      setSelectedCompanyId('');
                      setSelectedLocationId('');
                      setLocations([]);
                      setOriginalFormValues(null);
                    }}
                    disabled={!newPost.jobOrderId}
                    startIcon={<CloseIcon />}
                    fullWidth
                  >
                    Clear Connection
                  </Button>
                </Grid>
              </Grid>
            </Box>

            <TextField
              label="Job Description"
              value={newPost.jobDescription}
              onChange={(e) => setNewPost({ ...newPost, jobDescription: e.target.value })}
              fullWidth
              required
              multiline
              rows={4}
              helperText="Provide a detailed description of the role, responsibilities, and requirements"
            />

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Pay Rate ($/hr)"
                    type="number"
                    value={newPost.payRate}
                    onChange={(e) => setNewPost({ ...newPost, payRate: e.target.value })}
                    fullWidth
                    inputProps={{ min: 0, step: 0.01 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Pay Rate</Typography>
                    <Switch
                      checked={newPost.showPayRate}
                      onChange={(e) => setNewPost({ ...newPost, showPayRate: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Start Date"
                    type="date"
                    value={newPost.startDate}
                    onChange={(e) => setNewPost({ ...newPost, startDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Start</Typography>
                    <Switch
                      checked={newPost.showStart || false}
                      onChange={(e) => setNewPost({ ...newPost, showStart: e.target.checked })}
                    />
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="End Date"
                    type="date"
                    value={newPost.endDate}
                    onChange={(e) => setNewPost({ ...newPost, endDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show End</Typography>
                    <Switch
                      checked={newPost.showEnd || false}
                      onChange={(e) => setNewPost({ ...newPost, showEnd: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body1">Use Company Location</Typography>
              <Switch
                checked={useCompanyLocation}
                onChange={(e) => {
                  setUseCompanyLocation(e.target.checked);
                  if (!e.target.checked) {
                    // Clear company/location when switching to generic location
                    setSelectedCompanyId('');
                    setSelectedLocationId('');
                    setLocations([]);
                    setNewPost({
                      ...newPost,
                      companyId: '',
                      companyName: '',
                      worksiteId: '',
                      worksiteName: '',
                      street: '',
                      city: '',
                      state: '',
                      zipCode: ''
                    });
                  }
                }}
              />
            </Box>

            {useCompanyLocation ? (
              <>
                <Box sx={{ mt: 2 }}>
                  <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      fullWidth
                      options={companies}
                      getOptionLabel={(option) => option.name}
                      value={companies.find(c => c.id === selectedCompanyId) || null}
                      onChange={(event, newValue) => {
                        if (newValue) {
                          handleCompanyChange(newValue.id);
                        } else {
                          setSelectedCompanyId('');
                          setSelectedLocationId('');
                          setLocations([]);
                          setNewPost({
                            ...newPost,
                            companyId: '',
                            companyName: '',
                            worksiteId: '',
                            worksiteName: '',
                            street: '',
                            city: '',
                            state: '',
                            zipCode: ''
                          });
                        }
                      }}
                      loading={loadingCompanies}
                      disabled={loadingCompanies}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Company"
                          required
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required disabled={!selectedCompanyId}>
                      <InputLabel>Worksite</InputLabel>
                      <Select
                        value={selectedLocationId}
                        label="Worksite"
                        onChange={(e) => handleLocationChange(e.target.value)}
                        disabled={loadingLocations || !selectedCompanyId}
                      >
                        {loadingLocations ? (
                          <MenuItem value="">Loading locations...</MenuItem>
                        ) : locations.length === 0 ? (
                          <MenuItem value="">No locations available</MenuItem>
                        ) : (
                          locations.map((location) => (
                            <MenuItem key={location.id} value={location.id}>
                              {location.nickname || location.name}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
                </Box>

                {selectedLocationId && (
                  <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Selected Location Details:
                    </Typography>
                    <Typography variant="body2">
                      {newPost.street && `${newPost.street}, `}
                      {newPost.city}, {newPost.state} {newPost.zipCode}
                    </Typography>
                  </Box>
                )}
              </>
            ) : (
              <GoogleAutocomplete
                onLoad={onCityAutocompleteLoad}
                onPlaceChanged={onCityPlaceChanged}
                options={{
                  types: ['(cities)'],
                  componentRestrictions: { country: 'us' }
                }}
              >
                <TextField
                  fullWidth
                  label="City, State"
                  placeholder="Search for a city..."
                  required
                  helperText="Search and select a city - coordinates will be saved automatically"
                  inputRef={(ref) => setCityInputRef(ref)}
                />
              </GoogleAutocomplete>
            )}

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Visibility</InputLabel>
                    <Select
                      value={newPost.visibility}
                      label="Visibility"
                      onChange={(e) => {
                        const visibility = e.target.value as any;
                        setNewPost({ 
                          ...newPost, 
                          visibility,
                          // Clear restricted groups if not restricted
                          restrictedGroups: visibility === 'restricted' ? newPost.restrictedGroups : []
                        });
                      }}
                    >
                      <MenuItem value="public">Public - Visible to everyone</MenuItem>
                      <MenuItem value="restricted">Restricted - Visible to specific user groups</MenuItem>
                      <MenuItem value="private">Private - Internal only</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>User Groups</InputLabel>
                    <Select
                      value={newPost.restrictedGroups}
                      label="User Groups"
                      onChange={(e) => setNewPost({ ...newPost, restrictedGroups: e.target.value as string[] })}
                      disabled={newPost.visibility !== 'restricted' || loadingUserGroups}
                      multiple
                    >
                      {loadingUserGroups ? (
                        <MenuItem value="" disabled>Loading user groups...</MenuItem>
                      ) : userGroups.length === 0 ? (
                        <MenuItem value="" disabled>No user groups available</MenuItem>
                      ) : (
                        userGroups.map((group) => (
                          <MenuItem key={group.id} value={group.id}>
                            {group.name}
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>


            <Autocomplete
              multiple
              fullWidth
              options={onetSkills.map(skill => skill.name)}
              value={newPost.skills}
              onChange={(event, newValue) => {
                setNewPost({ ...newPost, skills: newValue });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Required Skills"
                  helperText="Select skills required for this position"
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
            />

            <TextField
              label="Auto-Add to User Group (Optional)"
              value={newPost.autoAddToUserGroup}
              onChange={(e) => setNewPost({ ...newPost, autoAddToUserGroup: e.target.value })}
              fullWidth
              helperText="Automatically add applicants to this user group ID"
            />
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
            {submitting 
              ? (newPost.status === 'draft' ? 'Saving...' : 'Creating...') 
              : (newPost.status === 'draft' ? 'Save Draft' : 'Create Post')
            }
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobsBoard; 