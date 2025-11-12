import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Box, Grid, TextField, Typography, Card, CardHeader, CardContent, FormControl, InputLabel, Select, MenuItem, useTheme, useMediaQuery } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import ResumeSuggestionField from '../../common/ResumeSuggestionField';

type Props = {
  value: any;
  onChange: (v: any) => void;
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

const PersonalInfoStep: React.FC<Props> = ({ value, onChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dobDisplayValue, setDobDisplayValue] = useState(formatDateForDisplay(value.dob || ''));
  
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

  // Google Places Autocomplete with robust initialization
  const autocompleteRef = useRef<any>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
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

  // Initialize Google Maps check on mount
  useEffect(() => {
    checkGoogleMapsLoaded();
    
    // Cleanup timeout on unmount
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [checkGoogleMapsLoaded]);

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
            street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
            city: getComponent(['locality']) || getComponent(['sublocality']) || getComponent(['postal_town']),
            state: getComponent(['administrative_area_level_1']),
            zip: getComponent(['postal_code']),
            homeLat: place.geometry?.location?.lat?.(),
            homeLng: place.geometry?.location?.lng?.(),
          };

    // Only update fields that have values from the place
    const updatedData = { ...value };
    Object.entries(newAddressData).forEach(([key, val]) => {
      if (val) {
        updatedData[key] = val;
      }
    });

    onChange(updatedData);
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
        
        <Grid item xs={12}>
          {isGoogleMapsLoaded ? (
            <Autocomplete 
              onLoad={handleAutocompleteLoad} 
              onPlaceChanged={handlePlaceChanged}
              options={{
                componentRestrictions: { country: 'us' },
                fields: ['address_components', 'formatted_address'],
              }}
            >
              <TextField 
                fullWidth 
                required
                label="Street Address" 
                value={value.street || ''} 
                onChange={(e) => handle('street', e.target.value)} 
                id="apply-street-address"
                name="street-address"
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
              fullWidth 
              required
              label="Street Address" 
              value={value.street || ''} 
              onChange={(e) => handle('street', e.target.value)} 
              id="apply-street-address"
              name="street-address"
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
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('unit')} 
            confidence={getFieldConfidence('unit')}
          >
            <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('city')} 
            confidence={getFieldConfidence('city')}
          >
            <TextField fullWidth required label="City" value={value.city || ''} onChange={(e) => handle('city', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('state')} 
            confidence={getFieldConfidence('state')}
          >
            <TextField fullWidth required label="State" value={value.state || ''} onChange={(e) => handle('state', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
        <Grid item xs={12} md={6}>
          <ResumeSuggestionField 
            isFromResume={isFieldFromResume('zip')} 
            confidence={getFieldConfidence('zip')}
          >
            <TextField fullWidth required label="Zip Code" inputMode="numeric" value={value.zip || ''} onChange={(e) => handle('zip', e.target.value)} />
          </ResumeSuggestionField>
        </Grid>
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
              
              <Grid item xs={12}>
                {isGoogleMapsLoaded ? (
                  <Autocomplete 
                    onLoad={handleAutocompleteLoad} 
                    onPlaceChanged={handlePlaceChanged}
                    options={{
                      componentRestrictions: { country: 'us' },
                      fields: ['address_components', 'formatted_address'],
                    }}
                  >
                    <TextField 
                      fullWidth 
                      required
                      label="Street Address" 
                      value={value.street || ''} 
                      onChange={(e) => handle('street', e.target.value)} 
                      id="apply-street-address"
                      name="street-address"
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
                    fullWidth 
                    required
                    label="Street Address" 
                    value={value.street || ''} 
                    onChange={(e) => handle('street', e.target.value)} 
                    id="apply-street-address"
                    name="street-address"
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
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('unit')} 
                  confidence={getFieldConfidence('unit')}
                >
                  <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('city')} 
                  confidence={getFieldConfidence('city')}
                >
                  <TextField fullWidth required label="City" value={value.city || ''} onChange={(e) => handle('city', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('state')} 
                  confidence={getFieldConfidence('state')}
                >
                  <TextField fullWidth required label="State" value={value.state || ''} onChange={(e) => handle('state', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
              <Grid item xs={12} md={6}>
                <ResumeSuggestionField 
                  isFromResume={isFieldFromResume('zip')} 
                  confidence={getFieldConfidence('zip')}
                >
                  <TextField fullWidth required label="Zip Code" inputMode="numeric" value={value.zip || ''} onChange={(e) => handle('zip', e.target.value)} />
                </ResumeSuggestionField>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default PersonalInfoStep;


