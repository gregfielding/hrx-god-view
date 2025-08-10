import React, { useState, useRef } from 'react';
import { Box, Typography, TextField, Button, Grid, Snackbar, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Autocomplete } from '@react-google-maps/api';

import { db } from '../../firebase';
import { geocodeAddress } from '../../utils/geocodeAddress';
import IndustrySelector from '../../components/IndustrySelector';

const AddCustomerForm = () => {
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    industry: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const autocompleteRef = useRef<any>(null);

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
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
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      const docRef = await addDoc(collection(db, 'tenants'), {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
        industry: form.industry,
        customerLat: geo.lat,
        customerLng: geo.lng,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'tenants', docRef.id, 'locations'), {
        nickname: 'Default',
        street: form.street,
        city: form.city,
        state: form.state,
        zip: form.zip,
        createdAt: serverTimestamp(),
      });
      setSuccess(true);
      setTimeout(() => {
        navigate(`/tenants/${docRef.id}`);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to add customer');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="outlined" onClick={() => navigate('/tenants')}>
          &larr; Back
        </Button>
      </Box>
      <Typography variant="h5" gutterBottom>
        Add New Customer
      </Typography>
      <form onSubmit={handleSubmit}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Customer Name"
              fullWidth
              required
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              onLoad={(ref) => (autocompleteRef.current = ref)}
              onPlaceChanged={handlePlaceChanged}
            >
              <TextField
                label="Street Address"
                fullWidth
                required
                value={form.street}
                onChange={(e) => handleChange('street', e.target.value)}
              />
            </Autocomplete>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="City"
              fullWidth
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              label="State"
              fullWidth
              value={form.state}
              onChange={(e) => handleChange('state', e.target.value)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              label="Zip"
              fullWidth
              value={form.zip}
              onChange={(e) => handleChange('zip', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <IndustrySelector
              value={form.industry}
              onChange={(industryCode) => handleChange('industry', industryCode)}
              label="Industry"
              required
              variant="autocomplete"
              showCategory={true}
            />
          </Grid>
          <Grid item xs={12}>
            <Button type="submit" variant="contained" color="primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Customer'}
            </Button>
          </Grid>
        </Grid>
      </form>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Customer added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddCustomerForm;
