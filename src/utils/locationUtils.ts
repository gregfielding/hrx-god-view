/**
 * Location utilities for proximity-based searches and job matching
 */

/**
 * Calculate the distance between two coordinates using the Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in miles
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 10) / 10; // Round to 1 decimal place
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a location is within a specified radius of another location
 * @param userLat User's latitude
 * @param userLng User's longitude
 * @param jobLat Job location latitude
 * @param jobLng Job location longitude
 * @param radiusInMiles Radius in miles
 * @returns True if within radius
 */
export function isWithinRadius(
  userLat: number,
  userLng: number,
  jobLat: number,
  jobLng: number,
  radiusInMiles: number
): boolean {
  const distance = calculateDistance(userLat, userLng, jobLat, jobLng);
  return distance <= radiusInMiles;
}

/**
 * Filter jobs by proximity to user's location
 * @param jobs Array of job objects with lat/lng properties
 * @param userLat User's latitude
 * @param userLng User's longitude
 * @param maxDistance Maximum distance in miles
 * @returns Filtered array of jobs within the specified distance
 */
export function filterJobsByProximity(
  jobs: Array<{ lat: number; lng: number; [key: string]: any }>,
  userLat: number,
  userLng: number,
  maxDistance: number
): Array<{ lat: number; lng: number; distance: number; [key: string]: any }> {
  return jobs
    .map(job => ({
      ...job,
      distance: calculateDistance(userLat, userLng, job.lat, job.lng)
    }))
    .filter(job => job.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
}

/**
 * Filter candidates by proximity to job location
 * @param candidates Array of candidate objects with homeLat/homeLng properties
 * @param jobLat Job location latitude
 * @param jobLng Job location longitude
 * @param maxDistance Maximum distance in miles
 * @returns Filtered array of candidates within the specified distance
 */
export function filterCandidatesByProximity(
  candidates: Array<{ homeLat?: number; homeLng?: number; [key: string]: any }>,
  jobLat: number,
  jobLng: number,
  maxDistance: number
): Array<{ homeLat?: number; homeLng?: number; distance: number; [key: string]: any }> {
  return candidates
    .filter(candidate => candidate.homeLat && candidate.homeLng) // Only include candidates with coordinates
    .map(candidate => ({
      ...candidate,
      distance: calculateDistance(candidate.homeLat!, candidate.homeLng!, jobLat, jobLng)
    }))
    .filter(candidate => candidate.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
}

/**
 * Get distance-based search suggestions for common commuting distances
 */
export const COMMUTING_DISTANCES = {
  LOCAL: 10,      // 10 miles - local area
  REGIONAL: 25,   // 25 miles - regional area
  METRO: 50,      // 50 miles - metro area
  EXTENDED: 100   // 100 miles - extended area
} as const;

/**
 * Format distance for display
 * @param distance Distance in miles
 * @returns Formatted distance string
 */
export function formatDistance(distance: number): string {
  if (distance < 1) {
    return `${Math.round(distance * 10) / 10} mi`;
  }
  return `${Math.round(distance)} mi`;
}

/**
 * Get proximity description for a given distance
 * @param distance Distance in miles
 * @returns Human-readable proximity description
 */
export function getProximityDescription(distance: number): string {
  if (distance <= 5) return 'Very Close';
  if (distance <= 15) return 'Close';
  if (distance <= 30) return 'Nearby';
  if (distance <= 50) return 'Regional';
  if (distance <= 100) return 'Extended';
  return 'Remote';
}
