import React from 'react';
import { Box, Checkbox, FormControlLabel, Grid, MenuItem, TextField, Typography, Card, CardHeader, CardContent } from '@mui/material';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const WorkEligibilityStep: React.FC<Props> = ({ value, onChange }) => {
  const handle = (field: string, v: any) => onChange({ ...value, [field]: v });

  return (
    <Box>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardHeader title={<Typography variant="h6">Work authorization and optional EEO</Typography>} />
        <CardContent>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <FormControlLabel
            control={<Checkbox checked={!!value.workAuthorized} onChange={(e) => handle('workAuthorized', e.target.checked)} aria-label="Authorized to work in the US" />}
            label="I am legally authorized to work in the United States"
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={<Checkbox checked={!!value.requireSponsorship} onChange={(e) => handle('requireSponsorship', e.target.checked)} aria-label="Require employer sponsorship" />}
            label="I now or in the future will require employer sponsorship"
          />
        </Grid>

        {value.workAuthorized !== true && (
          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary">
              To continue, please confirm you are legally authorized to work in the United States.
            </Typography>
          </Grid>
        )}
        {/* Optional EEO self-identification (always visible) */}
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label="Gender (optional)"
            value={value.gender || ''}
            onChange={(e) => handle('gender', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => (selected === '' ? 'Prefer not to say' : selected),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">Prefer not to say</MenuItem>
            <MenuItem value="Male">Male</MenuItem>
            <MenuItem value="Female">Female</MenuItem>
            <MenuItem value="Nonbinary">Nonbinary</MenuItem>
            <MenuItem value="Other">Other</MenuItem>
          </TextField>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label="Veteran status (optional)"
            value={value.veteranStatus || ''}
            onChange={(e) => handle('veteranStatus', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => (selected === '' ? 'Prefer not to say' : selected),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">Prefer not to say</MenuItem>
            <MenuItem value="Not a veteran">Not a veteran</MenuItem>
            <MenuItem value="Protected veteran">Protected veteran</MenuItem>
          </TextField>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label="Disability (optional)"
            value={value.disabilityStatus || ''}
            onChange={(e) => handle('disabilityStatus', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => (selected === '' ? 'Prefer not to say' : selected),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">Prefer not to say</MenuItem>
            <MenuItem value="No disability">No disability</MenuItem>
            <MenuItem value="Has disability">Has disability</MenuItem>
          </TextField>
        </Grid>
      </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default WorkEligibilityStep;


