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
 * they're absent it geocodes `formatted_address || name` with the already
 * loaded Maps JS Geocoder and parses the top result instead. Every call
 * writes a one-line diagnostic to localStorage (`hrx_places_diag`) — shared
 * across same-origin tabs, so a session debugging in one tab can read what a
 * user's tab actually received.
 */

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
    const geocoderAvailable = !!(window as any).google?.maps?.Geocoder;
    if (!query || !geocoderAvailable) {
      writeDiag(surface, {
        path: 'unresolvable',
        placeKeys: Object.keys(place),
        query,
        geocoderAvailable,
      });
      return null;
    }
    try {
      const geocoder = new (window as any).google.maps.Geocoder();
      const response = await geocoder.geocode({ address: query });
      const top = response?.results?.[0];
      if (!top || !Array.isArray(top.address_components)) {
        writeDiag(surface, { path: 'geocode-empty', placeKeys: Object.keys(place), query });
        return null;
      }
      components = top.address_components;
      geometry = top.geometry;
      formatted = top.formatted_address || formatted || query;
      placeId = top.place_id || placeId;
      path = 'geocoded';
    } catch (err: any) {
      writeDiag(surface, {
        path: 'geocode-error',
        placeKeys: Object.keys(place),
        query,
        error: String(err?.message || err).slice(0, 120),
      });
      return null;
    }
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
