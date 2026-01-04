import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  ToggleButtonGroup,
  ToggleButton,
  Snackbar,
  Alert,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import AddWorkerForm from '../../componentBlocks/AddWorkerForm';
import CSVUpload from '../../components/CSVUpload';
import { CSVWorkerData } from '../../utils/csvUpload';
import jobTitles from '../../data/onetJobTitles.json';

const AddWorkers: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [form, setForm] = useState({
    // Basic Identity
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    
    // Employment Classification
    securityLevel: '5',
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
  
  const [departments, setDepartments] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [importMode, setImportMode] = useState<'form' | 'csv'>('form');
  const [showCSVUpload, setShowCSVUpload] = useState(false);
  const [isStaffingCompany, setIsStaffingCompany] = useState(false);
  const [flexModuleEnabled, setFlexModuleEnabled] = useState(false);

  useEffect(() => {
    if (effectiveTenantId) {
      fetchData();
      // Import the function dynamically to avoid circular dependencies
      import('../../utils/staffingCompanies').then(({ isStaffingCompany: checkIfStaffingCompany }) => {
        setIsStaffingCompany(checkIfStaffingCompany(effectiveTenantId));
      });
    }
  }, [effectiveTenantId]);

  const fetchData = async () => {
    if (!effectiveTenantId) return;
    
    setLoading(true);
    try {
      // Fetch all data in parallel
      await Promise.all([
        fetchDepartments(),
        fetchLocations(),
        fetchDivisions(),
        fetchManagers(),
        fetchUserGroups()
      ]);
    } catch (error) {
      console.error('Error fetching add workers data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = query(collection(db, 'tenants', effectiveTenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch locations:', err);
      setLocations([]);
    }
  };

  const fetchDepartments = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch departments:', err);
      setDepartments([]);
    }
  };

  const fetchDivisions = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'divisions');
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch divisions:', err);
      setDivisions([]);
    }
  };

  const fetchManagers = async () => {
    if (!effectiveTenantId) return;
    try {
      // Fetch managers from users collection with security levels 5, 6, 7 (managers and admins)
      const usersQuery = query(
        collection(db, 'users'),
        where('tenantId', '==', effectiveTenantId),
        where('securityLevel', 'in', ['5', '6', '7'])
      );
      const usersSnap = await getDocs(usersQuery);
      const managerData = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setManagers(managerData);
    } catch (err: any) {
      console.warn('Could not fetch managers:', err);
      setManagers([]);
    }
  };

  const fetchUserGroups = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch user groups:', err);
      setUserGroups([]);
    }
  };

  const handleChange = (field: string, value: string | string[] | boolean | Date) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const isFormValid = Boolean(
    form.firstName && 
    form.lastName && 
    form.email && 
    form.phone && 
    form.securityLevel && 
    form.employmentType && 
    form.workStatus &&
    form.departmentId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      // Call the inviteUserV2 function instead of directly adding to Firestore
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      // Build payload with the required structure
      const payload: any = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        displayName: `${form.firstName} ${form.lastName}`,
        jobTitle: form.jobTitle,
        department: form.departmentId,
        locationIds: form.locationIds,
        securityLevel: form.securityLevel,
        role: 'Tenant',
        tenantId: tenantId,
        // Additional fields for geocoding
        street: form.street,
        city: form.city,
        state: form.state,
        zip: form.zip,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        employmentType: form.employmentType,
        startDate: form.startDate,
        workStatus: form.workStatus,
        workerId: form.workerId,
        union: form.union,
        workEligibility: form.workEligibility,
        languages: form.languages,
        userGroupIds: selectedUserGroups,
      };
      
      console.log('Sending inviteUserV2 payload:', payload);
      const result = await inviteUser(payload);
      console.log('InviteUserV2 result:', result);
      
      // Reset form
      setForm({
        firstName: '',
        lastName: '',
        preferredName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: '',
        securityLevel: '5',
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
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add worker');
    }
    setLoading(false);
  };

  const handleCSVImport = async (workers: CSVWorkerData[]) => {
    setLoading(true);
    setError('');
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      for (const worker of workers) {
        try {
          // Check if email already exists
          const emailQuery = query(collection(db, 'users'), where('email', '==', worker.email));
          const emailSnapshot = await getDocs(emailQuery);
          if (!emailSnapshot.empty) {
            errors.push(`Email ${worker.email} already exists`);
            errorCount++;
            continue;
          }

          // Build payload for inviteUserV2
          const payload: any = {
            email: worker.email,
            firstName: worker.firstName,
            lastName: worker.lastName,
            phone: worker.phone || '',
            displayName: `${worker.firstName} ${worker.lastName}`,
            jobTitle: worker.jobTitle || '',
            department: worker.departmentId || '',
            locationIds: worker.locationId ? [worker.locationId] : [],
            securityLevel: '5',
            role: 'Tenant',
            tenantId: tenantId,
            // Additional fields
            dateOfBirth: worker.dateOfBirth,
            street: '',
            city: '',
            state: '',
            zip: '',
          };

          // Call inviteUserV2 function
          await inviteUser(payload);
          successCount++;
        } catch (err: any) {
          errors.push(`Failed to add ${worker.email}: ${err.message}`);
          errorCount++;
        }
      }

      // Show results
      if (successCount > 0) {
        setSuccess(true);
      }
      
      if (errorCount > 0) {
        setError(`Import completed with ${errorCount} error(s): ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '...' : ''}`);
      }

      setShowCSVUpload(false);
    } catch (err: any) {
      setError(err.message || 'Failed to import workers');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Import Mode Toggle */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Add Workers
        </Typography>
        <ToggleButtonGroup
          value={importMode}
          exclusive
          onChange={(_, newMode) => newMode && setImportMode(newMode)}
          aria-label="import mode"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="form" aria-label="individual form">
            Individual Form
          </ToggleButton>
          <ToggleButton value="csv" aria-label="csv upload">
            CSV Upload
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Individual Form Mode */}
      {importMode === 'form' && (
        <Box>
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(true)}
            sx={{ mb: 2 }}
          >
            Add New Worker
          </Button>
          {showForm && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <AddWorkerForm
                form={form}
                onChange={handleChange}
                onPhoneChange={handlePhoneChange}
                onSubmit={handleSubmit}
                loading={loading}
                departments={departments}
                locations={locations}
                divisions={divisions}
                managers={managers}
                userGroups={userGroups}
                selectedUserGroups={selectedUserGroups}
                setSelectedUserGroups={setSelectedUserGroups}
                showForm={showForm}
                setShowForm={setShowForm}
                isFormValid={isFormValid}
                jobTitles={jobTitles}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                contextType="agency"
                isStaffingCompany={isStaffingCompany}
                flexModuleEnabled={flexModuleEnabled}
              />
            </Paper>
          )}
        </Box>
      )}

      {/* CSV Upload Mode */}
      {importMode === 'csv' && (
        <Box>
          {!showCSVUpload ? (
            <Button
              variant="contained"
              color="primary"
              onClick={() => setShowCSVUpload(true)}
              sx={{ mb: 2 }}
            >
              Upload CSV File
            </Button>
          ) : (
            <CSVUpload
              onWorkersReady={handleCSVImport}
              onCancel={() => setShowCSVUpload(false)}
              departments={departments}
              locations={locations}
              divisions={divisions}
              managers={managers}
            />
          )}
        </Box>
      )}

      {/* Snackbars */}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Worker added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddWorkers;
