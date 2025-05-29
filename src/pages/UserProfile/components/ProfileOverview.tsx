import React, { useEffect, useState } from 'react';
import { Box, TextField, Typography, Button, Snackbar, Alert, Grid } from '@mui/material';
import { db } from '../../../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

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
    // Add future summary fields like tenant, lastLogin, etc.
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
          const data = snapshot.data() as typeof form;
          setForm(data);
          setOriginalForm(data);
        }
      },
      (error) => {
        console.error('Error fetching user data in real-time:', error);
      },
    );

    return () => unsubscribe();
  }, [uid]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
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
      {/* High-Level User Summary */}
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
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              Role: {form.role}
            </Typography>
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
