import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Box, Grid, TextField, Typography, Card, CardHeader, CardContent, FormControl, InputLabel, Select, MenuItem, useTheme, useMediaQuery, Alert, Stack, Divider } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import ResumeSuggestionField from '../../common/ResumeSuggestionField';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import { auth } from '../../../firebase';

type Props = {
  value: any;
  onChange: (v: any) => void;
  onPasswordChange?: (password: string, confirmPassword: string) => void;
  showAddressFields?: boolean;
};

const formatPhone = (raw: string) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  const p1 = digits.slice(0, 3);
  const p2 = digits.slice(3, 6);
  const p3 = digits.slice(6, 10);
  if (digits.length <= 3) return p1;
  if (digits.length <= 6) return `(${p1})${p2}`;
  return `(${p1})${p2}-${p3}`;
};

// Format date for display (convert YYYY-MM-DD to MM/DD/YYYY)
const formatDateForDisplay = (dateString: string) => {
  if (!dateString) return '';
  // If it's already in MM/DD/YYYY format, return as is
  if (dateString.includes('/')) return dateString;
  // If it's in YYYY-MM-DD format, convert to MM/DD/YYYY
  if (dateString.includes('-') && dateString.length === 10) {
    const [year, month, day] = dateString.split('-');
    return `${month}/${day}/${year}`;
  }
  return dateString;
};

// Format date as user types (MM/DD/YYYY format)
const formatDobInput = (value: string) => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');
  
  // Format based on length
  if (digits.length <= 2) {
    return digits;
  } else if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  } else {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }
};

// Format date for storage (convert MM/DD/YYYY to YYYY-MM-DD)
const formatDateForStorage = (dateString: string) => {
  if (!dateString) return '';
  // Remove all non-digits first
  const digits = dateString.replace(/\D/g, '');
  
  // Only store if we have exactly 8 digits (complete date)
  if (digits.length === 8) {
    const month = digits.slice(0, 2);
    const day = digits.slice(2, 4);
    const year = digits.slice(4, 8);
    // Validate month and day ranges
    const monthNum = parseInt(month, 10);
    const dayNum = parseInt(day, 10);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  // If it's already in YYYY-MM-DD format, return as is
  if (dateString.includes('-') && dateString.length === 10) return dateString;
  // If it's in MM/DD/YYYY format, convert to YYYY-MM-DD
  if (dateString.includes('/')) {
    const parts = dateString.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      if (month && day && year && year.length === 4) {
        const monthNum = parseInt(month, 10);
        const dayNum = parseInt(day, 10);
        if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
          return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
      }
    }
  }
  // Return empty string if date is incomplete or invalid
  return '';
};

