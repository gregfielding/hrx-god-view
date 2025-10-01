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
  ContactEmergency as EmergencyIcon,
  Security as SecurityIcon,
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
  const coerceToDate = (value: any): Date | null => {
    if (!value) return null;
    try {
      // Firestore Timestamp
      if (typeof value?.toDate === 'function') return value.toDate();
      // ISO string or date string
      if (typeof value === 'string') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Milliseconds
      if (typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Date instance
      if (value instanceof Date) return value;
      return null;
    } catch {
      return null;
    }
  };
  const { tenantId: activeTenantId, user, securityLevel, activeTenant } = useAuth();
  const [form, setForm] = useState<UserProfileForm>({
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    dateOfBirth: '',
    gender: undefined,
    securityLevel: '5',
    employmentType: 'Full-Time',
    departmentId: '',
    divisionId: '',
    locationId: '',
    regionId: '',
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
  const [regions, setRegions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState<string>('');
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

  // System access info (read-only)
  const [systemAccess, setSystemAccess] = useState<{
    loginCount: number | null;
    lastLoginAt: Date | null;
    uid: string;
  }>({ loginCount: null, lastLoginAt: null, uid });

  // Removed AI insights section

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

  // AI Insights removed

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
              linkedinUrl: data.linkedinUrl || '',
              dateOfBirth,
              gender: data.gender || undefined,
              securityLevel: data.securityLevel || '5',
              employmentType: data.employmentType || 'Full-Time',
              departmentId: data.departmentId || '',
              divisionId: data.divisionId || '',
              locationId: data.locationId || '',
              regionId: data.regionId || '',
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
              crm_sales: !!data.crm_sales,
              recruiter: !!data.recruiter,
              jobsBoard: !!data.jobsBoard,
            };
            
            setForm(newForm);
            setOriginalForm(newForm);

            // AI insights removed
            
            // Load location settings data
            setLocationSettings({
              locationSharingEnabled: data.locationSettings?.locationSharingEnabled || false,
              locationGranularity: data.locationSettings?.locationGranularity || 'disabled',
              lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate ? data.locationSettings.lastLocationUpdate.toDate() : 
                (data.locationSettings?.lastLocationUpdate ? new Date(data.locationSettings.lastLocationUpdate) : null),
            });
            
            setAddressInfo(data.addressInfo || {});

            // Populate system access info: prefer lastActiveAt, fallback to lastLoginAt
            setSystemAccess({
              loginCount: typeof data.loginCount === 'number' ? data.loginCount : null,
              lastLoginAt: coerceToDate(data.lastActiveAt) || coerceToDate(data.lastLoginAt),
              uid,
            });
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
      
      // Fetch regions with error handling
      try {
        const regionQuery = collection(db, 'tenants', tenantId, 'regions');
        const regionSnap = await getDocs(regionQuery);
        const regionData = regionSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched regions:', regionData);
        setRegions(regionData);
      } catch (regionError) {
        console.warn('Could not fetch regions:', regionError);
        setRegions([]);
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
      
      
    } catch (error) {
      console.error('Error loading tenant data:', error);
      // Set empty arrays as fallbacks
      setDepartments([]);
      setDivisions([]);
      setRegions([]);
      setLocations([]);
      setManagers([]);
    }
  };

  const handleAddressChange = async (updatedAddressInfo: any) => {
    setAddressInfo(updatedAddressInfo);
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { addressInfo: updatedAddressInfo });
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSelectChange = (e: any) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    // Persist Employment Details fields immediately
    const employmentFields = new Set([
      'jobTitle',
      'securityLevel',
      'employmentType',
      'departmentId',
      'divisionId',
      'locationId',
      'regionId',
      'managerId',
      'startDate',
      'workStatus',
      // Also persist identity select fields
      'gender',
      'transportMethod',
    ]);
    if (employmentFields.has(name)) {
      persistEmploymentField(name, value);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      const formatted = formatPhoneNumber(value);
      setForm((prev) => ({ ...prev, phone: formatted }));
      persistProfileField('phone', formatted);
    }
    // Persist text inputs in Employment Details on blur
    const employmentTextFields = new Set(['jobTitle', 'workerId', 'union']);
    if (employmentTextFields.has(name)) {
      persistEmploymentField(name, value);
    }
    // Persist Basic Identity text fields on blur
    const identityTextFields = new Set(['firstName', 'lastName', 'preferredName', 'email']);
    if (identityTextFields.has(name)) {
      persistProfileField(name, value);
    }
  };


  const handleLanguagesChange = (event: any, newValue: string[]) => {
    setForm({ ...form, languages: newValue });
    persistProfileField('languages', newValue);
  };

  const handleEmergencyContactChange = (field: keyof EmergencyContact, value: string) => {
    const updatedEmergencyContact = {
      ...form.emergencyContact,
      [field]: value
    } as EmergencyContact;
    
    setForm({
      ...form,
      emergencyContact: updatedEmergencyContact
    });
    
    // Persist the emergency contact data immediately
    persistProfileField('emergencyContact', updatedEmergencyContact);
  };

  // Persist a single Employment Details field to Firestore immediately
  const persistEmploymentField = async (field: string, value: any) => {
    try {
      const userRef = doc(db, 'users', uid);
      let toSave: any = value;
      if (field === 'startDate' || field === 'dateOfBirth') {
        toSave = value ? new Date(value) : null;
      }
      
      // List of tenant-dependent fields that need to be stored in nested tenantIds structure
      const tenantDependentFields = [
        'securityLevel', 'regionId', 'jobTitle', 'workStatus', 'employmentType', 
        'departmentId', 'divisionId', 'managerId', 'startDate', 'workerId', 'locationId'
      ];
      
      // Special handling for tenant-dependent fields - update nested tenantIds
      if (tenantDependentFields.includes(field) && activeTenantId) {
        // Get current user document to access tenantIds
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        
        if (userData?.tenantIds?.[activeTenantId]) {
          // Prepare update data with both direct field and nested field
          const updateData: any = { 
            [field]: toSave,
            [`tenantIds.${activeTenantId}.${field}`]: toSave,
            updatedAt: new Date() 
          };
          
          // Clean up old field names to prevent duplication
          const fieldMappings: { [key: string]: string } = {
            'departmentId': 'department',
            'regionId': 'region'
          };
          
          if (fieldMappings[field]) {
            // Remove the old field name from the nested structure
            updateData[`tenantIds.${activeTenantId}.${fieldMappings[field]}`] = null;
            console.log(`🧹 Cleaning up old field: tenantIds.${activeTenantId}.${fieldMappings[field]}`);
          }
          
          await updateDoc(userRef, updateData);
          console.log(`✅ Updated ${field} to ${toSave} in both direct field and tenantIds.${activeTenantId}.${field}`);
        } else {
          // Fallback: just update direct field if tenantIds structure is missing
          await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
          console.log(`⚠️ Updated ${field} to ${toSave} in direct field only (tenantIds structure missing)`);
        }
      } else {
        // Normal field update (for non-tenant-dependent fields)
        await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
      }
    } catch (err) {
      console.error('Error updating field', field, err);
    }
  };

  // Generic alias for non-employment fields
  const persistProfileField = async (field: string, value: any) => {
    await persistEmploymentField(field, value);
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
        }, {} as any)
      };
      
      await logProfileUpdateActivity(uid, changes);
      
      setMessage('Profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
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
                  {/* Left Column */}
                  <Grid item xs={12} sm={6}>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          required
                          name="firstName"
                          label="First Name"
                          value={form.firstName}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          disabled={!canEditProfile()}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          required
                          name="lastName"
                          label="Last Name"
                          value={form.lastName}
                          onChange={handleChange}
                          onBlur={handleBlur}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="preferredName"
                          label="Preferred Name"
                          value={form.preferredName}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          helperText="Shown in Companion/chat and dashboards"
                        />
                      </Grid>
                      <Grid item xs={12}>
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
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          required
                          name="email"
                          label="Email"
                          type="email"
                          value={form.email}
                          onChange={handleChange}
                          onBlur={handleBlur}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="dateOfBirth"
                          label="Date of Birth"
                          type="date"
                          required
                          value={form.dateOfBirth}
                          onChange={(e) => {
                            handleChange(e as any);
                            persistProfileField('dateOfBirth', (e.target as HTMLInputElement).value);
                          }}
                          InputLabelProps={{ shrink: true }}
                          helperText="Used for EEO reporting or validation"
                        />
                      </Grid>
                      <Grid item xs={12}>
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
                    </Grid>
                  </Grid>
                  
                  {/* Right Column */}
                  <Grid item xs={12} sm={6}>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="linkedinUrl"
                          label="LinkedIn URL"
                          value={form.linkedinUrl || ''}
                          onChange={handleChange}
                          onBlur={(e) => persistProfileField('linkedinUrl', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12}>
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
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="emergencyContactName"
                          label="Emergency Contact Name"
                          value={form.emergencyContact?.name || ''}
                          onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="emergencyContactRelationship"
                          label="Relationship"
                          value={form.emergencyContact?.relationship || ''}
                          onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          name="emergencyContactPhone"
                          label="Emergency Contact Phone"
                          value={form.emergencyContact?.phone || ''}
                          onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12}>
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
                  </Grid>
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
                  <Typography variant="h6">Employment Details</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="jobTitle"
                      label="Job Title"
                      value={form.jobTitle}
                      onChange={handleChange}
                      onBlur={handleBlur}
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
                    {regions.length === 0 ? (
                      <TextField
                        label="Region"
                        fullWidth
                        disabled
                        value="No regions available"
                        helperText="Optional - geographic region"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Region</InputLabel>
                        <Select
                          name="regionId"
                          value={form.regionId || ''}
                          onChange={handleSelectChange}
                          label="Region"
                        >
                          <MenuItem value="">None</MenuItem>
                          {regions.map((region: any) => (
                            <MenuItem key={region.id} value={region.id}>
                              {region.name}
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
                        <MenuItem value="">None</MenuItem>
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
                      onChange={(e) => {
                        handleChange(e as any);
                        persistEmploymentField('startDate', (e.target as HTMLInputElement).value);
                      }}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for tenure calculations"
                    />
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="workerId"
                      label="Worker ID"
                      value={form.workerId}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Optional custom ID from HRIS"
                    />
                  </Grid>
                  {/* <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="union"
                      label="Union"
                      value={form.union}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Union name if exists"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.workEligibility}
                          onChange={(e) => {
                            setForm({ ...form, workEligibility: e.target.checked });
                            persistEmploymentField('workEligibility', e.target.checked);
                          }}
                        />
                      }
                      label="Work Eligibility"
                    />
                  </Grid> */}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
          )}


          {/* AI Insights section removed */}


          {/* 🔐 System Access Section */}
          <Grid item xs={12}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <SecurityIcon sx={{ mr: 1 }} />
                <Typography variant="h6">System Access</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" color="text.secondary">User ID</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{systemAccess.uid}</Typography>
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
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
                  
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      label="Last Active"
                      value={systemAccess.lastLoginAt ? systemAccess.lastLoginAt.toLocaleString() : '—'}
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>

                  {canResetPassword() && (
                    <Grid item xs={12} sm={4}>
                      <Button
                        variant="outlined"
                        color="primary"
                        onClick={() => setResetPasswordDialogOpen(true)}
                        disabled={!form.email}
                        fullWidth
                      >
                        Reset Password
                      </Button>
                    </Grid>
                  )}

                  {(parseInt(form.securityLevel || '0') >= 5) && (
                    <>
                      <Grid item xs={12}> 
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Per‑User Module Access</Typography>
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={!!form.crm_sales}
                              onChange={(e) => {
                                const value = e.target.checked;
                                setForm({ ...form, crm_sales: value });
                                persistProfileField('crm_sales', value);
                              }}
                            />
                          }
                          label="CRM (Sales) Access"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={!!form.recruiter}
                              onChange={(e) => {
                                const value = e.target.checked;
                                setForm({ ...form, recruiter: value });
                                persistProfileField('recruiter', value);
                              }}
                            />
                          }
                          label="Recruiter Module Access"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={!!form.jobsBoard}
                              onChange={(e) => {
                                const value = e.target.checked;
                                setForm({ ...form, jobsBoard: value });
                                persistProfileField('jobsBoard', value);
                              }}
                            />
                          }
                          label="Jobs Board Access"
                        />
                      </Grid>
                    </>
                  )}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

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
