import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  MenuItem,
  Grid,
  InputLabel,
  IconButton,
} from '@mui/material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../firebase';
import DeleteIcon from '@mui/icons-material/Delete';

const vaccineTypes = ['COVID-19', 'Flu', 'Hepatitis', 'MMR', 'Tdap', 'Varicella', 'Other'];
const statusOptions = ['Up to date', 'Not up to date', 'Declined'];

const emptyEntry = {
  type: '',
  status: '',
  date: '',
  file: null,
  notes: '',
};

const VaccinationStatusTab = ({ uid }: { uid: string }) => {
  const [vaccinations, setVaccinations] = useState<any[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) return;
    const fetch = async () => {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        setVaccinations(data.vaccinations || []);
        setFileNames((data.vaccinations || []).map((v: any) => v.fileName || ''));
      }
    };
    fetch();
  }, [uid]);

  const handleFieldChange = (idx: number, field: string, value: any) => {
    const updated = vaccinations.map((entry, i) =>
      i === idx ? { ...entry, [field]: value } : entry,
    );
    setVaccinations(updated);
  };

  const handleFileChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files[0]) return;
    const updated = vaccinations.map((entry, i) =>
      i === idx ? { ...entry, file: files[0], fileName: files[0].name } : entry,
    );
    setVaccinations(updated);
    setFileNames(updated.map((v) => v.fileName || ''));
  };

  const handleAdd = () => {
    setVaccinations([...vaccinations, { ...emptyEntry }]);
    setFileNames([...fileNames, '']);
  };

  const handleDelete = (idx: number) => {
    const updated = vaccinations.filter((_, i) => i !== idx);
    setVaccinations(updated);
    setFileNames(updated.map((v) => v.fileName || ''));
  };

  const handleSave = async () => {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { vaccinations });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Vaccination Status
      </Typography>
      {vaccinations.map((entry, idx) => (
        <Grid
          container
          spacing={2}
          key={idx}
          sx={{ mb: 2, border: '1px solid #333', borderRadius: 2, p: 2 }}
        >
          <Grid item xs={12} sm={4}>
            <TextField
              select
              label="Vaccine Type"
              fullWidth
              value={entry.type}
              onChange={(e) => handleFieldChange(idx, 'type', e.target.value)}
            >
              {vaccineTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              select
              label="Status"
              fullWidth
              value={entry.status}
              onChange={(e) => handleFieldChange(idx, 'status', e.target.value)}
            >
              {statusOptions.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Date of Last Dose"
              type="date"
              fullWidth
              value={entry.date}
              onChange={(e) => handleFieldChange(idx, 'date', e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <InputLabel>Upload Proof</InputLabel>
            <Button variant="contained" component="label">
              Upload
              <input type="file" hidden onChange={(e) => handleFileChange(idx, e)} />
            </Button>
            {fileNames[idx] && <Typography variant="body2">{fileNames[idx]}</Typography>}
          </Grid>
          <Grid item xs={12} sm={5}>
            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={2}
              value={entry.notes}
              onChange={(e) => handleFieldChange(idx, 'notes', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={1} display="flex" alignItems="center">
            <IconButton onClick={() => handleDelete(idx)}>
              <DeleteIcon />
            </IconButton>
          </Grid>
        </Grid>
      ))}
      <Button variant="outlined" onClick={handleAdd}>
        Add Vaccination
      </Button>
      <Button variant="contained" color="primary" sx={{ ml: 2 }} onClick={handleSave}>
        Save Vaccinations
      </Button>
    </Box>
  );
};

export default VaccinationStatusTab;
