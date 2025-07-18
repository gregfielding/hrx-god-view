import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Snackbar, Alert, MenuItem } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const roles = ['Agency', 'HRX', 'Employee', 'Contractor', 'Applicant', 'Customer', 'Dismissed'];
const securityLevels = ['7', '6', '5', '4', '3', '2', '1', '0'];

const AddUserForm = () => {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: '',
    securityLevel: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const docRef = await addDoc(collection(db, 'users'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setSuccess(true);
      setTimeout(() => {
        navigate(`/users/${docRef.id}`);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to add user');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="outlined" onClick={() => navigate('/users')}>
          &larr; Back
        </Button>
      </Box>
      <Typography variant="h5" gutterBottom>
        Add New User
      </Typography>
      <form onSubmit={handleSubmit}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="First Name"
              fullWidth
              required
              value={form.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Last Name"
              fullWidth
              required
              value={form.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Email"
              fullWidth
              required
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Phone"
              fullWidth
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              label="Role"
              fullWidth
              required
              value={form.role}
              onChange={(e) => handleChange('role', e.target.value)}
            >
              {roles.map((role) => (
                <MenuItem key={role} value={role}>
                  {role}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              label="Security Level"
              fullWidth
              required
              value={form.securityLevel}
              onChange={(e) => handleChange('securityLevel', e.target.value)}
            >
              {securityLevels.map((level) => (
                <MenuItem key={level} value={level}>
                  {level}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <Button type="submit" variant="contained" color="primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add User'}
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
          User added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddUserForm;
