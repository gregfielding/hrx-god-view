import React, { useEffect, useState } from 'react';
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
  Chip,
  Select,
  OutlinedInput,
  FormControl,
  InputLabel,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../../firebase';

interface ContactsTabProps {
  tenantId?: string;
  showForm?: boolean;
  setShowForm?: (show: boolean) => void;
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

const securityLevels = ['7', '6', '5', '4'];

const ContactsTab: React.FC<ContactsTabProps> = ({ tenantId, showForm: showFormProp, setShowForm: setShowFormProp }) => {
  // Use tenantId directly, remove any duplicate declarations
  const contextId = tenantId || tenantId;
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    jobTitle: '',
    department: '',
    phone: '',
    email: '',
    locationIds: [] as string[] | string,
    securityLevel: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [internalShowForm, setInternalShowForm] = useState(false);
  const showForm = showFormProp !== undefined ? showFormProp : internalShowForm;
  const setShowForm = setShowFormProp !== undefined ? setShowFormProp : setInternalShowForm;

  useEffect(() => {
    if (contextId) {
      fetchLocations().then(fetchContacts);
    }
    // eslint-disable-next-line
  }, [contextId]);

  const fetchContacts = async () => {
    if (!contextId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Agency'),
        where('tenantId', '==', contextId),
      );
      const snapshot = await getDocs(q);
      setContacts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch contacts');
    }
    setLoading(false);
  };

  const fetchLocations = async () => {
    if (!contextId) return;
    setLocationsLoading(true);
    try {
      const path = tenantId
        ? ['tenants', contextId, 'locations']
        : ['tenants', contextId, 'locations'];
      const q = query(collection(db, ...(path as [string, ...string[]])));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
    setLocationsLoading(false);
  };

  const handleChange = (field: string, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contextId) return;
    console.log('Submitting form:', form);
    if (!form.email) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      // Build payload with the required structure
      const payload: any = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        displayName: `${form.firstName} ${form.lastName}`,
        role: 'Tenant',
        securityLevel: form.securityLevel,
        department: form.department,
        locationIds: Array.isArray(form.locationIds) ? form.locationIds : [form.locationIds],
        tenantId: contextId,
      };
      
      // Only add optional fields if they have values
      if (form.jobTitle) payload.jobTitle = form.jobTitle;
      
      console.log('Sending payload:', payload);
      console.log('Payload keys:', Object.keys(payload));
      console.log('Payload values:', Object.values(payload));
      const result = await inviteUser(payload);
      console.log('InviteUser result:', result);
      setForm({
        firstName: '',
        lastName: '',
        jobTitle: '',
        department: '',
        phone: '',
        email: '',
        locationIds: [],
        securityLevel: '',
      });
      setSuccess(true);
      await fetchLocations();
      await fetchContacts();
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    }
    setLoading(false);
  };

  const isFormValid =
    form.firstName &&
    form.lastName &&
    form.email &&
    form.department &&
    form.locationIds.length > 0 &&
    form.securityLevel

  // Add resend/revoke handlers
  const handleResendInvite = async (email: string) => {
    setLoading(true);
    setError('');
    try {
      const functions = getFunctions();
      const resendInvite = httpsCallable(functions, 'resendInviteV2');
      await resendInvite({ email });
      setSuccess(true);
      await fetchContacts();
    } catch (err: any) {
      setError(err.message || 'Failed to resend invite');
    }
    setLoading(false);
  };

  const handleRevokeInvite = async (email: string) => {
    setLoading(true);
    setError('');
    try {
      const functions = getFunctions();
      const revokeInvite = httpsCallable(functions, 'revokeInviteV2');
      await revokeInvite({ email });
      setSuccess(true);
      await fetchContacts();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke invite');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Only show the Add New User button if using internal state */}
      {setShowFormProp === undefined && !showForm && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mb: 2 }}
          onClick={() => setShowForm(true)}
        >
          Add New User
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New User
          </Typography>
          {/* <Button
            variant="outlined"
            color="secondary"
            sx={{ mb: 2 }}
            onClick={async () => {
              const functions = getFunctions();
              const inviteUser = httpsCallable(functions, 'inviteUserV2');
              try {
                const result = await inviteUser({ email: 'test@example.com' });
                console.log('Test inviteUser result:', result);
              } catch (err) {
                console.error('Test inviteUser error:', err);
              }
            }}
          >
            Test Minimal InviteUser
          </Button> */}
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
                <TextField
                  label="Job Title"
                  fullWidth
                  value={form.jobTitle}
                  onChange={(e) => handleChange('jobTitle', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Department"
                  fullWidth
                  required
                  value={form.department}
                  onChange={(e) => handleChange('department', e.target.value)}
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
                      onChange={(e) => {
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
                                onMouseDown={(e) => e.stopPropagation()}
                                onDelete={() => {
                                  const ids = Array.isArray(form.locationIds)
                                    ? form.locationIds
                                    : [form.locationIds];
                                  handleChange(
                                    'locationIds',
                                    ids.filter((lid: string) => lid !== id),
                                  );
                                }}
                              />
                            );
                          })}
                        </Box>
                      )}
                    >
                      {locations.map((loc: any) => (
                        <MenuItem key={loc.id} value={loc.id}>
                          {loc.nickname}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Security Level"
                  fullWidth
                  value={form.securityLevel}
                  onChange={(e) => handleChange('securityLevel', e.target.value)}
                  required
                >
                  {securityLevels.map((level) => (
                    <MenuItem key={level} value={level}>
                      {level}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={loading || !isFormValid}
                >
                  {loading ? 'Adding...' : 'Add New User'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      <Typography variant="h6" gutterBottom>
        Manage Users
      </Typography>
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
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Job Title</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Security Level</TableCell>
                <TableCell>Invite Status</TableCell>
                <TableCell>View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  hover
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/users/${contact.id}`)}
                >
                  <TableCell>
                    {contact.firstName} {contact.lastName}
                  </TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>{contact.jobTitle || '-'}</TableCell>
                  <TableCell>{contact.department || '-'}</TableCell>
                  <TableCell>{contact.phone || '-'}</TableCell>
                  <TableCell>
                    {locations
                      .filter((loc: any) => (contact.locationIds || []).includes(loc.id))
                      .map((loc: any) => loc.nickname)
                      .join(', ') || '-'}
                  </TableCell>
                  <TableCell>{contact.securityLevel || '-'}</TableCell>
                  <TableCell>
                    {contact.inviteStatus ? contact.inviteStatus.charAt(0).toUpperCase() + contact.inviteStatus.slice(1) : '-'}
                    {contact.inviteStatus === 'pending' && (
                      <Box display="flex" gap={1} mt={1}>
                        <Button size="small" variant="outlined" color="primary" onClick={e => { e.stopPropagation(); handleResendInvite(contact.email); }}>Resend</Button>
                        <Button size="small" variant="outlined" color="secondary" onClick={e => { e.stopPropagation(); handleRevokeInvite(contact.email); }}>Revoke</Button>
                      </Box>
                    )}
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
          Contact added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ContactsTab;
