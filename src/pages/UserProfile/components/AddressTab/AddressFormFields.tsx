import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Grid, TextField, Button, Snackbar, Alert, Typography } from '@mui/material';
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
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const autocompleteRef = useRef<any>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout>();

  // Check if Google Maps is loaded with retry logic
  const checkGoogleMapsLoaded = useCallback(() => {
    const isLoaded = !!(window as any).google?.maps?.places;
    if (isLoaded) {
      setIsGoogleMapsLoaded(true);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }
    } else {
      // Retry after 100ms if not loaded
      retryTimeoutRef.current = setTimeout(checkGoogleMapsLoaded, 100);
    }
  }, []);

  useEffect(() => {
    setForm(formData);
    setOriginalForm(formData);
    checkGoogleMapsLoaded();
    
    // Cleanup timeout on unmount
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [formData, checkGoogleMapsLoaded]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev: typeof form) => ({ ...prev, [name]: value }));
  };

  const handlePlaceChanged = useCallback(() => {
    if (!autocompleteRef.current?.getPlace) return;
    
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.address_components) return;
    
    const components = place.address_components;
    const getComponent = (types: string[]) => {
      const component = components.find((c: any) => 
        types.every((t) => c.types?.includes(t))
      );
      return component?.long_name || '';
    };

    // Update only address fields to prevent clearing other form data
    const newAddressData = {
      streetAddress: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']) || getComponent(['sublocality']) || getComponent(['postal_town']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
      homeLat: place.geometry?.location?.lat?.(),
      homeLng: place.geometry?.location?.lng?.(),
    };

    // Only update fields that have values from the place
    const updatedData = { ...form };
    Object.entries(newAddressData).forEach(([key, val]) => {
      if (val !== undefined && val !== '') {
        updatedData[key] = val;
      }
    });

    setForm(updatedData);
  }, [form]);

  const handleAutocompleteLoad = useCallback((autocomplete: any) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const handleSave = async () => {
    await onFormChange(form);
    setMessage('Address updated successfully');
    setShowToast(true);
    setOriginalForm(form);
  };

  return (
    <Box>
      {isGoogleMapsLoaded ? (
        <Autocomplete 
          onLoad={handleAutocompleteLoad} 
          onPlaceChanged={handlePlaceChanged}
          options={{
            componentRestrictions: { country: 'us' },
            fields: ['address_components', 'formatted_address', 'geometry'],
          }}
        >
          <TextField
            label="Street Address"
            value={form.streetAddress || ''}
            onChange={handleManualChange}
            name="streetAddress"
            fullWidth
            sx={{ mb: 2 }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            inputProps={{
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'off',
              spellCheck: 'false',
            }}
          />
        </Autocomplete>
      ) : (
        <TextField
          label="Street Address"
          value={form.streetAddress || ''}
          onChange={handleManualChange}
          name="streetAddress"
          fullWidth
          sx={{ mb: 2 }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          inputProps={{
            autoComplete: 'off',
            autoCorrect: 'off',
            autoCapitalize: 'off',
            spellCheck: 'false',
          }}
        />
      )}
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
