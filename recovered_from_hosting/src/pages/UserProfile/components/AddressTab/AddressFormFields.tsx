import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Grid, TextField, Button, Snackbar, Alert, Typography } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import { geocodeAddress } from '../../../../utils/geocodeAddress';

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

  const geocodeCurrentAddress = async () => {
    const { streetAddress, city, state, zip } = form;
    
    // Check if we have enough address components to geocode
    if (!streetAddress || !city || !state) {
      return null;
    }
    
    try {
      const fullAddress = [streetAddress, city, state, zip].filter(Boolean).join(', ');
      console.log('Geocoding address:', fullAddress);
      
      const coordinates = await geocodeAddress(fullAddress);
      console.log('Geocoding successful:', coordinates);
      
      return coordinates;
    } catch (error) {
      console.warn('Geocoding failed:', error);
      return null;
    }
  };

  const handleSave = async () => {
    try {
      // If we don't have coordinates but have a complete address, try to geocode it
      if (!form.homeLat || !form.homeLng) {
        const coordinates = await geocodeCurrentAddress();
        if (coordinates) {
          setForm(prev => ({
            ...prev,
            homeLat: coordinates.lat,
            homeLng: coordinates.lng
          }));
          setMessage('Address updated and geocoded successfully');
        } else {
          setMessage('Address updated successfully (geocoding failed)');
        }
      } else {
        setMessage('Address updated successfully');
      }
      
      await onFormChange(form);
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error saving address:', error);
      setMessage('Error saving address');
      setShowToast(true);
    }
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
      <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
        {hasChanges && (
          <Button variant="contained" onClick={handleSave}>
            Save Changes
          </Button>
        )}
        {form.streetAddress && form.city && form.state && (!form.homeLat || !form.homeLng) && (
          <Button 
            variant="outlined" 
            onClick={async () => {
              const coordinates = await geocodeCurrentAddress();
              if (coordinates) {
                setForm(prev => ({
                  ...prev,
                  homeLat: coordinates.lat,
                  homeLng: coordinates.lng
                }));
                setMessage('Address geocoded successfully');
                setShowToast(true);
              } else {
                setMessage('Geocoding failed - please check the address');
                setShowToast(true);
              }
            }}
          >
            Geocode Address
          </Button>
        )}
      </Box>
      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert onClose={() => setShowToast(false)} severity="success" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddressFormFields;
