import React, { useCallback, useRef, useState } from 'react';
import { Box, Grid, TextField, Typography, Card, CardHeader, CardContent, useTheme, useMediaQuery, Alert } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import ResumeSuggestionField from '../../common/ResumeSuggestionField';
import { useLoadScript } from '@react-google-maps/api';
import { GOOGLE_MAPS_LIBRARIES } from '../../../utils/googleMapsLoader';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const SELECT_FROM_DROPDOWN_MSG =
  'Please select your address from the dropdown';

const AddressStep: React.FC<Props> = ({ value, onChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [addressError, setAddressError] = useState<string | null>(null);
  const autocompleteRef = useRef<any>(null);

  // Load Google Maps script
  const { isLoaded: isGoogleMapsLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '',
    // MUST match every other loader (App.tsx LoadScript) — a differing
    // libraries list builds a different script URL and the lib removes +
    // re-injects the Maps script, killing live Places widgets app-wide.
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  /**
   * `placeId` is the canonical "address has been verified by Google" marker
   * the wizard reads in `addressValid`. Free-typed text is allowed in the
   * input (so users can clear / re-search) but never persists structured
   * fields without a Place selection. If the user typed without selecting,
   * we surface the inline error and let the wizard's disabled-button gate
   * keep them on this step.
   */
  const verifiedFromGoogle = !!value?.placeId;

  const handle = (field: string, val: string) => {
    onChange({ ...value, [field]: val });
  };

  /**
   * Strip every structured/Google-derived address field on raw text edits so
   * a partial Google selection followed by manual edits never makes it into
   * `homeAddress`. The wizard treats the absence of `placeId` as "not
   * verified yet" — single source of truth.
   */
  const handleStreetTyping = (raw: string) => {
    if (verifiedFromGoogle) {
      onChange({
        ...value,
        street: raw,
        city: '',
        state: '',
        zip: '',
        homeLat: undefined,
        homeLng: undefined,
        placeId: undefined,
        formattedAddress: undefined,
        country: undefined,
        addressGeocodedAt: undefined,
      });
    } else {
      handle('street', raw);
    }
    if (raw.trim()) {
      setAddressError(SELECT_FROM_DROPDOWN_MSG);
    } else {
      setAddressError(null);
    }
  };

  const handlePlaceChanged = useCallback(() => {
    try {
      const place = autocompleteRef.current?.getPlace();
      if (!place || !place.place_id) {
        // Place id is the wire we hang verification on; no id ⇒ no Place.
        setAddressError(SELECT_FROM_DROPDOWN_MSG);
        return;
      }

      const components = Array.isArray(place.address_components)
        ? place.address_components
        : [];
      if (components.length === 0) {
        setAddressError('Selected address is missing components. Please try another selection.');
        return;
      }

      const getComponent = (types: string[], useShort = false) => {
        const c = components.find((comp: any) =>
          types.every((t) => comp?.types?.includes(t))
        );
        if (!c) return '';
        return useShort ? c.short_name || '' : c.long_name || '';
      };

      // Coordinates: Google sometimes returns LatLng functions, sometimes plain numbers.
      let homeLat: number | undefined;
      let homeLng: number | undefined;
      const location = place.geometry?.location;
      if (location) {
        if (typeof location.lat === 'function') {
          homeLat = location.lat();
          homeLng = location.lng();
        } else {
          homeLat = (location as any).lat;
          homeLng = (location as any).lng;
        }
      }
      if (
        typeof homeLat !== 'number' ||
        typeof homeLng !== 'number' ||
        isNaN(homeLat) ||
        isNaN(homeLng) ||
        homeLat < -90 ||
        homeLat > 90 ||
        homeLng < -180 ||
        homeLng > 180
      ) {
        setAddressError('Selected address has invalid coordinates. Please try another selection.');
        return;
      }

      const streetNumber = getComponent(['street_number']);
      const route = getComponent(['route']);
      const street = `${streetNumber} ${route}`.trim();

      const city =
        getComponent(['locality']) ||
        getComponent(['sublocality']) ||
        getComponent(['sublocality_level_1']) ||
        getComponent(['postal_town']) ||
        getComponent(['administrative_area_level_2']);

      // State: short name ("CA", not "California") matches the wizard /
      // Firestore `state` convention used elsewhere.
      const state = getComponent(['administrative_area_level_1'], true);
      const zip = getComponent(['postal_code']);
      // Country short ISO ("US", "CA"). Falls back to long name only when
      // Google didn't return short_name.
      const country =
        getComponent(['country'], true) || getComponent(['country']) || '';

      if (!street || !city || !state || !zip) {
        const missing: string[] = [];
        if (!street) missing.push('street');
        if (!city) missing.push('city');
        if (!state) missing.push('state');
        if (!zip) missing.push('zip');
        setAddressError(
          `Selected address is missing: ${missing.join(', ')}. Please try another selection.`,
        );
        return;
      }

      const formattedAddress: string =
        typeof place.formatted_address === 'string' && place.formatted_address.trim()
          ? place.formatted_address.trim()
          : [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', ');

      // Single setState — mirror the canonical `homeAddress` shape to the
      // flat wizard `value` so existing readers (`addressValid`, profile
      // writes) keep working without a fork.
      const updatedData = {
        ...value,
        street,
        city,
        state,
        zip,
        homeLat,
        homeLng,
        placeId: place.place_id,
        formattedAddress,
        country,
        // ISO timestamp for the user-visible "verified at" marker. Stored
        // alongside the structured `homeAddress` write at submit.
        addressGeocodedAt: new Date().toISOString(),
      };

      setAddressError(null);
      onChange(updatedData);
    } catch (error: any) {
      console.error('Error processing place selection:', error);
      setAddressError(SELECT_FROM_DROPDOWN_MSG);
    }
  }, [value, onChange]);

  const handleAutocompleteLoad = useCallback((autocomplete: any) => {
    autocompleteRef.current = autocomplete;
  }, []);

  // Single street input shared between mobile + desktop layouts. Wrapped in
  // Google Places `Autocomplete` when the script has loaded; falls back to a
  // bare TextField (with the same inline error) while it loads.
  const streetField = (
    <TextField
      fullWidth
      required
      label="Street Address"
      value={value.street || ''}
      onChange={(e) => handleStreetTyping(e.target.value)}
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
      helperText={
        addressError
          ? addressError
          : verifiedFromGoogle
            ? '✓ Address verified'
            : SELECT_FROM_DROPDOWN_MSG
      }
      error={!!addressError}
    />
  );

  const wrappedStreetField = isGoogleMapsLoaded ? (
    <Autocomplete
      onLoad={handleAutocompleteLoad}
      onPlaceChanged={handlePlaceChanged}
      options={{
        componentRestrictions: { country: 'us' },
        fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
        types: ['address'],
      }}
    >
      {streetField}
    </Autocomplete>
  ) : (
    streetField
  );

  // Read-only echo of the parsed Place. Only shown after `placeId` is set so
  // the user can confirm what Google returned.
  const verifiedFields = verifiedFromGoogle ? (
    <>
      <Grid item xs={12}>
        <Alert severity="success" sx={{ mb: 2 }}>
          ✓ Address verified. You can proceed to the next step.
        </Alert>
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField fullWidth required label="City" value={value.city || ''} disabled />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField fullWidth required label="State" value={value.state || ''} disabled />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField fullWidth required label="Zip Code" value={value.zip || ''} disabled />
      </Grid>
    </>
  ) : null;

  const formGrid = (
    <Grid container spacing={2}>
      <Grid item xs={12}>{wrappedStreetField}</Grid>
      <Grid item xs={12} md={6}>
        <ResumeSuggestionField isFromResume={false} confidence={undefined}>
          <TextField
            fullWidth
            label="Unit / Apt"
            value={value.unit || ''}
            onChange={(e) => handle('unit', e.target.value)}
          />
        </ResumeSuggestionField>
      </Grid>
      {verifiedFields}
    </Grid>
  );

  return (
    <Box>
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 2, fontSize: '1rem', fontWeight: 500 }}>
            Where are you located?
          </Typography>
          {formGrid}
        </Box>
      ) : (
        <Card
          variant="outlined"
          sx={{ mb: 3, boxShadow: 0, border: '1px solid', borderColor: 'divider' }}
        >
          <CardHeader
            title={<Typography variant="h6">Where are you located?</Typography>}
            sx={{ px: { xs: 2, md: 3 }, py: { xs: 1, md: 2 } }}
          />
          <CardContent sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              We need your address to match you with nearby job opportunities.
            </Typography>
            {formGrid}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default AddressStep;

