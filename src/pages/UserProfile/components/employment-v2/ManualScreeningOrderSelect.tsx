/**
 * On-call / manual screening selection. Ordering API not wired yet — selection is recorded in UI only for now.
 */
import React, { useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Snackbar,
  Typography,
} from '@mui/material';
import {
  additionalScreeningOptions,
  backgroundCheckOptions,
  drugScreeningOptions,
  type ScreeningOption,
} from '../../../../data/screeningsOptions';

function optionsWithHeader(
  prefix: string,
  header: string,
  opts: ScreeningOption[]
): React.ReactNode[] {
  return [
    <ListSubheader key={`h-${prefix}`} sx={{ fontWeight: 700, lineHeight: 2 }}>
      {header}
    </ListSubheader>,
    ...opts.map((o) => (
      <MenuItem key={`${prefix}-${o.value}`} value={`${prefix}::${o.value}`} sx={{ whiteSpace: 'normal' }}>
        <Box>
          <Typography variant="body2">{o.label}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {o.description}
          </Typography>
        </Box>
      </MenuItem>
    )),
  ];
}

const ManualScreeningOrderSelect: React.FC = () => {
  const [value, setValue] = useState<string>('');
  const [snack, setSnack] = useState<string | null>(null);

  const onChange = (e: SelectChangeEvent<string>) => {
    const selected = e.target.value;
    setValue('');
    if (!selected) return;
    setSnack('Screening orders will be placed here when the background check API is connected.');
  };

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
        Add a screening
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25, lineHeight: 1.45 }}>
        Use this when there is no assignment package or you need an extra check. Assignment-required screenings stay in
        the rows above. Each order will show its own steps (ordered → worker → vendor status) once the integration is
        live.
      </Typography>
      <FormControl size="small" fullWidth>
        <InputLabel id="manual-screening-type-label">Screening type</InputLabel>
        <Select
          labelId="manual-screening-type-label"
          label="Screening type"
          value={value}
          displayEmpty
          onChange={onChange}
        >
          <MenuItem value="">
            <em>Choose a background check, drug screen, or health screen…</em>
          </MenuItem>
          {optionsWithHeader('bg', 'Background checks', backgroundCheckOptions)}
          {optionsWithHeader('drug', 'Drug screens', drugScreeningOptions)}
          {optionsWithHeader('add', 'Additional screens', additionalScreeningOptions)}
        </Select>
      </FormControl>
      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        message={snack || ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default ManualScreeningOrderSelect;
