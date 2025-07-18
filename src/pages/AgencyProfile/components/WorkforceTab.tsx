import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Chip,
  Checkbox,
  AppBar,
  Toolbar,
  IconButton,
  Fab,
  Autocomplete,
} from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import jobTitles from '../../../data/onetJobTitles.json';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import { Autocomplete as MUIAutocomplete } from '@mui/material';
import { Autocomplete as GoogleMapsAutocomplete } from '@react-google-maps/api';
import BroadcastDialog from '../../../components/BroadcastDialog';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface WorkforceTabProps {
  tenantId: string;
}

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

const WorkforceTab: React.FC<WorkforceTabProps> = ({ tenantId }) => {
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
  const navigate = useNavigate();
  const autocompleteRef = useRef<any>(null);

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

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';
    setForm((prev) => ({
      ...prev,
      street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      
      await addDoc(collection(db, 'users'), {
        ...form,
        role: 'Worker',
        tenantId,
        homeLat: geo.lat,
        homeLng: geo.lng,
        createdAt: serverTimestamp(),
      });
      setForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        dob: '',
        street: '',
        city: '',
        state: '',
        zip: '',
        departmentId: '',
        locationIds: [],
        jobTitle: '',
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

  return (
    <Box sx={{ p: 2 }}>
      {!showForm && (
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
        <>
          <Typography variant="h6" gutterBottom>
            Add New Worker
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="First Name"
                  fullWidth
                  required
                  value={form.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Last Name"
                  fullWidth
                  required
                  value={form.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <MUIAutocomplete
                  options={jobTitles}
                  value={form.jobTitle}
                  onChange={(_, newValue) => handleChange('jobTitle', newValue || '')}
                  renderInput={(params) => <TextField {...params} label="Job Title" fullWidth />}
                  freeSolo
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Phone"
                  fullWidth
                  required
                  value={form.phone}
                  onChange={handlePhoneChange}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Email"
                  fullWidth
                  required
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Date of Birth"
                  type="date"
                  fullWidth
                  required
                  value={form.dob || ''}
                  onChange={(e) => handleChange('dob', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <GoogleMapsAutocomplete
                  onLoad={(ref) => (autocompleteRef.current = ref)}
                  onPlaceChanged={handlePlaceChanged}
                >
                  <TextField
                    label="Home Street Address"
                    fullWidth
                    value={form.street}
                    onChange={(e) => handleChange('street', e.target.value)}
                  />
                </GoogleMapsAutocomplete>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="City"
                  fullWidth
                  value={form.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={1.5}>
                <TextField
                  label="State"
                  fullWidth
                  value={form.state}
                  onChange={(e) => handleChange('state', e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={1.5}>
                <TextField
                  label="Zip"
                  fullWidth
                  value={form.zip}
                  onChange={(e) => handleChange('zip', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                {departments.length === 0 ? (
                  <TextField
                    label="Department"
                    fullWidth
                    disabled
                    value="No departments available"
                  />
                ) : (
                  <MUIAutocomplete
                    options={departments}
                    getOptionLabel={(dept) => dept.name}
                    value={departments.find((d) => d.id === form.departmentId) || null}
                    onChange={(_, newValue) =>
                      handleChange('departmentId', newValue ? newValue.id : '')
                    }
                    renderInput={(params) => <TextField {...params} label="Department" fullWidth />}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    clearOnEscape
                  />
                )}
              </Grid>
              <Grid item xs={12} sm={4}>
                {locationsLoading ? (
                  <TextField label="Cost Center" fullWidth disabled value="Loading locations..." />
                ) : locations.length === 0 ? (
                  <TextField
                    label="Cost Center"
                    fullWidth
                    disabled
                    value="No locations available"
                  />
                ) : (
                  <MUIAutocomplete
                    multiple
                    options={locations}
                    getOptionLabel={(loc) => loc.nickname}
                    value={locations.filter((l) => form.locationIds.includes(l.id))}
                    onChange={(_, newValue) =>
                      handleChange(
                        'locationIds',
                        newValue.map((l: any) => l.id),
                      )
                    }
                    renderInput={(params) => (
                      <TextField {...params} label="Cost Center" fullWidth />
                    )}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    clearOnEscape
                  />
                )}
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel id="user-groups-label">User Groups</InputLabel>
                  <Select
                    labelId="user-groups-label"
                    multiple
                    value={selectedUserGroups}
                    onChange={(e) =>
                      setSelectedUserGroups(
                        Array.isArray(e.target.value) ? e.target.value : [e.target.value],
                      )
                    }
                    input={<OutlinedInput label="User Groups" />}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {(selected as string[]).map((id) => {
                          const group = userGroups.find((g: any) => g.id === id);
                          return (
                            <Chip
                              key={id}
                              label={group ? group.title : id}
                              onMouseDown={(e) => e.stopPropagation()}
                              onDelete={() =>
                                setSelectedUserGroups(
                                  selectedUserGroups.filter((gid: string) => gid !== id),
                                )
                              }
                            />
                          );
                        })}
                      </Box>
                    )}
                  >
                    {userGroups.map((g: any) => (
                      <MenuItem key={g.id} value={g.id}>
                        {g.title}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={
                    loading ||
                    !(
                      form.firstName &&
                      form.lastName &&
                      form.email &&
                      form.phone &&
                      form.locationIds.length > 0
                    )
                  }
                >
                  {loading ? 'Adding...' : 'Add Worker'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Workers</Typography>
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

      {locationsLoading ? (
        <Typography>Loading locations...</Typography>
      ) : locations.length === 0 ? (
        <Typography color="warning.main">
          No locations available. Please add a location first.
        </Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedWorkers.length === contacts.length && contacts.length > 0}
                    indeterminate={
                      selectedWorkers.length > 0 && selectedWorkers.length < contacts.length
                    }
                    onChange={handleSelectAll}
                  />
                </TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Job Title</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedWorkers.includes(contact.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleWorkerSelection(contact.id);
                      }}
                    />
                  </TableCell>
                  <TableCell
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/users/${contact.id}`)}
                  >
                    {contact.firstName} {contact.lastName}
                  </TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>{contact.phone || '-'}</TableCell>
                  <TableCell>{contact.jobTitle || '-'}</TableCell>
                  <TableCell>
                    {locations
                      .filter((loc: any) => (contact.locationIds || []).includes(loc.id))
                      .map((loc: any) => loc.nickname)
                      .join(', ') || '-'}
                  </TableCell>
                  <TableCell>
                    {departments.find((dept: any) => dept.id === contact.departmentId)?.name || '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/users/${contact.id}`);
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
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

export default WorkforceTab;
