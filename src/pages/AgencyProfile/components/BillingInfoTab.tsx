import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Snackbar, Alert } from '@mui/material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

import { db } from '../../../firebase';

const BillingInfoTab = ({ tenantId }: { tenantId: string }) => {
  const [form, setForm] = useState({
    legalName: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchBilling = async () => {
      if (!tenantId) return;
      const agencyRef = doc(db, 'tenants', tenantId);
      const snap = await getDoc(agencyRef);
      if (snap.exists()) {
        const data = snap.data();
        setForm({
          legalName: data.billing?.legalName || '',
          street: data.billing?.street || '',
          city: data.billing?.city || '',
          state: data.billing?.state || '',
          zip: data.billing?.zip || '',
          notes: data.billing?.notes || '',
        });
      }
    };
    fetchBilling();
  }, [tenantId]);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const agencyRef = doc(db, 'tenants', tenantId);
      await updateDoc(agencyRef, { billing: form });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update billing info');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Billing Info
      </Typography>
      <form onSubmit={handleSubmit}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Company Legal Name"
              fullWidth
              required
              value={form.legalName}
              onChange={(e) => handleChange('legalName', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Street Address"
              fullWidth
              value={form.street}
              onChange={(e) => handleChange('street', e.target.value)}
            />
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
            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={2}
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Button type="submit" variant="contained" color="primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Billing Info'}
            </Button>
          </Grid>
        </Grid>
      </form>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Billing info updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BillingInfoTab;
