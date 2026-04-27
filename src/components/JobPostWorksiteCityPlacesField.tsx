import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { TextField, type TextFieldProps } from '@mui/material';
import {
  formatCityStateZipInput,
  parseCityStateZipInput,
} from '../utils/cityStateZipInput';

export type JobPostWorksiteCityCommit = {
  city: string;
  state: string;
  zipCode: string;
  worksiteName: string;
  coordinates?: { lat: number; lng: number };
  /** When set (e.g. place pick), overwrite street; omit on manual blur to leave street unchanged */
  street?: string;
};

function placeToCommit(place: google.maps.places.PlaceResult): JobPostWorksiteCityCommit | null {
  const loc = place.geometry?.location;
  if (!loc) return null;

  let city = '';
  let state = '';
  let zipCode = '';

  place.address_components?.forEach((component) => {
    if (component.types.includes('locality')) {
      city = component.long_name;
    }
    if (component.types.includes('administrative_area_level_1')) {
      state = component.short_name;
    }
    if (component.types.includes('postal_code')) {
      zipCode = component.long_name;
    }
  });

  const ac = place.address_components || [];
  const pick = (t: string) => ac.find((c) => c.types.includes(t))?.long_name || '';
  if (!city) {
    city =
      pick('sublocality') ||
      pick('sublocality_level_1') ||
      pick('administrative_area_level_3') ||
      pick('postal_town') ||
      '';
  }
  if (!city && place.name) {
    city = place.name.replace(/,.*$/, '').trim();
  }

  return {
    city,
    state,
    zipCode,
    street: '',
    worksiteName: (place.formatted_address || `${city}, ${state}`).trim(),
    coordinates: { lat: loc.lat(), lng: loc.lng() },
  };
}

function manualBlurCommit(raw: string): JobPostWorksiteCityCommit {
  const parsed = parseCityStateZipInput(raw);
  const hasLoc = !!(parsed.city?.trim() && parsed.state?.trim());
  return {
    city: parsed.city,
    state: parsed.state,
    zipCode: parsed.zipCode,
    worksiteName: hasLoc ? formatCityStateZipInput(parsed.city, parsed.state, parsed.zipCode) : '',
    coordinates: undefined,
  };
}

export type JobPostWorksiteCityPlacesFieldProps = {
  /** When the saved form value changes (load / parent update), sync the input if it is not focused. */
  committedLine: string;
  mapsReady: boolean;
  onCommit: (patch: JobPostWorksiteCityCommit) => void;
  disabled?: boolean;
  required?: boolean;
  helperText?: string;
  placeholder?: string;
};

/**
 * Google Places Autocomplete bound imperatively to an **uncontrolled** input.
 * Avoids @react-google-maps/api Autocomplete + MUI controlled TextField conflicts.
 */
const JobPostWorksiteCityPlacesField: React.FC<JobPostWorksiteCityPlacesFieldProps> = ({
  committedLine,
  mapsReady,
  onCommit,
  disabled,
  required,
  helperText = 'Search and pick a city, or type City, ST (ZIP optional) and tab out.',
  placeholder = 'Search for a city…',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputEl, setInputEl] = React.useState<HTMLInputElement | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const committedLineRef = useRef(committedLine);
  committedLineRef.current = committedLine;
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    setInputEl(el);
  }, []);

  // Sync Firestore / parent value → DOM when user is not typing (layout phase avoids empty flash on edit load)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = committedLine;
  }, [committedLine, inputEl]);

  useEffect(() => {
    if (!mapsReady || !inputEl || typeof google === 'undefined' || !google.maps?.places) {
      return;
    }

    const ac = new google.maps.places.Autocomplete(inputEl, {
      types: ['(cities)'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components', 'formatted_address', 'geometry', 'name'],
    });

    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el && document.activeElement !== el) {
        el.value = committedLineRef.current;
      }
    });

    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const patch = placeToCommit(place);
      if (!patch) return;
      onCommitRef.current(patch);
      const line = formatCityStateZipInput(patch.city, patch.state, patch.zipCode);
      if (inputRef.current) {
        inputRef.current.value = line || patch.worksiteName;
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      listener.remove();
      google.maps.event.clearInstanceListeners(ac);
    };
  }, [mapsReady, inputEl]);

  const handleBlur: TextFieldProps['onBlur'] = () => {
    const raw = inputRef.current?.value ?? '';
    onCommitRef.current(manualBlurCommit(raw));
  };

  const tfProps: TextFieldProps = {
    fullWidth: true,
    label: 'City, State',
    required,
    disabled,
    placeholder,
    helperText,
    inputRef: setInputRef,
    onBlur: handleBlur,
  };

  return <TextField {...tfProps} />;
};

export default JobPostWorksiteCityPlacesField;
