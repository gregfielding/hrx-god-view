import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Box, Grid, TextField, Typography, Card, CardHeader, CardContent, useTheme, useMediaQuery, Alert, Stack } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import ResumeSuggestionField from '../../common/ResumeSuggestionField';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import { useLoadScript } from '@react-google-maps/api';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const AddressStep: React.FC<Props> = ({ value, onChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [addressError, setAddressError] = useState<string | null>(null);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const autocompleteRef = useRef<any>(null);

  // Load Google Maps script
  const { isLoaded: isGoogleMapsLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  const handle = (field: string, val: string) => {
    onChange({ ...value, [field]: val });
  };

  const handlePlaceChanged = useCallback(() => {
    try {
      const place = autocompleteRef.current?.getPlace();
      if (!place) {
        console.warn('No place selected');
        return;
      }

      setAddressError(null);

      // Helper to extract address components
      const getComponent = (types: string[]) => {
        const component = place.address_components?.find((c: any) =>
          types.every((t) => c.types?.includes(t))
        );
        return component?.long_name || '';
      };

      // Get coordinates from place geometry
      let homeLat: number | undefined;
      let homeLng: number | undefined;
      
      const location = place.geometry.location;
      if (location) {
        if (typeof location.lat === 'function') {
          homeLat = location.lat();
          homeLng = location.lng();
        } else {
          homeLat = location.lat;
          homeLng = location.lng;
        }
      }
      
      // Validate coordinates
      if (typeof homeLat !== 'number' || typeof homeLng !== 'number' || 
          isNaN(homeLat) || isNaN(homeLng) ||
          homeLat < -90 || homeLat > 90 || homeLng < -180 || homeLng > 180) {
        console.error('❌ Invalid coordinates:', { homeLat, homeLng });
        setAddressError('Selected address has invalid coordinates. Please try another selection.');
        return;
      }

      // Extract address components
      const streetNumber = getComponent(['street_number']);
      const route = getComponent(['route']);
      const street = `${streetNumber} ${route}`.trim();
      
      const city = getComponent(['locality']) || 
                  getComponent(['sublocality']) || 
                  getComponent(['sublocality_level_1']) ||
                  getComponent(['postal_town']) ||
                  getComponent(['administrative_area_level_2']);
      
      const state = getComponent(['administrative_area_level_1']);
      const zip = getComponent(['postal_code']);

      // Validate required fields
      if (!street || !city || !state || !zip) {
        const missing = [];
        if (!street) missing.push('street');
        if (!city) missing.push('city');
        if (!state) missing.push('state');
        if (!zip) missing.push('zip');
        console.warn('⚠️ Missing address components:', missing);
        setAddressError(`Selected address is missing: ${missing.join(', ')}. Please try another selection.`);
        return;
      }

      // Update address data
      const newAddressData = {
        street,
        city,
        state,
        zip,
        homeLat,
        homeLng,
        placeId: place.place_id || undefined,
      };

      const updatedData = { ...value };
      Object.entries(newAddressData).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          updatedData[key] = val;
        }
      });

      console.log('📍 handlePlaceChanged - updating address data:', {
        placeId: place.place_id,
        newAddressData,
        hasCoordinates: updatedData.homeLat !== undefined && updatedData.homeLng !== undefined,
        addressComplete: !!(updatedData.street && updatedData.city && updatedData.state && updatedData.zip)
      });

      onChange(updatedData);
    } catch (error: any) {
      console.error('❌ Error processing place selection:', error);
      setAddressError('An error occurred processing the selected address. Please try again.');
    }
  }, [value, onChange]);

  const handleAutocompleteLoad = useCallback((autocomplete: any) => {
    autocompleteRef.current = autocomplete;
  }, []);

  return (
    <Box>
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 2, fontSize: '1rem', fontWeight: 500 }}>
            Where are you located?
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              {isGoogleMapsLoaded ? (
                <Autocomplete 
                  onLoad={handleAutocompleteLoad} 
                  onPlaceChanged={handlePlaceChanged}
                  options={{
                    componentRestrictions: { country: 'us' },
                    fields: [
                      'address_components',
                      'formatted_address',
                      'geometry',
                      'place_id'
                    ],
                    types: ['address'],
                  }}
                >
                  <TextField 
                    fullWidth 
                    required
                    label="Street Address" 
                    value={value.street || ''} 
                    onChange={(e) => {
                      handle('street', e.target.value);
                      if (value.homeLat || value.homeLng) {
                        onChange({ ...value, street: e.target.value, homeLat: undefined, homeLng: undefined });
                      }
                    }}
                    onBlur={async (e) => {
                      const street = e.target.value.trim();
                      const city = value.city?.trim();
                      const state = value.state?.trim();
                      const zip = value.zip?.trim();
                      
                      if (street && city && state && (!value.homeLat || !value.homeLng)) {
                        setGeocodingAddress(true);
                        setAddressError(null);
                        try {
                          const fullAddress = `${street}, ${city}, ${state} ${zip || ''}`.trim();
                          const coords = await geocodeAddress(fullAddress);
                          onChange({
                            ...value,
                            homeLat: coords.lat,
                            homeLng: coords.lng
                          });
                        } catch (error) {
                          console.error('Geocoding error:', error);
                          setAddressError('Could not validate address. Please select from the dropdown suggestions.');
                        } finally {
                          setGeocodingAddress(false);
                        }
                      }
                    }}
                    id="apply-street-address"
                    name="street-address"
                    autoComplete="off"
                    helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Please select an address from the dropdown suggestions')}
                    error={!!addressError}
                  />
                </Autocomplete>
              ) : (
                <TextField 
                  fullWidth 
                  required
                  label="Street Address" 
                  value={value.street || ''} 
                  onChange={(e) => {
                    handle('street', e.target.value);
                    if (value.homeLat || value.homeLng) {
                      onChange({ ...value, street: e.target.value, homeLat: undefined, homeLng: undefined });
                    }
                  }}
                  onBlur={async (e) => {
                    const street = e.target.value.trim();
                    const city = value.city?.trim();
                    const state = value.state?.trim();
                    const zip = value.zip?.trim();
                    
                    if (street && city && state && (!value.homeLat || !value.homeLng)) {
                      setGeocodingAddress(true);
                      setAddressError(null);
                      try {
                        const fullAddress = `${street}, ${city}, ${state} ${zip || ''}`.trim();
                        const coords = await geocodeAddress(fullAddress);
                        onChange({
                          ...value,
                          homeLat: coords.lat,
                          homeLng: coords.lng
                        });
                      } catch (error) {
                        console.error('Geocoding error:', error);
                        setAddressError('Could not validate address. Please enter a valid address.');
                      } finally {
                        setGeocodingAddress(false);
                      }
                    }
                  }}
                  id="apply-street-address"
                  helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Enter a valid street address')}
                  error={!!addressError}
                />
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              <ResumeSuggestionField 
                isFromResume={false} 
                confidence={undefined}
              >
                <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
              </ResumeSuggestionField>
            </Grid>
            {value.homeLat !== undefined && value.homeLng !== undefined && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField 
                    fullWidth 
                    required 
                    label="City" 
                    value={value.city || ''} 
                    disabled
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField 
                    fullWidth 
                    required 
                    label="State" 
                    value={value.state || ''} 
                    disabled
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField 
                    fullWidth 
                    required 
                    label="Zip Code" 
                    value={value.zip || ''} 
                    disabled
                  />
                </Grid>
              </>
            )}
          </Grid>
        </Box>
      ) : (
        <Card variant="outlined" sx={{ mb: 3, boxShadow: 0, border: '1px solid', borderColor: 'divider' }}>
          <CardHeader 
            title={<Typography variant="h6">Where are you located?</Typography>} 
            sx={{ px: { xs: 2, md: 3 }, py: { xs: 1, md: 2 } }}
          />
          <CardContent sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              We need your address to match you with nearby job opportunities.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                {isGoogleMapsLoaded ? (
                  <Autocomplete 
                    onLoad={handleAutocompleteLoad} 
                    onPlaceChanged={handlePlaceChanged}
                    options={{
                      componentRestrictions: { country: 'us' },
                      fields: [
                        'address_components',
                        'formatted_address',
                        'geometry',
                        'place_id'
                      ],
                      types: ['address'],
                    }}
                  >
                    <TextField 
                      fullWidth 
                      required
                      label="Street Address" 
                      value={value.street || ''} 
                      onChange={(e) => {
                        handle('street', e.target.value);
                        if (value.homeLat || value.homeLng) {
                          onChange({ ...value, street: e.target.value, homeLat: undefined, homeLng: undefined });
                        }
                      }}
                      onBlur={async (e) => {
                        const street = e.target.value.trim();
                        const city = value.city?.trim();
                        const state = value.state?.trim();
                        const zip = value.zip?.trim();
                        
                        if (street && city && state && (!value.homeLat || !value.homeLng)) {
                          setGeocodingAddress(true);
                          setAddressError(null);
                          try {
                            const fullAddress = `${street}, ${city}, ${state} ${zip || ''}`.trim();
                            const coords = await geocodeAddress(fullAddress);
                            onChange({
                              ...value,
                              homeLat: coords.lat,
                              homeLng: coords.lng
                            });
                          } catch (error) {
                            console.error('Geocoding error:', error);
                            setAddressError('Could not validate address. Please select from the dropdown suggestions.');
                          } finally {
                            setGeocodingAddress(false);
                          }
                        }
                      }}
                      id="apply-street-address"
                      helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Please select an address from the dropdown suggestions')}
                      error={!!addressError}
                    />
                  </Autocomplete>
                ) : (
                  <TextField 
                    fullWidth 
                    required
                    label="Street Address" 
                    value={value.street || ''} 
                    onChange={(e) => {
                      handle('street', e.target.value);
                      if (value.homeLat || value.homeLng) {
                        onChange({ ...value, street: e.target.value, homeLat: undefined, homeLng: undefined });
                      }
                    }}
                    onBlur={async (e) => {
                      const street = e.target.value.trim();
                      const city = value.city?.trim();
                      const state = value.state?.trim();
                      const zip = value.zip?.trim();
                      
                      if (street && city && state && (!value.homeLat || !value.homeLng)) {
                        setGeocodingAddress(true);
                        setAddressError(null);
                        try {
                          const fullAddress = `${street}, ${city}, ${state} ${zip || ''}`.trim();
                          const coords = await geocodeAddress(fullAddress);
                          onChange({
                            ...value,
                            homeLat: coords.lat,
                            homeLng: coords.lng
                          });
                        } catch (error) {
                          console.error('Geocoding error:', error);
                          setAddressError('Could not validate address. Please enter a valid address.');
                        } finally {
                          setGeocodingAddress(false);
                        }
                      }
                    }}
                    id="apply-street-address"
                    helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Enter a valid street address')}
                    error={!!addressError}
                  />
                )}
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={false} 
                  confidence={undefined}
                >
                  <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              {value.homeLat !== undefined && value.homeLng !== undefined && (
                <>
                  <Grid item xs={12} md={6}>
                    <TextField 
                      fullWidth 
                      required 
                      label="City" 
                      value={value.city || ''} 
                      disabled
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField 
                      fullWidth 
                      required 
                      label="State" 
                      value={value.state || ''} 
                      disabled
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField 
                      fullWidth 
                      required 
                      label="Zip Code" 
                      value={value.zip || ''} 
                      disabled
                    />
                  </Grid>
                </>
              )}
            </Grid>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default AddressStep;

