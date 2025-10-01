import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  Alert,
  Snackbar,
  Paper,
  TextField,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Chip,
  Autocomplete,
  FormHelperText,
  Checkbox,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Person as PersonIcon,
  PersonAdd as PersonAddIcon,
  ExpandMore as ExpandMoreIcon,
  Work as WorkIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import ApplicationsList from '../components/phase2/ApplicationsList';
import ApplicationDetail from '../components/phase2/ApplicationDetail';
import { Application } from '../types/phase2';
import jobTitles from '../data/onetJobTitles.json';
import { BreadcrumbNav } from '../components/BreadcrumbNav';

const Applications: React.FC = () => {
  const { user, tenantId } = useAuth();
  const navigate = useNavigate();
  
  // Application-related state
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  
  // Worker invitation state
  const [showInviteWorkerForm, setShowInviteWorkerForm] = useState(false);
  const [inviteWorkerLoading, setInviteWorkerLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | false>('basic');
  
  // Form data for worker invitation
  const [workerForm, setWorkerForm] = useState({
    // Basic Identity
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    
    // Employment Classification
    securityLevel: '2', // Default to Applicant level
    employmentType: 'Full-Time',
    jobTitle: '',
    departmentId: '',
    divisionId: '',
    locationId: '',
    managerId: '',
    
    // Metadata & Structure
    startDate: '',
    workStatus: 'Active',
    workerId: '',
    union: '',
    workEligibility: false as boolean,
    languages: [] as string[],
    
    // Legacy fields for backward compatibility
    locationIds: [] as string[],
    street: '',
    city: '',
    state: '',
    zip: '',
    dob: '',
  });
  
  // Supporting data for the form
  const [departments, setDepartments] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  
  // Snackbar state
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'info'
  });

  // Helper function to format phone numbers
  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
    if (!match) return value;
    let formatted = '';
    if (match[1]) formatted += `(${match[1]}`;
    if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
    if (match[3]) formatted += `-${match[3]}`;
    return formatted;
  };

  // Fetch supporting data for the worker form
  const fetchDepartments = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch departments:', err);
      setDepartments([]);
    }
  };

  const fetchLocations = async () => {
    if (!tenantId) return;
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch locations:', err);
      setLocations([]);
    }
  };

  const fetchDivisions = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'divisions');
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch divisions:', err);
      setDivisions([]);
    }
  };

  const fetchManagers = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'managers');
      const snapshot = await getDocs(q);
      setManagers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch managers:', err);
      setManagers([]);
    }
  };

  const fetchUserGroups = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch user groups:', err);
      setUserGroups([]);
    }
  };

  // Load supporting data when component mounts
  useEffect(() => {
    if (tenantId) {
      fetchDepartments();
      fetchLocations();
      fetchDivisions();
      fetchManagers();
      fetchUserGroups();
    }
  }, [tenantId]);

  // Form validation
  const isWorkerFormValid = Boolean(
    workerForm.firstName && 
    workerForm.lastName && 
    workerForm.email && 
    workerForm.phone && 
    workerForm.securityLevel && 
    workerForm.employmentType && 
    workerForm.workStatus &&
    workerForm.departmentId
  );

  if (!tenantId) {
    return (
      <Box sx={{ width: '100%', p: 3 }}>
        <Alert severity="error">
          No tenant ID found. Please ensure you're logged in with a valid tenant.
        </Alert>
      </Box>
    );
  }

  // Worker invitation form handlers
  const handleWorkerFormChange = (field: string, value: string | string[] | boolean | Date) => {
    setWorkerForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleWorkerFormChange('phone', formatPhoneNumber(e.target.value));
  };

  const handleSectionChange = (section: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedSection(isExpanded ? section : false);
  };

  const handleDateChange = (field: string, value: string) => {
    handleWorkerFormChange(field, value || '');
  };

  const handleBooleanChange = (field: string, value: boolean) => {
    handleWorkerFormChange(field, value);
  };

  const handleInviteWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    
    setInviteWorkerLoading(true);
    try {
      // Call the inviteUserV2 function
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      // Build payload with the required structure
      const payload: any = {
        email: workerForm.email,
        firstName: workerForm.firstName,
        lastName: workerForm.lastName,
        phone: workerForm.phone,
        displayName: `${workerForm.firstName} ${workerForm.lastName}`,
        jobTitle: workerForm.jobTitle,
        department: workerForm.departmentId,
        locationIds: workerForm.locationIds,
        securityLevel: workerForm.securityLevel,
        role: 'Tenant',
        tenantId: tenantId,
        // Additional fields for geocoding
        street: workerForm.street,
        city: workerForm.city,
        state: workerForm.state,
        zip: workerForm.zip,
        dateOfBirth: workerForm.dateOfBirth,
        gender: workerForm.gender,
        employmentType: workerForm.employmentType,
        startDate: workerForm.startDate,
        workStatus: workerForm.workStatus,
        workerId: workerForm.workerId,
        union: workerForm.union,
        workEligibility: workerForm.workEligibility,
        languages: workerForm.languages,
        userGroupIds: selectedUserGroups,
      };
      
      console.log('Sending inviteUserV2 payload:', payload);
      const result = await inviteUser(payload);
      console.log('InviteUserV2 result:', result);
      
      // Reset form
      setWorkerForm({
        firstName: '',
        lastName: '',
        preferredName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: '',
        securityLevel: '2',
        employmentType: 'Full-Time',
        jobTitle: '',
        departmentId: '',
        divisionId: '',
        locationId: '',
        managerId: '',
        startDate: '',
        workStatus: 'Active',
        workerId: '',
        union: '',
        workEligibility: false,
        languages: [],
        locationIds: [],
        street: '',
        city: '',
        state: '',
        zip: '',
        dob: '',
      });
      setSelectedUserGroups([]);
      setShowInviteWorkerForm(false);
      
      setSnackbar({
        open: true,
        message: 'Worker invitation sent successfully!',
        severity: 'success'
      });
    } catch (err: any) {
      console.error('Error inviting worker:', err);
      setSnackbar({
        open: true,
        message: err.message || 'Failed to invite worker',
        severity: 'error'
      });
    }
    setInviteWorkerLoading(false);
  };

  // Application handlers
  const handleViewApplication = (application: Application) => {
    setSelectedApplication(application);
    setShowDetailDialog(true);
  };

  const handleEditApplication = (application: Application) => {
    setSelectedApplication(application);
    setShowDetailDialog(true);
  };

  const handleDeleteApplication = async (application: Application) => {
    // TODO: Implement delete confirmation dialog
    console.log('Delete application:', application.id);
    setSnackbar({
      open: true,
      message: 'Delete functionality not yet implemented',
      severity: 'info'
    });
  };


  const handleDetailSave = (updatedApplication: Application) => {
    setSelectedApplication(updatedApplication);
    setSnackbar({
      open: true,
      message: 'Application updated successfully!',
      severity: 'success'
    });
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const breadcrumbItems = [
    {
      label: 'Recruiter',
      href: '/recruiter'
    },
    {
      label: 'Applicants'
    }
  ];

  return (
    <Box sx={{ width: '100%', pt: 0, pb: 3 }}>
      <BreadcrumbNav items={breadcrumbItems} />
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <PersonIcon sx={{ fontSize: 32, color: 'primary.main' }} />
          <Box>
            <Typography variant="h4" component="h1">
              Applications
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage candidate applications and track their progress through the hiring pipeline
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<PersonAddIcon />}
            onClick={() => setShowInviteWorkerForm(!showInviteWorkerForm)}
            size="large"
          >
            Invite Worker
          </Button>
        </Box>
      </Box>

      {/* Worker Invitation Form */}
      {showInviteWorkerForm && (
        <Grid container spacing={3} sx={{ mb: 3, mt: 0}}>
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Invite New Worker
              </Typography>
          
          <form onSubmit={handleInviteWorker}>
            {/* Basic Identity Section */}
            <Accordion 
              expanded={expandedSection === 'basic'} 
              onChange={handleSectionChange('basic')}
              defaultExpanded
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <PersonIcon sx={{ mr: 1 }} />
                <Typography variant="subtitle1">Basic Identity</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="First Name"
                      fullWidth
                      required
                      value={workerForm.firstName || ''}
                      onChange={(e) => handleWorkerFormChange('firstName', e.target.value)}
                      helperText="Legal first name"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Last Name"
                      fullWidth
                      required
                      value={workerForm.lastName || ''}
                      onChange={(e) => handleWorkerFormChange('lastName', e.target.value)}
                      helperText="Legal last name"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Preferred Name"
                      fullWidth
                      value={workerForm.preferredName || ''}
                      onChange={(e) => handleWorkerFormChange('preferredName', e.target.value)}
                      helperText="Shown in Companion/chat and dashboards"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Email"
                      fullWidth
                      required
                      type="email"
                      value={workerForm.email || ''}
                      onChange={(e) => handleWorkerFormChange('email', e.target.value)}
                      helperText="Unique user login + messaging"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Phone"
                      fullWidth
                      required
                      value={workerForm.phone || ''}
                      onChange={handlePhoneChange}
                      helperText="Used for SMS and Companion alerts"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Date of Birth"
                      fullWidth
                      required
                      type="date"
                      value={workerForm.dateOfBirth || ''}
                      onChange={(e) => handleDateChange('dateOfBirth', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for EEO reporting or validation"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Gender</InputLabel>
                      <Select
                        value={workerForm.gender || ''}
                        onChange={(e) => handleWorkerFormChange('gender', e.target.value)}
                        input={<OutlinedInput label="Gender" />}
                      >
                        <MenuItem value="Male">Male</MenuItem>
                        <MenuItem value="Female">Female</MenuItem>
                        <MenuItem value="Nonbinary">Nonbinary</MenuItem>
                        <MenuItem value="Other">Other</MenuItem>
                        <MenuItem value="Prefer not to say">Prefer not to say</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>

            {/* Employment Classification Section */}
            <Accordion 
              expanded={expandedSection === 'employment'} 
              onChange={handleSectionChange('employment')}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <WorkIcon sx={{ mr: 1 }} />
                <Typography variant="subtitle1">Employment Classification</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required>
                      <InputLabel>Security Level</InputLabel>
                      <Select
                        value={workerForm.securityLevel || ''}
                        onChange={(e) => handleWorkerFormChange('securityLevel', e.target.value)}
                        input={<OutlinedInput label="Security Level" />}
                      >
                        <MenuItem value="7">Admin</MenuItem>
                        <MenuItem value="6">Manager</MenuItem>
                        <MenuItem value="5">Worker</MenuItem>
                        <MenuItem value="4">Hired Staff</MenuItem>
                        <MenuItem value="3">Flex</MenuItem>
                        <MenuItem value="2">Applicant</MenuItem>
                        <MenuItem value="1">Dismissed</MenuItem>
                        <MenuItem value="0">Suspended</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Employment Type</InputLabel>
                      <Select
                        value={workerForm.employmentType || ''}
                        onChange={(e) => handleWorkerFormChange('employmentType', e.target.value)}
                        input={<OutlinedInput label="Employment Type *" />}
                      >
                        <MenuItem value="Full-Time">Full-Time</MenuItem>
                        <MenuItem value="Part-Time">Part-Time</MenuItem>
                        <MenuItem value="Contract">Contract</MenuItem>
                        <MenuItem value="Flex">Flex</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      options={jobTitles}
                      value={workerForm.jobTitle || ''}
                      onChange={(_, newValue) => handleWorkerFormChange('jobTitle', newValue || '')}
                      renderInput={(params) => (
                        <TextField 
                          {...params as any} 
                          label="Job Title" 
                          fullWidth 
                          size="small" 
                        />
                      )}
                      freeSolo
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {departments.length === 0 ? (
                      <TextField
                        label="Department"
                        fullWidth
                        disabled
                        value="No departments available"
                        helperText="Please create departments first"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel id="department-label">Department *</InputLabel>
                        <Select
                          labelId="department-label"
                          value={workerForm.departmentId || ''}
                          onChange={(e) => handleWorkerFormChange('departmentId', e.target.value)}
                          input={<OutlinedInput label="Department" />}
                        >
                          {departments.map((dept: any) => (
                            <MenuItem key={dept.id} value={dept.id}>
                              {dept.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {divisions.length === 0 ? (
                      <TextField
                        label="Division"
                        fullWidth
                        disabled
                        value="No divisions available"
                        helperText="Optional - useful for reporting"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel id="division-label">Division</InputLabel>
                        <Select
                          labelId="division-label"
                          value={workerForm.divisionId || ''}
                          onChange={(e) => handleWorkerFormChange('divisionId', e.target.value)}
                          input={<OutlinedInput label="Division" />}
                        >
                          <MenuItem value="">None</MenuItem>
                          {divisions.map((div: any) => (
                            <MenuItem key={div.id} value={div.id}>
                              {div.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {locations.length === 0 ? (
                      <TextField
                        label="Primary Location"
                        fullWidth
                        disabled
                        value="No locations available"
                        helperText="Optional - primary physical location"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel id="location-label">Primary Location</InputLabel>
                        <Select
                          labelId="location-label"
                          value={workerForm.locationId || ''}
                          onChange={(e) => handleWorkerFormChange('locationId', e.target.value)}
                          input={<OutlinedInput label="Primary Location" />}
                        >
                          <MenuItem value="">None</MenuItem>
                          {locations.map((loc: any) => (
                            <MenuItem key={loc.id} value={loc.id}>
                              {loc.nickname || loc.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {managers.length === 0 ? (
                      <TextField
                        label="Manager"
                        fullWidth
                        disabled
                        value="No managers available"
                        helperText="Optional - direct supervisor"
                      />
                    ) : (
                      <Autocomplete
                        options={managers}
                        getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
                        value={managers.find(m => m.id === workerForm.managerId) || null}
                        onChange={(_, newValue) => handleWorkerFormChange('managerId', newValue?.id || '')}
                        renderInput={(params) => (
                          <TextField 
                            {...params as any} 
                            label="Manager" 
                            fullWidth 
                            size="small" 
                          />
                        )}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                      />
                    )}
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>

            {/* Metadata & Structure Section */}
            <Accordion 
              expanded={expandedSection === 'metadata'} 
              onChange={handleSectionChange('metadata')}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <InfoIcon sx={{ mr: 1 }} />
                <Typography variant="subtitle1">Metadata & Structure</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Start Date"
                      fullWidth
                      type="date"
                      value={workerForm.startDate || ''}
                      onChange={(e) => handleDateChange('startDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for tenure calculations"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Work Status *</InputLabel>
                      <Select
                        value={workerForm.workStatus || 'Active'}
                        onChange={(e) => handleWorkerFormChange('workStatus', e.target.value)}
                        input={<OutlinedInput label="Work Status *" />}
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="On Leave">On Leave</MenuItem>
                        <MenuItem value="Terminated">Terminated</MenuItem>
                        <MenuItem value="Suspended">Suspended</MenuItem>
                        <MenuItem value="Pending">Pending</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Worker ID"
                      fullWidth
                      value={workerForm.workerId || ''}
                      onChange={(e) => handleWorkerFormChange('workerId', e.target.value)}
                      helperText="Optional custom ID from HRIS"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Union"
                      fullWidth
                      value={workerForm.union || ''}
                      onChange={(e) => handleWorkerFormChange('union', e.target.value)}
                      helperText="Optional union name or boolean flag"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={workerForm.workEligibility || false}
                          onChange={(e) => handleBooleanChange('workEligibility', e.target.checked)}
                        />
                      }
                      label="Work Eligibility"
                    />
                    <FormHelperText>Eligibility for employment in the region</FormHelperText>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      multiple
                      options={['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Portuguese', 'Russian']}
                      value={workerForm.languages || []}
                      onChange={(_, newValue) => handleWorkerFormChange('languages', newValue)}
                      renderInput={(params) => (
                        <TextField
                          {...(params as any)}
                          label="Languages"
                          fullWidth
                          size="small"
                          helperText="Spoken/written languages"
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                          const { key, ...chipProps } = getTagProps({ index });
                          return <Chip key={String(key)} label={option} {...chipProps} />;
                        })
                      }
                      freeSolo
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>

            {/* User Groups Section */}
            {userGroups.length > 0 && (
              <Accordion 
                expanded={expandedSection === 'groups'} 
                onChange={handleSectionChange('groups')}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle1">User Groups</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Autocomplete
                        multiple
                        options={userGroups}
                        getOptionLabel={(option) => option.name}
                        value={userGroups.filter(group => selectedUserGroups.includes(group.id))}
                        onChange={(_, newValue) => {
                          const groupIds = newValue.map(group => group.id);
                          setSelectedUserGroups(groupIds);
                        }}
                        renderInput={(params) => (
                          <TextField {...(params as any)} label="User Groups" fullWidth size="small" />
                        )}
                        renderTags={(value, getTagProps) =>
                          value.map((option, index) => {
                            const { key, ...chipProps } = getTagProps({ index });
                            return <Chip key={String(key)} label={option.name} {...chipProps} />;
                          })
                        }
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Form Actions */}
            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={inviteWorkerLoading || !isWorkerFormValid}
              >
                {inviteWorkerLoading ? 'Sending Invitation...' : 'Send Invitation'}
              </Button>
              <Button 
                variant="outlined" 
                color="secondary" 
                onClick={() => setShowInviteWorkerForm(false)}
              >
                Cancel
              </Button>
            </Box>
          </form>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Applications List */}
      <Grid container spacing={3} sx={{ mt:0 }}>
        <Grid item xs={12}>
          <ApplicationsList
            tenantId={tenantId}
            onViewApplication={handleViewApplication}
            onEditApplication={handleEditApplication}
            onDeleteApplication={handleDeleteApplication}
          />
        </Grid>
      </Grid>


      {/* Application Detail Dialog */}
      <Dialog
        open={showDetailDialog}
        onClose={() => setShowDetailDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        {selectedApplication && (
          <ApplicationDetail
            application={selectedApplication}
            tenantId={tenantId}
            onSave={handleDetailSave}
            onClose={() => setShowDetailDialog(false)}
          />
        )}
      </Dialog>


      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Applications;
