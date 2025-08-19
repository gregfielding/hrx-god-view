import React, { useEffect, useState } from 'react';
import {
  Box,
  TextField,
  Typography,
  Button,
  Snackbar,
  Alert,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  FormControlLabel,
  Switch,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Card,
  CardContent,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  Psychology as PsychologyIcon,
  ContactEmergency as EmergencyIcon,
} from '@mui/icons-material';
import { doc, getDoc, onSnapshot, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';

import { db , auth } from '../../../firebase';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import { logProfileUpdateActivity, logSecurityChangeActivity } from '../../../utils/activityLogger';
import { useAuth } from '../../../contexts/AuthContext';
import { UserProfileForm, EmergencyContact } from '../../../types/UserProfile';

import AddressFormFields from './AddressTab/AddressFormFields';
import MapWithMarkers from './AddressTab/MapWithMarkers';

type Props = {
  uid: string;
};

const ProfileOverview: React.FC<Props> = ({ uid }) => {
  const { tenantId: activeTenantId, user, securityLevel, activeTenant } = useAuth();
  const [form, setForm] = useState<UserProfileForm>({
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: undefined,
    securityLevel: '5',
    employmentType: 'Full-Time',
    departmentId: '',
    divisionId: '',
    locationId: '',
    managerId: '',
    startDate: '',
    workStatus: 'Active',
    workerId: '',
    union: '',
    workEligibility: true,
    languages: [],
    emergencyContact: undefined,
    transportMethod: undefined,
    role: 'Worker',
    jobTitle: '',
    department: '',
  });

  const [originalForm, setOriginalForm] = useState<UserProfileForm>(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState<string>('');
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [originalUserGroupIds, setOriginalUserGroupIds] = useState<string[]>([]);
  const [tenantName, setTenantName] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [addressInfo, setAddressInfo] = useState<any>({
    homeLat: null,
    homeLng: null,
    workLat: 38.8977, // Default: White House
    workLng: -77.0365,
    currentLat: null,
    currentLng: null,
  });

  // AI insights data (read-only)
  const [aiInsights, setAiInsights] = useState({
    jobSatisfactionIndex: null as number | null,
    burnoutRiskScore: null as number | null,
    companionLastActiveAt: null as Date | null,
    careerPathSuggestions: [] as any[],
  });

  // Location settings data (read-only)
  const [locationSettings, setLocationSettings] = useState({
    locationSharingEnabled: false,
    locationGranularity: 'disabled' as string,
    lastLocationUpdate: null as Date | null,
  });

  // Language options for autocomplete
  const languageOptions = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean',
    'Arabic', 'Hindi', 'Bengali', 'Urdu', 'Turkish', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish',
    'Polish', 'Czech', 'Hungarian', 'Romanian', 'Bulgarian', 'Greek', 'Hebrew', 'Thai', 'Vietnamese', 'Tagalog'
  ];

  // Check if user can edit this profile
  const canEditProfile = () => {
    // Users can always edit their own profile
    if (user?.uid === uid) return true;
    
    // Admins and managers can edit any profile (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  // Check if user can see sensitive sections
  const canSeeSensitiveSections = () => {
    // Admins and managers can see all sections (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    // Workers can only see basic sections
    return false;
  };

  // Check if user can see AI insights (managers and admins only)
  const canSeeAIInsights = () => {
    // Only managers and admins can see AI insights (security level 5 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 5) return true;
    
    return false;
  };

  // Check if user can reset passwords
  const canResetPassword = () => {
    // Users can reset their own password
    if (user?.uid === uid) return true;
    
    // Admins and managers can reset any password (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  useEffect(() => {
    const userRef = doc(db, 'users', uid);
    const unsubscribe =
      onSnapshot(
        userRef,
        async (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            
            // Convert dates to ISO strings for form inputs
            const dateOfBirth = data.dateOfBirth ? 
              (data.dateOfBirth.toDate ? new Date(data.dateOfBirth.toDate()).toISOString().split('T')[0] : 
               typeof data.dateOfBirth === 'string' ? data.dateOfBirth : 
               new Date(data.dateOfBirth).toISOString().split('T')[0]) : '';
            const startDate = data.startDate ? 
              (data.startDate.toDate ? new Date(data.startDate.toDate()).toISOString().split('T')[0] : 
               typeof data.startDate === 'string' ? data.startDate : 
               new Date(data.startDate).toISOString().split('T')[0]) : '';
            
            const newForm: UserProfileForm = {
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              preferredName: data.preferredName || '',
              email: data.email || '',
              phone: data.phone || '',
              dateOfBirth,
              gender: data.gender || undefined,
              securityLevel: data.securityLevel || '5',
              employmentType: data.employmentType || 'Full-Time',
              departmentId: data.departmentId || '',
              divisionId: data.divisionId || '',
              locationId: data.locationId || '',
              managerId: data.managerId || '',
              startDate,
              workStatus: data.workStatus || 'Active',
              workerId: data.workerId || '',
              union: data.union || '',
              workEligibility: data.workEligibility !== false,
              languages: data.languages || [],
              emergencyContact: data.emergencyContact || undefined,
              transportMethod: data.transportMethod || null,
              role: data.role || 'Worker',
              jobTitle: data.jobTitle || '',
              department: data.department || '',
            };
            
            setForm(newForm);
            setOriginalForm(newForm);

            // Load user groups
            const userGroupIds = data.userGroupIds || [];
            setUserGroupIds(userGroupIds);
            setOriginalUserGroupIds(userGroupIds);

            // Load AI insights data
            setAiInsights({
              jobSatisfactionIndex: data.jobSatisfactionIndex || null,
              burnoutRiskScore: data.burnoutRiskScore || null,
              companionLastActiveAt: data.companionLastActiveAt?.toDate ? data.companionLastActiveAt.toDate() : 
                (data.companionLastActiveAt ? new Date(data.companionLastActiveAt) : null),
              careerPathSuggestions: data.careerPathSuggestions || [],
            });
            
            // Load location settings data
            setLocationSettings({
              locationSharingEnabled: data.locationSettings?.locationSharingEnabled || false,
              locationGranularity: data.locationSettings?.locationGranularity || 'disabled',
              lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate ? data.locationSettings.lastLocationUpdate.toDate() : 
                (data.locationSettings?.lastLocationUpdate ? new Date(data.locationSettings.lastLocationUpdate) : null),
            });
            
            setAddressInfo(data.addressInfo || {});
          }
        },
        (error) => {
          console.error('Error fetching user data:', error);
        },
      );

    return () => unsubscribe();
  }, [uid]);

  // Load tenant data when activeTenantId changes
  useEffect(() => {
    if (activeTenantId) {
      setTenantId(activeTenantId);
      loadTenantData(activeTenantId);
    }
  }, [activeTenantId]);

  const loadTenantData = async (tenantId: string) => {
    try {
      console.log('Loading tenant data for tenantId:', tenantId);
      
      // Use tenant name from activeTenant if available, otherwise use tenantId as fallback
      if (activeTenant?.name) {
        setTenantName(activeTenant.name);
        setCustomerName(activeTenant.name);
      } else {
        setTenantName(tenantId);
        setCustomerName(tenantId);
      }
      
      // Fetch departments with error handling
      try {
        const deptQuery = collection(db, 'tenants', tenantId, 'departments');
        const deptSnap = await getDocs(deptQuery);
        const deptData = deptSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched departments:', deptData);
        setDepartments(deptData);
      } catch (deptError) {
        console.warn('Could not fetch departments:', deptError);
        setDepartments([]);
      }
      
      // Fetch divisions with error handling
      try {
        const divQuery = collection(db, 'tenants', tenantId, 'divisions');
        const divSnap = await getDocs(divQuery);
        const divData = divSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched divisions:', divData);
        setDivisions(divData);
      } catch (divError) {
        console.warn('Could not fetch divisions:', divError);
        setDivisions([]);
      }
      
      // Fetch locations with error handling
      try {
        const locQuery = collection(db, 'tenants', tenantId, 'locations');
        const locSnap = await getDocs(locQuery);
        const locData = locSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched locations:', locData);
        setLocations(locData);
      } catch (locError) {
        console.warn('Could not fetch locations:', locError);
        setLocations([]);
      }
      
      // Fetch managers with error handling
      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('tenantId', '==', tenantId),
          where('securityLevel', 'in', ['5', '6', '7'])
        );
        const usersSnap = await getDocs(usersQuery);
        const managerData = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched managers:', managerData);
        setManagers(managerData);
      } catch (managerError) {
        console.warn('Could not fetch managers:', managerError);
        setManagers([]);
      }
      
      // Fetch user groups with error handling
      try {
        const gq = collection(db, 'tenants', tenantId, 'userGroups');
        const gSnap = await getDocs(gq);
        const groupData = gSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched user groups:', groupData);
        setUserGroups(groupData);
      } catch (groupError) {
        console.warn('Could not fetch user groups:', groupError);
        setUserGroups([]);
      }
      
    } catch (error) {
      console.error('Error loading tenant data:', error);
      // Set empty arrays as fallbacks
      setDepartments([]);
      setDivisions([]);
      setLocations([]);
      setManagers([]);
      setUserGroups([]);
    }
  };

  const handleAddressChange = async (updatedAddressInfo: any) => {
    setAddressInfo(updatedAddressInfo);
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { addressInfo: updatedAddressInfo });
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm) || 
                     JSON.stringify(userGroupIds) !== JSON.stringify(originalUserGroupIds);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSelectChange = (e: any) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setForm((prev) => ({ ...prev, phone: formatPhoneNumber(value) }));
    }
  };

  const handleUserGroupsChange = (event: any) => {
    const {
      target: { value },
    } = event;
    setUserGroupIds(typeof value === 'string' ? value.split(',') : value);
  };

  const handleLanguagesChange = (event: any, newValue: string[]) => {
    setForm({ ...form, languages: newValue });
  };

  const handleEmergencyContactChange = (field: keyof EmergencyContact, value: string) => {
    setForm({
      ...form,
      emergencyContact: {
        ...form.emergencyContact,
        [field]: value
      } as EmergencyContact
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userRef = doc(db, 'users', uid);
      
      // Convert form data back to proper format for Firestore
      // Filter out undefined values to prevent Firestore errors
      const cleanForm = Object.fromEntries(
        Object.entries(form).filter(([_, value]) => value !== undefined)
      );
      
      const updateData = {
        ...cleanForm,
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth) : null,
        startDate: form.startDate ? new Date(form.startDate) : null,
        userGroupIds,
        updatedAt: new Date()
      };
      
      // Remove null values as well to prevent Firestore errors
      const finalUpdateData = Object.fromEntries(
        Object.entries(updateData).filter(([key, value]) => {
          // Filter out null, undefined, and empty strings for optional fields
          if (value === null || value === undefined) return false;
          if (typeof value === 'string' && value === '' && ['preferredName', 'divisionId', 'locationId', 'managerId', 'workerId', 'union', 'jobTitle', 'department'].includes(key)) return false;
          
          // Handle emergencyContact object - only include if it has valid data
          if (key === 'emergencyContact') {
            if (!value || typeof value !== 'object') return false;
            const contact = value as any;
            // Only include if at least one field has a non-empty value
            return contact.name?.trim() || contact.relationship?.trim() || contact.phone?.trim();
          }
          
          // Handle gender field - only include if it has a valid value
          if (key === 'gender') {
            return value && typeof value === 'string' && value !== '' && value !== 'undefined';
          }
          
          return true;
        })
      );
      
      console.log('Submitting update data:', finalUpdateData);
      await updateDoc(userRef, finalUpdateData);
      
      // Log the profile update activity
      const changes = {
        formChanges: Object.keys(form).reduce((acc, key) => {
          if (form[key as keyof typeof form] !== originalForm[key as keyof typeof originalForm]) {
            acc[key] = {
              old: originalForm[key as keyof typeof originalForm],
              new: form[key as keyof typeof form]
            };
          }
          return acc;
        }, {} as any),
        userGroupChanges: {
          old: originalUserGroupIds,
          new: userGroupIds
        }
      };
      
      await logProfileUpdateActivity(uid, changes);
      
      setMessage('Profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
      setOriginalUserGroupIds(userGroupIds);
    } catch (error) {
      console.error('Error updating user data:', error);
      setMessage('Failed to update profile');
      setShowToast(true);
    }
  };

  const handleResetPassword = async () => {
    if (!form.email) {
      setMessage('Email address is required to reset password');
      setShowToast(true);
      return;
    }

    setResetPasswordLoading(true);
    try {
      await sendPasswordResetEmail(auth, form.email);
      
      // Log the password reset activity
      await logSecurityChangeActivity(
        uid,
        'password_reset_requested',
        'Password reset email requested',
        { email: form.email }
      );
      
      setMessage('Password reset email sent successfully');
      setShowToast(true);
      setResetPasswordDialogOpen(false);
    } catch (error: any) {
      console.error('Error sending password reset email:', error);
      let errorMessage = 'Failed to send password reset email';
      
      // Handle specific Firebase Auth errors
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No user found with this email address';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many password reset attempts. Please try again later';
      }
      
      setMessage(errorMessage);
      setShowToast(true);
    } finally {
      setResetPasswordLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Grid container spacing={3}>
          {/* 🧍 Basic Identity Section */}
          <Grid item xs={12}>
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <PersonIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Basic Identity</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      name="firstName"
                      label="First Name"
                      value={form.firstName}
                      onChange={handleChange}
                      disabled={!canEditProfile()}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      name="lastName"
                      label="Last Name"
                      value={form.lastName}
                      onChange={handleChange}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="preferredName"
                      label="Preferred Name"
                      value={form.preferredName}
                      onChange={handleChange}
                      helperText="Shown in Companion/chat and dashboards"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      name="email"
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      name="phone"
                      label="Phone"
                      value={form.phone}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="dateOfBirth"
                      label="Date of Birth"
                      type="date"
                      required
                      value={form.dateOfBirth}
                      onChange={handleChange}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for EEO reporting or validation"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Gender</InputLabel>
                      <Select
                        name="gender"
                        value={form.gender || ''}
                        onChange={handleSelectChange}
                        label="Gender"
                      >
                        <MenuItem value="Male">Male</MenuItem>
                        <MenuItem value="Female">Female</MenuItem>
                        <MenuItem value="Nonbinary">Nonbinary</MenuItem>
                        <MenuItem value="Other">Other</MenuItem>
                        <MenuItem value="Prefer not to say">Prefer not to say</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      multiple
                      options={languageOptions}
                      value={form.languages || []}
                      onChange={handleLanguagesChange}
                      renderInput={(params) => (
                        <TextField {...params} label="Languages" placeholder="Select languages" />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip label={option} {...getTagProps({ index })} key={option} />
                        ))
                      }
                    />
                  </Grid>
                  {canResetPassword() && (
                    <Grid item xs={12}>
                      <Button
                        variant="outlined"
                        color="primary"
                        onClick={() => setResetPasswordDialogOpen(true)}
                        disabled={!form.email}
                      >
                        Reset Password
                      </Button>
                    </Grid>
                  )}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* 📍 Employment Classification Section */}
          {canSeeSensitiveSections() && (
            <Grid item xs={12}>
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <WorkIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">Employment Classification</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required>
                      <InputLabel>Security Level</InputLabel>
                      <Select
                        name="securityLevel"
                        value={form.securityLevel}
                        onChange={handleSelectChange}
                        label="Security Level *"
                      >
                        <MenuItem value="7">Admin (7)</MenuItem>
                        <MenuItem value="6">Manager (6)</MenuItem>
                        <MenuItem value="5">Worker (5)</MenuItem>
                        <MenuItem value="4">Hired Staff (4)</MenuItem>
                        <MenuItem value="3">Flex (3)</MenuItem>
                        <MenuItem value="2">Applicant (2)</MenuItem>
                        <MenuItem value="1">Dismissed (1)</MenuItem>
                        <MenuItem value="0">Suspended (0)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Employment Type</InputLabel>
                      <Select
                        name="employmentType"
                        value={form.employmentType}
                        onChange={handleSelectChange}
                        label="Employment Type *"
                      >
                        <MenuItem value="Full-Time">Full-Time</MenuItem>
                        <MenuItem value="Part-Time">Part-Time</MenuItem>
                        <MenuItem value="Contract">Contract</MenuItem>
                        <MenuItem value="Flex">Flex</MenuItem>
                      </Select>
                    </FormControl>
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
                        <InputLabel>Department</InputLabel>
                        <Select
                          name="departmentId"
                          value={form.departmentId}
                          onChange={handleSelectChange}
                          label="Department"
                        >
                          <MenuItem value="">None</MenuItem>
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
                        <InputLabel>Division</InputLabel>
                        <Select
                          name="divisionId"
                          value={form.divisionId || ''}
                          onChange={handleSelectChange}
                          label="Division"
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
                        label="Location"
                        fullWidth
                        disabled
                        value="No locations available"
                        helperText="Optional - primary physical location"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Location</InputLabel>
                        <Select
                          name="locationId"
                          value={form.locationId || ''}
                          onChange={handleSelectChange}
                          label="Location"
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
                    <FormControl fullWidth>
                      <InputLabel>Manager</InputLabel>
                      <Select
                        name="managerId"
                        value={form.managerId || ''}
                        onChange={handleSelectChange}
                        label="Manager"
                      >
                        {managers.map((manager: any) => (
                          <MenuItem key={manager.id} value={manager.id}>
                            {manager.firstName} {manager.lastName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="startDate"
                      label="Start Date"
                      type="date"
                      value={form.startDate}
                      onChange={handleChange}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for tenure calculations"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required>
                      <InputLabel>Work Status</InputLabel>
                      <Select
                        name="workStatus"
                        value={form.workStatus}
                        onChange={handleSelectChange}
                        label="Work Status *"
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
                      fullWidth
                      name="workerId"
                      label="Worker ID"
                      value={form.workerId}
                      onChange={handleChange}
                      helperText="Optional custom ID from HRIS"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="union"
                      label="Union"
                      value={form.union}
                      onChange={handleChange}
                      helperText="Union name or boolean flag"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.workEligibility}
                          onChange={(e) => setForm({ ...form, workEligibility: e.target.checked })}
                        />
                      }
                      label="Work Eligibility"
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
          )}

          {/* 🧪 Enrichments Section */}
          <Grid item xs={12}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <EmergencyIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Emergency Contact & Transport</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      name="emergencyContactName"
                      label="Emergency Contact Name"
                      value={form.emergencyContact?.name || ''}
                      onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      name="emergencyContactRelationship"
                      label="Relationship"
                      value={form.emergencyContact?.relationship || ''}
                      onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      name="emergencyContactPhone"
                      label="Emergency Contact Phone"
                      value={form.emergencyContact?.phone || ''}
                      onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Transport Method</InputLabel>
                      <Select
                        name="transportMethod"
                        value={form.transportMethod || ''}
                        onChange={handleSelectChange}
                        label="Transport Method"
                      >
                        <MenuItem value="Car">Car</MenuItem>
                        <MenuItem value="Public Transit">Public Transit</MenuItem>
                        <MenuItem value="Bike">Bike</MenuItem>
                        <MenuItem value="Walk">Walk</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* 🧠 Behavioral AI Section (Read-only) */}
          {canSeeAIInsights() && (
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <PsychologyIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">AI Insights (Auto-generated)</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">
                          Job Satisfaction Index
                        </Typography>
                        <Typography variant="h4" color="primary">
                          {aiInsights.jobSatisfactionIndex || 'N/A'}
                        </Typography>
                        <Typography variant="caption">
                          Rolling score (1-100)
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">
                          Burnout Risk Score
                        </Typography>
                        <Typography variant="h4" color="error">
                          {aiInsights.burnoutRiskScore || 'N/A'}
                        </Typography>
                        <Typography variant="caption">
                          Rolling score (1-100)
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">
                          Location Sharing Status
                        </Typography>
                        <Typography variant="h6" color={locationSettings.locationSharingEnabled ? 'success' : 'text.secondary'}>
                          {locationSettings.locationSharingEnabled ? 'Enabled' : 'Disabled'}
                        </Typography>
                        <Typography variant="caption">
                          {locationSettings.locationSharingEnabled 
                            ? `Mode: ${locationSettings.locationGranularity.replace('_', ' ')}`
                            : 'No location sharing active'
                          }
                        </Typography>
                        {locationSettings.lastLocationUpdate && (
                          <Typography variant="caption" display="block">
                            Last update: {locationSettings.lastLocationUpdate.toLocaleString()}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">
                          Companion Activity
                        </Typography>
                        <Typography variant="h6" color="primary">
                          {aiInsights.companionLastActiveAt ? 'Active' : 'Inactive'}
                        </Typography>
                        <Typography variant="caption">
                          {aiInsights.companionLastActiveAt 
                            ? `Last active: ${aiInsights.companionLastActiveAt.toLocaleString()}`
                            : 'No recent activity'
                          }
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
          )}

          {/* 🔐 System & Associations Section */}
          {canSeeSensitiveSections() && (
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <BusinessIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">System & Associations</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>Associations</Typography>
                    <Box sx={{ mb: 2 }}>
                      {tenantId && (
                        <Typography variant="body1">Tenant: {tenantName || tenantId}</Typography>
                      )}
                      {tenantId && (
                        <Typography variant="body1">Customer: {customerName || tenantId}</Typography>
                      )}
                      {!tenantId && (
                        <Typography variant="body2" color="text.secondary">No associations found.</Typography>
                      )}
                    </Box>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>User Groups</Typography>
                    <Autocomplete
                      multiple
                      options={userGroups}
                      getOptionLabel={(option) => option.title || option.id}
                      value={userGroups.filter((g) => userGroupIds.includes(g.id))}
                      onChange={(_, newValue) => setUserGroupIds(newValue.map((g: any) => g.id))}
                      renderInput={(params) => (
                        <TextField {...params} label="User Groups" placeholder="Select groups" fullWidth />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            label={option.title || option.id}
                            {...getTagProps({ index })}
                            key={option.id}
                          />
                        ))
                      }
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
          )}

          {/* Address Section */}
          <Grid item xs={12}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h6">Home Address</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <AddressFormFields uid={uid} formData={addressInfo} onFormChange={handleAddressChange} />
                <MapWithMarkers
                  homeLat={addressInfo.homeLat}
                  homeLng={addressInfo.homeLng}
                  workLat={addressInfo.workLat}
                  workLng={addressInfo.workLng}
                  currentLat={addressInfo.currentLat}
                  currentLng={addressInfo.currentLng}
                />
              </AccordionDetails>
            </Accordion>
          </Grid>

          {hasChanges && canEditProfile() && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained" size="large">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Box>

      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert 
          onClose={() => setShowToast(false)} 
          severity={message.includes('successfully') ? 'success' : 'error'} 
          sx={{ width: '100%' }}
        >
          {message}
        </Alert>
      </Snackbar>

      {/* Password Reset Confirmation Dialog */}
      <Dialog
        open={resetPasswordDialogOpen}
        onClose={() => setResetPasswordDialogOpen(false)}
        aria-labelledby="reset-password-dialog-title"
        aria-describedby="reset-password-dialog-description"
      >
        <DialogTitle id="reset-password-dialog-title">
          Reset Password
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="reset-password-dialog-description">
            Are you sure you want to send a password reset email to <strong>{form.email}</strong>?
            <br /><br />
            The user will receive an email with a link to reset their password.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setResetPasswordDialogOpen(false)} 
            disabled={resetPasswordLoading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleResetPassword} 
            variant="contained" 
            color="primary"
            disabled={resetPasswordLoading}
          >
            {resetPasswordLoading ? 'Sending...' : 'Send Reset Email'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileOverview;
