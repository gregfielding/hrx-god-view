/**
 * Robust extraction of a structured address from a Places selection.
 *
 * Why this exists (2026-07-09): even with the widget's `fields` requesting
 * `address_components`, production selections have come back with only a
 * formatted string (input rewritten to "100 Carson Park Drive, Eau Claire,
 * WI, USA" but `getPlace()` carrying no components) — so handlers that read
 * `place.address_components` directly filled the address line and left
 * city/state/zip empty, or hard-errored on the applicant signup step.
 *
 * `resolvePlaceAddress` first tries the components on the place itself; when
 * they're absent it geocodes `formatted_address || name` via the
 * `placesGeocodeAddress` callable (the BROWSER key is API-restricted —
 * `google.maps.Geocoder` returns REQUEST_DENIED, verified live — so the
 * server key does the lookup), falling back to parsing the formatted string
 * itself ("street, city, ST, USA" — no zip) if the callable fails. Every
 * call writes a one-line diagnostic to localStorage (`hrx_places_diag`) —
 * shared across same-origin tabs, so a session debugging in one tab can
 * read what a user's tab actually received.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

export interface ResolvedPlaceAddress {
  street: string;
  city: string;
  /** Short name, e.g. "CA" — matches the wizard / Firestore `state` convention. */
  state: string;
  zipCode: string;
  /** Short ISO, e.g. "US". */
  country: string;
  formattedAddress: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}

const DIAG_KEY = 'hrx_places_diag';

function writeDiag(surface: string, entry: Record<string, unknown>): void {
  try {
    const prior = JSON.parse(window.localStorage.getItem(DIAG_KEY) || '[]');
    const list = Array.isArray(prior) ? prior : [];
    list.push({ at: new Date().toISOString(), surface, ...entry });
    window.localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* best effort */
  }
}

function parseComponents(components: any[]): {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
} {
  const get = (types: string[], useShort = false): string => {
    const c = components.find((comp: any) => types.every((t) => comp?.types?.includes(t)));
    if (!c) return '';
    return (useShort ? c.short_name : c.long_name) || '';
  };
  const streetNumber = get(['street_number']);
  const route = get(['route']);
  return {
    street: `${streetNumber} ${route}`.trim(),
    city:
      get(['locality']) ||
      get(['sublocality']) ||
      get(['sublocality_level_1']) ||
      get(['postal_town']) ||
      get(['administrative_area_level_2']),
    state: get(['administrative_area_level_1'], true),
    zipCode: get(['postal_code']),
    country: get(['country'], true) || get(['country']) || '',
  };
}

function extractLatLng(geometry: any): { lat: number | null; lng: number | null } {
  const location = geometry?.location;
  if (!location) return { lat: null, lng: null };
  const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
  const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
  return {
    lat: typeof lat === 'number' && !isNaN(lat) ? lat : null,
    lng: typeof lng === 'number' && !isNaN(lng) ? lng : null,
  };
}

export async function resolvePlaceAddress(
  place: any,
  surface: string,
): Promise<ResolvedPlaceAddress | null> {
  if (!place) {
    writeDiag(surface, { path: 'no-place' });
    return null;
  }

  let components: any[] | undefined = Array.isArray(place.address_components)
    ? place.address_components
    : undefined;
  let geometry = place.geometry;
  let formatted: string =
    typeof place.formatted_address === 'string' ? place.formatted_address : '';
  let placeId: string | null = typeof place.place_id === 'string' ? place.place_id : null;
  let path = 'components';

  if (!components || components.length === 0) {
    const query = (formatted || place.name || '').trim();
    if (!query) {
      writeDiag(surface, { path: 'unresolvable', placeKeys: Object.keys(place) });
      return null;
    }
    try {
      const call = httpsCallable(getFunctions(), 'placesGeocodeAddress');
      const resp: any = await call({ address: query });
      const d = resp?.data;
      if (d?.ok) {
        const { lat, lng } = { lat: d.lat ?? null, lng: d.lng ?? null };
        const result: ResolvedPlaceAddress = {
          street: d.street || '',
          city: d.city || '',
          state: d.state || '',
          zipCode: d.zipCode || '',
          country: d.country || '',
          formattedAddress: d.formattedAddress || query,
          placeId: d.placeId || placeId,
          lat,
          lng,
        };
        writeDiag(surface, {
          path: 'server-geocoded',
          placeKeys: Object.keys(place),
          filled: {
            street: !!result.street,
            city: !!result.city,
            state: !!result.state,
            zip: !!result.zipCode,
            coords: lat !== null,
          },
        });
        return result;
      }
      writeDiag(surface, {
        path: 'server-geocode-miss',
        placeKeys: Object.keys(place),
        query,
        status: d?.status,
      });
    } catch (err: any) {
      writeDiag(surface, {
        path: 'server-geocode-error',
        placeKeys: Object.keys(place),
        query,
        error: String(err?.message || err).slice(0, 120),
      });
    }
    // Last resort: parse the canonical description "street, city, ST, USA".
    // No zip and no coordinates — surfaces that require them will still show
    // their validation message, but forms like Add Location get street +
    // city + state filled for manual completion.
    const parts = query.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const stateToken = (parts[parts.length - 2] || '').split(/\s+/)[0] || '';
      const zipToken = (parts[parts.length - 2] || '').split(/\s+/)[1] || '';
      const result: ResolvedPlaceAddress = {
        street: parts[0],
        city: parts[1],
        state: stateToken,
        zipCode: zipToken,
        country: /^(usa|us|united states)$/i.test(parts[parts.length - 1]) ? 'US' : '',
        formattedAddress: query,
        placeId,
        lat: null,
        lng: null,
      };
      writeDiag(surface, { path: 'string-parsed', placeKeys: Object.keys(place) });
      return result;
    }
    writeDiag(surface, { path: 'string-parse-failed', placeKeys: Object.keys(place), query });
    return null;
  }

  const parsed = parseComponents(components!);
  const { lat, lng } = extractLatLng(geometry);
  const result: ResolvedPlaceAddress = {
    ...parsed,
    country: parsed.country,
    formattedAddress:
      formatted ||
      [parsed.street, [parsed.city, parsed.state].filter(Boolean).join(', '), parsed.zipCode]
        .filter(Boolean)
        .join(', '),
    placeId,
    lat,
    lng,
  };
  writeDiag(surface, {
    path,
    placeKeys: Object.keys(place),
    filled: {
      street: !!result.street,
      city: !!result.city,
      state: !!result.state,
      zip: !!result.zipCode,
      coords: lat !== null,
    },
  });
  return result;
}
