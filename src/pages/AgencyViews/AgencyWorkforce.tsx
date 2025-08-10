import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Snackbar,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import jobTitles from '../../data/onetJobTitles.json';
import BroadcastDialog from '../../components/BroadcastDialog';
import AddWorkerForm from '../../componentBlocks/AddWorkerForm';
import CSVUpload from '../../components/CSVUpload';
import WorkersTable from '../../componentBlocks/WorkersTable';
import { CSVWorkerData } from '../../utils/csvUpload';


function formatPhoneNumber(value: string) {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

const AgencyWorkforce: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    jobTitle: '',
    phone: '',
    email: '',
    locationIds: [] as string[],
    departmentId: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    dob: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false);
  const [search, setSearch] = useState('');
  // CSV import state
  const [importMode, setImportMode] = useState<'form' | 'csv'>('form');
  const [showCSVUpload, setShowCSVUpload] = useState(false);

  useEffect(() => {
    if (tenantId) {
      fetchDepartments();
      fetchLocations().then(fetchContacts);
      fetchUserGroups();
    }
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchContacts = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Worker'),
        where('tenantId', '==', tenantId),
      );
      const snapshot = await getDocs(q);
      setContacts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch workers');
    }
    setLoading(false);
  };

  const fetchLocations = async () => {
    if (!tenantId) return;
    setLocationsLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
    setLocationsLoading(false);
  };

  const fetchDepartments = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchUserGroups = async () => {
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const handleChange = (field: string, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const isFormValid =
    form.firstName && form.lastName && form.email && form.phone && form.locationIds.length > 0;

  const handleWorkerSelection = (workerId: string) => {
    setSelectedWorkers((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId],
    );
  };

  const handleSelectAll = () => {
    if (selectedWorkers.length === contacts.length) {
      setSelectedWorkers([]);
    } else {
      setSelectedWorkers(contacts.map((contact) => contact.id));
    }
  };

  const handleBroadcastSuccess = (result: any) => {
    setSuccess(true);
    setSelectedWorkers([]);
  };

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
        securityLevel: '5',
        role: 'Worker',
        tenantId: tenantId,
        // Additional fields for geocoding
        street: form.street,
        city: form.city,
        state: form.state,
        zip: form.zip,
        dateOfBirth: form.dob,
        userGroupIds: selectedUserGroups,
      };
      
      console.log('Sending inviteUserV2 payload:', payload);
      const result = await inviteUser(payload);
      console.log('InviteUserV2 result:', result);
      setForm({
        firstName: '',
        lastName: '',
        jobTitle: '',
        phone: '',
        email: '',
        locationIds: [],
        departmentId: '',
        street: '',
        city: '',
        state: '',
        zip: '',
        dob: '',
      });
      setSelectedUserGroups([]);
      setSuccess(true);
      await fetchDepartments();
      await fetchLocations();
      await fetchContacts();
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
            role: 'Worker',
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
        await fetchContacts();
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

  if (!tenantId) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="error">
          No agency ID found. Please log in as an agency user.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Workforce Management
        </Typography>
        {!showForm && !showCSVUpload && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => setImportMode('csv')}
            >
              CSV Upload
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => setShowForm(true)}
            >
              Add New Worker
            </Button>
          </Box>
        )}
      </Box>

      {/* Import Mode Toggle */}
      {!showForm && !showCSVUpload && (
        <Box sx={{ mb: 3 }}>
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
      )}

      {/* Individual Form Mode */}
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
          />
        </Paper>
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
              divisions={[]}
              managers={[]}
            />
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Workers ({contacts.length})</Typography>
        {selectedWorkers.length > 0 && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowBroadcastDialog(true)}
            sx={{ ml: 2 }}
          >
            Send Broadcast to {selectedWorkers.length} Worker
            {selectedWorkers.length !== 1 ? 's' : ''}
          </Button>
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search workers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: 300 }}
        />
      </Box>
      <WorkersTable
        contacts={contacts}
        locations={locations}
        departments={departments}
        selectedWorkers={selectedWorkers}
        handleWorkerSelection={handleWorkerSelection}
        handleSelectAll={handleSelectAll}
        navigateToUser={(userId) => navigate(`/users/${userId}`)}
        contextType="agency"
        loading={locationsLoading}
        search={search}
        onSearchChange={setSearch}
      />

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

      <BroadcastDialog
        open={showBroadcastDialog}
        onClose={() => setShowBroadcastDialog(false)}
        tenantId={tenantId}
        senderId="admin" // Replace with actual user ID
        initialAudienceFilter={{
          userIds: selectedWorkers,
        }}
        title={`Send Broadcast to ${selectedWorkers.length} Worker${
          selectedWorkers.length !== 1 ? 's' : ''
        }`}
        onSuccess={handleBroadcastSuccess}
      />
    </Box>
  );
};

export default AgencyWorkforce; 