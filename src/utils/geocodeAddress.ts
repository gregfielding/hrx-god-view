const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

export type GeocodeDetails = {
  lat: number;
  lng: number;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  formattedAddress?: string;
};

const getComponent = (components: any[], types: string[]) =>
  components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';

export async function geocodeAddressDetailed(address: string): Promise<GeocodeDetails> {
  if (!apiKey) throw new Error('Google Maps API key is not set');
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address,
    )}&key=${apiKey}`,
  );
  const data = await response.json();
  if (data.status !== 'OK' || !data.results?.length) {
    const statusMessage = data.status === 'ZERO_RESULTS' 
      ? 'No results found for this address'
      : data.status === 'OVER_QUERY_LIMIT'
      ? 'Geocoding API quota exceeded'
      : data.status === 'REQUEST_DENIED'
      ? 'Geocoding API request denied. Please enable the Geocoding API in Google Cloud Console for your API key, or check API key restrictions.'
      : data.status === 'INVALID_REQUEST'
      ? 'Invalid address format'
      : `Geocoding failed (status: ${data.status})`;
    throw new Error(statusMessage);
  }

  const result = data.results[0];
  const components = result.address_components || [];
  const streetNumber = getComponent(components, ['street_number']);
  const route = getComponent(components, ['route']);
  const street = `${streetNumber} ${route}`.trim();
  const city =
    getComponent(components, ['locality']) ||
    getComponent(components, ['sublocality']) ||
    getComponent(components, ['administrative_area_level_2']);
  const state = getComponent(components, ['administrative_area_level_1']);
  const zip = getComponent(components, ['postal_code']);

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    street: street || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    formattedAddress: result.formatted_address,
  };
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number }> {
  const detailed = await geocodeAddressDetailed(address);
  return { lat: detailed.lat, lng: detailed.lng };
}

const MSG_API_KEY =
  'Google Maps API key is not set. Set REACT_APP_GOOGLE_MAPS_API_KEY and enable Geocoding API.';
const MSG_FAILED_WITH_SUGGESTIONS =
  'Geocoding failed. Select an address from the suggestions above, or check that the Geocoding API is enabled for your API key.';
const MSG_FAILED_GENERIC =
  'Geocoding failed. Check the address or ensure the Geocoding API is enabled for your API key.';

/**
 * Returns a user-facing message for geocoding errors. Use in catch blocks when calling geocodeAddress / geocodeAddressDetailed.
 */
export function getGeocodingErrorMessage(
  error: unknown,
  options?: { hasAutocomplete?: boolean }
): string {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (msg === 'Google Maps API key is not set') return MSG_API_KEY;
  return options?.hasAutocomplete === true ? MSG_FAILED_WITH_SUGGESTIONS : MSG_FAILED_GENERIC;
}
