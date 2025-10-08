import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Switch,
  FormHelperText,
  Autocomplete,
  Chip,
  Typography,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';
import jobTitlesList from '../data/onetJobTitles.json';
import onetSkills from '../data/onetSkills.json';
import credentialsSeed from '../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';
import { collection, getDocs, query, orderBy as firestoreOrderBy, where } from 'firebase/firestore';
import { db } from '../firebase';

export interface JobPostFormProps {
  initialData?: Partial<JobsBoardPost>;
  onSave: (data: Partial<JobsBoardPost>) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  mode?: 'create' | 'edit';
}

const JobPostForm: React.FC<JobPostFormProps> = ({
  initialData,
  onSave,
  onCancel,
  loading = false,
  mode = 'create'
}) => {
  const { tenantId, user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Form data - using the same structure as JobsBoard
  const [formData, setFormData] = useState({
    postTitle: '',
    jobType: 'gig' as 'gig' | 'career',
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
    workersNeeded: 1,
    eVerifyRequired: false,
    backgroundCheckPackages: [],
    showBackgroundChecks: false,
    drugScreeningPanels: [],
    showDrugScreening: false,
    additionalScreenings: [],
    showAdditionalScreenings: false,
    visibility: 'public' as 'public' | 'private' | 'restricted',
    restrictedGroups: [] as string[],
    status: 'draft' as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired',
    jobOrderId: '',
    skills: [] as string[],
    showSkills: false,
    licensesCerts: [] as string[],
    showLicensesCerts: false,
    experienceLevels: [] as string[],
    showExperience: false,
    educationLevels: [] as string[],
    showEducation: false,
    languages: [] as string[],
    showLanguages: false,
    physicalRequirements: [] as string[],
    showPhysicalRequirements: false,
    uniformRequirements: [] as string[],
    showUniformRequirements: false,
    requiredPpe: [] as string[],
    showRequiredPpe: false,
    shift: [] as string[],
    showShift: false,
    startTime: '',
    endTime: '',
    showStartTime: false,
    showEndTime: false,
    autoAddToUserGroup: '',
    ...initialData
  });

  // Company and location data
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; nickname?: string; address: any }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [useCompanyLocation, setUseCompanyLocation] = useState(true);

  // Job orders and user groups
  const [jobOrders, setJobOrders] = useState<Array<{ id: string; jobOrderName: string; status: string }>>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  const [userGroups, setUserGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingUserGroups, setLoadingUserGroups] = useState(false);

  // City autocomplete
  const [cityAutocomplete, setCityAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  const [cityInputRef, setCityInputRef] = useState<HTMLInputElement | null>(null);

  // Track original form values before job order connection
  const [originalFormValues, setOriginalFormValues] = useState<any>(null);

  // Shift options for Career job type
  const shiftOptions = [
    'Full Time', 'Part Time', 'Temporary',
    'First Shift', 'Second Shift', 'Third Shift', 'Day Shift', 'Night Shift',
    'Swing Shift', 'Weekends', 'Some Weekends', 'Some Nights',
    '8 Hour', '10 Hour', '12 Hour'
  ];

  // Helper function to safely convert dates to YYYY-MM-DD format for date inputs
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      if (typeof dateValue === 'string') {
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return dateValue;
        }
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        return dateValue.toDate().toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        return dateValue.toISOString().split('T')[0];
      } else {
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      }
    } catch (error) {
      console.warn('Error formatting date:', dateValue, error);
      return '';
    }
  };

  useEffect(() => {
    if (initialData) {
      // Format dates properly for form inputs
      setFormData(prev => ({ 
        ...prev, 
        ...initialData,
        startDate: formatDateForInput(initialData.startDate),
        endDate: formatDateForInput(initialData.endDate),
        expDate: formatDateForInput(initialData.expDate),
        payRate: initialData.payRate ? initialData.payRate.toString() : '',
        worksiteAddress: {
          street: initialData.worksiteAddress?.street || '',
          city: initialData.worksiteAddress?.city || '',
          state: initialData.worksiteAddress?.state || '',
          zipCode: initialData.worksiteAddress?.zipCode || '',
        }
      }));
      // Set company/location if initial data has them
      if (initialData.companyId) {
        setSelectedCompanyId(initialData.companyId);
        loadLocationsForCompany(initialData.companyId);
      }
      if (initialData.worksiteId) {
        setSelectedLocationId(initialData.worksiteId);
      }
    }
    loadCompanies();
    loadJobOrders();
    loadUserGroups();
  }, []);

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
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingJobOrders(true);
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
      if (err.code === 'permission-denied') {
        console.warn('Job orders not accessible - continuing without job order connections');
        setJobOrders([]);
      } else {
        console.error('Error loading job orders:', err);
      }
    } finally {
      setLoadingJobOrders(false);
    }
  };

  const loadUserGroups = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingUserGroups(true);
      const userGroupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const querySnapshot = await getDocs(userGroupsRef);
      
      const userGroupsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Unnamed Group'
      }));
      
      setUserGroups(userGroupsData);
    } catch (err: any) {
      if (err.code === 'permission-denied') {
        console.warn('User groups not accessible - restricted visibility options will be limited');
        setUserGroups([]);
      } else {
        console.error('Error loading user groups:', err);
      }
    } finally {
      setLoadingUserGroups(false);
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
      setFormData({
        ...formData,
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
      setFormData({
        ...formData,
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

        setFormData({
          ...formData,
          worksiteName: place.formatted_address || `${city}, ${state}`,
          street: '',
          city,
          state,
          zipCode
        });
      }
    }
  };

  const handleJobOrderChange = async (jobOrderId: string) => {
    if (jobOrderId) {
      setOriginalFormValues({ ...formData });
      
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderDoc = await getDoc(jobOrderRef);
        
        if (jobOrderDoc.exists()) {
          const jobOrderData = jobOrderDoc.data();
          
          setFormData({
            ...formData,
            jobOrderId,
            postTitle: formData.postTitle || jobOrderData.jobOrderName || '',
            jobTitle: formData.jobTitle || jobOrderData.jobTitle || '',
            jobDescription: formData.jobDescription || jobOrderData.jobOrderDescription || jobOrderData.jobDescription || '',
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
            payRate: jobOrderData.payRate?.toString() || '',
            workersNeeded: jobOrderData.workersNeeded || 1,
            eVerifyRequired: jobOrderData.eVerifyRequired || false,
            backgroundCheckPackages: jobOrderData.backgroundCheckPackages || [],
            drugScreeningPanels: jobOrderData.drugScreeningPanels || [],
            additionalScreenings: jobOrderData.additionalScreenings || []
          });
          
          if (jobOrderData.companyId) {
            setSelectedCompanyId(jobOrderData.companyId);
            await loadLocationsForCompany(jobOrderData.companyId);
            if (jobOrderData.worksiteId) {
              setSelectedLocationId(jobOrderData.worksiteId);
              
              // Fetch the actual worksite details to populate address fields
              try {
                const worksiteRef = doc(db, 'tenants', tenantId, 'crm_companies', jobOrderData.companyId, 'locations', jobOrderData.worksiteId);
                const worksiteDoc = await getDoc(worksiteRef);
                
                if (worksiteDoc.exists()) {
                  const worksiteData = worksiteDoc.data();
                  setFormData(prev => ({
                    ...prev,
                    worksiteId: jobOrderData.worksiteId,
                    worksiteName: worksiteData.nickname || worksiteData.name || jobOrderData.worksiteName || '',
                    street: worksiteData.address || worksiteData.street || '',
                    city: worksiteData.city || '',
                    state: worksiteData.state || '',
                    zipCode: worksiteData.zipcode || worksiteData.zipCode || ''
                  }));
                }
              } catch (worksiteErr) {
                console.warn('Failed to load worksite details:', worksiteErr);
                // Fallback to job order data if worksite fetch fails
                setFormData(prev => ({
                  ...prev,
                  worksiteId: jobOrderData.worksiteId,
                  worksiteName: jobOrderData.worksiteName || '',
                  street: jobOrderData.worksiteAddress?.street || '',
                  city: jobOrderData.worksiteAddress?.city || '',
                  state: jobOrderData.worksiteAddress?.state || '',
                  zipCode: jobOrderData.worksiteAddress?.zipCode || ''
                }));
              }
            }
          }
        }
      } catch (err) {
        console.error('Error loading job order data:', err);
      }
    } else {
      setFormData({ ...formData, jobOrderId: '' });
    }
  };

  const isFormValid = () => {
    if (!formData.postTitle?.trim()) return false;
    if (!formData.jobType) return false;
    if (!formData.jobDescription?.trim()) return false;
    
    if (useCompanyLocation) {
      if (!selectedCompanyId || !selectedLocationId) return false;
    } else {
      if (!formData.city?.trim() || !formData.state?.trim()) return false;
    }
    
    return true;
  };

  const handleSubmit = async () => {
    setError(null);

    if (!isFormValid()) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      // Convert string dates to Date objects and string payRate to number
      const dataToSave = {
        ...formData,
        startDate: formData.startDate ? new Date(formData.startDate) : undefined,
        endDate: formData.endDate ? new Date(formData.endDate) : undefined,
        expDate: formData.expDate ? new Date(formData.expDate) : undefined,
        worksiteAddress: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zipCode: formData.zipCode,
        },
        payRate: formData.payRate ? parseFloat(formData.payRate.toString()) : undefined,
      };
      
      await onSave(dataToSave);
    } catch (err: any) {
      setError(err.message || 'Failed to save job post');
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Post Title and Job Type */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Post Title"
                value={formData.postTitle}
                onChange={(e) => setFormData({ ...formData, postTitle: e.target.value })}
                fullWidth
                required
                helperText="Title for the job posting (may differ from actual job title)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required>
                <InputLabel>Job Type</InputLabel>
                <Select
                  value={formData.jobType}
                  label="Job Type"
                  onChange={(e) => setFormData({ ...formData, jobType: e.target.value as 'gig' | 'career' })}
                >
                  <MenuItem value="gig">Gig</MenuItem>
                  <MenuItem value="career">Career</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                fullWidth
                freeSolo
                options={jobTitlesList}
                value={formData.jobTitle}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, jobTitle: newValue || '' });
                }}
                onInputChange={(event, newInputValue) => {
                  setFormData({ ...formData, jobTitle: newInputValue });
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
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status}
                  label="Status"
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                >
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                  <MenuItem value="expired">Expired</MenuItem>
                  <MenuItem value="complete">Complete</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Expiration Date"
                type="date"
                value={formData.expDate || ''}
                onChange={(e) => setFormData({ ...formData, expDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
                helperText="When this posting will automatically expire"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Workers Needed"
                type="number"
                value={formData.workersNeeded}
                onChange={(e) => setFormData({ ...formData, workersNeeded: parseInt(e.target.value) || 1 })}
                fullWidth
                inputProps={{ min: 1 }}
                helperText="Number of workers needed"
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
                  value={formData.jobOrderId}
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
                  if (originalFormValues) {
                    setFormData({
                      ...formData,
                      jobOrderId: '',
                      ...originalFormValues
                    });
                  } else {
                    setFormData({ ...formData, jobOrderId: '' });
                  }
                  setSelectedCompanyId('');
                  setSelectedLocationId('');
                  setLocations([]);
                  setOriginalFormValues(null);
                }}
                disabled={!formData.jobOrderId}
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
          value={formData.jobDescription}
          onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
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
                value={formData.payRate}
                onChange={(e) => setFormData({ ...formData, payRate: e.target.value })}
                fullWidth
                inputProps={{ min: 0, step: 0.01 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Pay Rate</Typography>
                <Switch
                  checked={formData.showPayRate}
                  onChange={(e) => setFormData({ ...formData, showPayRate: e.target.checked })}
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
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Start</Typography>
                <Switch
                  checked={formData.showStart || false}
                  onChange={(e) => setFormData({ ...formData, showStart: e.target.checked })}
                />
              </Box>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="End Date"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show End</Typography>
                <Switch
                  checked={formData.showEnd || false}
                  onChange={(e) => setFormData({ ...formData, showEnd: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Shift Section - Only show for Career job type */}
        {formData.jobType === 'career' && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  fullWidth
                  options={shiftOptions}
                  value={formData.shift}
                  onChange={(event, newValue) => {
                    setFormData({ ...formData, shift: newValue });
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Shift Details"
                      helperText="Select shift requirements for this position"
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
              </Grid>
              <Grid item xs={12} sm={6}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show Shift Details on Post</Typography>
                  <Switch
                    checked={formData.showShift}
                    onChange={(e) => setFormData({ ...formData, showShift: e.target.checked })}
                  />
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* Time Section - Only show for Gig job type */}
        {formData.jobType === 'gig' && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Start Time"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  helperText="Job start time"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show Start Time</Typography>
                  <Switch
                    checked={formData.showStartTime}
                    onChange={(e) => setFormData({ ...formData, showStartTime: e.target.checked })}
                  />
                </Box>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="End Time"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  helperText="Job end time"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show End Time</Typography>
                  <Switch
                    checked={formData.showEndTime}
                    onChange={(e) => setFormData({ ...formData, showEndTime: e.target.checked })}
                  />
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body1">Use Company Location</Typography>
          <Switch
            checked={useCompanyLocation}
            onChange={(e) => {
              setUseCompanyLocation(e.target.checked);
              if (!e.target.checked) {
                setSelectedCompanyId('');
                setSelectedLocationId('');
                setLocations([]);
                setFormData({
                  ...formData,
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
                        setFormData({
                          ...formData,
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
                  {formData.street && `${formData.street}, `}
                  {formData.city}, {formData.state} {formData.zipCode}
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
                  value={formData.visibility}
                  label="Visibility"
                  onChange={(e) => {
                    const visibility = e.target.value as any;
                    setFormData({ 
                      ...formData, 
                      visibility,
                      restrictedGroups: visibility === 'restricted' ? formData.restrictedGroups : [],
                      autoAddToUserGroup: visibility === 'restricted' ? '' : formData.autoAddToUserGroup
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
                  value={formData.restrictedGroups}
                  label="User Groups"
                  onChange={(e) => setFormData({ ...formData, restrictedGroups: e.target.value as string[] })}
                  disabled={formData.visibility !== 'restricted' || loadingUserGroups}
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

        {/* E-Verify Required Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              {/* Empty left column for spacing */}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">E-Verify Required</Typography>
                <Switch
                  checked={formData.eVerifyRequired}
                  onChange={(e) => setFormData({ ...formData, eVerifyRequired: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Background Checks Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={backgroundCheckOptions.map(option => option.label)}
                value={formData.backgroundCheckPackages}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, backgroundCheckPackages: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Background Check Packages"
                    helperText="Select required background check packages"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Background Requirements</Typography>
                <Switch
                  checked={formData.showBackgroundChecks}
                  onChange={(e) => setFormData({ ...formData, showBackgroundChecks: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Drug Screening Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={drugScreeningOptions.map(option => option.label)}
                value={formData.drugScreeningPanels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, drugScreeningPanels: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Drug Screening Panels"
                    helperText="Select required drug screening panels"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Drug Screening Requirements</Typography>
                <Switch
                  checked={formData.showDrugScreening}
                  onChange={(e) => setFormData({ ...formData, showDrugScreening: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Additional Screenings Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={additionalScreeningOptions.map(option => option.label)}
                value={formData.additionalScreenings}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, additionalScreenings: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Additional Screenings"
                    helperText="Select required additional screening types"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Additional Screenings on Post</Typography>
                <Switch
                  checked={formData.showAdditionalScreenings}
                  onChange={(e) => setFormData({ ...formData, showAdditionalScreenings: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Skills Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={onetSkills.map(skill => skill.name)}
                value={formData.skills}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, skills: newValue });
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Skills on Post</Typography>
                <Switch
                  checked={formData.showSkills}
                  onChange={(e) => setFormData({ ...formData, showSkills: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Licenses & Certifications Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={credentialsSeed
                  .filter(cred => cred.is_active)
                  .map(cred => `${cred.name} (${cred.type})`)
                }
                value={formData.licensesCerts}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, licensesCerts: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Licenses & Certifications"
                    helperText="Select required licenses and certifications"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Licenses & Certifications on Post</Typography>
                <Switch
                  checked={formData.showLicensesCerts}
                  onChange={(e) => setFormData({ ...formData, showLicensesCerts: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Experience Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={experienceOptions.map(exp => exp.label)}
                value={formData.experienceLevels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, experienceLevels: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Experience Levels"
                    helperText="Select required experience levels"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Experience on Post</Typography>
                <Switch
                  checked={formData.showExperience}
                  onChange={(e) => setFormData({ ...formData, showExperience: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Education Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={educationOptions.map(edu => edu.label)}
                value={formData.educationLevels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, educationLevels: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Education Levels"
                    helperText="Select required education levels"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Education on Post</Typography>
                <Switch
                  checked={formData.showEducation}
                  onChange={(e) => setFormData({ ...formData, showEducation: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Languages Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Hindi', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Polish', 'Czech', 'Hungarian', 'Greek', 'Turkish', 'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', 'Malay', 'Tagalog', 'Other']}
                value={formData.languages}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, languages: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Language Requirements"
                    helperText="Select required languages for this position"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Languages on Post</Typography>
                <Switch
                  checked={formData.showLanguages}
                  onChange={(e) => setFormData({ ...formData, showLanguages: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Physical Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Standing', 'Walking', 'Sitting', 'Lifting 25 lbs', 'Lifting 50 lbs', 'Lifting 75 lbs', 'Lifting 100+ lbs',
                  'Carrying 25 lbs', 'Carrying 50 lbs', 'Carrying 75 lbs', 'Carrying 100+ lbs', 'Pushing', 'Pulling',
                  'Climbing', 'Balancing', 'Stooping', 'Kneeling', 'Crouching', 'Crawling', 'Reaching', 'Handling',
                  'Fingering', 'Feeling', 'Talking', 'Hearing', 'Seeing', 'Color Vision', 'Depth Perception',
                  'Field of Vision', 'Driving', 'Operating Machinery', 'Working at Heights', 'Confined Spaces',
                  'Outdoor Work', 'Indoor Work', 'Temperature Extremes', 'Noise', 'Vibration', 'Fumes/Odors',
                  'Dust', 'Chemicals', 'Radiation', 'Other'
                ]}
                value={formData.physicalRequirements}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, physicalRequirements: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Physical Requirements"
                    helperText="Select physical requirements for this position"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Physical Requirements on Post</Typography>
                <Switch
                  checked={formData.showPhysicalRequirements}
                  onChange={(e) => setFormData({ ...formData, showPhysicalRequirements: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Uniform Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Business Casual', 'Business Professional', 'Casual', 'Scrubs', 'Uniform Provided',
                  'Black Pants', 'White Shirt', 'Polo Shirt', 'Button-Down Shirt', 'Dress Shirt',
                  'Khaki Pants', 'Dress Pants', 'Jeans (Dark)', 'Jeans (No Holes)', 'Slacks',
                  'Skirt/Dress', 'Blouse', 'Sweater', 'Cardigan', 'Blazer', 'Suit', 'Tie Required',
                  'No Tie', 'Closed-Toe Shoes', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Dress Shoes',
                  'Sneakers', 'Boots', 'Sandals Allowed', 'No Sandals', 'No Flip-Flops', 'No Shorts',
                  'No Tank Tops', 'No Graphic Tees', 'No Hoodies', 'No Sweatpants', 'No Leggings',
                  'No Yoga Pants', 'No Athletic Wear', 'No Ripped Clothing', 'No Visible Tattoos',
                  'No Facial Piercings', 'Minimal Jewelry', 'No Jewelry', 'Hair Tied Back',
                  'Clean Shaven', 'Facial Hair Allowed', 'Hair Color Restrictions', 'No Hair Color Restrictions',
                  'Coveralls', 'Safety Vest', 'Hard Hat', 'Reflective Clothing', 'Weather-Appropriate',
                  'Seasonal Attire', 'Formal Occasions', 'Customer-Facing', 'Back Office', 'Laboratory',
                  'Kitchen', 'Warehouse', 'Construction', 'Healthcare', 'Food Service', 'Retail', 'Office', 'Other'
                ]}
                value={formData.uniformRequirements}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, uniformRequirements: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Uniform Requirements"
                    helperText="Select dress code and uniform requirements"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Uniform Requirements on Post</Typography>
                <Switch
                  checked={formData.showUniformRequirements}
                  onChange={(e) => setFormData({ ...formData, showUniformRequirements: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Required PPE Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Hard Hat', 'Safety Glasses', 'Safety Goggles', 'Face Shield', 'Respirator', 'Dust Mask', 'N95 Mask',
                  'Hearing Protection', 'Ear Plugs', 'Ear Muffs', 'High-Visibility Vest', 'Reflective Clothing',
                  'Safety Boots', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Cut-Resistant Gloves', 'Chemical-Resistant Gloves',
                  'Heat-Resistant Gloves', 'Fall Protection Harness', 'Safety Lanyard', 'Lifeline',
                  'Confined Space Equipment', 'Gas Monitor', 'Air Purifying Respirator', 'Self-Contained Breathing Apparatus',
                  'First Aid Kit', 'Emergency Shower', 'Eye Wash Station', 'Fire Extinguisher', 'Safety Data Sheets',
                  'Lockout/Tagout Devices', 'Barricades', 'Warning Signs', 'Personal Alarm', 'Two-Way Radio',
                  'Flashlight', 'Headlamp', 'Protective Coveralls', 'Disposable Suits', 'Chemical Apron',
                  'Lab Coat', 'Hair Net', 'Beard Cover', 'Disposable Gloves', 'Nitrile Gloves', 'Latex Gloves',
                  'Vinyl Gloves', 'Insulated Gloves', 'Electrical Gloves', 'Welding Helmet', 'Welding Gloves',
                  'Welding Apron', 'Welding Boots', 'Welding Jacket', 'Chainsaw Chaps', 'Cutting Gloves',
                  'Abrasion-Resistant Clothing', 'Flame-Resistant Clothing', 'Arc Flash Protection',
                  'Voltage-Rated Gloves', 'Rubber Insulating Gloves', 'Leather Protectors', 'Insulating Blankets',
                  'Insulating Covers', 'Hot Sticks', 'Voltage Detectors', 'Ground Fault Circuit Interrupters', 'Other'
                ]}
                value={formData.requiredPpe}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, requiredPpe: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Required PPE"
                    helperText="Select required personal protective equipment"
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
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Required PPE on Post</Typography>
                <Switch
                  checked={formData.showRequiredPpe}
                  onChange={(e) => setFormData({ ...formData, showRequiredPpe: e.target.checked })}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        <FormControl fullWidth>
          <InputLabel>Auto-Add to User Group</InputLabel>
          <Select
            value={formData.autoAddToUserGroup}
            label="Auto-Add to User Group"
            onChange={(e) => setFormData({ ...formData, autoAddToUserGroup: e.target.value })}
            disabled={formData.visibility === 'restricted' || loadingUserGroups}
            displayEmpty
          >
            <MenuItem value="">
              <em>No automatic group assignment</em>
            </MenuItem>
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
          <FormHelperText>
            {formData.visibility === 'restricted' 
              ? 'Auto-add to group is not available when visibility is restricted'
              : 'Automatically add applicants to this user group'
            }
          </FormHelperText>
        </FormControl>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || !isFormValid()}
          >
            {loading 
              ? (formData.status === 'draft' ? 'Saving...' : 'Creating...') 
              : (formData.status === 'draft' ? 'Save Draft' : mode === 'edit' ? 'Update Post' : 'Create Post')
            }
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

export default JobPostForm;