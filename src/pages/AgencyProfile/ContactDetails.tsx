import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

import { db } from '../../firebase';

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

const securityLevels = ['Admin', 'Manager', 'Staffer', 'Worker'];

interface ContactDetailsProps {
  tenantId: string;
  contactId: string;
  onBack?: () => void;
}

const ContactDetails: React.FC<ContactDetailsProps> = ({ tenantId, contactId, onBack }) => {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    jobTitle: '',
    phone: '',
    email: '',
    location: '',
    securityLevel: '',
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchContact();
    fetchLocations();
    // eslint-disable-next-line
  }, [tenantId, contactId]);

  const fetchContact = async () => {
    if (!contactId) return;
    const contactRef = doc(db, 'users', contactId);
    const snap = await getDoc(contactRef);
    if (snap.exists()) {
      const data = snap.data();
      setForm({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        jobTitle: data.jobTitle || '',
        phone: data.phone || '',
        email: data.email || '',
        location: data.locationId || '',
        securityLevel: data.securityLevel || '',
      });
    }
  };

  const fetchLocations = async () => {
    try {
      const q = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const handleSave = async () => {
    if (!contactId) return;
    setLoading(true);
    setError('');
    try {
      const contactRef = doc(db, 'users', contactId);
      await updateDoc(contactRef, form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update contact');
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!contactId) return;
    setLoading(true);
    setError('');
    try {
      const contactRef = doc(db, 'users', contactId);
      await deleteDoc(contactRef);
      if (onBack) {
        onBack();
      } else {
        navigate(`/tenants/${tenantId}?tab=4`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete contact');
    }
    setLoading(false);
    setDeleteDialog(false);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h5" gutterBottom>
          Contact Details
        </Typography>
        <Button
          variant="outlined"
          onClick={onBack ? onBack : () => navigate(`/tenants/${tenantId}?tab=4`)}
        >
          &larr; Back to Contacts
        </Button>
      </Box>
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
          <TextField label="Phone" fullWidth value={form.phone} onChange={handlePhoneChange} />
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
          <TextField
            select
            label="Location"
            fullWidth
            value={form.location}
            onChange={(e) => handleChange('location', e.target.value)}
            required
          >
            {locations.map((loc: any) => (
              <MenuItem key={loc.id} value={loc.id}>
                {loc.nickname}
              </MenuItem>
            ))}
          </TextField>
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
        <Grid item xs={12}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSave}
            disabled={loading}
            sx={{ mr: 2 }}
          >
            {loading ? 'Saving...' : 'Save'}
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={() => setDeleteDialog(true)}
            disabled={loading}
          >
            Delete Contact
          </Button>
        </Grid>
      </Grid>
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
      <Dialog open={deleteDialog} onClose={() => setDeleteDialog(false)}>
        <DialogTitle>Delete Contact</DialogTitle>
        <DialogContent>
          Are you sure you want to delete this contact? This action cannot be undone.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ContactDetails;
