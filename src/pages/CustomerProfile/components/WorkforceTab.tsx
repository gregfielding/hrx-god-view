import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Snackbar,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../../firebase';
import jobTitles from '../../../data/onetJobTitles.json';
import AddWorkerForm from '../../../componentBlocks/AddWorkerForm';
import CSVUpload from '../../../components/CSVUpload';
import WorkersTable from '../../../componentBlocks/WorkersTable';
import { CSVWorkerData } from '../../../utils/csvUpload';


interface WorkforceTabProps {
  tenantId: string;
}

function formatPhoneNumber(value: string) {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^\(\d{0,3}\)(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

const securityLevels = ['Admin', 'Manager', 'Staffer'];

const WorkforceTab: React.FC<WorkforceTabProps> = ({ tenantId, ...props }) => {
  const isTenant = !!tenantId;
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    jobTitle: '',
    phone: '',
    email: '',
    locationIds: [] as string[],
    departmentId: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  // CSV import state
  const [importMode, setImportMode] = useState<'form' | 'csv'>('form');
  const [showCSVUpload, setShowCSVUpload] = useState(false);

  useEffect(() => {
    if (tenantId) {
      fetchDepartments();
      fetchLocations().then(fetchContacts);
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
      const path = isTenant
        ? ['tenants', tenantId, 'locations']
        : ['tenants', tenantId, 'locations'];
      const q = query(collection(db, ...(path as [string, ...string[]])));
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

  const handleChange = (field: string, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const isFormValid = Boolean(
    form.firstName &&
    form.lastName &&
    form.email &&
    form.locationIds.length > 0 &&
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
        securityLevel: 'Worker',
        role: 'Worker',
        tenantId: tenantId,
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
      });
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
            securityLevel: 'Worker',
            role: 'Worker',
            tenantId: tenantId,
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

  return (
    <Box sx={{ p: 0 }}>
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
      {importMode === 'form' && !showForm && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mb: 2 }}
          onClick={() => setShowForm(true)}
        >
          Add New Worker
        </Button>
      )}
      {showForm && (
        <AddWorkerForm
          form={form}
          onChange={handleChange}
          onPhoneChange={handlePhoneChange}
          onSubmit={handleSubmit}
          loading={loading}
          departments={departments}
          locations={locations}
          showForm={showForm}
          setShowForm={setShowForm}
          isFormValid={isFormValid}
          jobTitles={jobTitles}
          error={error}
          success={success}
          setError={setError}
          setSuccess={setSuccess}
          contextType="customer"
        />
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
      <Typography variant="h6" gutterBottom>
        Workers
      </Typography>
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
        contextType="customer"
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
    </Box>
  );
};

export default WorkforceTab;
