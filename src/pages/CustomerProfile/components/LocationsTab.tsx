import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert } from '@mui/material';
import { collection, addDoc, getDocs, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import { geocodeAddress } from '../../../utils/geocodeAddress';

interface LocationsTabProps {
  customerId: string;
}

const LocationsTab: React.FC<LocationsTabProps> = ({ customerId }) => {
  const [form, setForm] = useState({
    nickname: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nickname: '', street: '', city: '', state: '', zip: '', phone: '' });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchLocations();
    // eslint-disable-next-line
  }, [customerId]);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'customers', customerId, 'locations');
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch locations');
    }
    setLoading(false);
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      await addDoc(collection(db, 'customers', customerId, 'locations'), {
        ...form,
        customerLat: geo.lat,
        customerLng: geo.lng,
        createdAt: serverTimestamp(),
      });
      setForm({ nickname: '', street: '', city: '', state: '', zip: '', phone: '' });
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to add location');
    }
    setLoading(false);
  };

  const handleEdit = (loc: any) => {
    setEditId(loc.id);
    setEditForm({
      nickname: loc.nickname || '',
      street: loc.street || '',
      city: loc.city || '',
      state: loc.state || '',
      zip: loc.zip || '',
      phone: loc.phone || '',
    });
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSave = async () => {
    if (!editId) return;
    setLoading(true);
    setError('');
    try {
      const locRef = doc(db, 'customers', customerId, 'locations', editId);
      await updateDoc(locRef, editForm);
      setEditId(null);
      setEditForm({ nickname: '', street: '', city: '', state: '', zip: '', phone: '' });
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to update location');
    }
    setLoading(false);
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditForm({ nickname: '', street: '', city: '', state: '', zip: '', phone: '' });
  };

  const handleDelete = async (locId: string) => {
    setLoading(true);
    setError('');
    try {
      const locRef = doc(db, 'customers', customerId, 'locations', locId);
      await deleteDoc(locRef);
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to delete location');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2 }}>
      {!showForm && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Add New Location
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Add New Location</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={4}>
                <TextField label="Nickname" fullWidth required value={form.nickname} onChange={e => handleChange('nickname', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField label="Street Address" fullWidth required value={form.street} onChange={e => handleChange('street', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="City" fullWidth required value={form.city} onChange={e => handleChange('city', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="State" fullWidth required value={form.state} onChange={e => handleChange('state', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="Zip" fullWidth required value={form.zip} onChange={e => handleChange('zip', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Phone (optional)" fullWidth value={form.phone} onChange={e => handleChange('phone', e.target.value)} />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Location'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      <Typography variant="h6" gutterBottom>Locations</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nickname</TableCell>
              <TableCell>Street</TableCell>
              <TableCell>City</TableCell>
              <TableCell>State</TableCell>
              <TableCell>Zip</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Edit</TableCell>
              <TableCell>Delete</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {locations.map((loc) => (
              <TableRow key={loc.id}>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.nickname} onChange={e => handleEditChange('nickname', e.target.value)} size="small" />
                  ) : (
                    loc.nickname
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.street} onChange={e => handleEditChange('street', e.target.value)} size="small" />
                  ) : (
                    loc.street
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.city} onChange={e => handleEditChange('city', e.target.value)} size="small" />
                  ) : (
                    loc.city
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.state} onChange={e => handleEditChange('state', e.target.value)} size="small" />
                  ) : (
                    loc.state
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.zip} onChange={e => handleEditChange('zip', e.target.value)} size="small" />
                  ) : (
                    loc.zip
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <TextField value={editForm.phone} onChange={e => handleEditChange('phone', e.target.value)} size="small" />
                  ) : (
                    loc.phone || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editId === loc.id ? (
                    <Button size="small" variant="contained" onClick={handleEditSave} disabled={loading || !editForm.nickname}>Save</Button>
                  ) : (
                    <IconButton onClick={() => handleEdit(loc)}><EditIcon /></IconButton>
                  )}
                  {editId === loc.id && (
                    <Button size="small" onClick={handleEditCancel} sx={{ ml: 1 }}>Cancel</Button>
                  )}
                </TableCell>
                <TableCell>
                  <IconButton color="error" onClick={() => handleDelete(loc.id)}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Location added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default LocationsTab; 