const PersonalInfoStep: React.FC<Props> = ({ value, onChange, onPasswordChange, showAddressFields = false }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isAuthenticated = auth.currentUser !== null;

  // Notify parent of password changes
  useEffect(() => {
    if (onPasswordChange) {
      onPasswordChange(password, confirmPassword);
    }
  }, [password, confirmPassword, onPasswordChange]);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dobDisplayValue, setDobDisplayValue] = useState(formatDateForDisplay(value.dob || ''));
  const selectedPreferredLanguage: 'en' | 'es' =
    value.preferredLanguage === 'es' ? 'es' : 'en';
  
  // Sync display value when value.dob changes externally
  useEffect(() => {
    if (value.dob) {
      setDobDisplayValue(formatDateForDisplay(value.dob));
    }
  }, [value.dob]);
  
  const handle = (field: string, v: string) => onChange({ ...value, [field]: v });

  // Helper function to check if a field value came from resume parsing
  const isFieldFromResume = (fieldName: string) => {
    return value?.resumeSuggestions?.[fieldName] === true;
  };

  const getFieldConfidence = (fieldName: string) => {
    return value?.resumeConfidence?.[fieldName] || 1.0;
  };

  // Google Places Autocomplete with robust initialization following Google's best practices
  const autocompleteRef = useRef<any>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const renderAddressSection = () => (
    <React.Fragment>
      {/* Address fields */}
      <Grid item xs={12}>
        {isGoogleMapsLoaded ? (
          <Autocomplete
            onLoad={handleAutocompleteLoad}
            onPlaceChanged={handlePlaceChanged}
            options={{
              componentRestrictions: { country: 'us' },
              fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
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
                      homeLng: coords.lng,
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Please select an address from the dropdown suggestions')}
              error={!!addressError}
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
                    homeLng: coords.lng,
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
            name="street-address"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            helperText={addressError || (geocodingAddress ? 'Validating address...' : 'Enter a valid street address')}
            error={!!addressError}
            inputProps={{
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'off',
              spellCheck: 'false',
            }}
          />
        )}
      </Grid>
      <Grid item xs={12} md={6}>
        <ResumeSuggestionField isFromResume={isFieldFromResume('unit')} confidence={getFieldConfidence('unit')}>
          <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
        </ResumeSuggestionField>
      </Grid>
      {value.homeLat !== undefined && value.homeLng !== undefined && (
        <>
          <Grid item xs={12} md={6}>
            <ResumeSuggestionField isFromResume={isFieldFromResume('city')} confidence={getFieldConfidence('city')}>
              <TextField fullWidth required label="City" value={value.city || ''} disabled />
            </ResumeSuggestionField>
          </Grid>
          <Grid item xs={12} md={6}>
            <ResumeSuggestionField isFromResume={isFieldFromResume('state')} confidence={getFieldConfidence('state')}>
              <TextField fullWidth required label="State" value={value.state || ''} disabled />
            </ResumeSuggestionField>
          </Grid>
          <Grid item xs={12} md={6}>
            <ResumeSuggestionField isFromResume={isFieldFromResume('zip')} confidence={getFieldConfidence('zip')}>
              <TextField fullWidth required label="Zip Code" value={value.zip || ''} disabled />
            </ResumeSuggestionField>
          </Grid>
        </>
      )}
      {addressError && (
        <Grid item xs={12}>
          <Alert severity="error" sx={{ mt: 1 }}>
            {addressError}
          </Alert>
        </Grid>
      )}
    </React.Fragment>
  );

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
      // Retry after 100ms if not loaded (max 50 retries = 5 seconds)
      if (!retryTimeoutRef.current || (retryTimeoutRef.current as any).retryCount < 50) {
        retryTimeoutRef.current = setTimeout(() => {
          if (retryTimeoutRef.current) {
            (retryTimeoutRef.current as any).retryCount = ((retryTimeoutRef.current as any).retryCount || 0) + 1;
          }
          checkGoogleMapsLoaded();
        }, 100) as any;
      }
    }
  }, []);

  // Initialize Google Maps check on mount
  useEffect(() => {
    if (!showAddressFields) {
      setIsGoogleMapsLoaded(false);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }
      return;
    }

    checkGoogleMapsLoaded();
    
    // Cleanup timeout on unmount
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [checkGoogleMapsLoaded, showAddressFields]);

  const handlePlaceChanged = useCallback(() => {
    if (!autocompleteRef.current?.getPlace) {
      console.warn('⚠️ Autocomplete ref or getPlace method not available');
      return;
    }
    
    try {
      const place = autocompleteRef.current.getPlace();
      
      // Validate place object
      if (!place) {
        console.warn('⚠️ No place object returned from autocomplete');
        setAddressError('Please select a valid address from the suggestions.');
        return;
      }
      
      if (!place.address_components || !Array.isArray(place.address_components) || place.address_components.length === 0) {
        console.warn('⚠️ Place missing address_components:', place);
        setAddressError('Selected address is missing required information. Please try another selection.');
        return;
      }
      
      // Validate geometry/coordinates (required for map display)
      if (!place.geometry || !place.geometry.location) {
        console.warn('⚠️ Place missing geometry/location:', place);
        setAddressError('Selected address is missing location data. Please try another selection.');
        return;
      }
      
      setAddressError(null);
      
      const components = place.address_components;
      const getComponent = (types: string[]) => {
        const component = components.find((c: any) => 
          types.every((t) => c.types?.includes(t))
        );
        return component?.long_name || '';
      };

      // Get coordinates from place geometry (best practice: use geometry.location)
      let homeLat: number | undefined;
      let homeLng: number | undefined;
      
      const location = place.geometry.location;
      if (location) {
        // Handle both function and object formats (Google Maps API can return either)
        if (typeof location.lat === 'function') {
          homeLat = location.lat();
          homeLng = location.lng();
        } else {
          homeLat = location.lat;
          homeLng = location.lng;
        }
      }
      
      // Validate coordinates are valid numbers
      if (typeof homeLat !== 'number' || typeof homeLng !== 'number' || 
          isNaN(homeLat) || isNaN(homeLng) ||
          homeLat < -90 || homeLat > 90 || homeLng < -180 || homeLng > 180) {
        console.error('❌ Invalid coordinates:', { homeLat, homeLng });
        setAddressError('Selected address has invalid coordinates. Please try another selection.');
        return;
      }

      // Extract address components following Google's best practices
      const streetNumber = getComponent(['street_number']);
      const route = getComponent(['route']);
      const street = `${streetNumber} ${route}`.trim();
      
      // Try multiple locality types for city (best practice: handle various address formats)
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

      // Update only address fields to prevent clearing other form data
      const newAddressData = {
        street,
        city,
        state,
        zip,
        homeLat,
        homeLng,
        placeId: place.place_id || undefined, // Store Place ID for future reference
      };

      // Only update fields that have values from the place
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
            Tell us a bit about you
          </Typography>
          <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('firstName')} 
            confidence={getFieldConfidence('firstName')}
          >
            <TextField fullWidth required label="First name" value={value.firstName || ''} onChange={(e) => handle('firstName', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('lastName')} 
            confidence={getFieldConfidence('lastName')}
          >
            <TextField fullWidth required label="Last name" value={value.lastName || ''} onChange={(e) => handle('lastName', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('email')} 
            confidence={getFieldConfidence('email')}
          >
            <TextField fullWidth required type="email" label="Email" value={value.email || ''} onChange={(e) => handle('email', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('phone')} 
            confidence={getFieldConfidence('phone')}
          >
            <TextField 
              fullWidth 
              required 
              label="Phone" 
              inputMode="numeric" 
              value={formatPhone(value.phone || '')} 
              onChange={(e) => {
                // Store only digits, remove formatting
                const digits = e.target.value.replace(/\D/g, '');
                handle('phone', digits);
              }} 
            />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <FormControl fullWidth>
            <InputLabel id="apply-preferred-language-mobile-label">Preferred Message Language</InputLabel>
            <Select
              labelId="apply-preferred-language-mobile-label"
              label="Preferred Message Language"
              value={selectedPreferredLanguage}
              onChange={(e) => handle('preferredLanguage', e.target.value as string)}
            >
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="es">Spanish</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField 
            fullWidth 
            required
            label="Date of Birth (MM/DD/YYYY)" 
            inputMode="numeric" 
            placeholder="MM/DD/YYYY"
            value={dobDisplayValue} 
            onChange={(e) => {
              const formatted = formatDobInput(e.target.value);
              setDobDisplayValue(formatted);
              
              // Extract digits to check if date is complete
              const digits = formatted.replace(/\D/g, '');
              
              // Only store if we have exactly 8 digits (complete date)
              if (digits.length === 8) {
                const storageValue = formatDateForStorage(formatted);
                if (storageValue) {
                  handle('dob', storageValue);
                } else {
                  // Invalid date format, clear storage
                  handle('dob', '');
                }
              } else {
                // Incomplete date, clear storage so validation knows it's incomplete
                handle('dob', '');
              }
            }}
            inputProps={{
              maxLength: 10
            }}
            onKeyPress={(e) => {
              // Allow only digits, backspace, delete, tab, escape, enter, and forward slash
              if (!/[0-9/]/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
                e.preventDefault();
              }
            }}
          />
        </Grid>
        
        {showAddressFields && renderAddressSection()}
          </Grid>
        </Box>
      ) : (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardHeader 
            title={<Typography variant="h6">Tell us a bit about you</Typography>} 
            sx={{ px: 2, py: 1.5 }}
          />
          <CardContent sx={{ px: 2, py: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('firstName')} 
                  confidence={getFieldConfidence('firstName')}
                >
                  <TextField fullWidth required label="First name" value={value.firstName || ''} onChange={(e) => handle('firstName', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('lastName')} 
                  confidence={getFieldConfidence('lastName')}
                >
                  <TextField fullWidth required label="Last name" value={value.lastName || ''} onChange={(e) => handle('lastName', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('email')} 
                  confidence={getFieldConfidence('email')}
                >
                  <TextField fullWidth required type="email" label="Email" value={value.email || ''} onChange={(e) => handle('email', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('phone')} 
                  confidence={getFieldConfidence('phone')}
                >
                  <TextField 
                    fullWidth 
                    required 
                    label="Phone" 
                    inputMode="numeric" 
                    value={formatPhone(value.phone || '')} 
                    onChange={(e) => {
                      // Store only digits, remove formatting
                      const digits = e.target.value.replace(/\D/g, '');
                      handle('phone', digits);
                    }} 
                  />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel id="apply-preferred-language-desktop-label">Preferred Message Language</InputLabel>
                  <Select
                    labelId="apply-preferred-language-desktop-label"
                    label="Preferred Message Language"
                    value={selectedPreferredLanguage}
                    onChange={(e) => handle('preferredLanguage', e.target.value as string)}
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="es">Spanish</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth 
                  required
                  label="Date of Birth (MM/DD/YYYY)" 
                  inputMode="numeric" 
                  placeholder="MM/DD/YYYY"
                  value={dobDisplayValue} 
                  onChange={(e) => {
                    const formatted = formatDobInput(e.target.value);
                    setDobDisplayValue(formatted);
                    
                    // Extract digits to check if date is complete
                    const digits = formatted.replace(/\D/g, '');
                    
                    // Only store if we have exactly 8 digits (complete date)
                    if (digits.length === 8) {
                      const storageValue = formatDateForStorage(formatted);
                      if (storageValue) {
                        handle('dob', storageValue);
                      } else {
                        // Invalid date format, clear storage
                        handle('dob', '');
                      }
                    } else {
                      // Incomplete date, clear storage so validation knows it's incomplete
                      handle('dob', '');
                    }
                  }}
                  inputProps={{
                    maxLength: 10
                  }}
                  onKeyPress={(e) => {
                    // Allow only digits, backspace, delete, tab, escape, enter, and forward slash
                    if (!/[0-9/]/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                />
              </Grid>
              
              {showAddressFields && renderAddressSection()}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Password Fields - Only show if not authenticated */}
      {!isAuthenticated && (
        <Box sx={{ mt: isMobile ? 2 : 3 }}>
          {isMobile ? (
            <>
              <Typography variant="h6" sx={{ mb: 1.5, fontSize: '1rem', fontWeight: 500 }}>
                Create Your Account
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  fullWidth
                  type="password"
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText="At least 6 characters"
                  required
                />
                <TextField
                  fullWidth
                  type="password"
                  label="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={confirmPassword.length > 0 && password !== confirmPassword}
                  helperText={confirmPassword.length > 0 && password !== confirmPassword ? "Passwords don't match" : ' '}
                  required
                />
              </Stack>
            </>
          ) : (
              <Card variant="outlined">
              <CardHeader 
                title={<Typography variant="h6">Create Your Account</Typography>}
                sx={{ px: 2, py: 1.5 }}
              />
              <CardContent sx={{ px: 2, py: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Create a password to save your progress and submit your application.
                </Typography>
                <Stack spacing={1.5}>
                  <TextField
                    fullWidth
                    type="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    helperText="At least 6 characters"
                    required
                  />
                  <TextField
                    fullWidth
                    type="password"
                    label="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    error={confirmPassword.length > 0 && password !== confirmPassword}
                    helperText={confirmPassword.length > 0 && password !== confirmPassword ? "Passwords don't match" : ' '}
                    required
                  />
                </Stack>
              </CardContent>
            </Card>
          )}
        </Box>
      )}
    </Box>
  );
};

export default PersonalInfoStep;


