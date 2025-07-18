import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Grid,
  TextField,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Snackbar,
  Alert,
} from '@mui/material';
import { db } from '../../firebase';
import { collection, getDocs, doc, getDoc, updateDoc, serverTimestamp, query, where } from 'firebase/firestore';

interface AgencyContactsTabProps {
  tenantId: string;
}

// Placeholder for job titles (replace with import from JSON in real code)
const jobTitles = [
  'Registered Nurse',
  'CNA',
  'LPN',
  'Housekeeper',
  'Cook',
  'Dietary Aide',
  'Receptionist',
  'Other',
];

const AgencyContactsTab: React.FC<AgencyContactsTabProps> = ({ tenantId, ...props }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    locationId: '',
    role: '',
    notes: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Fetch locations for this customer
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const q = collection(db, 'tenants', tenantId, 'locations');
        const snapshot = await getDocs(q);
        setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (err: any) {
        setError('Failed to fetch locations');
      }
    };
    if (tenantId) fetchLocations();
  }, [tenantId]);

  // Fetch agencyContacts for this agency from the customer doc
  const fetchContacts = async () => {
    if (!tenantId || !tenantId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Tenant'),
        where('tenantId', '==', tenantId),
        where('tenantId', '==', tenantId),
      );
      const snapshot = await getDocs(q);
      setContacts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError('Failed to fetch contacts');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchContacts();
    // eslint-disable-next-line
  }, [tenantId]);

  const handleFormChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      const customerSnap = await getDoc(customerRef);
      let allContacts = [];
      if (customerSnap.exists()) {
        allContacts = customerSnap.data().agencyContacts || [];
      }
      const newContact = {
        ...form,
        tenantId: tenantId, // Assuming tenantId is tenantId for now
        id: `${tenantId}_${Date.now()}`,
        createdAt: serverTimestamp(),
      };
      await updateDoc(customerRef, {
        agencyContacts: [...allContacts, newContact],
      });
      setForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        jobTitle: '',
        locationId: '',
        role: '',
        notes: '',
      });
      setShowForm(false);
      setSuccess(true);
      fetchContacts();
    } catch (err: any) {
      setError('Failed to add contact');
    }
    setLoading(false);
  };

  const handleDeleteContact = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      const customerSnap = await getDoc(customerRef);
      let allContacts = [];
      if (customerSnap.exists()) {
        allContacts = customerSnap.data().agencyContacts || [];
      }
      const updatedContacts = allContacts.filter(
        (c: any) => !(c.tenantId === tenantId && c.id === id),
      );
      await updateDoc(customerRef, {
        agencyContacts: updatedContacts,
      });
      setSuccess(true);
      fetchContacts();
    } catch (err: any) {
      setError('Failed to delete contact');
    }
    setLoading(false);
  };

  return (
    <Box>
      {!showForm && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mb: 2 }}
          onClick={() => setShowForm(true)}
        >
          Add New Contact
        </Button>
      )}
      {showForm && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Add New Contact
          </Typography>
          <form onSubmit={handleAddContact}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="First Name"
                  fullWidth
                  required
                  value={form.firstName}
                  onChange={(e) => handleFormChange('firstName', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Last Name"
                  fullWidth
                  required
                  value={form.lastName}
                  onChange={(e) => handleFormChange('lastName', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Role"
                  fullWidth
                  value={form.role}
                  onChange={(e) => handleFormChange('role', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Email"
                  fullWidth
                  value={form.email}
                  onChange={(e) => handleFormChange('email', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Phone"
                  fullWidth
                  value={form.phone}
                  onChange={(e) => handleFormChange('phone', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Job Title"
                  fullWidth
                  value={form.jobTitle}
                  onChange={(e) => handleFormChange('jobTitle', e.target.value)}
                >
                  {jobTitles.map((title) => (
                    <MenuItem key={title} value={title}>
                      {title}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Location"
                  fullWidth
                  value={form.locationId}
                  onChange={(e) => handleFormChange('locationId', e.target.value)}
                >
                  {locations.map((loc: any) => (
                    <MenuItem key={loc.id} value={loc.id}>
                      {loc.nickname} ({loc.city})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField
                  label="Notes"
                  fullWidth
                  multiline
                  minRows={2}
                  value={form.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  Add Contact
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </Paper>
      )}
      <Typography variant="h6" gutterBottom>
        Contacts
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Job Title</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell>Edit</TableCell>
              <TableCell>Delete</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  {contact.firstName} {contact.lastName}
                </TableCell>
                <TableCell>{contact.role}</TableCell>
                <TableCell>{contact.email}</TableCell>
                <TableCell>{contact.phone}</TableCell>
                <TableCell>{contact.jobTitle}</TableCell>
                <TableCell>
                  {locations.find((l) => l.id === contact.locationId)?.nickname || '-'}
                </TableCell>
                <TableCell>{contact.notes}</TableCell>
                <TableCell>
                  <Button size="small" variant="outlined" disabled>
                    Edit
                  </Button>
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => handleDeleteContact(contact.id)}
                    disabled={loading}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Contact updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AgencyContactsTab;
