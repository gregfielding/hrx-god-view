const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number }> {
  if (!apiKey) throw new Error('Google Maps API key is not set');
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address,
    )}&key=${apiKey}`,
  );
  const data = await response.json();
  if (data.status === 'OK') {
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  }
  throw new Error('Geocoding failed');
}
