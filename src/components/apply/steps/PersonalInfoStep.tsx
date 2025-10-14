import React, { useEffect, useRef } from 'react';
import { Box, Grid, TextField, Typography } from '@mui/material';

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

const PersonalInfoStep: React.FC<Props> = ({ value, onChange }) => {
  const handle = (field: string, v: string) => onChange({ ...value, [field]: v });

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

  // Format date for storage (convert MM/DD/YYYY to YYYY-MM-DD)
  const formatDateForStorage = (dateString: string) => {
    if (!dateString) return '';
    // If it's already in YYYY-MM-DD format, return as is
    if (dateString.includes('-') && dateString.length === 10) return dateString;
    // If it's in MM/DD/YYYY format, convert to YYYY-MM-DD
    if (dateString.includes('/')) {
      const [month, day, year] = dateString.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateString;
  };

  // Google Places Autocomplete (street address)
  const streetRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  
  // Keep refs updated
  onChangeRef.current = onChange;
  valueRef.current = value;
  
  useEffect(() => {
    if (!streetRef.current || !(window as any).google?.maps?.places) return;
    
    // Only create autocomplete once
    if (!autocompleteRef.current) {
      autocompleteRef.current = new (window as any).google.maps.places.Autocomplete(streetRef.current, {
        fields: ['address_components', 'formatted_address'],
        types: ['address'],
      });
      
      const parse = (components: any[]) => {
        const get = (type: string) => {
          const comp = components.find((c) => c.types?.includes(type));
          return comp ? comp.long_name : '';
        };
        return {
          street: `${get('street_number')} ${get('route')}`.trim(),
          city: get('locality') || get('sublocality') || get('postal_town') || '',
          state: get('administrative_area_level_1') || '',
          zip: get('postal_code') || '',
        };
      };
      
      const listener = autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (!place?.address_components) return;
        const parsed = parse(place.address_components);
        // Use refs to get the latest values without causing re-renders
        onChangeRef.current({ 
          ...valueRef.current, 
          street: parsed.street,
          city: parsed.city,
          state: parsed.state,
          zip: parsed.zip
        });
      });
      
      // Store the listener for cleanup
      autocompleteRef.current._listener = listener;
    }
    
    return () => {
      if (autocompleteRef.current?._listener?.remove) {
        autocompleteRef.current._listener.remove();
      }
    };
  }, []); // Empty dependency array - only run once

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Tell us a bit about you</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="First name" value={value.firstName || ''} onChange={(e) => handle('firstName', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="Last name" value={value.lastName || ''} onChange={(e) => handle('lastName', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth type="email" label="Email" value={value.email || ''} onChange={(e) => handle('email', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="Phone" inputMode="numeric" value={formatPhone(value.phone || '')} onChange={(e) => handle('phone', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField 
            fullWidth 
            label="Date of Birth (MM/DD/YYYY)" 
            inputMode="numeric" 
            placeholder="MM/DD/YYYY"
            value={formatDateForDisplay(value.dob || '')} 
            onChange={(e) => handle('dob', formatDateForStorage(e.target.value))} 
          />
        </Grid>
        <Grid item xs={12}>
          <TextField fullWidth label="Street Address" value={value.street || ''} onChange={(e) => handle('street', e.target.value)} inputRef={streetRef} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="Unit / Apt" value={value.unit || ''} onChange={(e) => handle('unit', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="City" value={value.city || ''} onChange={(e) => handle('city', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="State" value={value.state || ''} onChange={(e) => handle('state', e.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth label="Zip Code" inputMode="numeric" value={value.zip || ''} onChange={(e) => handle('zip', e.target.value)} />
        </Grid>
      </Grid>
    </Box>
  );
};

export default PersonalInfoStep;


