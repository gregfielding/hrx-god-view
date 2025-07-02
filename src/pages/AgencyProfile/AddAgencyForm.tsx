import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Snackbar, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { geocodeAddress } from '../../utils/geocodeAddress';

function formatPhoneNumber(value: string) {
  // Remove all non-digit characters
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

const AddAgencyForm = () => {
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    handleChange('phone', formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      const docRef = await addDoc(collection(db, 'agencies'), {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
          lat: geo.lat,
          lng: geo.lng,
        },
        agencyLat: geo.lat,
        agencyLng: geo.lng,
        createdAt: serverTimestamp(),
      });
      setSuccess(true);
      setTimeout(() => {
        navigate(`/agencies/${docRef.id}`);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to add agency');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="outlined" onClick={() => navigate('/agencies')}>
          &larr; Back
        </Button>
      </Box>
      <Typography variant="h5" gutterBottom>Add New Agency</Typography>
      <form onSubmit={handleSubmit}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField label="Agency Name" fullWidth required value={form.name} onChange={e => handleChange('name', e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Street Address" fullWidth value={form.street} onChange={e => handleChange('street', e.target.value)} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="City" fullWidth value={form.city} onChange={e => handleChange('city', e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="State" fullWidth value={form.state} onChange={e => handleChange('state', e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="Zip" fullWidth value={form.zip} onChange={e => handleChange('zip', e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <Button type="submit" variant="contained" color="primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Agency'}
            </Button>
          </Grid>
        </Grid>
      </form>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000}>
        <Alert severity="success" sx={{ width: '100%' }}>Agency added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default AddAgencyForm; 