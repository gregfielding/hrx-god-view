import React, { useState, useEffect, useRef } from 'react';
import { Box, Grid, TextField, Button, Snackbar, Alert } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';


type Props = {
  uid: string;
  formData: any; // Live Firestore data passed from AddressTab
  onFormChange: (updatedAddressInfo: any) => Promise<void>;
};

const AddressFormFields: React.FC<Props> = ({ uid, formData, onFormChange }) => {
  const [form, setForm] = useState(formData);
  const [originalForm, setOriginalForm] = useState(formData);
  const [showToast, setShowToast] = useState(false);
  const [message, setMessage] = useState('');
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    setForm(formData);
    setOriginalForm(formData);
  }, [formData]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev: typeof form) => ({ ...prev, [name]: value }));
  };

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';

    setForm((prev: typeof form) => ({
      ...prev,
      streetAddress: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
      homeLat: place.geometry.location.lat(),
      homeLng: place.geometry.location.lng(),
    }));
  };

  const handleSave = async () => {
    await onFormChange(form);
    setMessage('Address updated successfully');
    setShowToast(true);
    setOriginalForm(form);
  };

  return (
    <Box>
      <Autocomplete
        onLoad={(ref) => (autocompleteRef.current = ref)}
        onPlaceChanged={handlePlaceChanged}
      >
        <TextField
          label="Street Address"
          value={form.streetAddress || ''}
          onChange={handleManualChange}
          name="streetAddress"
          fullWidth
          sx={{ mb: 2 }}
        />
      </Autocomplete>
      <TextField
        label="Unit Number"
        value={form.unitNumber || ''}
        onChange={handleManualChange}
        name="unitNumber"
        fullWidth
        sx={{ mb: 2 }}
      />
      <Grid container spacing={2}>
        <Grid item xs={4}>
          <TextField
            label="City"
            value={form.city || ''}
            onChange={handleManualChange}
            name="city"
            fullWidth
          />
        </Grid>
        <Grid item xs={4}>
          <TextField
            label="State"
            value={form.state || ''}
            onChange={handleManualChange}
            name="state"
            fullWidth
          />
        </Grid>
        <Grid item xs={4}>
          <TextField
            label="Zip"
            value={form.zip || ''}
            onChange={handleManualChange}
            name="zip"
            fullWidth
          />
        </Grid>
      </Grid>
      {hasChanges && (
        <Button variant="contained" onClick={handleSave} sx={{ mt: 2 }}>
          Save Changes
        </Button>
      )}
      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert onClose={() => setShowToast(false)} severity="success" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddressFormFields;
