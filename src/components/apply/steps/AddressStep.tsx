import React, { useCallback, useRef, useState } from 'react';
import { Box, Grid, TextField, Typography, Card, CardHeader, CardContent, useTheme, useMediaQuery, Alert, Button, Link, CircularProgress } from '@mui/material';
import { Autocomplete } from '@react-google-maps/api';
import { getFunctions, httpsCallable } from 'firebase/functions';
import ResumeSuggestionField from '../../common/ResumeSuggestionField';
import { useLoadScript } from '@react-google-maps/api';
import { GOOGLE_MAPS_LIBRARIES } from '../../../utils/googleMapsLoader';
import { resolvePlaceAddress } from '../../../utils/placesAddress';

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
  // Manual-entry escape hatch: on phones the Places dropdown sometimes never
  // engages (script timing, keyboard covering the list, fat-finger misses) and
  // the dropdown-only rule turned that into a hard stall — workers abandoned
  // the wizard at this step and became accounts with no address. Manual mode
  // geocodes the typed address through the placesGeocodeAddress callable
  // (browser key is API-restricted; server key isn't), so it produces the
  // same verified shape (normalized fields + coords + placeId) as a dropdown
  // pick — the wizard's addressValid gate is unchanged.
  const [manualMode, setManualMode] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
    const place = autocompleteRef.current?.getPlace();
    // resolvePlaceAddress falls back to geocoding when the place arrives
    // without address_components (seen in prod) — an applicant losing this
    // step means losing the signup entirely, so be maximally forgiving.
    void (async () => {
      try {
        const resolved = await resolvePlaceAddress(place, 'apply-address-step');
        if (!resolved) {
          setAddressError(SELECT_FROM_DROPDOWN_MSG);
          return;
        }

        const { street, city, state, zipCode: zip, country } = resolved;
        const homeLat = resolved.lat;
        const homeLng = resolved.lng;
        if (
          homeLat === null ||
          homeLng === null ||
          homeLat < -90 ||
          homeLat > 90 ||
          homeLng < -180 ||
          homeLng > 180
        ) {
          setAddressError('Selected address has invalid coordinates. Please try another selection.');
          return;
        }

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
          placeId: resolved.placeId,
          formattedAddress: resolved.formattedAddress,
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
    })();
  }, [value, onChange]);

  const handleAutocompleteLoad = useCallback((autocomplete: any) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const manualVerified =
    typeof value?.homeLat === 'number' &&
    typeof value?.homeLng === 'number' &&
    !isNaN(value.homeLat) &&
    !isNaN(value.homeLng);

  /**
   * Manual-mode edits mirror handleStreetTyping's contract: any change after a
   * successful verification strips the geocoded fields so a modified-but-
   * unverified address can never pass the wizard gate.
   */
  const handleManualField = (field: string, raw: string) => {
    const next: any = { ...value, [field]: raw };
    if (manualVerified || value?.placeId) {
      next.homeLat = undefined;
      next.homeLng = undefined;
      next.placeId = undefined;
      next.formattedAddress = undefined;
      next.country = undefined;
      next.addressGeocodedAt = undefined;
      next.addressVerifiedVia = undefined;
    }
    onChange(next);
    setAddressError(null);
  };

  const handleManualVerify = async () => {
    const street = String(value?.street || '').trim();
    const city = String(value?.city || '').trim();
    const state = String(value?.state || '').trim();
    const zip = String(value?.zip || '').trim();
    if (!street || !city || !state || !zip) {
      setAddressError('Please fill in street, city, state, and ZIP code.');
      return;
    }
    setVerifying(true);
    setAddressError(null);
    try {
      const call = httpsCallable(getFunctions(), 'placesGeocodeAddress');
      const resp: any = await call({ address: `${street}, ${city}, ${state} ${zip}` });
      const d = resp?.data;
      if (!d?.ok || typeof d.lat !== 'number' || typeof d.lng !== 'number') {
        setAddressError(
          "We couldn't verify that address. Double-check the street number, city, state, and ZIP — then tap Verify again.",
        );
        return;
      }
      // Prefer the geocoder's normalized fields; fall back to what the user
      // typed for anything the geocoder omits (e.g. rural results without a
      // postal_code component). Coordinates are the non-negotiable part.
      onChange({
        ...value,
        street: d.street || street,
        city: d.city || city,
        state: d.state || state,
        zip: d.zipCode || zip,
        homeLat: d.lat,
        homeLng: d.lng,
        placeId: d.placeId || undefined,
        formattedAddress: d.formattedAddress || undefined,
        country: d.country || undefined,
        addressGeocodedAt: new Date().toISOString(),
        addressVerifiedVia: 'manual_geocode',
      });
    } catch (err) {
      console.error('Manual address verify failed:', err);
      setAddressError("We couldn't verify that address right now. Please try again in a moment.");
    } finally {
      setVerifying(false);
    }
  };

  const enterManualMode = () => {
    setManualMode(true);
    setAddressError(null);
  };

  const exitManualMode = () => {
    setManualMode(false);
    setAddressError(null);
  };

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

  const manualGrid = (
    <Grid container spacing={2}>
      {manualVerified ? (
        <Grid item xs={12}>
          <Alert severity="success">✓ Address verified. You can proceed to the next step.</Alert>
        </Grid>
      ) : (
        <Grid item xs={12}>
          <Typography variant="body2" color="text.secondary">
            Type your full address and tap Verify — we'll check it for you.
          </Typography>
        </Grid>
      )}
      <Grid item xs={12}>
        <TextField
          fullWidth
          required
          label="Street Address"
          value={value.street || ''}
          onChange={(e) => handleManualField('street', e.target.value)}
          autoComplete="street-address"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Unit / Apt"
          value={value.unit || ''}
          onChange={(e) => handle('unit', e.target.value)}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          required
          label="City"
          value={value.city || ''}
          onChange={(e) => handleManualField('city', e.target.value)}
          autoComplete="address-level2"
        />
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField
          fullWidth
          required
          label="State"
          value={value.state || ''}
          onChange={(e) => handleManualField('state', e.target.value)}
          autoComplete="address-level1"
        />
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField
          fullWidth
          required
          label="Zip Code"
          value={value.zip || ''}
          onChange={(e) => handleManualField('zip', e.target.value)}
          autoComplete="postal-code"
          inputProps={{ inputMode: 'numeric' }}
        />
      </Grid>
      {addressError ? (
        <Grid item xs={12}>
          <Alert severity="error">{addressError}</Alert>
        </Grid>
      ) : null}
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {!manualVerified && (
            <Button
              variant="contained"
              onClick={handleManualVerify}
              disabled={verifying}
              startIcon={verifying ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {verifying ? 'Verifying…' : 'Verify address'}
            </Button>
          )}
          <Link component="button" type="button" variant="body2" onClick={exitManualMode}>
            Back to address search
          </Link>
        </Box>
      </Grid>
    </Grid>
  );

  const formGrid = manualMode ? (
    manualGrid
  ) : (
    <Grid container spacing={2}>
      <Grid item xs={12}>{wrappedStreetField}</Grid>
      {!verifiedFromGoogle && (
        <Grid item xs={12} sx={{ pt: '4px !important' }}>
          <Link component="button" type="button" variant="body2" onClick={enterManualMode}>
            Can't find your address in the dropdown? Enter it manually
          </Link>
        </Grid>
      )}
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

