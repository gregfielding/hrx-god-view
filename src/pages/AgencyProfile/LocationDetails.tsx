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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
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

interface LocationDetailsProps {
  tenantId: string;
  locationId: string;
  onBack?: () => void;
}

const LocationDetails: React.FC<LocationDetailsProps> = ({ tenantId, locationId, onBack }) => {
  const [form, setForm] = useState({
    nickname: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchLocation();
    // eslint-disable-next-line
  }, [tenantId, locationId]);

  useEffect(() => {
    if (locationId) {
      fetchContactsForLocation();
    }
    // eslint-disable-next-line
  }, [locationId, tenantId]);

  const fetchLocation = async () => {
    if (!tenantId || !locationId) return;
    const locRef = doc(db, 'tenants', tenantId, 'locations', locationId);
    const snap = await getDoc(locRef);
    if (snap.exists()) {
      const data = snap.data();
      setForm({
        nickname: data.nickname || '',
        street: data.street || '',
        city: data.city || '',
        state: data.state || '',
        zip: data.zip || '',
        phone: data.phone || '',
      });
    }
  };

  const fetchContactsForLocation = async () => {
    if (!tenantId || !locationId) return;
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'Tenant'),
      where('tenantId', '==', tenantId),
      where('locationId', '==', locationId),
    );
    const snapshot = await getDocs(q);
    setContacts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const handleSave = async () => {
    if (!tenantId || !locationId) return;
    setLoading(true);
    setError('');
    try {
      const locRef = doc(db, 'tenants', tenantId, 'locations', locationId);
      await updateDoc(locRef, form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update location');
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!tenantId || !locationId) return;
    setLoading(true);
    setError('');
    try {
      const locRef = doc(db, 'tenants', tenantId, 'locations', locationId);
      await deleteDoc(locRef);
      if (onBack) {
        onBack();
      } else {
        navigate(`/tenants/${tenantId}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete location');
    }
    setLoading(false);
    setDeleteDialog(false);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h5" gutterBottom>
          Location Details
        </Typography>
        <Button
          variant="outlined"
          onClick={onBack ? onBack : () => navigate(`/tenants/${tenantId}`)}
        >
          &larr; Back to Locations
        </Button>
      </Box>
      <Grid container spacing={2} mb={2}>
        <Grid item xs={12} sm={4}>
          <TextField
            label="Nickname"
            fullWidth
            required
            value={form.nickname}
            onChange={(e) => handleChange('nickname', e.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField
            label="Street Address"
            fullWidth
            required
            value={form.street}
            onChange={(e) => handleChange('street', e.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="City"
            fullWidth
            required
            value={form.city}
            onChange={(e) => handleChange('city', e.target.value)}
          />
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField
            label="State"
            fullWidth
            required
            value={form.state}
            onChange={(e) => handleChange('state', e.target.value)}
          />
        </Grid>
        <Grid item xs={6} sm={2}>
          <TextField
            label="Zip"
            fullWidth
            required
            value={form.zip}
            onChange={(e) => handleChange('zip', e.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="Phone (optional)"
            fullWidth
            value={form.phone}
            onChange={handlePhoneChange}
          />
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
            Delete Location
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
          Location updated!
        </Alert>
      </Snackbar>
      <Dialog open={deleteDialog} onClose={() => setDeleteDialog(false)}>
        <DialogTitle>Delete Location</DialogTitle>
        <DialogContent>
          Are you sure you want to delete this location? This action cannot be undone.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <Typography variant="h6" mt={4} mb={2}>
        Contacts
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Security Level</TableCell>
              <TableCell>View</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No contacts yet.</TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
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
                  <TableCell>{contact.phone || '-'}</TableCell>
                  <TableCell>{contact.securityLevel || '-'}</TableCell>
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
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default LocationDetails;
