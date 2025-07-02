import React, { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, MenuItem, Grid, InputLabel } from '@mui/material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../firebase';

const statusOptions = ['Passed', 'Pending', 'Failed', 'Not Required'];
const typeOptions = ['State', 'Federal', 'Healthcare-specific', 'Other'];

const BackgroundCheckTab = ({ uid }: { uid: string }) => {
  const [form, setForm] = useState<any>({
    status: '',
    type: '',
    date: '',
    expiry: '',
    file: null,
    notes: ''
  });
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (!uid) return;
    const fetch = async () => {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        setForm(data.backgroundCheck || {});
      }
    };
    fetch();
  }, [uid]);

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileName(e.target.files[0].name);
      handleChange('file', e.target.files[0]);
    }
  };

  const handleSave = async () => {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { backgroundCheck: form });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Background Check</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField select label="Status" fullWidth value={form.status} onChange={e => handleChange('status', e.target.value)}>
            {statusOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField select label="Type" fullWidth value={form.type} onChange={e => handleChange('type', e.target.value)}>
            {typeOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField label="Date of Last Check" type="date" fullWidth value={form.date} onChange={e => handleChange('date', e.target.value)} InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField label="Expiry Date" type="date" fullWidth value={form.expiry} onChange={e => handleChange('expiry', e.target.value)} InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <InputLabel>Upload File (PDF, image, etc.)</InputLabel>
          <Button variant="contained" component="label">
            Upload
            <input type="file" hidden onChange={handleFileChange} />
          </Button>
          {fileName && <Typography variant="body2">{fileName}</Typography>}
        </Grid>
        <Grid item xs={12}>
          <TextField label="Notes" fullWidth multiline minRows={2} value={form.notes} onChange={e => handleChange('notes', e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <Button variant="contained" color="primary" onClick={handleSave}>Save Background Check</Button>
        </Grid>
      </Grid>
    </Box>
  );
};

export default BackgroundCheckTab; 