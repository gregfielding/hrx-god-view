import React, { useEffect, useState } from 'react';
import { Box, TextField, Typography, Button, Snackbar, Alert, Grid } from '@mui/material';
import { db } from '../../../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

type Props = {
  customerId: string;
};

const CustomerOverview: React.FC<Props> = ({ customerId }) => {
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  });
  const [originalForm, setOriginalForm] = useState(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    const customerRef = doc(db, 'customers', customerId);
    const unsubscribe = onSnapshot(
      customerRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setForm({
            name: data.name || '',
            street: data.address?.street || '',
            city: data.address?.city || '',
            state: data.address?.state || '',
            zip: data.address?.zip || '',
          });
          setOriginalForm({
            name: data.name || '',
            street: data.address?.street || '',
            city: data.address?.city || '',
            state: data.address?.state || '',
            zip: data.address?.zip || '',
          });
        }
      },
      (error) => {
        console.error('Error fetching customer data in real-time:', error);
      },
    );
    return () => unsubscribe();
  }, [customerId]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const customerRef = doc(db, 'customers', customerId);
      await updateDoc(customerRef, {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
      });
      setMessage('Customer profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error updating customer data:', error);
      setMessage('Failed to update customer profile');
      setShowToast(true);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" mb={2}>
        Account Overview
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="name"
              label="Customer Name"
              value={form.name}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="street"
              label="Street Address"
              value={form.street}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="city"
              label="City"
              value={form.city}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth
              name="state"
              label="State"
              value={form.state}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth
              name="zip"
              label="Zip"
              value={form.zip}
              onChange={handleChange}
            />
          </Grid>
          {hasChanges && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Box>
      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert onClose={() => setShowToast(false)} severity="success" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CustomerOverview;
