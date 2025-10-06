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
import { Search, LocationOn, Business, Schedule, Work, AttachMoney, People, Add } from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { collection, getDocs, query, orderBy as firestoreOrderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import jobTitlesList from '../../data/onetJobTitles.json';

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
    payRate: '',
    showPayRate: true,
    visibility: 'public' as 'public' | 'private' | 'restricted',
    status: 'draft' as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired',
    jobOrderId: '',
    autoAddToUserGroup: '',
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
      payRate: '',
      showPayRate: true,
      visibility: 'public',
      status: 'draft',
      jobOrderId: '',
      autoAddToUserGroup: '',
    });
    setSelectedCompanyId('');
    setSelectedLocationId('');
    setCompanies([]);
    setLocations([]);
    setUseCompanyLocation(true);
    setSubmitError(null);
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

            <Stack direction="row" spacing={2}>
              <TextField
                label="Start Date"
                type="date"
                value={newPost.startDate}
                onChange={(e) => setNewPost({ ...newPost, startDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End Date"
                type="date"
                value={newPost.endDate}
                onChange={(e) => setNewPost({ ...newPost, endDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Stack>

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

            <FormControl fullWidth>
              <InputLabel>Visibility</InputLabel>
              <Select
                value={newPost.visibility}
                label="Visibility"
                onChange={(e) => setNewPost({ ...newPost, visibility: e.target.value as any })}
              >
                <MenuItem value="public">Public - Visible to everyone</MenuItem>
                <MenuItem value="restricted">Restricted - Visible to specific user groups</MenuItem>
                <MenuItem value="private">Private - Internal only</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Job Order ID (Optional)"
              value={newPost.jobOrderId}
              onChange={(e) => setNewPost({ ...newPost, jobOrderId: e.target.value })}
              fullWidth
              helperText="Link this posting to an existing job order"
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
            {submitting ? 'Creating...' : 'Create Post'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobsBoard; 