import { geocodeAddress } from './geocodeAddress';

// Removed unused ParsedAddress interface

export function parseAddress(address: string): { streetAddress: string; unit?: string } {
  if (!address || typeof address !== 'string') {
    return { streetAddress: '' };
  }

  const addressLower = address.toLowerCase().trim();
  
  // Common street suffixes to avoid treating as units
  const streetSuffixes = [
    'rd', 'road', 'st', 'street', 'ave', 'avenue', 'blvd', 'boulevard',
    'ln', 'lane', 'dr', 'drive', 'ct', 'court', 'pl', 'place',
    'way', 'circle', 'crescent', 'terrace', 'parkway', 'highway',
    'n', 's', 'e', 'w', 'north', 'south', 'east', 'west'
  ];
  
  // Common unit/suite patterns
  const unitPatterns = [
    /ste\s+([a-z0-9]+)/i,           // ste b, ste 100
    /suite\s+([a-z0-9]+)/i,         // suite 100, suite a
    /unit\s+([a-z0-9]+)/i,          // unit 5, unit a
    /apt\s+([a-z0-9]+)/i,           // apt 2b, apt 100
    /apartment\s+([a-z0-9]+)/i,     // apartment 100
    /#\s*([a-z0-9]+)/i,             // #100, #a
    /floor\s+([a-z0-9]+)/i,         // floor 2
    /fl\s+([a-z0-9]+)/i,            // fl 2
    /room\s+([a-z0-9]+)/i,          // room 100
    /rm\s+([a-z0-9]+)/i,            // rm 100
    /building\s+([a-z0-9]+)/i,      // building a
    /bldg\s+([a-z0-9]+)/i,          // bldg a
    // More specific patterns to avoid catching street suffixes
    /\s+([a-z0-9]+)\s*$/i,          // anything at the end that looks like a unit (with space)
  ];

  let unit: string | undefined;
  let cleanAddress = address;

  // Try to find and extract unit information
  for (const pattern of unitPatterns) {
    const match = addressLower.match(pattern);
    if (match) {
      const potentialUnit = match[1].toLowerCase();
      
      // Skip if this looks like a street suffix
      if (streetSuffixes.includes(potentialUnit)) {
        continue;
      }
      
      unit = match[1].toUpperCase();
      
      // Remove the unit from the address
      const unitPattern = new RegExp(pattern.source, 'i');
      cleanAddress = address.replace(unitPattern, '').trim();
      
      // Clean up any trailing punctuation or extra spaces
      cleanAddress = cleanAddress.replace(/[,\s]+$/, '').trim();
      
      console.log(`Parsed address: "${address}" → Street: "${cleanAddress}", Unit: "${unit}"`);
      break;
    }
  }

  return unit ? { streetAddress: cleanAddress, unit } : { streetAddress: cleanAddress };
}

export async function validateAndGeocodeAddress(
  streetAddress: string,
  city: string,
  state: string,
  zip: string,
  country: string,
  unit?: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    // Build full address for geocoding
    const addressParts = [streetAddress, city, state, zip, country].filter(part => part.trim());
    if (addressParts.length === 0) {
      console.log('No address data available for geocoding');
      return null;
    }

    const fullAddress = addressParts.join(', ');
    console.log(`Geocoding address: ${fullAddress}${unit ? ` (Unit: ${unit})` : ''}`);
    
    // Add timeout to geocoding to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Geocoding timeout')), 8000) // 8 second timeout
    );
    
    const geocodePromise = geocodeAddress(fullAddress);
    const coordinates = await Promise.race([geocodePromise, timeoutPromise]);
    
    console.log(`Geocoding successful: ${coordinates.lat}, ${coordinates.lng}`);
    return coordinates;
  } catch (error) {
    console.warn(`Geocoding failed for address: ${streetAddress}, ${city}, ${state} ${zip}`, error);
    return null;
  }
}

export async function processCompanyAddress(company: any): Promise<{
  streetAddress: string;
  unit?: string;
  coordinates?: { lat: number; lng: number };
}> {
  const address = company['Address'] || '';
  const city = company['City'] || '';
  const state = company['State'] || '';
  const zip = company['Zip'] || company['Zipcode'] || '';
  const country = company['Country'] || '';

  // Parse the address to extract unit information
  const { streetAddress, unit } = parseAddress(address);

  // Try to geocode the address
  const coordinates = await validateAndGeocodeAddress(
    streetAddress,
    city,
    state,
    zip,
    country,
    unit
  );

  const result: { streetAddress: string; unit?: string; coordinates?: { lat: number; lng: number } } = {
    streetAddress
  };
  if (unit) {
    result.unit = unit;
  }
  if (coordinates) {
    result.coordinates = coordinates;
  }
  return result;
} 