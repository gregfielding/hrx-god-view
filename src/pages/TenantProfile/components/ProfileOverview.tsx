import React, { useEffect, useState } from 'react';
import { Box, TextField, Typography, Button, Snackbar, Alert, Grid } from '@mui/material';
import { db } from '../../../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { formatPhoneNumber } from '../../../utils/formatPhone';

type Props = {
  tenantId: string;
};

const TenantOverview: React.FC<Props> = ({ tenantId }) => {
  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  });

  const [originalForm, setOriginalForm] = useState(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!tenantId) return;

    const tenantRef = doc(db, 'tenants', tenantId);
    const unsubscribe = onSnapshot(
      tenantRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as typeof form;
          setForm(data);
          setOriginalForm(data);
        }
      },
      (error) => {
        console.error('Error fetching tenant data in real-time:', error);
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setForm((prev) => ({ ...prev, phone: formatPhoneNumber(value) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      await updateDoc(tenantRef, form);
      setMessage('Tenant profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error updating tenant data:', error);
      setMessage('Failed to update tenant profile');
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
              name="companyName"
              label="Company Name"
              value={form.companyName}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="contactName"
              label="Primary Contact"
              value={form.contactName}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="email"
              label="Email"
              value={form.email}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="phone"
              label="Phone"
              value={form.phone}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="address"
              label="Address"
              value={form.address}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              name="notes"
              label="Notes"
              value={form.notes}
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

export default TenantOverview;
