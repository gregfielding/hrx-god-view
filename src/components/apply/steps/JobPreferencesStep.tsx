import React from 'react';
import { Box, Chip, Grid, MenuItem, TextField, Typography } from '@mui/material';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const shiftOptions = ['Day', 'Swing', 'Night', 'Flexible'];

const JobPreferencesStep: React.FC<Props> = ({ value, onChange }) => {
  const handle = (field: string, v: any) => onChange({ ...value, [field]: v });

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Preferences (availability, shift, pay)</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField
            select
            fullWidth
            label="Preferred shift"
            value={value.shift || ''}
            onChange={(e) => handle('shift', e.target.value)}
          >
            {shiftOptions.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            type="number"
            label="Target hourly pay (USD)"
            value={value.targetPay || ''}
            onChange={(e) => handle('targetPay', Number(e.target.value))}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Availability notes"
            value={value.availabilityNotes || ''}
            onChange={(e) => handle('availabilityNotes', e.target.value)}
            multiline
            minRows={3}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default JobPreferencesStep;


