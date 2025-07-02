import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert, MenuItem, FormControl, InputLabel, Select, OutlinedInput, Chip, Autocomplete } from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import jobTitles from '../../../data/onetJobTitles.json';
import { geocodeAddress } from '../../../utils/geocodeAddress';

interface WorkforceTabProps {
  agencyId: string;
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

const WorkforceTab: React.FC<WorkforceTabProps> = ({ agencyId }) => {
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
  const navigate = useNavigate();

  useEffect(() => {
    if (agencyId) {
      fetchDepartments();
      fetchLocations().then(fetchContacts);
      fetchUserGroups();
    }
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchContacts = async () => {
    if (!agencyId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Worker'),
        where('agencyId', '==', agencyId)
      );
      const snapshot = await getDocs(q);
      setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch workers');
    }
    setLoading(false);
  };

  const fetchLocations = async () => {
    if (!agencyId) return;
    setLocationsLoading(true);
    try {
      const q = query(collection(db, 'agencies', agencyId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
    setLocationsLoading(false);
  };

  const fetchDepartments = async () => {
    if (!agencyId) return;
    try {
      const q = collection(db, 'agencies', agencyId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchUserGroups = async () => {
    try {
      const q = collection(db, 'agencies', agencyId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const handleChange = (field: string, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const isFormValid = form.firstName && form.lastName && form.email && form.phone && form.locationIds.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agencyId) return;
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      await addDoc(collection(db, 'users'), {
        ...form,
        role: 'Worker',
        securityLevel: 'Worker',
        agencyId,
        locationIds: form.locationIds,
        departmentId: form.departmentId,
        homeLat: geo.lat,
        homeLng: geo.lng,
        userGroupIds: selectedUserGroups,
        createdAt: serverTimestamp(),
      });
      setForm({ firstName: '', lastName: '', jobTitle: '', phone: '', email: '', locationIds: [], departmentId: '', street: '', city: '', state: '', zip: '', dob: '' });
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
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Add New Worker
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Add New Worker</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={3}>
                <TextField label="First Name" fullWidth required value={form.firstName} onChange={e => handleChange('firstName', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="Last Name" fullWidth required value={form.lastName} onChange={e => handleChange('lastName', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Autocomplete
                  options={jobTitles}
                  value={form.jobTitle}
                  onChange={(_, newValue) => handleChange('jobTitle', newValue || '')}
                  renderInput={(params) => (
                    <TextField {...params} label="Job Title" fullWidth />
                  )}
                  freeSolo
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="Phone" fullWidth required value={form.phone} onChange={handlePhoneChange} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Email" fullWidth required value={form.email} onChange={e => handleChange('email', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Date of Birth"
                  type="date"
                  fullWidth
                  required
                  value={form.dob || ''}
                  onChange={e => handleChange('dob', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Home Street Address" fullWidth value={form.street} onChange={e => handleChange('street', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="City" fullWidth value={form.city} onChange={e => handleChange('city', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={1.5}>
                <TextField label="State" fullWidth value={form.state} onChange={e => handleChange('state', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={1.5}>
                <TextField label="Zip" fullWidth value={form.zip} onChange={e => handleChange('zip', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4}>
                {departments.length === 0 ? (
                  <TextField label="Department" fullWidth disabled value="No departments available" />
                ) : (
                  <Autocomplete
                    options={departments}
                    getOptionLabel={dept => dept.name}
                    value={departments.find(d => d.id === form.departmentId) || null}
                    onChange={(_, newValue) => handleChange('departmentId', newValue ? newValue.id : '')}
                    renderInput={params => <TextField {...params} label="Department" fullWidth />}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    clearOnEscape
                  />
                )}
              </Grid>
              <Grid item xs={12} sm={4}>
                {locationsLoading ? (
                  <TextField label="Cost Center" fullWidth disabled value="Loading locations..." />
                ) : locations.length === 0 ? (
                  <TextField label="Cost Center" fullWidth disabled value="No locations available" />
                ) : (
                  <Autocomplete
                    multiple
                    options={locations}
                    getOptionLabel={loc => loc.nickname}
                    value={locations.filter(l => form.locationIds.includes(l.id))}
                    onChange={(_, newValue) => handleChange('locationIds', newValue.map((l: any) => l.id))}
                    renderInput={params => <TextField {...params} label="Cost Center" fullWidth />}
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
                    onChange={e => setSelectedUserGroups(Array.isArray(e.target.value) ? e.target.value : [e.target.value])}
                    input={<OutlinedInput label="User Groups" />}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {(selected as string[]).map((id) => {
                          const group = userGroups.find((g: any) => g.id === id);
                          return (
                            <Chip
                              key={id}
                              label={group ? group.title : id}
                              onMouseDown={e => e.stopPropagation()}
                              onDelete={() => setSelectedUserGroups(selectedUserGroups.filter((gid: string) => gid !== id))}
                            />
                          );
                        })}
                      </Box>
                    )}
                  >
                    {userGroups.map((g: any) => (
                      <MenuItem key={g.id} value={g.id}>{g.title}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading || !(form.firstName && form.lastName && form.email && form.phone && form.locationIds.length > 0)}>
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
      <Typography variant="h6" gutterBottom>Workers</Typography>
      {locationsLoading ? (
        <Typography>Loading locations...</Typography>
      ) : locations.length === 0 ? (
        <Typography color="warning.main">No locations available. Please add a location first.</Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
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
                <TableRow key={contact.id} hover style={{ cursor: 'pointer' }} onClick={() => navigate(`/users/${contact.id}`)}>
                  <TableCell>{contact.firstName} {contact.lastName}</TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>{contact.phone || '-'}</TableCell>
                  <TableCell>{contact.jobTitle || '-'}</TableCell>
                  <TableCell>{locations.filter((loc: any) => (contact.locationIds || []).includes(loc.id)).map((loc: any) => loc.nickname).join(', ') || '-'}</TableCell>
                  <TableCell>{departments.find((dept: any) => dept.id === contact.departmentId)?.name || '-'}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={e => { e.stopPropagation(); navigate(`/users/${contact.id}`); }}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Worker added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default WorkforceTab; 