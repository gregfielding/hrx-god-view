/**
 * Client-facing geocode fallback for Places autocomplete selections.
 *
 * Why (2026-07-09): interpolated addresses (e.g. "100 Carson Park Drive,
 * Eau Claire, WI" — no rooftop listing) come out of the Autocomplete widget
 * with a synthetic place_id whose details fetch fails, so the client gets a
 * place with a formatted string but NO address_components — city/state/zip
 * can't be filled. The browser Maps key is API-restricted and returns
 * REQUEST_DENIED for the JS Geocoder, so the client can't recover on its
 * own; this callable geocodes with GOOGLE_MAPS_SERVER_KEY (Geocoding-only
 * key, see integrations/fieldglass/serverGeocode.ts for provisioning) and
 * returns the parsed result. Consumed by src/utils/placesAddress.ts.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

interface GeocodeComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function component(components: GeocodeComponent[], type: string): GeocodeComponent | undefined {
  return components.find((c) => c.types?.includes(type));
}

export const placesGeocodeAddress = onCall({ memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const address = String(request.data?.address ?? '').trim();
  if (!address || address.length > 300) {
    throw new HttpsError('invalid-argument', 'address must be a non-empty string (max 300 chars).');
  }

  const key = String(process.env.GOOGLE_MAPS_SERVER_KEY ?? '').trim();
  if (!key) {
    logger.error('[placesGeocodeAddress] GOOGLE_MAPS_SERVER_KEY unset');
    return { ok: false };
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = (await resp.json()) as {
      status: string;
      results?: Array<{
        formatted_address?: string;
        place_id?: string;
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: GeocodeComponent[];
      }>;
    };
    if (data.status !== 'OK' || !data.results?.length) {
      if (data.status !== 'ZERO_RESULTS') {
        logger.warn('[placesGeocodeAddress] non-OK status', { status: data.status, address });
      }
      return { ok: false, status: data.status };
    }
    const r = data.results[0];
    const comps = r.address_components ?? [];
    const streetNumber = component(comps, 'street_number')?.long_name ?? '';
    const route = component(comps, 'route')?.long_name ?? '';
    return {
      ok: true,
      street: `${streetNumber} ${route}`.trim(),
      city:
        component(comps, 'locality')?.long_name ??
        component(comps, 'sublocality')?.long_name ??
        component(comps, 'sublocality_level_1')?.long_name ??
        component(comps, 'postal_town')?.long_name ??
        component(comps, 'administrative_area_level_2')?.long_name ??
        '',
      state: component(comps, 'administrative_area_level_1')?.short_name ?? '',
      zipCode: component(comps, 'postal_code')?.long_name ?? '',
      country: component(comps, 'country')?.short_name ?? '',
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
      formattedAddress: r.formatted_address ?? '',
      placeId: r.place_id ?? null,
    };
  } catch (err) {
    logger.warn('[placesGeocodeAddress] request failed', {
      address,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false };
  }
});
