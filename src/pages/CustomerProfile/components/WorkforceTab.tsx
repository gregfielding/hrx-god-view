import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert, MenuItem, FormControl, InputLabel, Select, OutlinedInput, Chip, Autocomplete } from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import jobTitles from '../../../data/onetJobTitles.json';

interface WorkforceTabProps {
  agencyId?: string;
  customerId?: string;
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

const WorkforceTab: React.FC<WorkforceTabProps> = ({ agencyId, customerId }) => {
  const contextId = agencyId || customerId;
  const isAgency = !!agencyId;
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

  useEffect(() => {
    if (customerId) {
      fetchDepartments();
      fetchLocations().then(fetchContacts);
    }
    // eslint-disable-next-line
  }, [customerId]);

  const fetchContacts = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Worker'),
        where('customerId', '==', customerId)
      );
      const snapshot = await getDocs(q);
      setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch workers');
    }
    setLoading(false);
  };

  const fetchLocations = async () => {
    if (!contextId) return;
    setLocationsLoading(true);
    try {
      const path = isAgency
        ? ['agencies', contextId, 'locations']
        : ['customers', contextId, 'locations'];
      const q = query(collection(db, ...(path as [string, ...string[]])));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
    setLocationsLoading(false);
  };

  const fetchDepartments = async () => {
    if (!customerId) return;
    try {
      const q = collection(db, 'customers', customerId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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

  const isFormValid = form.firstName && form.lastName && form.email && form.locationIds.length > 0 && form.departmentId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return;
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'users'), {
        ...form,
        role: 'Worker',
        securityLevel: 'Worker',
        customerId,
        locationIds: form.locationIds,
        departmentId: form.departmentId,
        createdAt: serverTimestamp(),
      });
      setForm({ firstName: '', lastName: '', jobTitle: '', phone: '', email: '', locationIds: [], departmentId: '' });
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
                <TextField label="Phone" fullWidth value={form.phone} onChange={handlePhoneChange} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Email" fullWidth required value={form.email} onChange={e => handleChange('email', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4}>
                {departments.length === 0 ? (
                  <TextField label="Department" fullWidth disabled value="No departments available" />
                ) : (
                  <FormControl fullWidth required>
                    <InputLabel id="department-label">Department</InputLabel>
                    <Select
                      labelId="department-label"
                      value={form.departmentId || ''}
                      onChange={e => handleChange('departmentId', e.target.value)}
                      input={<OutlinedInput label="Department" />}
                      required
                    >
                      {departments.map((dept: any) => (
                        <MenuItem key={dept.id} value={dept.id}>{dept.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} sm={4}>
                {locationsLoading ? (
                  <TextField label="Location" fullWidth disabled value="Loading locations..." />
                ) : locations.length === 0 ? (
                  <TextField label="Location" fullWidth disabled value="No locations available" />
                ) : (
                  <FormControl fullWidth required>
                    <InputLabel id="location-label">Location</InputLabel>
                    <Select
                      labelId="location-label"
                      multiple
                      value={form.locationIds}
                      onChange={e => {
                        const value = e.target.value;
                        handleChange('locationIds', Array.isArray(value) ? value : [value]);
                      }}
                      input={<OutlinedInput label="Location" />}
                      renderValue={(selected) => (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(selected as string[]).map((id) => {
                            const loc = locations.find((l: any) => l.id === id);
                            return (
                              <Chip
                                key={id}
                                label={loc ? loc.nickname : id}
                                onMouseDown={e => e.stopPropagation()}
                                onDelete={() => {
                                  const ids = Array.isArray(form.locationIds) ? form.locationIds : [form.locationIds];
                                  handleChange('locationIds', ids.filter((lid: string) => lid !== id));
                                }}
                              />
                            );
                          })}
                        </Box>
                      )}
                    >
                      {locations.map((loc: any) => (
                        <MenuItem key={loc.id} value={loc.id}>{loc.nickname}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading || !isFormValid}>
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