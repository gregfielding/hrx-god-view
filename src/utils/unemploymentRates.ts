/**
 * Estimated SUTA (state) and FUTA (federal) unemployment tax rates by state.
 * Used for pricing/margin estimates. Verify with state DOL and IRS for compliance.
 *
 * SUTA: new-employer / typical rates (%). Rates and wage bases vary by state and experience.
 * FUTA: 0.6% effective (most states); credit-reduction states (e.g. CA, USVI) higher.
 */

export type StateCode = string;

/** Estimated new-employer SUTA rate as percentage (e.g. 2.7 = 2.7%). 2025 reference. */
const SUTA_NEW_EMPLOYER_RATE: Record<string, number> = {
  AL: 2.7, AK: 1.0, AZ: 2.0, AR: 3.0, CA: 3.4, CO: 1.7, CT: 1.9, DE: 1.8, FL: 2.7, GA: 2.7,
  HI: 2.4, ID: 1.3, IL: 3.95, IN: 2.5, IA: 1.0, KS: 2.7, KY: 2.7, LA: 1.1, ME: 2.0, MD: 2.6,
  MA: 1.9, MI: 2.7, MN: 1.0, MS: 2.0, MO: 2.4, MT: 1.2, NE: 1.2, NV: 2.95, NH: 1.0, NJ: 1.4,
  NM: 1.0, NY: 4.1, NC: 1.0, ND: 1.0, OH: 2.7, OK: 1.5, OR: 2.1, PA: 3.7, RI: 1.7, SC: 1.2,
  SD: 1.2, TN: 2.7, TX: 2.7, UT: 1.0, VT: 1.0, VA: 2.5, WA: 1.0, WV: 2.7, WI: 3.25, WY: 1.0,
  DC: 2.7,
};

/** FUTA effective rate as percentage. 0.6% standard; credit-reduction states higher (2025). */
const FUTA_EFFECTIVE_RATE: Record<string, number> = {
  CA: 1.8,   // credit reduction
  VI: 5.1,   // US Virgin Islands (if you use VI as code)
  // all others get standard 0.6%
};

const STANDARD_FUTA_RATE = 0.6;

/**
 * Get estimated SUTA rate (new employer) for a state.
 * @param stateCode Two-letter state code (e.g. "CA", "NY"). Case-insensitive.
 * @returns Rate as percentage (e.g. 2.7) or null if unknown.
 */
export function getSutaRateByState(stateCode: StateCode | null | undefined): number | null {
  if (!stateCode || typeof stateCode !== 'string') return null;
  const key = stateCode.trim().toUpperCase().slice(0, 2);
  const rate = SUTA_NEW_EMPLOYER_RATE[key];
  return rate != null ? rate : null;
}

/**
 * Get effective FUTA rate for a state (accounts for credit reduction).
 * @param stateCode Two-letter state code (e.g. "CA"). Case-insensitive.
 * @returns Rate as percentage (e.g. 0.6 or 1.8 for CA).
 */
export function getFutaRateByState(stateCode: StateCode | null | undefined): number {
  if (!stateCode || typeof stateCode !== 'string') return STANDARD_FUTA_RATE;
  const key = stateCode.trim().toUpperCase().slice(0, 2);
  return FUTA_EFFECTIVE_RATE[key] ?? STANDARD_FUTA_RATE;
}

/** US state codes for dropdowns (50 states + DC). */
export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
] as const;

/** Normalize state string to 2-letter code (e.g. "California" -> "CA", "ca" -> "CA"). */
const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', DC: 'DC',
};

/**
 * Normalize state to 2-letter code for lookup.
 * Accepts "CA", "ca", "California" and returns "CA".
 */
export function normalizeStateCode(state: string | null | undefined): string {
  if (!state || typeof state !== 'string') return '';
  const t = state.trim();
  if (t.length === 2) return t.toUpperCase();
  return STATE_NAME_TO_CODE[t] ?? t.toUpperCase().slice(0, 2);
}
