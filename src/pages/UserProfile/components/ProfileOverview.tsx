import React, { useEffect, useState } from 'react';
import { Box, TextField, Typography, Button, Snackbar, Alert, Grid } from '@mui/material';
import { db } from '../../../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { formatPhoneNumber } from '../../../utils/formatPhone'; // <- Ensure this exists

type Props = {
  uid: string;
};

const ProfileOverview: React.FC<Props> = ({ uid }) => {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'worker',
    securityLevel: '',
  });

  const [originalForm, setOriginalForm] = useState(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!uid) return;

    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setForm({
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            email: data.email || '',
            phone: data.phone || '',
            role: data.role || 'worker',
            securityLevel: data.securityLevel || '',
          });
          setOriginalForm({
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            email: data.email || '',
            phone: data.phone || '',
            role: data.role || 'worker',
            securityLevel: data.securityLevel || '',
          });
        }
      },
      (error) => {
        console.error('Error fetching user data:', error);
      },
    );

    return () => unsubscribe();
  }, [uid]);

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
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, form);
      setMessage('Profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error updating user data:', error);
      setMessage('Failed to update profile');
      setShowToast(true);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" mb={2}>
        Contact Information
      </Typography>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="firstName"
              label="First Name"
              value={form.firstName}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="lastName"
              label="Last Name"
              value={form.lastName}
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
          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              name="role"
              label="Role"
              value={form.role}
              onChange={handleChange}
              SelectProps={{ native: true }}
            >
              <option value="Applicant">Applicant</option>
              <option value="Employee">Employee</option>
              <option value="Contractor">Contractor</option>
              <option value="Tenant">Tenant</option>
              <option value="Client">Client</option>
              <option value="HRX">HRX</option>
              <option value="Dismissed">Dismissed</option>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              name="securityLevel"
              label="Security Level"
              value={form.securityLevel}
              onChange={handleChange}
              SelectProps={{ native: true }}
            >
              <option value="">Select Security Level</option>
              <option value="Admin">Admin</option>
              <option value="Worker">Worker</option>
              <option value="Manager">Manager</option>
              <option value="Staffer">Staffer</option>
            </TextField>
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

export default ProfileOverview;
