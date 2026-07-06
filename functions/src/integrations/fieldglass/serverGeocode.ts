/**
 * **Server-side geocoding for the Fieldglass auto-ensure path (FG Slice 4b).**
 *
 * The client Maps key is browser-restricted (verified REQUEST_DENIED from
 * server context, 2026-07-06), so parse-time automation uses a dedicated
 * key in `GOOGLE_MAPS_SERVER_KEY` — API-restricted to the Geocoding API
 * only, no referrer restriction. Provisioned via:
 *
 *   gcloud services enable geocoding-backend.googleapis.com --project=hrx1-d3beb
 *   gcloud services api-keys create --display-name="HRX functions server geocoding" \
 *     --api-target=service=geocoding-backend.googleapis.com --project=hrx1-d3beb
 *
 * Fail-open by design: key unset, quota hit, timeout, no street in the
 * result, or a state mismatch all return null — the caller keeps the
 * directory city/state/zip and the street stays backfillable through the
 * /shifts/log dialog.
 *
 * The state check matters: geocoding a food-service unit name like
 * "PSH LANCASTER MED CENTER FOOD" can partial-match somewhere else in the
 * country. A hit whose state differs from the Sodexo directory's state for
 * that site is worse than no street at all, so it's rejected.
 */

import { logger } from 'firebase-functions/v2';

export interface ServerGeocodeHit {
  street: string;
  city?: string;
  state?: string;
  zipCode?: string;
  lat: number;
  lng: number;
  formattedAddress?: string;
}

interface GeocodeComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function component(components: GeocodeComponent[], type: string): GeocodeComponent | undefined {
  return components.find((c) => c.types?.includes(type));
}

export async function serverGeocodeSite(params: {
  siteName: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Reject hits outside this state (USPS code, e.g. "PA"). */
  expectedState?: string;
}): Promise<ServerGeocodeHit | null> {
  const key = String(process.env.GOOGLE_MAPS_SERVER_KEY ?? '').trim();
  if (!key) return null;

  const query = [params.siteName, params.city, [params.state, params.zip].filter(Boolean).join(' ')]
    .filter((s) => String(s ?? '').trim())
    .join(', ');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = (await resp.json()) as {
      status: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: GeocodeComponent[];
      }>;
    };
    if (data.status !== 'OK' || !data.results?.length) {
      if (data.status !== 'ZERO_RESULTS') {
        logger.warn('[serverGeocodeSite] non-OK status', { status: data.status, query });
      }
      return null;
    }
    const r = data.results[0];
    const comps = r.address_components ?? [];
    const streetNumber = component(comps, 'street_number')?.long_name ?? '';
    const route = component(comps, 'route')?.long_name ?? '';
    const street = `${streetNumber} ${route}`.trim();
    if (!route) return null; // no usable street — keep the fallback address

    const stateCode = component(comps, 'administrative_area_level_1')?.short_name ?? '';
    if (params.expectedState && stateCode && stateCode !== params.expectedState.toUpperCase()) {
      logger.warn('[serverGeocodeSite] state mismatch — rejecting hit', {
        query,
        expectedState: params.expectedState,
        got: stateCode,
        formatted: r.formatted_address,
      });
      return null;
    }

    const loc = r.geometry?.location;
    if (!loc) return null;
    return {
      street,
      city:
        component(comps, 'locality')?.long_name ??
        component(comps, 'sublocality')?.long_name ??
        undefined,
      state: stateCode || undefined,
      zipCode: component(comps, 'postal_code')?.long_name ?? undefined,
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: r.formatted_address,
    };
  } catch (err) {
    logger.warn('[serverGeocodeSite] request failed (fail-open)', {
      query,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
